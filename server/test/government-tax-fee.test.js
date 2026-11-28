import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ExcelJS from "exceljs";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
}

function createContext() {
  const dependencies = {
    ExcelJS, Buffer,
    booleanFlag: (value, fallback = false) => value === undefined ? fallback : Boolean(value),
    normalizeOrderNewOld: (value) => value || "",
    orderChargeNoteText: () => "",
    orderIsCharged: () => false,
    exportFeeUserRemark: (fee) => fee.remark || "",
    todayInputValue: () => "2026-11-28",
    db: { prepare() { throw new Error("export must not access the database"); } },
    normalizeCustomerVatRate: (value) => Number(value || 0),
    normalizeOrderCustomsDeclarationNos: () => [],
    normalizeOrderFeeCategory: (value) => value || "正常",
    normalizeCostCenterCurrency: (value) => value || "港币",
    normalizeOrderFeeCostParts: (value) => Array.isArray(value) ? value : [],
    normalizeOrderFeeFxLinks: () => ({}),
    parseJsonObjectText: (_value, fallback) => fallback,
    normalizeFeeItemCostSources: () => [],
    feeItemCategoryValue: (value) => value || "正常"
  };
  // Run in the same realm as ExcelJS: its row writer uses instanceof Array.
  const create = new Function(...Object.keys(dependencies), [
    section("const ORDER_EXPORT_COLUMNS", "const KENFA_LOGO_FILE_URL"),
    section("function normalizeOrderFeeAssigneeFields", "function mapAddressBook"),
    section("function mapFeeItem", "function mapFreightRate"),
    section("function templateContentType", "function isProtectedTemplateName"),
    section("function normalizeOrderFee(fee,", "function normalizeOrderFeeFxLinks"),
    // These fixtures have no linked customs businesses or receipt images.
    "attachLinkedCustomsBusinessesToOrders = async (orders) => orders;",
    "addStatementReceiptSheet = async () => {};",
    "return { renderOrdersXlsxBuffer, exportColumnsForOrders, feeAmountForColumn, mapOrderFee, normalizeOrderFee, mapFeeItem, mapTemplate, normalizeTemplateFeeNames };"
  ].join("\n"));
  return create(...Object.values(dependencies));
}

const taxColumn = (name = "香港政府税金", currency = "人民币", key = "fee-item-147") => ({
  key, feeItemId: 147, feeName: name, label: name, feeCurrency: currency, visible: true
});
const template = (columns = [taxColumn()]) => ({
  type: "visual-export-template", headerHeight: 80, columns: [
    { key: "no", label: "订单号", visible: true },
    { key: "fee-item-146", label: "中港运费", feeName: "中港运费", feeCurrency: "人民币", visible: true },
    ...columns
  ]
});
const order = (name, no = "O1", currency = "人民币", amount = 200) => ({
  no, date: "2026-11-02", customer: "客户", receivableRMB: currency === "人民币" ? 1300 + amount : 1300,
  receivableHKD: currency === "港币" ? amount : 0,
  fees: [
    { name: "中港运费", currency: "人民币", amount: 1300 },
    { name, currency, amount }
  ]
});

test("November mixed legacy/new tax names export one 200 charge and a non-duplicated Excel total", async () => {
  const ctx = createContext();
  const orders = [order("香港政府税金"), order("代垫香港政府税金", "O2")];
  const buffer = await ctx.renderOrdersXlsxBuffer(orders, "客户对账单-客户", template());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  const header = sheet.getRow(6);
  const taxCells = [];
  header.eachCell((cell) => { if (cell.text.includes("香港政府税金")) taxCells.push(cell); });
  assert.equal(taxCells.length, 1, JSON.stringify(sheet.getSheetValues()));
  assert.equal(taxCells[0].text, "香港政府税金\nRMB");
  const taxIndex = taxCells[0].col;
  const totalIndex = header.values.findIndex((value) => String(value).includes("RMB合计"));
  for (const rowNumber of [7, 8]) {
    assert.equal(sheet.getCell(rowNumber, taxIndex).value, 200);
    const total = sheet.getCell(rowNumber, totalIndex).value;
    assert.equal(total.result, 1500);
    const refs = total.formula.match(/[A-Z]+\d+/g);
    assert.equal(refs.length, 2, "one freight cell and one tax cell");
    assert.equal(new Set(refs).size, 2);
  }
  assert.equal(sheet.getCell(9, taxIndex).value.result, 400);
});

test("old and new template columns collapse after currency repair while preserving their position", () => {
  const ctx = createContext();
  const payload = template([
    taxColumn("代垫香港政府税金", "港币"),
    taxColumn("香港政府税金", "人民币", "fee-item-old-copy"),
    { key: "after-tax", label: "后续字段", visible: true }
  ]);
  const columns = ctx.exportColumnsForOrders(payload, [order("代垫香港政府税金")]);
  const taxes = columns.filter((column) => column.feeName === "香港政府税金");
  assert.equal(taxes.length, 1);
  assert.equal(taxes[0].feeCurrency, "人民币");
  assert.equal(columns.indexOf(taxes[0]), columns.findIndex((column) => column.key === "fee-item-146") + 1);
  assert.equal(ctx.feeAmountForColumn(order("代垫香港政府税金"), taxes[0]), 200);
});

test("October canonical names stay unchanged and historical names also work without a template", () => {
  const ctx = createContext();
  for (const feeName of ["香港政府税金", "代垫香港政府税金"]) {
    const orders = [order(feeName)];
    const columns = ctx.exportColumnsForOrders(null, orders);
    const taxes = columns.filter((column) => column.feeName?.includes("香港政府税金"));
    assert.equal(taxes.length, 1);
    assert.equal(taxes[0].label, "香港政府税金");
    assert.equal(ctx.feeAmountForColumn(orders[0], taxes[0]), 200);
  }
});

test("RMB and HKD remain separate and genuinely separate fee rows retain all amounts", () => {
  const ctx = createContext();
  const orders = [order("香港政府税金"), order("代垫香港政府税金", "O2", "港币", 50)];
  const columns = ctx.exportColumnsForOrders(template(), orders);
  const taxes = columns.filter((column) => column.feeName?.includes("香港政府税金"));
  assert.equal(taxes.length, 2);
  assert.deepEqual(Array.from(taxes, (column) => ctx.feeAmountForColumn(orders[0], column)), [200, 0]);
  assert.deepEqual(Array.from(taxes, (column) => ctx.feeAmountForColumn(orders[1], column)), [0, 50]);
  const twoRealFees = order("香港政府税金");
  twoRealFees.fees.push({ name: "代垫香港政府税金", currency: "人民币", amount: 30 });
  assert.equal(ctx.feeAmountForColumn(twoRealFees, taxes[0]), 230);
});

test("a legacy template without a currency splits mixed tax charges by the actual order currencies", async () => {
  const ctx = createContext();
  const missingCurrencyColumn = taxColumn("代垫香港政府税金");
  delete missingCurrencyColumn.feeCurrency;
  const payload = template([missingCurrencyColumn]);
  const mixedOrder = order("代垫香港政府税金");
  mixedOrder.fees.push({ name: "香港政府税金", currency: "港币", amount: 50 });
  mixedOrder.receivableHKD = 50;
  const columns = ctx.exportColumnsForOrders(payload, [mixedOrder]);
  const taxes = columns.filter((column) => column.feeName === "香港政府税金");
  assert.equal(taxes.length, 2);
  assert.deepEqual(taxes.map((column) => column.feeCurrency), ["人民币", "港币"]);
  assert.deepEqual(taxes.map((column) => ctx.feeAmountForColumn(mixedOrder, column)), [200, 50]);
  assert.equal(new Set(columns.map((column) => column.key)).size, columns.length);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await ctx.renderOrdersXlsxBuffer([mixedOrder], "客户对账单-客户", payload));
  const sheet = workbook.worksheets[0];
  const headers = sheet.getRow(6).values;
  const rmbIndex = headers.findIndex((value) => String(value).includes("RMB合计"));
  const hkdIndex = headers.findIndex((value) => String(value).includes("HKD合计"));
  assert.equal(sheet.getCell(7, rmbIndex).value.result, 1500);
  assert.equal(sheet.getCell(7, hkdIndex).value.result, 50);
});

test("a legacy template without a currency gets its sole currency from order data", () => {
  const ctx = createContext();
  for (const currency of ["人民币", "港币"]) {
    const payload = template([{ ...taxColumn("代垫香港政府税金"), feeCurrency: "" }]);
    const current = order("香港政府税金", "O1", currency, 200);
    const taxes = ctx.exportColumnsForOrders(payload, [current]).filter((column) => column.feeName === "香港政府税金");
    assert.equal(taxes.length, 1);
    assert.equal(taxes[0].feeCurrency, currency);
    assert.equal(ctx.feeAmountForColumn(current, taxes[0]), 200);
  }
});

test("renamed tax items with different historical IDs keep every charge in the merged Excel column", async () => {
  const ctx = createContext();
  const legacy = order("代垫香港政府税金");
  legacy.fees[1].feeItemId = 147;
  const current = order("香港政府税金", "O2", "人民币", 300);
  current.fees[1].feeItemId = 248;
  const payload = template([
    taxColumn("代垫香港政府税金"),
    { ...taxColumn(), key: "fee-item-248", feeItemId: 248 }
  ]);
  const columns = ctx.exportColumnsForOrders(payload, [legacy, current]);
  const taxes = columns.filter((column) => column.feeName === "香港政府税金");
  assert.equal(taxes.length, 1);
  assert.equal(ctx.feeAmountForColumn(legacy, taxes[0]), 200);
  assert.equal(ctx.feeAmountForColumn(current, taxes[0]), 300);
  legacy.fees.push({ name: "香港政府税金", feeItemId: 248, currency: "人民币", amount: 30 });
  legacy.receivableRMB += 30;
  assert.equal(ctx.feeAmountForColumn(legacy, taxes[0]), 230);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await ctx.renderOrdersXlsxBuffer([legacy, current], "客户对账单-客户", payload));
  const sheet = workbook.worksheets[0];
  const headers = sheet.getRow(6).values;
  const taxIndex = headers.findIndex((value) => String(value).includes("香港政府税金"));
  const totalIndex = headers.findIndex((value) => String(value).includes("RMB合计"));
  assert.deepEqual(sheet.getCell(7, taxIndex).value, { formula: "200+30", result: 230 });
  assert.equal(sheet.getCell(8, taxIndex).value, 300);
  assert.equal(sheet.getCell(7, totalIndex).value.result, 1530);
  assert.equal(sheet.getCell(8, totalIndex).value.result, 1600);
  assert.equal(sheet.getCell(9, taxIndex).value.result, 530);
  assert.equal(ctx.feeAmountForColumn({ fees: [
    { name: "香港政府税金", feeItemId: 248, currency: "港币", amount: 90 },
    { name: "其他费用", feeItemId: 300, currency: "人民币", amount: 80 }
  ] }, taxes[0]), 0);
  assert.equal(ctx.feeAmountForColumn({ fees: [
    { name: "其他费用", feeItemId: 300, currency: "人民币", amount: 80 }
  ] }, { ...taxColumn("其他费用"), feeItemId: 301 }), 0);
});

test("historical orders and incoming order fees use the canonical name without changing amounts or ownership", () => {
  const ctx = createContext();
  const read = ctx.mapOrderFee({ name: "代垫香港政府税金", amount: 200, cost: 200, category: "代垫", currency: "人民币", driver_role: "手动指定", driver_name: "吉华仓库" });
  assert.equal(read.name, "香港政府税金");
  assert.equal(read.amount, 200);
  assert.equal(read.cost, 200);
  assert.equal(read.category, "代垫");
  assert.equal(read.driverName, "吉华仓库");
  const saved = ctx.normalizeOrderFee({ ...read, name: "代垫香港政府税金", unitPrice: 200, quantity: 1 }, "人民币");
  assert.equal(saved.name, "香港政府税金");
  assert.equal(saved.amount, 200);
  assert.equal(saved.driverName, "吉华仓库");
  assert.equal(ctx.mapFeeItem({ name: "代垫香港政府税金" }).name, "香港政府税金");
});

test("historical fee templates and export template labels are normalized in API reads and saves", () => {
  const ctx = createContext();
  const legacy = JSON.stringify({ type: "order-freight-template", fees: [{ name: "代垫香港政府税金", amount: 200, cost: 100, remark: "保留原备注" }] });
  const mapped = ctx.mapTemplate({ id: 1, content: legacy });
  const fee = JSON.parse(mapped.content).fees[0];
  assert.deepEqual(fee, { name: "香港政府税金", amount: 200, cost: 100, remark: "保留原备注" });
  assert.equal(ctx.normalizeTemplateFeeNames(mapped.content), mapped.content);
  const visual = JSON.parse(ctx.normalizeTemplateFeeNames(JSON.stringify(template([taxColumn("代垫香港政府税金")]))));
  assert.equal(visual.columns[2].label, "香港政府税金");
  assert.equal(visual.columns[2].feeName, "香港政府税金");
  assert.equal(ctx.normalizeTemplateFeeNames("not json"), "not json");
});

test("legacy templates tolerate empty fee rows and preserve custom captions and unrelated template content", () => {
  const ctx = createContext();
  const freight = JSON.stringify({ type: "order-freight-template", fees: [null, { name: "代垫香港政府税金", amount: 200 }] });
  const normalized = JSON.parse(ctx.normalizeTemplateFeeNames(freight));
  assert.equal(normalized.fees[0], null);
  assert.equal(normalized.fees[1].name, "香港政府税金");
  const visual = JSON.stringify(template([
    { ...taxColumn("代垫香港政府税金"), label: "税金（客户约定）", order: 9, width: 100 },
    { key: "fee-item-200", feeName: "其他费用", label: "客户自定义费用名称", feeCurrency: "港币" }
  ]));
  const columns = JSON.parse(ctx.normalizeTemplateFeeNames(visual)).columns;
  assert.deepEqual(columns[2], {
    ...JSON.parse(visual).columns[2], feeName: "香港政府税金"
  });
  assert.deepEqual(columns[3], JSON.parse(visual).columns[3]);
  const unrelated = '{ "type": "outsourced-cost-rule", "fees": [{ "name": "代垫香港政府税金" }] }';
  assert.equal(ctx.normalizeTemplateFeeNames(unrelated), unrelated);
});
