import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
function section(start, end) {
  const offset = source.indexOf(start);
  assert.notEqual(offset, -1, start);
  const finish = source.indexOf(end, offset);
  assert.notEqual(finish, -1, end);
  return source.slice(offset, finish);
}

const context = vm.createContext({
  normalizeVehicleSource: (value) => String(value ?? "").trim(),
  normalizePlateText: (value) => String(value ?? "").replace(/\s+/g, "").trim(),
  normalizeTransportMode: (value) => String(value ?? "").trim(),
  userTextValue: (value) => String(value ?? "").trim()
});
vm.runInContext([
  section("function normalizeTransportMode(", "function normalizePortText("),
  section("function orderDispatchCandidateForOrder", "async function hydrateOrderDispatchLoadInfo"),
  section("const ORDER_ASSIGNMENT_BASE_FIELDS", "async function readOrderPayload"),
  section("function dispatchRowFieldProvided", "function dispatchRowStringField"),
  section("function mergeUnchangedDispatchAssignmentFields", "function dispatchRowQuantityWasEdited")
].join("\n"), context);

test("current dispatch assignment replaces stale order values in order list data", () => {
  const order = {
    no: "HY20261103013",
    vehicleSource: "汉业物流",
    plate: "粤ZCS36港",
    driver: "魏焕巧",
    transportMode: "单司机"
  };
  const dispatch = {
    vehicleSource: "汉业物流",
    plate: "粤ZEL68港",
    driver: "叶勇波",
    transportMode: "单司机"
  };

  const displayed = context.applyOrderDispatchAssignment(order, dispatch);
  assert.equal(displayed.plate, "粤ZEL68港");
  assert.equal(displayed.driver, "叶勇波");
  assert.equal(order.plate, "粤ZCS36港", "the source record remains unchanged");
});

test("legacy dispatch rows without assignment fields preserve the order values", () => {
  const order = {
    no: "HY20261103014",
    vehicleSource: "汉业物流",
    supplier: "华南供应商",
    plate: "粤ZCS36港",
    driver: "魏焕巧",
    hkDriver: "香港司机",
    mainlandDriver: "内地司机",
    transportMode: "双司机"
  };
  const legacyDispatch = {
    date: "2026-11-03",
    orderNo: order.no,
    loading: "深圳",
    unloading: "香港"
  };

  const displayed = context.applyOrderDispatchAssignment(order, legacyDispatch);
  assert.equal(displayed.vehicleSource, "汉业物流");
  assert.equal(displayed.supplier, "华南供应商");
  assert.equal(displayed.plate, "粤ZCS36港");
  assert.equal(displayed.driver, "魏焕巧");
  assert.equal(displayed.hkDriver, "香港司机");
  assert.equal(displayed.mainlandDriver, "内地司机");
  assert.equal(displayed.transportMode, "双司机");
});

test("a legacy single-driver dispatch row cannot hide a saved double-driver order", () => {
  const order = {
    vehicle_source: "汉业物流", transport_mode: "双司机", plate: "粤ZCS36港",
    driver: "香港司机 / 大陆骑师", hk_driver: "香港司机", mainland_driver: "大陆骑师"
  };
  const dispatch = {
    transportMode: "单司机", plate: "粤ZEL68港", driver: "旧司机", hkDriver: "", mainlandDriver: ""
  };
  const displayed = context.applyOrderDispatchAssignment(order, dispatch);
  assert.equal(displayed.transportMode, "双司机");
  assert.equal(displayed.driver, "香港司机 / 大陆骑师");
  assert.equal(displayed.hkDriver, "香港司机");
  assert.equal(displayed.mainlandDriver, "大陆骑师");
  assert.equal(displayed.plate, "粤ZEL68港", "other current dispatch fields remain authoritative");

  const saved = context.mergeUnchangedOrderAssignmentFields({
    remark: "只改备注", orderAssignmentBase: displayed
  }, order, dispatch);
  assert.equal(saved.transportMode, "双司机");
  assert.equal(saved.mainlandDriver, "大陆骑师");
  const missingMode = context.applyOrderDispatchAssignment(order, { driver: "旧司机" });
  assert.equal(missingMode.driver, "香港司机 / 大陆骑师");
  assert.equal(missingMode.transportMode, "双司机");
});

test("historical transport mode names retain both relay driver roles", () => {
  for (const [legacyMode, mode] of [["香港司机 + 大陆骑师接驳", "双司机"], ["口岸交货", "口岸转国内车"]]) {
    const displayed = context.applyOrderDispatchAssignment({
      transport_mode: legacyMode, driver: "香港司机 / 大陆骑师", hk_driver: "香港司机", mainland_driver: "大陆骑师"
    }, { transportMode: "香港司机直送", driver: "旧司机" });
    assert.equal(displayed.transportMode, mode);
    assert.equal(displayed.hkDriver, "香港司机");
    assert.equal(displayed.mainlandDriver, "大陆骑师");
  }
});

test("a double-driver dispatch assignment still replaces an older single-driver order", () => {
  const displayed = context.applyOrderDispatchAssignment({
    transportMode: "单司机", driver: "旧司机"
  }, {
    transportMode: "双司机", driver: "", hkDriver: "香港司机", mainlandDriver: "大陆骑师"
  });
  assert.equal(displayed.transportMode, "双司机");
  assert.equal(displayed.hkDriver, "香港司机");
  assert.equal(displayed.mainlandDriver, "大陆骑师");
});

test("assignment selection favors the latest active plan date over an older completed row", () => {
  const lookup = new Map([[
    "order:HY20261103013",
    [
      { date: "2026-11-03", priority: 2, statusRank: 60, createdAt: "2026-11-03 08:00:00", plate: "粤ZCS36港" },
      { date: "2026-11-04", priority: 2, statusRank: 40, createdAt: "2026-11-04 14:28:00", plate: "粤ZEL68港" }
    ]
  ]]);

  const selected = context.orderDispatchCandidateForOrder({ no: "HY20261103013" }, lookup);
  assert.equal(selected.plate, "粤ZEL68港");
});

test("saving an old order form keeps the live dispatch assignment unless the user changed that field", () => {
  const existing = { vehicle_source: "汉业物流", plate: "粤ZCS36港", driver: "魏焕巧", transport_mode: "单司机" };
  const dispatch = { vehicleSource: "汉业物流", plate: "粤ZEL68港", driver: "叶勇波", transportMode: "单司机" };
  const body = {
    vehicleSource: "汉业物流",
    plate: "粤ZCS36港",
    driver: "魏焕巧",
    transportMode: "单司机",
    orderAssignmentBase: {
      vehicleSource: "汉业物流",
      plate: "粤ZCS36港",
      driver: "魏焕巧",
      transportMode: "单司机"
    }
  };

  const merged = context.mergeUnchangedOrderAssignmentFields(body, existing, dispatch);
  assert.equal(merged.plate, "粤ZEL68港");
  assert.equal(merged.driver, "叶勇波");

  const legacyClientSave = context.mergeUnchangedOrderAssignmentFields({
    vehicleSource: "汉业物流",
    plate: "粤ZCS36港",
    driver: "魏焕巧",
    transportMode: "单司机"
  }, existing, dispatch);
  assert.equal(legacyClientSave.plate, "粤ZEL68港");
  assert.equal(legacyClientSave.driver, "叶勇波");

  const intentionalEdit = context.mergeUnchangedOrderAssignmentFields({
    ...body,
    plate: "粤ZAB12港"
  }, existing, dispatch);
  assert.equal(intentionalEdit.plate, "粤ZAB12港");
  assert.equal(intentionalEdit.driver, "叶勇波");

  const legacyIntentionalEdit = context.mergeUnchangedOrderAssignmentFields({
    plate: "粤ZAB12港"
  }, existing, dispatch);
  assert.equal(legacyIntentionalEdit.plate, "粤ZAB12港");
  assert.equal(legacyIntentionalEdit.driver, "叶勇波");

  const partialEdit = context.mergeUnchangedOrderAssignmentFields({ remark: "客户补充说明" }, existing, dispatch);
  assert.equal(partialEdit.plate, "粤ZEL68港");
  assert.equal(partialEdit.driver, "叶勇波");
});

test("saving an unchanged double-driver order with a legacy dispatch row preserves its assignment", () => {
  const existing = {
    vehicle_source: "汉业物流", transport_mode: "双司机",
    driver: "香港司机 / 大陆骑师", hk_driver: "香港司机", mainland_driver: "大陆骑师"
  };
  const merged = context.mergeUnchangedOrderAssignmentFields({
    vehicleSource: "汉业物流", transportMode: "双司机",
    driver: "香港司机 / 大陆骑师", hkDriver: "香港司机", mainlandDriver: "大陆骑师"
  }, existing, { date: "2026-11-23", transportMode: "", hkDriver: "", mainlandDriver: "" });
  assert.equal(merged.transportMode, "双司机");
  assert.equal(merged.hkDriver, "香港司机");
  assert.equal(merged.mainlandDriver, "大陆骑师");
});

test("changing transport mode honors cleared driver fields even if the live assignment changed", () => {
  const merged = context.mergeUnchangedOrderAssignmentFields({
    transportMode: "单司机", driver: "香港司机", hkDriver: "", mainlandDriver: "",
    orderAssignmentBase: { transportMode: "双司机", driver: "香港司机", hkDriver: "香港司机", mainlandDriver: "" }
  }, {}, {
    transportMode: "双司机", driver: "香港司机 / 大陆骑师", hkDriver: "香港司机", mainlandDriver: "大陆骑师"
  });
  assert.equal(merged.transportMode, "单司机");
  assert.equal(merged.driver, "香港司机");
  assert.equal(merged.hkDriver, "");
  assert.equal(merged.mainlandDriver, "");
});

test("legacy snake_case updates can change mode and explicitly clear driver fields", () => {
  const merged = context.mergeUnchangedOrderAssignmentFields({
    transport_mode: "单司机", driver: "香港司机", hk_driver: "", mainland_driver: ""
  }, {
    transport_mode: "双司机", driver: "香港司机 / 大陆骑师", hk_driver: "香港司机", mainland_driver: "大陆骑师"
  }, {
    transportMode: "双司机", driver: "香港司机 / 大陆骑师", hkDriver: "香港司机", mainlandDriver: "大陆骑师"
  });
  assert.equal(merged.transportMode ?? merged.transport_mode, "单司机");
  assert.equal(merged.hkDriver ?? merged.hk_driver, "");
  assert.equal(merged.mainlandDriver ?? merged.mainland_driver, "");
});

test("an old dispatch page preserves a newer order assignment while saving unrelated edits", () => {
  const base = { transportMode: "单司机", driver: "旧司机", hkDriver: "", mainlandDriver: "", plate: "旧车牌" };
  const current = { transportMode: "双司机", driver: "", hkDriver: "香港司机", mainlandDriver: "大陆骑师", plate: "新车牌" };
  const merged = context.mergeUnchangedDispatchAssignmentFields({ ...base, note: "新备注" }, current, base);
  assert.equal(merged.transportMode, "双司机");
  assert.equal(merged.driver, "");
  assert.equal(merged.hkDriver, "香港司机");
  assert.equal(merged.mainlandDriver, "大陆骑师");
  assert.equal(merged.plate, "新车牌");
  assert.equal(merged.note, "新备注");
  assert.equal(base.transportMode, "单司机", "the old baseline is not modified");
});

test("an intentional dispatch mode change keeps cleared drivers and legacy aliases", () => {
  const base = { transport_mode: "双司机", driver: "", hk_driver: "香港司机", mainland_driver: "大陆骑师" };
  const merged = context.mergeUnchangedDispatchAssignmentFields({
    transportMode: "单司机", driver: "香港司机", hkDriver: "", mainlandDriver: ""
  }, { ...base, mainland_driver: "新骑师" }, base);
  assert.equal(merged.transportMode, "单司机");
  assert.equal(merged.driver, "香港司机");
  assert.equal(merged.hkDriver, "");
  assert.equal(merged.mainlandDriver, "");
  const unchanged = context.mergeUnchangedDispatchAssignmentFields(base, { ...base, mainland_driver: "新骑师" }, base);
  assert.equal(unchanged.mainlandDriver, "新骑师");
  assert.equal(unchanged.mainland_driver, "新骑师");
});

function updateRouteContext({ existing, rows }) {
  const state = { order: { ...existing }, rows: structuredClone(rows) };
  const ctx = vm.createContext({
    ...context,
    state,
    app: { patch: (_path, handler) => { ctx.updateOrder = handler; } },
    db: {
      prepare: () => ({
        get: async () => state.order,
        all: async () => [{ plan_date: "2026-11-23", rows_json: JSON.stringify(state.rows) }]
      }),
      transaction: (callback) => callback
    },
    parseDispatchPlanRowsJson: JSON.parse,
    compactLookupValues: (values) => [...new Set(values.filter(Boolean))],
    loadSpecialCustomerOrderLookup: async () => null,
    assertOrderVisibleForAccount: async () => true,
    booleanFlag: Boolean,
    orderDispatchLoadInfoLookup: async () => new Map([[`order:${state.order.no}`, state.rows.map((row) => ({ ...row, priority: 2 }))]]),
    readOrderPayload: async (body) => ({ ...body, no: state.order.no, status: "预排", fees: [] }),
    resolveOrderCustomer: async () => true,
    lockOrderDispatchSync: async () => {},
    updateOrderRow: async (_no, item) => { state.order = { ...state.order, ...item }; },
    saveOrderFees: async () => {},
    ORDER_STATUS_TO_DISPATCH_STATUS: {},
    syncDispatchPlanRowsRemarkFromOrder: async () => {},
    updateDispatchPlanRowsJson: async (_date, json) => { state.rows = JSON.parse(json); },
    writeAudit: async () => {},
    auditChangeSummary: () => "",
    mapOrder: (order) => ({ ...order, ...ctx.orderAssignmentFieldsFromSource(order) }),
    hydrateOrderRowsForApi: async (orders) => orders.map((order) => ctx.applyOrderDispatchAssignment(order, state.rows[0]))
  });
  vm.runInContext([
    section("function dispatchRowText", "function dispatchRowBooleanField"),
    section("function dispatchRowMatchesRefs", "function attachDispatchOrderRefs"),
    section("function orderDispatchCandidateForOrder", "async function orderDispatchLoadInfoLookup"),
    section("const ORDER_ASSIGNMENT_BASE_FIELDS", "async function readOrderPayload"),
    section("async function syncDispatchPlanRowsAssignmentFromOrder", "async function syncDispatchPlanRowsRemarkFromOrder"),
    section('app.patch("/api/orders/:no",', 'app.patch("/api/orders/:no/status",')
  ].join("\n"), ctx);
  return ctx;
}

test("order update persists double drivers to dispatch and returns them when reopened", async () => {
  const ctx = updateRouteContext({
    existing: { no: "O1", vehicle_source: "汉业物流", transport_mode: "单司机", driver: "香港司机" },
    rows: [
      { orderNo: "O1", vehicleSource: "汉业物流", transportMode: "单司机", driver: "香港司机", note: "保留备注", quantity: "20" },
      { linkedOrderNos: ["O1"], transportMode: "单司机", transport_mode: "单司机" },
      { orderNo: "O2", transportMode: "单司机", driver: "其他司机" }
    ]
  });
  let response;
  await ctx.updateOrder({ params: { no: "O1" }, body: {
    vehicleSource: "汉业物流", transportMode: "双司机",
    driver: "香港司机 / 大陆骑师", hkDriver: "香港司机", mainlandDriver: "大陆骑师",
    orderAssignmentBase: { vehicleSource: "汉业物流", transportMode: "单司机", driver: "香港司机", hkDriver: "", mainlandDriver: "" }
  } }, { json: (value) => { response = value; } });
  assert.equal(ctx.state.order.transportMode, "双司机");
  assert.equal(ctx.state.rows[0].transportMode, "双司机");
  assert.equal(ctx.state.rows[0].hkDriver, "香港司机");
  assert.equal(ctx.state.rows[0].mainlandDriver, "大陆骑师");
  assert.equal(ctx.state.rows[0].note, "保留备注");
  assert.equal(ctx.state.rows[0].quantity, "20");
  assert.equal(ctx.state.rows[0].driver, "", "dispatch rows keep relay drivers in separate fields");
  assert.equal(ctx.state.rows[1].transportMode, "双司机");
  assert.equal(ctx.state.rows[1].transport_mode, "双司机");
  assert.equal(ctx.state.rows[2].driver, "其他司机");
  assert.equal(response.transportMode, "双司机");
  assert.equal(response.hkDriver, "香港司机");
  assert.equal(response.mainlandDriver, "大陆骑师");
  const reopened = ctx.applyOrderDispatchAssignment(ctx.state.order, ctx.state.rows[0]);
  assert.equal(reopened.transportMode, "双司机");
  assert.equal(reopened.mainlandDriver, "大陆骑师");
});

test("switching an order back to single-driver clears both dispatch driver aliases", async () => {
  const ctx = updateRouteContext({
    existing: {
      no: "O1", vehicle_source: "汉业物流", transport_mode: "双司机",
      driver: "香港司机 / 大陆骑师", hk_driver: "香港司机", mainland_driver: "大陆骑师"
    },
    rows: [{
      orderNo: "O1", vehicleSource: "汉业物流", transportMode: "双司机", driver: "",
      hkDriver: "香港司机", mainlandDriver: "大陆骑师", hk_driver: "香港司机", mainland_driver: "大陆骑师"
    }]
  });
  let response;
  await ctx.updateOrder({ params: { no: "O1" }, body: {
    vehicleSource: "汉业物流", transportMode: "单司机", driver: "香港司机", hkDriver: "", mainlandDriver: "",
    orderAssignmentBase: { transportMode: "双司机", driver: "香港司机 / 大陆骑师", hkDriver: "香港司机", mainlandDriver: "大陆骑师" }
  } }, { json: (value) => { response = value; } });
  assert.equal(response.transportMode, "单司机");
  assert.equal(response.driver, "香港司机");
  assert.equal(response.mainlandDriver, "");
  assert.equal(ctx.state.rows[0].hkDriver, "");
  assert.equal(ctx.state.rows[0].mainlandDriver, "");
  assert.equal(ctx.state.rows[0].hk_driver, "");
  assert.equal(ctx.state.rows[0].mainland_driver, "");
});
