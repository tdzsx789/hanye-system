import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function financeWageCurrencyCode");
const end = source.indexOf("const financeWageRows", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({ String, Number, DRIVER_WAGE_DEFAULT_FEE_CURRENCY: "HKD", money: (value) => Number(value || 0).toLocaleString() });
vm.runInContext(source.slice(start, end), context);
const displayStart = source.indexOf("function financeWageMiscDisplay");
const displayEnd = source.indexOf("function financeWageAdjustmentsSummaryText", displayStart);
vm.runInContext(source.slice(displayStart, displayEnd), context);

test("HKD and RMB advance misc fees are both included after RMB conversion", () => {
  assert.equal(context.financeWageMiscDeductionHKD(100, 88, 0.88), 200);
});

test("missing RMB exchange rate does not silently deduct the RMB amount", () => {
  assert.equal(context.financeWageMiscDeductionHKD(100, 88, 0), 100);
});

test("parking fee is reimbursed instead of deducted from driver wages", () => {
  const totals = context.financeWageSettlementTotals({
    wageHKD: 10000,
    deductionsHKD: 8000,
    parkingFeeHKD: 1415,
    parkingFeeTreatment: "reimbursement"
  });
  assert.equal(totals.totalDeductionHKD, 8000);
  assert.equal(totals.parkingReimbursementHKD, 1415);
  assert.equal(totals.totalHKD, 3415);
});

test("legacy parking fees keep their previous deduction behavior", () => {
  const totals = context.financeWageSettlementTotals({
    wageHKD: 10000,
    deductionsHKD: 8000,
    parkingFeeHKD: 1415,
    parkingFeeTreatment: "deduction"
  });
  assert.equal(totals.totalDeductionHKD, 9415);
  assert.equal(totals.parkingFeeDeductionHKD, 1415);
  assert.equal(totals.parkingReimbursementHKD, 0);
  assert.equal(totals.totalHKD, 585);
});

test("misc display keeps both currency slots when one amount is zero", () => {
  assert.equal(context.financeWageMiscDisplay(6000, 0), "HKD 6,000 / RMB 0");
  assert.equal(context.financeWageMiscDisplay(0, 2000), "HKD 0 / RMB 2,000");
});
