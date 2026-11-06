import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function supplierEntityAliases");
const end = source.indexOf("function supplierOrderPayableBreakdown", start);
const context = vm.createContext({
  findPartnerByTypedLabel() {
    return null;
  },
  supplierDisplayLabel(value) {
    return String(value || "").trim();
  },
  normalizeVehicleSource(value) {
    return String(value || "").trim();
  },
  uniqueOrderCostNames(values = []) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
  },
  isCompanyCoveredFee(fee = {}) {
    return fee.category === "公司承担";
  },
  orderFeeAssigneeNames(fee = {}, order = {}) {
    if (Object.prototype.hasOwnProperty.call(fee, "driverName")) {
      return fee.driverName ? [fee.driverName] : [];
    }
    return order.supplier ? [order.supplier] : [];
  },
  orderFeeHasManualAssignee(fee = {}) {
    return Boolean(String(fee.driverName || "").trim());
  },
  feeItemForFee() {
    return {};
  },
  supplierOrderFeeCostSnapshot(fee = {}) {
    return {
      amount: Number(fee.cost || 0),
      currency: fee.currency || "港币",
      matched: true,
      label: ""
    };
  }
});
vm.runInContext(source.slice(start, end), context);

test("manual supplier attribution filters a fee out of the original supplier bill", () => {
  const order = {
    vehicleSource: "外派车辆",
    supplier: "鸿博达",
    fees: [
      { name: "费用450", driverName: "雄丰仓库", cost: 450 },
      { name: "费用100", cost: 100 }
    ]
  };

  assert.deepEqual(
    Array.from(context.supplierOrderCostFeeRows(order, "雄丰仓库"), ({ name, amount }) => ({ name, amount })),
    [{ name: "费用450", amount: 450 }]
  );
  assert.deepEqual(
    Array.from(context.supplierOrderCostFeeRows(order, "鸿博达"), ({ name, amount }) => ({ name, amount })),
    [{ name: "费用100", amount: 100 }]
  );
});

test("a manually attributed vehicle-check fee follows the selected supplier", () => {
  const order = {
    vehicleSource: "外派车辆",
    supplier: "惠雅居运输",
    fees: [{ name: "查车费", driverName: "蔡武查车", cost: 80 }]
  };

  assert.equal(context.supplierOrderCostFeeRows(order, "蔡武查车").length, 1);
  assert.equal(context.supplierOrderCostFeeRows(order, "惠雅居运输").length, 0);
});

test("fees without a manual attribution stay with the order supplier", () => {
  const order = {
    vehicleSource: "外派车辆",
    supplier: "鸿博达",
    fees: [{ name: "运输费", cost: 120 }]
  };

  assert.equal(context.supplierOrderCostFeeRows(order, "鸿博达").length, 1);
  assert.equal(context.supplierOrderCostFeeRows(order, "雄丰仓库").length, 0);
});

