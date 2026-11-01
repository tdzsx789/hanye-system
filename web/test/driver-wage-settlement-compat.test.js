import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function normalizeFinanceWageSettlementRow");
const end = source.indexOf("function financeWageSettlementPeriodKey", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({
  String,
  Number,
  DRIVER_WAGE_SETTLEMENT_SETTLED_STATUS: "已结算",
  DRIVER_WAGE_SETTLEMENT_PENDING_STATUS: "未结算"
});
vm.runInContext(source.slice(start, end), context);

test("legacy RMB-only settlement is loaded as one canonical RMB amount", () => {
  const row = context.normalizeFinanceWageSettlementRow({
    adjustments_hkd: null,
    adjustments_rmb: 120
  });

  assert.equal(row.adjustmentsHKD, 120);
  assert.equal(row.adjustmentsRMB, null);
  assert.equal(row.adjustmentsCurrency, "RMB");
});

test("historical dual-currency settlement remains dual-currency", () => {
  const row = context.normalizeFinanceWageSettlementRow({
    adjustments_hkd: 80,
    adjustments_rmb: 30
  });

  assert.equal(row.adjustmentsHKD, 80);
  assert.equal(row.adjustmentsRMB, 30);
  assert.equal(row.adjustmentsCurrency, "HKD");
});
