import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function financeWageStatementOrderInPeriod");
const end = source.indexOf("function financeWageStatementFeeLineKey", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({
  financePeriodFilter: { value: "2026-10" },
  dateMatchesPeriodFilter: () => true,
  inputDateUtcValue(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  },
  orderDispatchLoadDate(order = {}) {
    return order.dispatchLoadDate || order.date || "";
  },
  orderDispatchLoadTime(order = {}) {
    return order.dispatchLoadTime || "";
  },
  dispatchPlanTimeRank(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : 24 * 60 + 1;
  }
});
vm.runInContext(source.slice(start, end), context);

test("driver wage export orders follow dispatch loading date and time", () => {
  const sorted = context.financeWageStatementOrders({
    orders: [
      { no: "HY20261014011", date: "2026-10-14", dispatchLoadDate: "2026-10-14", dispatchLoadTime: "18:00" },
      { no: "HY20261014006", date: "2026-10-14", dispatchLoadDate: "2026-10-14", dispatchLoadTime: "11:00" },
      { no: "HY20261014008", date: "2026-10-14", dispatchLoadDate: "2026-10-14", dispatchLoadTime: "14:00" },
      { no: "HY20261014011-FIRST", date: "2026-10-14", dispatchLoadDate: "2026-10-14", dispatchLoadTime: "09:00" }
    ]
  });

  assert.deepEqual(Array.from(sorted, ({ no }) => no), [
    "HY20261014011-FIRST",
    "HY20261014006",
    "HY20261014008",
    "HY20261014011"
  ]);
});

test("driver wage export puts missing loading times after timed orders", () => {
  const sorted = context.financeWageStatementOrders({
    orders: [
      { no: "HY2", date: "2026-10-14", dispatchLoadDate: "2026-10-14", dispatchLoadTime: "" },
      { no: "HY1", date: "2026-10-14", dispatchLoadDate: "2026-10-14", dispatchLoadTime: "09:00" }
    ]
  });

  assert.deepEqual(Array.from(sorted, ({ no }) => no), ["HY1", "HY2"]);
});
