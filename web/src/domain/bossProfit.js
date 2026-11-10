function amount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export function sumCustomsRevenueRmb(rows = []) {
  return rows.reduce((sum, row) => sum + amount(row?.total), 0);
}

export function sumMoneyBreakdowns(...breakdowns) {
  return breakdowns.reduce((sum, item = {}) => ({
    hkd: sum.hkd + amount(item.hkd),
    rmb: sum.rmb + amount(item.rmb)
  }), { hkd: 0, rmb: 0 });
}

export function subtractMoneyBreakdowns(revenue = {}, ...costs) {
  const totalCost = sumMoneyBreakdowns(...costs);
  return {
    hkd: amount(revenue.hkd) - totalCost.hkd,
    rmb: amount(revenue.rmb) - totalCost.rmb
  };
}

export function calculateTransportProfit({
  revenue = {},
  driverWages = {},
  supplierCosts = {},
  companyCoveredCosts = {},
  vehicleCosts = {}
} = {}) {
  return subtractMoneyBreakdowns(
    revenue,
    driverWages,
    supplierCosts,
    companyCoveredCosts,
    vehicleCosts
  );
}

export function calculateCustomerContributionProfit({
  revenue = {},
  driverWages = {},
  supplierCosts = {},
  companyCoveredCosts = {},
  otherBusinessProfit = {},
  customsProfit = {}
} = {}) {
  return sumMoneyBreakdowns(
    subtractMoneyBreakdowns(revenue, driverWages, supplierCosts, companyCoveredCosts),
    otherBusinessProfit,
    customsProfit
  );
}

export function calculateCompanyNetProfit({
  transportProfit = {},
  customsProfit = {},
  otherBusinessProfit = {},
  otherIncome = {},
  companyExpenses = {}
} = {}) {
  return subtractMoneyBreakdowns(
    sumMoneyBreakdowns(transportProfit, customsProfit, otherBusinessProfit, otherIncome),
    companyExpenses
  );
}
