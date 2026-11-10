import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function statementCustomerRowMatchesSearch");
const end = source.indexOf("const financeCustomerRanking", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

const customers = new Map([
  ["c-1", { id: "c-1", name: "深圳市恒泰通供应链管理有限公司", shortName: "恒泰通" }],
  ["c-2", { id: "c-2", name: "新源润贸易有限公司", short_name: "新源润" }]
]);
const context = vm.createContext({
  String,
  transportCustomerByReference: (_name, id) => customers.get(String(id)) || null,
  customerShortDisplay: (customer) => customer?.shortName || customer?.short_name || "",
  transportCustomerLabelByReference: (name) => name
});
vm.runInContext(source.slice(start, end), context);

test("customer statement search matches full name, short name, and customer id", () => {
  assert.equal(context.statementCustomerRowMatchesSearch({
    customer: "恒泰通",
    customerId: "c-1"
  }, "深圳市恒泰通"), true);
  assert.equal(context.statementCustomerRowMatchesSearch({
    customer: "恒泰通",
    customerId: "c-1"
  }, "恒泰通"), true);
  assert.equal(context.statementCustomerRowMatchesSearch({
    customer: "恒泰通",
    customerId: "c-1"
  }, "c-1"), true);
  assert.equal(context.statementCustomerRowMatchesSearch({
    customer: "新源润",
    customerId: "c-2"
  }, "不存在的客户"), false);
});

test("empty customer statement search keeps every customer", () => {
  assert.equal(context.statementCustomerRowMatchesSearch({ customer: "恒泰通" }, "  "), true);
});
