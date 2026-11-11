import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("function normalizeDriverWageSettlementStatus");
const end = source.indexOf("function parseJsonArrayText", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({
  String,
  Number,
  Object,
  JSON,
  DRIVER_WAGE_SETTLEMENT_PENDING_STATUS: "未结算",
  DRIVER_WAGE_SETTLEMENT_SETTLED_STATUS: "已结算",
  pickBody: (body, camelKey, snakeKey, fallback) => body[camelKey] ?? body[snakeKey] ?? fallback
});
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

test("old schemas keep both explicit currency amounts instead of projecting one over the other", () => {
  const item = context.normalizeDriverWageSettlementWriteItem({
    adjustmentsHKD: 100,
    adjustmentsRMB: 88,
    adjustmentsCurrency: "HKD"
  }, { adjustmentsCurrency: false });

  assert.equal(item.adjustmentsHKD, 100);
  assert.equal(item.adjustmentsRMB, 88);
});

test("old schemas persist added deductions in note metadata and expose them as fields", () => {
  const item = context.normalizeDriverWageSettlementWriteItem({
    periodKey: "2026-11",
    driverId: 7,
    status: "未结算",
    adjustmentsHKD: 120,
    adjustmentsRMB: null,
    adjustmentsCurrency: "RMB",
    adjustmentsUnit: "项",
    plateFeeHKD: 50,
    plateFeeUnit: "项",
    plateFeeCurrency: "HKD",
    socialSecurityFeeHKD: 30,
    socialSecurityFeeUnit: "项",
    socialSecurityFeeCurrency: "RMB",
    parkingFeeHKD: null,
    parkingFeeUnit: "项",
    parkingFeeCurrency: "HKD",
    note: "历史备注"
  }, { adjustmentsHKD: true, adjustmentsRMB: true, note: true });

  assert.equal(item.adjustmentsHKD, null);
  assert.equal(item.adjustmentsRMB, 120);
  const stored = context.unpackDriverWageSettlementNote(item.note);
  assert.equal(stored.note, "历史备注");
  assert.equal(stored.metadata.plateFeeHKD, 50);
  assert.equal(stored.metadata.socialSecurityFeeCurrency, "RMB");

  const mapped = context.mapDriverWageSettlement({
    period_key: "2026-11",
    driver_id: 7,
    status: "未结算",
    adjustments_hkd: item.adjustmentsHKD,
    adjustments_rmb: item.adjustmentsRMB,
    note: item.note
  });
  assert.equal(mapped.adjustmentsCurrency, "RMB");
  assert.equal(mapped.plateFeeHKD, 50);
  assert.equal(mapped.socialSecurityFeeHKD, 30);
  assert.equal(mapped.socialSecurityFeeCurrency, "RMB");
  assert.equal(mapped.note, "历史备注");

  const next = context.readDriverWageSettlementPayload({ note: "历史备注更新" }, {
    period_key: "2026-11",
    driver_id: 7,
    adjustments_hkd: item.adjustmentsHKD,
    adjustments_rmb: item.adjustmentsRMB,
    note: item.note
  });
  assert.equal(next.adjustmentsCurrency, "RMB");
  assert.equal(next.plateFeeHKD, 50);
  assert.equal(next.socialSecurityFeeHKD, 30);
});

test("legacy parking fees are migrated to reimbursement", () => {
  const legacyRow = {
    period_key: "2026-10",
    driver_id: 9,
    status: "未结算",
    parking_fee_hkd: 250,
    parking_fee_currency: "HKD",
    note: "旧备注"
  };
  const mappedLegacy = context.mapDriverWageSettlement(legacyRow);
  assert.equal(mappedLegacy.parkingFeeTreatment, "reimbursement");

  const legacyUpdate = context.readDriverWageSettlementPayload({ note: "更新备注" }, legacyRow);
  assert.equal(legacyUpdate.parkingFeeTreatment, "reimbursement");
  const savedLegacy = context.normalizeDriverWageSettlementWriteItem(legacyUpdate, {
    parkingFeeHKD: true,
    parkingFeeCurrency: true,
    note: true
  });
  assert.equal(context.unpackDriverWageSettlementNote(savedLegacy.note).metadata.parkingFeeTreatment, "reimbursement");

  const newSettlement = context.readDriverWageSettlementPayload({
    periodKey: "2026-11",
    driverId: 9,
    parkingFeeHKD: 300
  });
  assert.equal(newSettlement.parkingFeeTreatment, "reimbursement");
});

test("explicit legacy deduction values are normalized to reimbursement", () => {
  const mapped = context.mapDriverWageSettlement({
    parking_fee_hkd: 180,
    parking_fee_currency: "HKD",
    note: "旧备注\n[[hanye-driver-wage-meta:v1]]{\"parkingFeeTreatment\":\"deduction\"}"
  });
  assert.equal(mapped.parkingFeeTreatment, "reimbursement");
});
