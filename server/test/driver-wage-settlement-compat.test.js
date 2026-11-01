import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("function normalizeOptionalDriverWageAmount");
const end = source.indexOf("function mapDriverWageSettlement", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({ String, Number, Object });
vm.runInContext(source.slice(start, end), context);

test("legacy RMB-only settlement maps to the new canonical amount on a new schema", () => {
  const item = context.normalizeDriverWageSettlementWriteItem({
    adjustmentsHKD: null,
    adjustmentsRMB: 120,
    adjustmentsCurrency: "RMB"
  }, { adjustmentsCurrency: true });

  assert.equal(item.adjustmentsHKD, 120);
  assert.equal(item.adjustmentsRMB, null);
});

test("legacy RMB-only settlement stays in adjustments_rmb on an old schema", () => {
  const item = context.normalizeDriverWageSettlementWriteItem({
    adjustmentsHKD: 120,
    adjustmentsRMB: null,
    adjustmentsCurrency: "RMB"
  }, { adjustmentsCurrency: false });

  assert.equal(item.adjustmentsHKD, null);
  assert.equal(item.adjustmentsRMB, 120);
});

test("historical rows with both currencies keep both amounts", () => {
  const item = context.normalizeDriverWageSettlementWriteItem({
    adjustmentsHKD: 80,
    adjustmentsRMB: 30,
    adjustmentsCurrency: "HKD"
  }, { adjustmentsCurrency: false });

  assert.equal(item.adjustmentsHKD, 80);
  assert.equal(item.adjustmentsRMB, 30);
});
