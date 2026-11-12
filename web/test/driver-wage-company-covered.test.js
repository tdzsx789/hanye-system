import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");

function createContext() {
  const context = vm.createContext({
    COMPANY_SELF_PAY_CATEGORY: "公司自费",
    OTHER_EXPENSE_COST_SOURCE: "其他支出",
    COMPANY_COVERED_DEFAULT_REMARKS: ["公司自费", "其他支出"],
    isCompanyCoveredFeeItem(item = {}) {
      const target = item || {};
      const sources = target.costSources || target.costSource || target.cost_source || [];
      const values = Array.isArray(sources) ? sources : [sources];
      return target.category === "公司自费"
        || values.includes("公司自费")
        || values.includes("其他支出");
    },
    feeItemForFee(fee = {}) {
      return fee.item || null;
    },
    selectedDriver: { value: { name: "香港司机甲" } },
    quantityNumber(value) {
      const number = Number(value || 0);
      return Number.isFinite(number) ? number : 0;
    },
    orderDriverWageRule() {
      return {
        loadPerBoard: 40,
        unloadPerBoard: 50,
        crossSeaFee: 80,
        addPointFee: 20,
        waitingPerHour: 30
      };
    },
    advanceFeeRateTotalForOrder() {
      return 0;
    },
    isAdvanceFee(fee = {}) {
      return fee.category === "代垫";
    },
    isMainlandRiderDriver() {
      return false;
    },
    orderHasMainlandRiderCostAndWage() {
      return true;
    },
    feeAssignedDriverName(order, fee = {}) {
      return String(fee.driverName || fee.driver_name || order.driver || "").trim();
    },
    normalizeFeeCost(fee = {}) {
      const value = fee.cost ?? fee.costValue ?? fee.cost_value ?? fee.costAmount ?? fee.cost_amount;
      if (value === undefined || value === null || String(value).trim() === "") return null;
      return Number(value);
    },
    booleanFlag(value, fallback = false) {
      if (value === undefined || value === null || value === "") return fallback;
      if (typeof value === "boolean") return value;
      return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
    }
  });

  const coveredStart = source.indexOf("function feeHasCompanyCoveredAssignment");
  const coveredEnd = source.indexOf("\nfunction isCompanySelfPayDefaultRemark", coveredStart);
  assert.ok(coveredStart >= 0 && coveredEnd > coveredStart);
  vm.runInContext(source.slice(coveredStart, coveredEnd), context);

  vm.runInContext(`
    function feeCostAssigneeBelongsToDriver(order = {}, fee = {}, driver = null) {
      if (!driver?.name || !fee || isCompanyCoveredFee(fee)) return false;
      const name = String(fee.driverName || fee.driver_name || "").trim();
      return name === String(driver.name || "").trim();
    }
  `, context);

  const extraStart = source.indexOf("const DRIVER_EXTRA_FEE_KEYWORDS");
  const extraEnd = source.indexOf("\nfunction driverByName", extraStart);
  assert.ok(extraStart >= 0 && extraEnd > extraStart);
  vm.runInContext(source.slice(extraStart, extraEnd), context);

  const advanceStart = source.indexOf("function advanceFeesForOrder");
  const advanceEnd = source.indexOf("\nfunction orderAdvanceFeeBreakdown", advanceStart);
  assert.ok(advanceStart >= 0 && advanceEnd > advanceStart);
  vm.runInContext(source.slice(advanceStart, advanceEnd), context);
  return context;
}

test("company-covered unloading does not trigger driver extra wages", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const order = {
    fees: [{ name: "卸货费", amount: 120, quantity: 3, driverName: "公司承担" }]
  };

  assert.equal(context.isCompanyCoveredFee(order.fees[0]), true);
  assert.equal(context.orderHasActualDriverExtraFee(order, "unloadPerBoard", driver), false);
  assert.equal(context.orderDriverExtraQuantity(order, "unloadPerBoard", driver), 0);
  assert.equal(context.driverExtraTripFee(order, "unloadPerBoard", driver), 0);
});

test("same-name company fee is skipped while the driver's unloading fee remains payable", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const order = {
    fees: [
      { name: "卸货费", amount: 120, quantity: 5, category: "公司自费", driverName: "香港司机甲" },
      { name: "卸货费", amount: 80, quantity: 2, driverName: "香港司机甲" }
    ]
  };

  assert.equal(context.orderDriverExtraQuantity(order, "unloadPerBoard", driver), 2);
  assert.equal(context.driverExtraTripFee(order, "unloadPerBoard", driver), 100);
});

test("company-covered loading, crossing, point and waiting fees do not enter driver wages", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const fields = [
    ["loadPerBoard", "装货费"],
    ["crossSeaFee", "过海费"],
    ["addPointFee", "加点费"],
    ["waitingPerHour", "装货等候费"]
  ];

  for (const [field, name] of fields) {
    const order = {
      fees: [{ name, amount: 100, quantity: 2, driverName: driver.name, remark: "其他支出由公司承担" }]
    };
    assert.equal(context.isCompanyCoveredFee(order.fees[0]), true);
    assert.equal(context.driverExtraTripFee(order, field, driver), 0, field);
  }
});

test("loading wait fees do not trigger per-board loading wages", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const order = {
    fees: [{ name: "装货等候费", amount: 200, quantity: 1, driverName: driver.name }]
  };

  assert.equal(context.orderHasActualDriverExtraFee(order, "loadPerBoard", driver), false);
  assert.equal(context.orderDriverExtraQuantity(order, "loadPerBoard", driver), 0);
  assert.equal(context.driverExtraTripFee(order, "loadPerBoard", driver), 0);
  assert.equal(context.driverExtraTripFee(order, "waitingPerHour", driver), 30);
});

test("waiting fee names do not match the per-board loading project", () => {
  const context = createContext();
  assert.equal(context.driverExtraFeeNameMatchesField("装货等候费", "loadPerBoard"), false);
  assert.equal(context.driverExtraFeeNameMatchesField("装货等待费", "loadPerBoard"), false);
  assert.equal(context.driverExtraFeeNameMatchesField("装货等待费", "waitingPerHour"), true);
});

test("a saved zero driver cost does not create a waiting wage", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const order = {
    fees: [{
      name: "装货等候费",
      amount: 200,
      cost: 0,
      costCurrency: "人民币",
      driverName: driver.name
    }]
  };

  assert.equal(context.orderHasActualDriverExtraFee(order, "waitingPerHour", driver), false);
  assert.equal(context.driverExtraTripFee(order, "waitingPerHour", driver), 0);
});

test("legacy orders without a saved cost keep their automatic waiting wage", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const order = {
    fees: [{
      name: "装货等候费",
      amount: 200,
      cost: 0,
      _savedCost: null,
      driverName: driver.name
    }]
  };

  assert.equal(context.orderHasActualDriverExtraFee(order, "waitingPerHour", driver), true);
  assert.equal(context.driverExtraTripFee(order, "waitingPerHour", driver), 30);
});

test("legacy JSON cost parts preserve an explicit zero cost", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const order = {
    fees: [{
      name: "装货等候费",
      amount: 200,
      cost: 0,
      _savedCost: null,
      costPartsJson: JSON.stringify([{ role: "香港司机", amount: 0 }]),
      driverName: driver.name
    }]
  };

  assert.equal(context.orderHasActualDriverExtraFee(order, "waitingPerHour", driver), false);
  assert.equal(context.driverExtraTripFee(order, "waitingPerHour", driver), 0);
});

test("a positive saved driver cost still creates the configured waiting wage", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const order = {
    fees: [{
      name: "装货等候费",
      amount: 200,
      cost: 50,
      costCurrency: "港币",
      driverName: driver.name
    }]
  };

  assert.equal(context.driverExtraTripFee(order, "waitingPerHour", driver), 30);
});

test("legacy company markers are recognized without a fee item id", () => {
  const context = createContext();
  assert.equal(context.isCompanyCoveredFee({ name: "卸货费", driverName: "公司承担" }), true);
  assert.equal(context.isCompanyCoveredFee({ name: "卸货费", driver_role: "公司自费" }), true);
  assert.equal(context.isCompanyCoveredFee({ name: "卸货费", remark: "费用由公司承担" }), true);
});

test("company-covered advance fees are excluded from driver advance totals", () => {
  const context = createContext();
  const driver = { name: "香港司机甲" };
  const order = {
    driver: driver.name,
    fees: [
      { name: "预支卸货费", category: "代垫", amount: 100, driverName: driver.name, remark: "公司承担" },
      { name: "预支停车费", category: "代垫", amount: 50, driverName: driver.name }
    ]
  };

  assert.deepEqual(
    context.advanceFeesForOrder(order, driver).map((fee) => fee.name),
    ["预支停车费"]
  );
});
