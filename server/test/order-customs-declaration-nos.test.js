import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Load the order functions without starting the API or running database maintenance.
const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}
const text = (value) => String(value ?? "").trim();
const context = vm.createContext({
  OWN_VEHICLE_SOURCE: "汉业物流",
  todayInputValue: () => "2026-10-27",
  orderDateFromLinkedDispatchRow: async (_no, _dispatchNo, date) => date,
  normalizeOrderStatus: (value, fallback) => value || fallback,
  shouldPreventOrderStatusDowngrade: () => false,
  normalizeVehicleSource: text,
  normalizeTransportMode: text,
  normalizePortText: text,
  normalizePlateText: text,
  normalizeOrderNewOld: text,
  booleanFlag: Boolean,
  normalizeLinkedCustomsBusinessIdsInput: () => [],
  normalizeLocationEntriesFromPayload: () => [],
  normalizeLocationEntries: () => [],
  parseLinkedCustomsBusinessIds: () => [],
  composeLocationEntriesText: () => "",
  locationEntriesJson: () => "[]"
});
vm.runInContext([
  section("const USER_TEXT_COMPAT_CHAR_MAP", "function normalizeLocationPartText"),
  section("const TRANSPORT_CUSTOMS_DECLARATION_NO_FLAG_FIELD", "function transportCustomsDeclarationNoEnabled"),
  section("function mapOrder(row)", "function normalizeOrderChargedAt"),
  section("function pickBody(body,", "async function writeOrderRow")
].join("\n"), context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const existingOrder = {
  no: "HY20261027001",
  dispatch_no: "PC20261027001",
  order_date: "2026-10-27",
  status: "预排",
  remark: "司机装货",
  customs_declaration_nos: "[]"
};
async function saveFields(body, existing = existingOrder, customsDeclarationNosColumn = true) {
  const payload = await context.readOrderPayload(body, existing);
  return Object.fromEntries(context.orderWriteEntries(payload, { customsDeclarationNos: customsDeclarationNosColumn }, existing));
}

test("adding and changing declaration numbers writes a separate column without appending to remarks", async () => {
  let order = { ...existingOrder };
  for (const numbers of [["534520261000676369"], ["A123", "B456"], ["B456"]]) {
    order = { ...order, ...await saveFields({ customsDeclarationNos: numbers, remark: "司机装货" }, order) };
    assert.equal(order.remark, "司机装货");
    assert.deepEqual(JSON.parse(order.customs_declaration_nos), numbers);
    assert.deepEqual(plain(context.mapOrder(order).customsDeclarationNos), numbers);
  }
});

test("a blank remark stays blank when declaration numbers are entered", async () => {
  const fields = await saveFields({ customsDeclarationNos: ["A123"], remark: "" });
  assert.equal(fields.remark, "");
  assert.equal(fields.customs_declaration_nos, '["A123"]');
});

test("partial updates preserve declaration numbers and explicit removal clears them", async () => {
  const order = { ...existingOrder, customs_declaration_nos: '["A123","B456"]' };
  assert.equal((await saveFields({ status: "已签收" }, order)).customs_declaration_nos, '["A123","B456"]');
  const fields = await saveFields({ customsDeclarationNos: [] }, order);
  assert.equal(fields.customs_declaration_nos, "[]");
  assert.equal(fields.remark, "司机装货");
  assert.deepEqual(plain(context.mapOrder({ ...order, ...fields }).customsDeclarationNos), []);
});

test("legacy schemas preserve declaration numbers in remarks when the structured column is absent", async () => {
  const legacyOrder = {
    no: existingOrder.no,
    dispatch_no: existingOrder.dispatch_no,
    order_date: existingOrder.order_date,
    status: existingOrder.status,
    remark: '司机装货\n运输客户报关单号：["A123","B456"]'
  };
  const fields = await saveFields({ status: "已签收" }, legacyOrder, false);
  assert.equal(fields.remark, '司机装货\n运输客户报关单号：["A123","B456"]');
  assert.deepEqual(plain(context.mapOrder({ ...legacyOrder, ...fields }).customsDeclarationNos), ["A123", "B456"]);

  const newOrderFields = await saveFields({
    customsDeclarationNos: ["C789"],
    remark: "司机装货"
  }, legacyOrder, false);
  assert.equal(newOrderFields.remark, '司机装货\n运输客户报关单号：["C789"]');
});

test("legacy metadata survives normalization of full width punctuation and is removed from remarks", async () => {
  for (const prefix of ["运输客户报关单号：", "运输客户报关单号:", "运输报关单号：", "运输报关单号:"]) {
    const remark = `司机装货${prefix}["A123"]${prefix}["B456","A123"]`;
    const order = { ...existingOrder, remark };
    const mapped = context.mapOrder(order);
    assert.equal(mapped.remark, "司机装货");
    assert.deepEqual(plain(mapped.customsDeclarationNos), ["A123", "B456"]);
    const fields = await saveFields({}, order);
    assert.equal(fields.remark, "司机装货");
    assert.equal(fields.customs_declaration_nos, '["A123","B456"]');
  }
});

test("metadata cleanup preserves customer text after the array and across Windows line endings", () => {
  const remark = '首行\r\n运输客户报关单号：["A]B","C\\\"D"]尾注\r\n\r\n末行';
  assert.equal(context.stripOrderCustomsDeclarationNosRemark(remark), "首行\n尾注\n\n末行");
  assert.deepEqual(plain(context.orderCustomsDeclarationNosFromRemark(remark)), ["A]B", 'C"D']);
});
