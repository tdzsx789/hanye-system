import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function financeWageStatementFeeName");
const end = source.indexOf("function financeWageStatementProjectColumns", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
vm.runInContext(source.slice(start, end), vm.createContext({}));
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test("driver wage export project headers use the requested order", () => {
  const names = [
    "其它费用",
    "装货费",
    "香港派送费",
    "香港停车费",
    "过海费",
    "香港登记费",
    "打车费",
    "代垫装车费",
    "加油费",
    "卸货费",
    "加点费",
    "香港过磅费"
  ];
  const sorted = names
    .map((name, index) => ({ name, index }))
    .sort((left, right) =>
      context.financeWageStatementProjectOrderIndex(left.name)
      - context.financeWageStatementProjectOrderIndex(right.name)
      || left.index - right.index
    );

  assert.deepEqual(Array.from(sorted, ({ name }) => name), [
    "香港停车费",
    "香港登记费",
    "香港过磅费",
    "加油费",
    "打车费",
    "代垫装车费",
    "卸货费",
    "装货费",
    "加点费",
    "过海费",
    "香港派送费",
    "其它费用"
  ]);
});

test("legacy other-fee spelling is exported as 其它费用", () => {
  assert.equal(context.financeWageStatementProjectDisplayName("其他费用"), "其它费用");
});
