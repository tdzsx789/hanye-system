import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("function normalizeExportExchange");
const end = source.indexOf("function exportFilenamePart", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

function createContext() {
  const context = vm.createContext({
    Array,
    Math,
    Number,
    Object,
    Set,
    String,
    formatExportAmount(value) {
      return String(Number(value || 0));
    },
    normalizeCustomerVatRate(value) {
      const rate = Number(value || 0);
      return Number.isFinite(rate) && rate > 0 ? rate : 0;
    },
    textValue(value) {
      return String(value ?? "");
    },
    orderIsCharged() {
      return false;
    },
    isExportAmountColumn(column = {}) {
      return column.amount === true;
    },
    isLinkedCustomsItemCountExportColumn() {
      return false;
    },
    exportOrderColumnAmount(order, column) {
      if (column.key === "__rmbTotal") return Number(order.receivableRMB || 0);
      if (column.key === "__hkdTotal") return Number(order.receivableHKD || 0);
      return 0;
    },
    exportOrderColumnValue() {
      return "";
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test("customer statement VAT row uses the configured rate and converted total", () => {
  const context = createContext();
  const columns = [
    { key: "__sequence" },
    { key: "__rmbTotal", amount: true },
    { key: "__hkdTotal", amount: true }
  ];
  const result = context.exportTableRowData(
    [{ receivableHKD: 100, receivableRMB: 20, customerVatRate: 13 }],
    columns,
    { mode: "hkd-to-rmb", rate: 2 },
    { includeSettlementTotal: true, includeVatRow: true }
  );
  const vatRow = result.rows.find((row) => row.kind === "vatTotal");
  assert.ok(vatRow);
  assert.equal(vatRow.values[vatRow.labelIndex], "含13%增值税价格：");
  assert.equal(vatRow.values[vatRow.targetIndex], "248.6");
});

test("customer statement VAT row is omitted when the customer tax point is zero", () => {
  const context = createContext();
  const columns = [{ key: "__sequence" }, { key: "__rmbTotal", amount: true }];
  const result = context.exportTableRowData(
    [{ receivableHKD: 100, receivableRMB: 20, customerVatRate: 0 }],
    columns,
    { mode: "hkd-to-rmb", rate: 2 },
    { includeSettlementTotal: true, includeVatRow: true }
  );
  assert.equal(result.rows.some((row) => row.kind === "vatTotal"), false);
});

test("customer statement VAT row still appears without an exchange rate", () => {
  const context = createContext();
  const columns = [
    { key: "__sequence" },
    { key: "__hkdTotal", amount: true },
    { key: "__rmbTotal", amount: true }
  ];
  const result = context.exportTableRowData(
    [{ receivableHKD: 100, receivableRMB: 20, customerVatRate: 6 }],
    columns,
    null,
    { includeSettlementTotal: false, includeVatRow: true }
  );
  const vatRow = result.rows.find((row) => row.kind === "vatTotal");
  assert.ok(vatRow);
  assert.equal(vatRow.values[1], "106");
  assert.equal(vatRow.values[2], "21.2");
});
