import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function dataLoadActiveScope");
const end = source.indexOf("function currentAuditDataSnapshot", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({
  activeModule: { value: "financeWages" },
  BOSS_CENTER_MODULES: [],
  VEHICLE_EXPENSE_MODULES: [],
  normalizeRoute(value = "") {
    return String(value || "").split("?")[0];
  }
});
vm.runInContext(source.slice(start, end), context);

test("driver wage module loads fee items needed to resolve fee cost ownership", () => {
  assert.equal(context.dataLoadScopeNeedsFeeItems("financeWages"), true);
  assert.equal(context.dataLoadScopeNeedsFeeItems("active"), true);
});

test("fee item loading remains enabled for order, freight, and template modules", () => {
  for (const scope of ["orders", "freight", "templates"]) {
    assert.equal(context.dataLoadScopeNeedsFeeItems(scope), true);
  }
});

test("unrelated scoped modules do not load fee items", () => {
  assert.equal(context.dataLoadScopeNeedsFeeItems("vehicleDriver"), false);
});
