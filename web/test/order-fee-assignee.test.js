import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { effect, reactive, stop } from "vue";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");
function extract(text, name) {
  const start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const end = text.indexOf("\n}", start);
  assert.notEqual(end, -1, name);
  return text.slice(start, end + 2);
}
const plain = (value) => JSON.parse(JSON.stringify(value));
const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

function createContext({ order = {}, item = {} } = {}) {
  const context = vm.createContext({
    orderForm: reactive({ vehicleSource: "汉业物流", transportMode: "单司机", driver: "香港司机甲", ...order }),
    orderReadOnlyMode: { value: false },
    orderFeeAssigneeDrafts: reactive(new WeakMap()),
    OWN_VEHICLE_SOURCE: "汉业物流",
    ORDER_DRIVER_ROLE_LABELS: new Set(["香港司机", "大陆骑师", "跟随订单司机", "香港司机/大陆骑师"]),
    normalizeUserText: normalizeText,
    normalizeVehicleSource: (value) => value,
    normalizeTransportMode: (value) => value || "单司机",
    normalizeCostCenterSourceLabel: (value) => value,
    normalizeFeeItemCostSources: (value) => Array.isArray(value) ? value : [value || "供应商"],
    isDomesticTransferMode: (value) => value === "口岸转国内车",
    isCompanyCoveredFee: (fee) => fee.companyCovered === true,
    isAdvanceFee: (fee) => fee.category === "代垫",
    advanceFeesForOrder: () => [],
    feeItemForFee: () => item,
    supplierDisplayLabel: (value) => value === "供应商全称" ? "供应商简称" : value || "",
    scheduleOrderFeeCostSync() {}
  });
  for (const name of [
    "orderIsDoubleDriverMode", "normalizeOrderDriverNamePart", "splitOrderDriverNames", "orderRelayDriverPair",
    "uniqueOrderCostNames", "isCrossBorderFreightFee", "orderDriverNameByRole", "crossBorderFreightDriverRoles",
    "orderFeeAutoDriverRole", "normalizeOrderFeeAssigneeText", "orderFeeLegacyAssigneeNames",
    "orderFeeHasManualAssignee", "normalizeOrderFeeManualAssigneeFlag", "orderFeeCostSourceAssigneeNames",
    "orderFeeDefaultAssigneeNames", "orderFeeAssigneeNames", "orderFeeAssigneeDisplayNames",
    "orderFeeAssigneeDisplay", "orderFeeAssigneeInputValue", "orderFeeAssigneeTitle",
    "resetOrderFeeAssignee", "handleOrderFeeAssigneeInput", "commitOrderFeeAssigneeInput",
    "syncCrossBorderFreightDriverRole", "feeCostAssigneeBelongsToDriver"
  ]) vm.runInContext(extract(source, name), context);
  return context;
}

function createServerContext() {
  const context = vm.createContext({
    userTextValue: normalizeText,
    booleanFlag: (value, fallback) => value === undefined ? fallback : Boolean(value),
    normalizeOrderFeeCategory: (value) => value || "正常",
    normalizeCostCenterCurrency: (value) => value || "港币",
    normalizeOrderFeeCostParts: (value) => Array.isArray(value) ? value : [],
    normalizeOrderFeeFxLinks: () => ({}),
    parseJsonObjectText: (_value, fallback) => fallback
  });
  for (const name of ["normalizeOrderFeeAssigneeFields", "normalizeOrderFee", "mapOrderFee"]) {
    vm.runInContext(extract(serverSource, name), context);
  }
  return context;
}

test("legacy empty manual assignments follow the order driver and remain in wage attribution", () => {
  const context = createContext();
  const fee = { name: "大陆过磅费", driverRole: "手动指定", driverName: "", _manualAssignee: true };
  assert.equal(context.orderFeeHasManualAssignee(fee), false);
  assert.equal(context.orderFeeAssigneeInputValue(fee), "香港司机甲");
  assert.equal(context.feeCostAssigneeBelongsToDriver(context.orderForm, fee, { name: "香港司机甲" }), true);
});

test("reset works without a configured default role and clears legacy aliases", () => {
  const context = createContext();
  const fee = { name: "大陆过磅费", driverRole: "手动指定", driver_role: "手动指定", driverName: "仓库", driver_name: "仓库" };
  context.resetOrderFeeAssignee(fee);
  assert.equal(context.orderFeeHasManualAssignee(fee), false);
  assert.equal(fee.driverRole, "");
  assert.equal(fee.driver_name, "");
  assert.equal(context.orderFeeAssigneeInputValue(fee), "香港司机甲");
});

test("clearing an input preserves an editable draft and restores automatic attribution on blur", () => {
  const context = createContext();
  const fee = reactive({ name: "大陆过磅费", driverName: "仓库", driverRole: "手动指定" });
  let rendered;
  const runner = effect(() => { rendered = context.orderFeeAssigneeInputValue(fee); });
  context.handleOrderFeeAssigneeInput(fee, { target: { value: "" } });
  assert.equal(rendered, "");
  assert.equal(context.orderFeeHasManualAssignee(fee), false);
  context.commitOrderFeeAssigneeInput(fee);
  assert.equal(rendered, "香港司机甲");
  context.orderForm.driver = "香港司机乙";
  assert.equal(rendered, "香港司机乙");
  stop(runner);
});

test("replacing an assignee retains the new name without re-inserting automatic text", () => {
  const context = createContext();
  const fee = { name: "大陆过磅费" };
  for (const value of ["", "吉", "吉华仓库"]) {
    context.handleOrderFeeAssigneeInput(fee, { target: { value } });
    assert.equal(context.orderFeeAssigneeInputValue(fee), value);
  }
  context.commitOrderFeeAssigneeInput(fee);
  context.orderForm.driver = "香港司机乙";
  assert.equal(fee.driverRole, "手动指定");
  assert.equal(context.orderFeeAssigneeInputValue(fee), "吉华仓库");
  assert.equal(context.feeCostAssigneeBelongsToDriver(context.orderForm, fee, { name: "香港司机乙" }), false);
});

test("non-freight fees configured to follow both drivers display both names", () => {
  const context = createContext({
    order: { transportMode: "双司机", driver: "香港司机甲 / 大陆骑师乙", hkDriver: "香港司机甲", mainlandDriver: "大陆骑师乙" },
    item: { name: "大陆过磅费", defaultDriverRole: "跟随订单司机" }
  });
  const fee = { name: "大陆过磅费" };
  assert.deepEqual(plain(context.orderFeeAssigneeNames(fee)), ["香港司机甲", "大陆骑师乙"]);
  for (const name of ["香港司机甲", "大陆骑师乙"]) {
    assert.equal(context.feeCostAssigneeBelongsToDriver(context.orderForm, fee, { name }), true);
  }
});

test("double-driver cost sources still select the configured driver without guessing missing assignees", () => {
  const context = createContext({
    order: { transportMode: "双司机", hkDriver: "香港司机甲", mainlandDriver: "大陆骑师乙" },
    item: { costSources: ["大陆骑师"] }
  });
  assert.equal(context.orderFeeAssigneeInputValue({ name: "大陆过磅费" }), "大陆骑师乙");
  context.orderForm.mainlandDriver = "";
  assert.equal(context.orderFeeAssigneeInputValue({ name: "大陆过磅费" }), "");
  assert.match(context.orderFeeAssigneeTitle({ name: "大陆过磅费" }), /未匹配到成本归属/);
});

test("outsourced and company-covered fees preserve their respective assignees", () => {
  const context = createContext({ order: { vehicleSource: "外派车辆", supplier: "供应商全称" } });
  assert.equal(context.orderFeeAssigneeInputValue({ driverRole: "手动指定", driverName: "" }), "供应商简称");
  const covered = { name: "公司自费", companyCovered: true, driverName: "仓库" };
  assert.equal(context.orderFeeAssigneeInputValue(covered), "公司承担");
  context.resetOrderFeeAssignee(covered);
  assert.equal(context.feeCostAssigneeBelongsToDriver(context.orderForm, covered, { name: "仓库" }), false);
});

test("read-only assignees cannot be changed by input or blur", () => {
  const context = createContext();
  context.orderReadOnlyMode.value = true;
  const fee = { driverRole: "手动指定", driverName: "原归属" };
  context.handleOrderFeeAssigneeInput(fee, { target: { value: "其他人" } });
  context.commitOrderFeeAssigneeInput(fee);
  assert.equal(fee.driverName, "原归属");
});

test("saving and reading fees no longer perpetuates empty manual assignments", () => {
  const server = createServerContext();
  const context = createContext();
  const input = { name: "大陆过磅费", driverRole: "手动指定", driverName: "", quantity: 1, unitPrice: 27 };
  const saved = server.normalizeOrderFee(input, "人民币");
  assert.equal(saved.driverRole, "");
  assert.equal(saved.driverName, "");
  const legacy = server.mapOrderFee({ name: input.name, driver_role: "手动指定", driver_name: "" });
  assert.equal(legacy.driverRole, "");
  assert.equal(context.orderFeeAssigneeInputValue(legacy), "香港司机甲");
  assert.equal(context.orderFeeAssigneeInputValue(saved), "香港司机甲");
});

test("manual warehouse assignments survive save/read and explicit clearing overrides old aliases", () => {
  const server = createServerContext();
  const saved = server.normalizeOrderFee({ name: "大陆过磅费", driverRole: "手动指定", driverName: "吉华仓库" }, "人民币");
  const loaded = server.mapOrderFee({ name: saved.name, driver_role: saved.driverRole, driver_name: saved.driverName });
  const context = createContext();
  assert.equal(context.orderFeeAssigneeInputValue(loaded), "吉华仓库");
  const cleared = server.normalizeOrderFee({ driverRole: "", driverName: "", driver_role: "手动指定", driver_name: "旧归属" }, "人民币");
  assert.equal(cleared.driverRole, "");
  assert.equal(cleared.driverName, "");
});

test("legacy combined-driver role labels survive server normalization and reads", () => {
  const server = createServerContext();

  for (const role of ["香港司机/大陆骑师", "香港司机 / 大陆骑师", "香港司机 + 大陆骑师接驳"]) {
    const saved = server.normalizeOrderFee({ name: "杂费", driverRole: role }, "港币");
    assert.equal(saved.driverRole, role);
    const loaded = server.mapOrderFee({ name: "杂费", driver_role: role, driver_name: "" });
    assert.equal(loaded.driverRole, role);
  }

  const context = createContext({
    order: { transportMode: "双司机", hkDriver: "香港司机甲", mainlandDriver: "大陆骑师乙" }
  });
  assert.deepEqual(plain(context.orderFeeAssigneeNames({ driverName: "香港司机 / 大陆骑师" })), ["香港司机甲", "大陆骑师乙"]);
});
