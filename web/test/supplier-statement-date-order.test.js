import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function compareStatementOrderDates");
const end = source.indexOf("function selectedStatementOrders", start);
const context = vm.createContext({
  inputDateUtcValue(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }
});
vm.runInContext(source.slice(start, end), context);

test("statement orders sort by date ascending and order number within a date", () => {
  const sorted = context.sortStatementOrdersByDate([
    { no: "HY10", date: "2026-10-23" },
    { no: "HY3", date: "2026-10-16" },
    { no: "HY12", date: "2026-10-23" },
    { no: "HY2", date: "2026-10-15" }
  ]);

  assert.deepEqual(Array.from(sorted, ({ no }) => no), ["HY2", "HY3", "HY10", "HY12"]);
});

test("orders without a date remain after dated orders", () => {
  const sorted = context.sortStatementOrdersByDate([
    { no: "HY1", date: "" },
    { no: "HY2", date: "2026-10-15" }
  ]);

  assert.deepEqual(Array.from(sorted, ({ no }) => no), ["HY2", "HY1"]);
});
