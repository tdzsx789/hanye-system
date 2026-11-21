import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
function sourceFunction(name, async = false) {
  const start = source.indexOf(`${async ? "async " : ""}function ${name}(`);
  const end = source.indexOf("\n}", start);
  assert.ok(start >= 0 && end > start, `missing function: ${name}`);
  return source.slice(start, end + 2);
}

// Different transport customers can share a full company name. Put the
// airport record first to reproduce the former name-only lookup.
const customers = [
  { id: "KH00021172", name: "肯发高精设备(深圳)有限公司", shortName: "肯发宝安机场", type: "客户", customerCategory: "运输客户" },
  { id: "KH00021002", name: "肯发高精设备(深圳)有限公司", shortName: "肯发", type: "客户", customerCategory: "运输客户" },
  { id: "KH00021112", name: "肯发精密仪器(深圳)有限公司", shortName: "肯发精密", type: "客户", customerCategory: "运输客户" }
];

function createContext(customerRecords = customers) {
  const context = vm.createContext({
    customerRows: { value: customerRecords },
    customerRowsById: { value: new Map(customerRecords.map((customer) => [customer.id, customer])) },
    partnerRowsByTypedLabel: { value: new Map() },
    customerMatchesCategory: (customer, category) => customer.type === "客户" && customer.customerCategory === category,
    statementExportType: { value: "customer" },
    supplierDisplayLabel: (value) => value,
  });
  vm.runInContext([
    "customerShortDisplay", "partnerLookupKey", "findPartnerByTypedLabel",
    "transportCustomerById", "transportCustomerByName", "transportCustomerByReference",
    "transportCustomerLabelByReference", "customsCustomerById", "customsCustomerByName",
    "customsCustomerByReference", "customsCustomerLabelByReference",
    "exportFilenamePart", "statementFilenamePeriodLabel",
    "monthlyStatementExportFilename", "statementExportFilename",
  ].map((name) => sourceFunction(name)).join("\n"), context);
  return context;
}

test("statement filenames use the selected customer's id when full names are identical", () => {
  const context = createContext();
  const fullName = customers[1].name;
  assert.equal(context.statementExportFilename(fullName, "2026-10-21", "2026-11-20", "xlsx", "KH00021002"),
    "肯发2026年10月至2026年11月运输对账单.xlsx");
  assert.equal(context.statementExportFilename(fullName, "2026-10-21", "2026-11-20", "xlsx", "KH00021172"),
    "肯发宝安机场2026年10月至2026年11月运输对账单.xlsx");
  assert.equal(context.statementExportFilename(customers[2].name, "2026-11-01", "2026-11-30", "pdf", "KH00021112"),
    "肯发精密2026年11月运输对账单.pdf");
});

test("filenames retain the existing fallback, supplier, and driver formats", () => {
  const context = createContext();
  assert.equal(context.statementExportFilename("历史客户", "2026-11-01", "2026-11-30"), "历史客户2026年11月运输对账单.xlsx");
  context.statementExportType.value = "supplier";
  assert.equal(context.statementExportFilename("供应商甲", "2026-11-01", "2026-11-30"), "供应商甲2026年11月供应商对账单.xlsx");
  context.statementExportType.value = "driver";
  assert.equal(context.statementExportFilename("司机甲", "2026-11-01", "2026-11-30"), "司机甲_司机对账_2026-11-01_2026-11-30.xlsx");
});

test("legacy customer references and short_name remain usable without a current customer id", () => {
  const legacy = { id: "legacy-1", name: "历史公司", short_name: "历史简称", type: "客户", customerCategory: "运输客户" };
  const context = createContext([legacy, { ...legacy, id: "legacy-2", name: "无简称公司", short_name: "" }]);
  for (const id of [undefined, null, "", "deleted-customer-id"]) {
    assert.equal(context.statementExportFilename(legacy.name, "2026-11-01", "2026-11-30", "xlsx", id),
      "历史简称2026年11月运输对账单.xlsx");
  }
  assert.equal(context.statementExportFilename("无简称公司", "2026-11-01", "2026-11-30", "pdf", "legacy-2"),
    "无简称公司2026年11月运输对账单.pdf");
  assert.equal(createContext([]).statementExportFilename("已删除客户", "2026-11-01", "2026-11-30", "xlsx", "deleted-customer-id"),
    "已删除客户2026年11月运输对账单.xlsx");
});

test("customer ids take precedence over renamed companies and stay within the customer category", () => {
  const customsCustomer = { ...customers[1], id: "customs-1", shortName: "报关简称", customerCategory: "报关客户" };
  const context = createContext([...customers, customsCustomer]);
  assert.equal(context.statementExportFilename("改名前的公司名称", "2026-11-01", "2026-11-30", "xlsx", "KH00021002"),
    "肯发2026年11月运输对账单.xlsx");
  assert.equal(context.statementExportFilename(customers[2].name, "2026-11-01", "2026-11-30", "xlsx", "customs-1"),
    "肯发精密2026年11月运输对账单.xlsx");
  context.statementExportType.value = "customs";
  assert.equal(context.statementExportFilename(customsCustomer.name, "2026-11-01", "2026-11-30", "pdf", "customs-1"),
    "报关简称2026年11月报关对账单.pdf");
});

test("Excel and PDF exports keep the selected row's customer id after closing the export dialog", async () => {
  for (const [format, template] of [["excel", { name: "默认模板" }], ["excel", { name: "肯发专用" }], ["pdf", { name: "默认模板" }]]) {
    const context = createContext();
    let downloadedFilename;
    Object.assign(context, {
      activeStatementExportRow: { value: { customer: customers[1].name, customerId: "KH00021002", count: 1, hkd: 100, rmb: 0 } },
      closeStatementExportMenu: () => { context.activeStatementExportRow.value = null; },
      ensureStatementEntity: () => customers[1].name,
      statementDateRange: () => ({ start: "2026-10-21", end: "2026-11-20" }),
      selectedStatementOrders: () => [{ no: "HY1", customerId: "KH00021002" }],
      saveStatementExportSettings: () => {},
      isKenfaTemplateRow: (row) => row.name === "肯发专用",
      statementExportTypeLabel: () => "客户对账单",
      statementExportExchangePayload: () => null,
      exportOrderSnapshotsAsExcel: async (_orders, _title, _template, _exchange, filename) => { downloadedFilename = filename; return true; },
      exportOrderSnapshotsAsPdf: async (_orders, _title, _template, _exchange, filename) => { downloadedFilename = filename; return true; },
      markStatementDownloaded: async () => true,
    });
    vm.runInContext(sourceFunction("exportStatementByFormat", true), context);
    await context.exportStatementByFormat(format, template);
    assert.equal(downloadedFilename, `肯发2026年10月至2026年11月运输对账单.${format === "pdf" ? "pdf" : "xlsx"}`);
  }
});
