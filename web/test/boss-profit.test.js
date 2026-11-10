import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCompanyNetProfit,
  calculateCustomerContributionProfit,
  calculateTransportProfit,
  sumCustomsRevenueRmb
} from "../src/domain/bossProfit.js";

test("customer contribution profit subtracts costs from that customer's orders", () => {
  const highCostCustomer = calculateCustomerContributionProfit({
    revenue: { hkd: 1000, rmb: 500 },
    driverWages: { hkd: 300, rmb: 50 },
    supplierCosts: { hkd: 500, rmb: 300 },
    companyCoveredCosts: { hkd: 100, rmb: 25 },
    otherBusinessProfit: { rmb: 10 }
  });
  const lowCostCustomer = calculateCustomerContributionProfit({
    revenue: { hkd: 1000, rmb: 500 },
    driverWages: { hkd: 100, rmb: 0 },
    supplierCosts: { hkd: 0, rmb: 50 },
    companyCoveredCosts: { hkd: 0, rmb: 0 }
  });

  assert.deepEqual(highCostCustomer, { hkd: 100, rmb: 135 });
  assert.deepEqual(lowCostCustomer, { hkd: 900, rmb: 450 });
});

test("company net profit subtracts company expenses after operating profit", () => {
  assert.deepEqual(calculateCompanyNetProfit({
    transportProfit: { hkd: 1000, rmb: 100 },
    customsProfit: { rmb: 200 },
    otherBusinessProfit: { rmb: 50 },
    otherIncome: { rmb: 25 },
    companyExpenses: { hkd: 100, rmb: 500 }
  }), { hkd: 900, rmb: -125 });
});

test("transport profit subtracts driver, supplier, company-covered, and vehicle costs", () => {
  assert.deepEqual(calculateTransportProfit({
    revenue: { hkd: 1000, rmb: 500 },
    driverWages: { hkd: 300, rmb: 50 },
    supplierCosts: { hkd: 500, rmb: 300 },
    companyCoveredCosts: { hkd: 100, rmb: 25 },
    vehicleCosts: { hkd: 50, rmb: 100 }
  }), { hkd: 50, rmb: 25 });
});

test("company net profit uses transport contribution plus uncosted customs and non-transport entries", () => {
  const transportProfit = calculateTransportProfit({
    revenue: { rmb: 1000 },
    driverWages: { rmb: 200 },
    supplierCosts: { rmb: 300 },
    companyCoveredCosts: { rmb: 100 },
    vehicleCosts: { rmb: 100 }
  });
  const netProfit = calculateCompanyNetProfit({
    transportProfit,
    customsProfit: { rmb: 500 },
    otherBusinessProfit: { rmb: 40 },
    otherIncome: { rmb: 20 },
    companyExpenses: { rmb: 60 }
  });

  assert.deepEqual(netProfit, { hkd: 0, rmb: 800 });
  assert.ok(netProfit.rmb <= 1000 + 500 + 40 + 20);
});

test("customs revenue reads the server RMB total once and ignores legacy unknown currency fields", () => {
  assert.equal(sumCustomsRevenueRmb([
    { total: 1000, totalHKD: 500 },
    { total: "250", total_hkd: 400 },
    { total: "invalid", totalHKD: 200 }
  ]), 1250);
});
