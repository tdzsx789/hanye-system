import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function financeWageStatementMainlandRiderName");
const end = source.indexOf("function financeWageStatementRows", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const context = vm.createContext({
  orderIsDoubleDriverMode(order = {}) {
    return order.transportMode === "双司机";
  },
  orderRelayDriverPair(order = {}) {
    const rider = String(order.mainlandDriver || "").trim();
    return { mainland: rider === "大陆骑师" ? "" : rider };
  }
});
vm.runInContext(source.slice(start, end), context);

test("driver wage rider summary counts only orders with a displayed rider", () => {
  const orders = [
    { transportMode: "双司机", mainlandDriver: "骑师甲" },
    { transportMode: "双司机", mainlandDriver: "" },
    { transportMode: "双司机", mainlandDriver: "大陆骑师" },
    { transportMode: "单司机", mainlandDriver: "不应显示" },
    { transportMode: "双司机", mainlandDriver: "骑师乙" }
  ];

  assert.equal(context.financeWageStatementMainlandRiderCount(orders), 2);
});
