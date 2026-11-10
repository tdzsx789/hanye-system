import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("function groupCustomerStatementFeeColumns");
const end = source.indexOf("function pdfTextWithWeight", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({
  textValue(value) {
    return value === null || value === undefined ? "" : String(value);
  },
  isExportFeeItemColumn(column = {}) {
    return Boolean(column.feeName || String(column.key || "").startsWith("fee-item-"));
  },
  exportColumnCurrencyLabel(column = {}) {
    return column.feeCurrency || "";
  }
});
vm.runInContext(source.slice(start, end), context);

function column(key, feeCurrency = "") {
  return feeCurrency ? { key, feeName: key, feeCurrency } : { key };
}

test("恒泰通客户对账单按人民币、港币分组并放置对应合计", () => {
  const result = context.groupCustomerStatementFeeColumns(
    [column("date"), column("fee-hkd", "HKD"), column("plate"), column("fee-rmb", "RMB")],
    [column("__hkdTotal"), column("__rmbTotal")],
    "恒泰通",
    [],
    true
  );

  assert.deepEqual(
    Array.from(result.bodyColumns, ({ key }) => key),
    ["date", "fee-rmb", "fee-hkd", "plate"]
  );
  assert.deepEqual(Array.from(result.totalColumns, ({ key }) => key), ["__rmbTotal", "__hkdTotal"]);
});

test("所有客户对账单都按人民币、港币分组", () => {
  const columns = [column("date"), column("fee-hkd", "HKD"), column("fee-rmb", "RMB")];
  const totals = [column("__hkdTotal"), column("__rmbTotal")];
  const grouped = context.groupCustomerStatementFeeColumns(columns, totals, "", [{ customer: "恒泰通慧华" }], true);
  assert.deepEqual(Array.from(grouped.bodyColumns, ({ key }) => key), ["date", "fee-rmb", "fee-hkd"]);
  assert.deepEqual(Array.from(grouped.totalColumns, ({ key }) => key), ["__rmbTotal", "__hkdTotal"]);

  const ordinaryCustomer = context.groupCustomerStatementFeeColumns(columns, totals, "其他客户", [{ customer: "其他客户" }], true);
  assert.deepEqual(Array.from(ordinaryCustomer.bodyColumns, ({ key }) => key), ["date", "fee-rmb", "fee-hkd"]);
  assert.deepEqual(Array.from(ordinaryCustomer.totalColumns, ({ key }) => key), ["__rmbTotal", "__hkdTotal"]);
});
