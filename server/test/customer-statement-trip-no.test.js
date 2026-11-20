import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source section: ${start}`);
  return source.slice(from, to);
}

function createContext() {
  const context = vm.createContext({
    textValue: (value) => String(value ?? ""),
    booleanFlag: (value) => Boolean(value),
    normalizeExportTemplate: () => null,
    exportColumnsFromTemplate: (template) => template?.columns || [{ key: "plate", label: "车牌" }],
    normalizeTemplateFeeColumnsForOrders: (columns) => columns,
    ensureStatementRequiredColumns: (columns) => columns,
    exportTemplateColumnHasDisplayValue: () => true,
    dynamicExportFeeColumns: () => [],
    linkedCustomsBusinessExportColumns: () => [],
    orderCustomsDeclarationNoExportColumns: () => [],
    mergeExportColumnsByTemplateOrder: (columns) => columns,
    exportTemplateFeePositionLookup: () => ({}),
    groupCustomerStatementFeeColumns: (bodyColumns, totalColumns) => ({ bodyColumns, totalColumns }),
    exportColumnAutoWidth: (column) => column.width || 72,
    exportColumnBaseLabel: (column) => column.label || "",
    isExportFeeItemColumn: (column) => Boolean(column.fee),
    ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN: { key: "__sequence" },
    ORDER_EXPORT_SYSTEM_TOTAL_COLUMNS: [],
    ORDER_EXPORT_SYSTEM_TOTAL_COLUMN_KEYS: new Set(),
    ORDER_EXPORT_CHARGE_NOTE_COLUMN: { key: "__chargeNote" },
    ORDER_EXPORT_TRIP_NO_COLUMN: { key: "tripNo", label: "车次号", width: 72 },
    STATEMENT_REQUIRED_COLUMNS: [],
  });
  vm.runInContext([
    section("function firstExportFieldValue(", "function exportOrderColumnValue("),
    section("function statementColumnMatchesKey(", "function ensureStatementRequiredColumns("),
    section("function orderTripNoValue(", "function ordersHaveSixSheetNo("),
    section("function exportColumnsForOrders(", "function exportTemplateTextRows("),
  ].join("\n"), context);
  return context;
}

test("customer statement adds the trip number after the plate and exports each order's value", () => {
  const context = createContext();
  const orders = [{ tripNo: "11867124" }, { trip_no: "T-02" }, {}];
  const columns = context.exportColumnsForOrders(null, orders, { includeTripNoColumn: true });
  const keys = Array.from(columns, (column) => column.key);
  assert.equal(keys.indexOf("tripNo"), keys.indexOf("plate") + 1);
  const tripColumn = columns.find((column) => column.key === "tripNo");
  assert.deepEqual(orders.map((order) => context.exportOrderFieldValue(order, tripColumn.key, tripColumn)), ["11867124", "T-02", ""]);
});

test("empty trip numbers do not add a column and a template column is not duplicated", () => {
  const context = createContext();
  const keys = (columns) => Array.from(columns, (column) => column.key);
  assert.ok(!keys(context.exportColumnsForOrders(null, [{ tripNo: "  " }], { includeTripNoColumn: true })).includes("tripNo"));
  const template = { columns: [{ key: "plate", label: "车牌" }, { key: "trip_no", label: "车次号" }] };
  const columns = context.exportColumnsForOrders(template, [{ tripNo: "11867124" }], { includeTripNoColumn: true });
  assert.equal(columns.filter((column) => column.label === "车次号").length, 1);
  assert.equal(context.exportOrderFieldValue({ tripNo: "11867124" }, "trip_no", columns[2]), "11867124");
  assert.ok(!keys(context.exportColumnsForOrders(null, [{ tripNo: "11867124" }], {})).includes("tripNo"));
});

test("customer statement renderers request the trip number column", async () => {
  const stop = new Error("columns captured");
  let captured;
  const context = vm.createContext({
    normalizeExportTemplate: () => null,
    isCustomerStatementExportTitle: (title) => title.startsWith("客户对账单"),
    isSupplierStatementExportTitle: () => false,
    attachLinkedCustomsBusinessesToOrders: async (orders) => orders,
    exportColumnsForOrders: (_template, _orders, options) => { captured = options; throw stop; },
  });
  const rendererPrefix = (name) => `${section(`async function ${name}(`, "\n  });")}\n  });\n}`;
  vm.runInContext([
    "renderOrdersCsv", "renderOrdersXlsxBuffer", "renderOrdersExcelHtml", "renderOrdersPdf"
  ].map(rendererPrefix).join("\n"), context);
  for (const invoke of [
    () => context.renderOrdersCsv([], "客户对账单-嘉裕达"),
    () => context.renderOrdersXlsxBuffer([], "客户对账单-嘉裕达"),
    () => context.renderOrdersExcelHtml([], "客户对账单-嘉裕达"),
    () => context.renderOrdersPdf({}, [], "客户对账单-嘉裕达"),
  ]) {
    captured = null;
    await assert.rejects(invoke(), (error) => error === stop);
    assert.equal(captured.includeTripNoColumn, true);
  }
});
