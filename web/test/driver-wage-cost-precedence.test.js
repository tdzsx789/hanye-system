import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function financeWageStatementFeeHasStoredCost");
const end = source.indexOf("function financeWageStatementOrderProjectLines", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({
  booleanFlag(value, fallback = false) {
    if (value === undefined || value === null || value === "") return fallback;
    return value === true || value === 1 || value === "1" || value === "true";
  },
  normalizeFeeCost(fee = {}) {
    if (fee.cost === undefined || fee.cost === null || fee.cost === "") return null;
    const value = Number(fee.cost);
    return Number.isFinite(value) && value >= 0 ? value : null;
  },
  normalizeOrderFeeCostComponent(value = null) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  },
  normalizeOrderFeeCostSplitParts(value = []) {
    return Array.isArray(value) ? value : [];
  },
  orderFeeCostSplitParts() {
    return null;
  },
  feeItemForFee() {
    return { currency: "港币" };
  },
  driverCostCenterSourceForDriver() {
    return "香港司机";
  },
  normalizeCostCenterSourceLabel(value = "") {
    return String(value || "").trim();
  },
  financeWageStatementProjectCurrency(value = "") {
    return String(value || "").toUpperCase() === "RMB" || value === "人民币" ? "RMB" : "HKD";
  },
  financeWageStatementProjectName(value = "") {
    return String(value || "").trim();
  },
  financeWageStatementFeeLineKey(name = "", currency = "HKD") {
    return `${name}|${currency}`;
  },
  financeWageStatementIsFreightName() {
    return false;
  },
  isAdvanceFee() {
    return false;
  }
});
vm.runInContext(source.slice(start, end), context);

function amounts(fee) {
  return Array.from(
    context.financeWageStatementFeeSavedCostState(
      { fees: [fee] },
      fee,
      { name: "李永洪" }
    ).lines,
    ({ amount, currency }) => ({ amount, currency })
  );
}

test("single-currency unloading cost wins over a stale costHKD value", () => {
  assert.deepEqual(
    amounts({ name: "卸货费", cost: 550, costCurrency: "港币", costHKD: 110 }),
    [{ amount: 550, currency: "HKD" }]
  );
  assert.deepEqual(
    amounts({
      name: "卸货费",
      amount: 140,
      currency: "人民币",
      cost: 100,
      costCurrency: "港币",
      costHKD: 20
    }),
    [{ amount: 100, currency: "HKD" }]
  );
});

test("the same precedence applies to other cost-center projects", () => {
  assert.deepEqual(
    amounts({ name: "香港停车费", cost: 300, costCurrency: "港币", costHKD: 60 }),
    [{ amount: 300, currency: "HKD" }]
  );
});

test("explicit multi-currency split still exports both saved components", () => {
  assert.deepEqual(
    amounts({
      name: "卸货费",
      cost: 650,
      costHKD: 550,
      costRMB: 100,
      costSplitManual: true
    }),
    [
      { amount: 550, currency: "HKD" },
      { amount: 100, currency: "RMB" }
    ]
  );
});

test("a saved zero cost is not replaced by an old non-zero compatibility value", () => {
  const state = context.financeWageStatementFeeSavedCostState(
    { fees: [] },
    { name: "卸货费", cost: 0, costCurrency: "港币", costHKD: 20 },
    { name: "李永洪" }
  );
  assert.equal(state.present, true);
  assert.equal(state.lines.length, 0);
});
