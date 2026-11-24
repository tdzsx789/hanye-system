import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const end = source.indexOf("\n}", start);
  const prefix = source.slice(start - 6, start) === "async " ? "async " : "";
  return prefix + source.slice(start, end + 2);
}

function saveContext(mode = "双司机") {
  const original = {
    no: "O1", dispatchNo: "D1", vehicleSource: "汉业物流",
    transportMode: "单司机", driver: "香港司机", hkDriver: "", mainlandDriver: ""
  };
  const saved = mode === "双司机"
    ? { ...original, transportMode: mode, driver: "香港司机 / 大陆骑师", hkDriver: "香港司机", mainlandDriver: "大陆骑师" }
    : original;
  const staleDispatch = mode === "双司机" ? original : {
    ...original, transportMode: "双司机", driver: "", hkDriver: "香港司机", mainlandDriver: "大陆骑师"
  };
  const rows = [
    { id: "linked", orderNo: "O1", ...staleDispatch, mainland_driver: staleDispatch.mainlandDriver },
    { id: "split", linkedOrderNos: ["O1"], ...staleDispatch, no: undefined, dispatchNo: "split-D" },
    { id: "other", orderNo: "O2", dispatchNo: "D2", transportMode: "单司机", driver: "其他司机" }
  ];
  const ctx = vm.createContext({
    orderForm: { ...saved },
    orderUsesOwnVehicle: { value: true },
    orderRows: { value: [original] },
    dispatchPlanRows: { value: rows },
    editingOrderNo: { value: "O1" },
    orderAssignmentBase: { value: null },
    orderAttachmentUploading: { value: false },
    orderIsCustomsOnly: { value: false },
    pendingDispatchBindId: { value: "" },
    loading: { value: false },
    selectedCustomerId: { value: "" },
    activeCustomerDetailTab: { value: "" },
    orderFees: { value: [] },
    OWN_VEHICLE_SOURCE: "汉业物流",
    TRANSPORT_MODE_OPTIONS: ["单司机", "双司机", "口岸转国内车"],
    normalizeVehicleSource: (value) => value || "",
    normalizeTransportMode: (value) => value || "",
    normalizePlateText: (value) => value || "",
    normalizeDispatchCustomerSelectionValues: (value) => Array.isArray(value) ? value : [],
    normalizeOrderLinkedCustomsBusinessIds: () => [],
    displayPortText: (value) => value || "",
    dispatchPlanDate: (row) => row.date || "2026-11-23",
    hasMissingAdvanceFeeAmount: () => false,
    currentOrderCustomerRecord: () => ({ id: "C1", name: "客户" }),
    confirmSaveOrderWithMissingAdvanceReceipts: async () => true,
    handleOrderVehicleSourceChange() {},
    syncCrossBorderFreightDriverRoles() {},
    scheduleOrderFeeCostSync() {},
    syncAutoFreightFee() {},
    normalizeOrderFeeRows() {},
    syncOrderFeeCosts() {},
    buildNormalizedOrderPayload: () => ({ ...saved }),
    ordersApi: { updateOrder: async () => ({ ...saved }) },
    activatePartnerContext() {},
    notify: (message) => { ctx.lastNotice = message; },
    orderDispatchPlanRow: () => ctx.dispatchPlanRows.value[0]
  });
  ctx.orderUsesRelayDrivers = { get value() { return ["双司机", "口岸转国内车"].includes(ctx.orderForm.transportMode); } };
  for (const name of ["normalizeTransportMode", "normalizeDispatchCustomerSelectionValues", "normalizedOrderAssignmentBase", "orderDisplaySource", "normalizeOrderDriversForSave", "handleOrderTransportModeChange", "saveOrder"]) {
    vm.runInContext(extract(name), ctx);
  }
  vm.runInContext(extract("syncLocalDispatchRowsForOrderAssignment"), ctx);
  return ctx;
}

test("saving double drivers updates cached dispatch rows before the order is reopened", async () => {
  const ctx = saveContext();
  assert.ok(await ctx.saveOrder({ closeAfterSave: false }));
  const reopened = ctx.orderDisplaySource(ctx.orderRows.value[0]);
  assert.equal(reopened.transportMode, "双司机");
  assert.equal(reopened.hkDriver, "香港司机");
  assert.equal(reopened.mainlandDriver, "大陆骑师");
  assert.equal(reopened.driver, "香港司机 / 大陆骑师");
  assert.equal(ctx.dispatchPlanRows.value[1].transportMode, "双司机");
  assert.equal(ctx.dispatchPlanRows.value[2].driver, "其他司机");
});

test("switching back to a single driver clears the cached mainland rider", async () => {
  const ctx = saveContext("单司机");
  assert.ok(await ctx.saveOrder({ closeAfterSave: false }));
  const reopened = ctx.orderDisplaySource(ctx.orderRows.value[0]);
  assert.equal(reopened.transportMode, "单司机");
  assert.equal(reopened.driver, "香港司机");
  assert.equal(reopened.hkDriver, "");
  assert.equal(reopened.mainlandDriver, "");
  assert.equal(ctx.dispatchPlanRows.value[0].mainland_driver, "");
});

test("opening a historical double-driver order preserves it despite a single-driver dispatch cache", () => {
  const ctx = saveContext();
  ctx.orderRows.value = [{ ...ctx.orderForm }];
  const reopened = ctx.orderDisplaySource(ctx.orderRows.value[0]);
  assert.equal(reopened.transportMode, "双司机");
  assert.equal(reopened.driver, "香港司机 / 大陆骑师");
  assert.equal(reopened.hkDriver, "香港司机");
  assert.equal(reopened.mainlandDriver, "大陆骑师");
});

test("historical dispatch reference lists update only linked rows and retain unrelated data", () => {
  const ctx = saveContext();
  ctx.dispatchPlanRows.value = [
    { linked_order_nos: '["O1"]', transport_mode: "单司机", hk_driver: "旧司机", mainland_driver: "", note: "旧备注", quantity: "20" },
    { dispatch_nos: "D1，D3", transportMode: "单司机", driver: "旧司机" },
    { dispatch_group_id: "G1", transportMode: "单司机", driver: "旧司机" },
    { orderNo: "O2", driver: "其他司机" }
  ];
  ctx.syncLocalDispatchRowsForOrderAssignment({ ...ctx.orderForm, no: "O1", dispatchNo: "D1", dispatchGroupId: "G1" });
  for (const row of ctx.dispatchPlanRows.value.slice(0, 3)) {
    assert.equal(row.transportMode, "双司机");
    assert.equal(row.mainlandDriver, "大陆骑师");
  }
  assert.equal(ctx.dispatchPlanRows.value[0].transport_mode, "双司机");
  assert.equal(ctx.dispatchPlanRows.value[0].mainland_driver, "大陆骑师");
  assert.equal(ctx.dispatchPlanRows.value[0].note, "旧备注");
  assert.equal(ctx.dispatchPlanRows.value[0].quantity, "20");
  assert.equal(ctx.dispatchPlanRows.value[3].driver, "其他司机");
});

test("switching from double to single driver retains only the Hong Kong driver", () => {
  const ctx = saveContext();
  ctx.orderForm.transportMode = "单司机";
  ctx.handleOrderTransportModeChange();
  ctx.normalizeOrderDriversForSave();
  assert.equal(ctx.orderForm.driver, "香港司机");
  assert.equal(ctx.orderForm.hkDriver, "");
  assert.equal(ctx.orderForm.mainlandDriver, "");
});

test("legacy driver aliases and a missing dispatch mode preserve the saved relay assignment", () => {
  const ctx = saveContext();
  ctx.orderRows.value = [{
    no: "O1", vehicleSource: "汉业物流", transportMode: "双司机",
    driver: "香港司机 / 大陆骑师", hkDriver: "香港司机", mainlandDriver: "大陆骑师"
  }];
  ctx.dispatchPlanRows.value = [{ orderNo: "O1", driver: "旧司机" }];
  assert.equal(ctx.orderDisplaySource(ctx.orderRows.value[0]).driver, "香港司机 / 大陆骑师");
  ctx.orderRows.value[0] = {
    no: "O1", vehicle_source: "汉业物流", transport_mode: "双司机",
    driver: "香港司机 / 大陆骑师", hk_driver: "香港司机", mainland_driver: "大陆骑师"
  };
  ctx.dispatchPlanRows.value = [{ orderNo: "O1", transport_mode: "单司机", driver: "旧司机" }];
  const reopened = ctx.orderDisplaySource(ctx.orderRows.value[0]);
  assert.equal(reopened.transportMode, "双司机");
  assert.equal(reopened.hkDriver, "香港司机");
  assert.equal(reopened.mainlandDriver, "大陆骑师");
});
