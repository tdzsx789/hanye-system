import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const syncStart = source.indexOf("function syncAutoFreightFee");
const syncEnd = source.indexOf("async function ensureReferenceDataLoaded", syncStart);
const applyStart = source.indexOf("function applyFeeTemplateRows");
const applyEnd = source.indexOf("function applyOrderTemplateFields", applyStart);
const templateFeeHelpers = [source.slice(syncStart, syncEnd), source.slice(applyStart, applyEnd)].join("\n");

function createContext() {
  const context = vm.createContext({
    orderFees: { value: [] },
    orderForm: { currency: "港币" },
    feeItemRowsByName: { value: new Map() },
    booleanFlag: (value, fallback = false) => value === undefined ? fallback : Boolean(value),
    normalizeFeeCost: () => null,
    orderFeeCategoryValue: (value) => value,
    normalizeOrderFeeRow: (fee) => ({ ...fee }),
    normalizeFeeQuantity: (fee) => Number(fee.quantity || 1),
    calculateFeeAmountFromUnitPrice: ({ quantity, unitPrice }) => Number(quantity || 1) * Number(unitPrice || 0),
    normalizeFeeAmount: (fee) => Number(fee.amount || 0),
    isFreightFeeRow: (fee) => !fee.name || fee.name.includes("运费") || fee.autoFreight,
    findFreightFeeTemplate: () => ({ name: "中港运费", category: "正常", currency: "港币", defaultAmount: 900 }),
    findAutoFreightFeeIndex: () => 0,
    createBlankFeeRow: () => ({ name: "", quantity: 1, unitPrice: 0, amount: 0 }),
    ensureOrderFreightCurrency() {},
    syncCrossBorderFreightDriverRole() {},
    refreshOrderFeeCost() {},
    scheduleOrderFeeCostSync() {},
    addFeeRow() {}
  });
  vm.runInContext(templateFeeHelpers, context);
  return context;
}

test("loading a saved RMB freight template preserves its currency during auto sync", () => {
  const context = createContext();
  context.applyFeeTemplateRows([{
    name: "中港运费",
    category: "正常",
    quantity: 1,
    unitPrice: 900,
    amount: 900,
    currency: "人民币"
  }]);

  assert.equal(context.orderFees.value[0].currency, "人民币");
  assert.equal(context.orderFees.value[0]._manualCurrency, true);

  context.syncAutoFreightFee();

  assert.equal(context.orderFees.value[0].currency, "人民币");
  assert.equal(context.orderFees.value[0].unitPrice, 900);
});
