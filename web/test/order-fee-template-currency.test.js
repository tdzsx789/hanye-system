import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const syncStart = source.indexOf("function syncAutoFreightFee");
const syncEnd = source.indexOf("async function ensureReferenceDataLoaded", syncStart);
const normalizeStart = source.indexOf("function normalizeOrderFeeRow");
const normalizeEnd = source.indexOf("function normalizeLocationText", normalizeStart);
const loadStart = source.indexOf("function normalizeLoadedOrderFreightFee");
const loadEnd = source.indexOf("function applyFeeTemplateRows", loadStart);
const applyStart = source.indexOf("function applyFeeTemplateRows");
const applyEnd = source.indexOf("function applyOrderTemplateFields", applyStart);
const templateFeeHelpers = [
  source.slice(normalizeStart, normalizeEnd),
  source.slice(syncStart, syncEnd),
  source.slice(loadStart, loadEnd),
  source.slice(applyStart, applyEnd)
].join("\n");

function createContext() {
  let feeClientKey = 0;
  const normalizeCurrency = (value, fallback = "港币") => {
    const currency = String(value || "").trim().toUpperCase();
    if (currency === "RMB" || currency === "人民币") return "人民币";
    if (currency === "HKD" || currency === "港币") return "港币";
    return fallback;
  };
  const context = vm.createContext({
    orderFees: { value: [] },
    orderForm: { currency: "港币" },
    feeItemRowsByName: { value: new Map() },
    feeItemRowsById: { value: new Map() },
    booleanFlag: (value, fallback = false) => value === undefined ? fallback : Boolean(value),
    ensureOrderFeeClientKey: (fee) => { fee._clientKey ||= `fee-${++feeClientKey}`; },
    orderFeeFxLinks: (fee) => fee?.fxLinks || {},
    setOrderFeeFxLinks: (fee, links) => { fee.fxLinks = links; },
    normalizeCostCenterCurrency: normalizeCurrency,
    normalizeOrderFeeCostSplitParts: (parts) => Array.isArray(parts) ? parts : [],
    normalizeOrderFeeCostComponent: (value) => value == null || value === "" ? null : Number(value),
    orderFeeHasStoredManualCostSplit: () => false,
    orderFeeCostSplitEnabled: () => false,
    normalizeOrderFeeAssigneeText: (value) => String(value || ""),
    orderFeeAutoDriverRole: () => "",
    normalizeOrderFeeManualAssigneeFlag: () => false,
    syncCompanySelfPayFeeRemark() {},
    feeCategoryLabel: (fee) => fee.category || "正常",
    normalizeFeeQuantity: (fee) => Number(fee.quantity || 1),
    normalizeFeeUnitPrice: (fee) => Number(fee.unitPrice || 0),
    rawFeeUnitPrice: (fee) => Number(fee.unitPrice || 0),
    applyOrderFeeFxLinkField: (fee, field) => {
      if (!fee.fxLinks?.[field]) return false;
      if (field !== "cost") fee.currency = normalizeCurrency(fee.fxLinks[field].targetCurrency);
      return true;
    },
    normalizeFeeCost: () => null,
    orderFeeCategoryValue: (value) => value,
    calculateFeeAmountFromUnitPrice: ({ quantity, unitPrice }) => Number(quantity || 1) * Number(unitPrice || 0),
    normalizeFeeAmount: (fee) => Number(fee.amount || 0),
    isFreightFeeRow: (fee) => !fee.name || fee.name.includes("运费") || fee.autoFreight,
    isCrossBorderFreightFee: (fee) => fee.name === "中港运费",
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

test("a saved template's RMB currency wins over stale HKD FX links and route defaults", () => {
  const context = createContext();
  const loadedFee = context.normalizeLoadedOrderFreightFee({
    name: "中港运费",
    quantity: 1,
    unitPrice: 1200,
    amount: 1200,
    currency: "RMB",
    fxLinks: {
      unitPrice: { targetCurrency: "HKD" },
      amount: { targetCurrency: "HKD" },
      cost: { targetCurrency: "HKD" }
    }
  });
  context.applyFeeTemplateRows([loadedFee]);

  assert.equal(context.orderFees.value[0].currency, "人民币");
  assert.equal(context.orderFees.value[0]._manualCurrency, true);
  assert.deepEqual(Object.keys(context.orderFees.value[0].fxLinks), ["cost"]);

  context.normalizeOrderFeeRows();
  context.syncAutoFreightFee();
  assert.equal(context.orderFees.value[0].currency, "人民币");
});
