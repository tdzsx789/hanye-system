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
  section("function orderDispatchCandidateForOrder", "async function hydrateOrderDispatchLoadInfo"),
  section("const ORDER_ASSIGNMENT_BASE_FIELDS", "async function readOrderPayload")
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
