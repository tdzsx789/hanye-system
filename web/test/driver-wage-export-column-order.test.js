import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function financeWageStatementFeeName");
const end = source.indexOf("function financeWageStatementProjectColumns", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);
const rowsEnd = source.indexOf("function buildFinanceWageStatementExportPayload", end);
assert.notEqual(rowsEnd, -1);
vm.runInContext(source.slice(end, rowsEnd), context);

test("driver wage export project headers use the requested order", () => {
  const names = [
    "其它费用",
    "香港坐车费",
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
    "香港坐车费",
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

test("香港坐车费 immediately follows 香港过磅费 before 代垫卸货费", () => {
  const scaleFee = context.financeWageStatementProjectOrderIndex("香港过磅费");
  const rideFee = context.financeWageStatementProjectOrderIndex("香港坐车费");
  const advanceUnloadingFee = context.financeWageStatementProjectOrderIndex("代垫卸货费");
  const unloadingFee = context.financeWageStatementProjectOrderIndex("卸货费");

  assert.equal(rideFee, scaleFee + 1);
  assert.ok(rideFee < advanceUnloadingFee);
  assert.ok(advanceUnloadingFee < unloadingFee);
});

test("standard wage statement project names retain their documented order", () => {
  const names = [
    "装货等候费",
    "文件打印费",
    "香港停车费",
    "大陆过磅费",
    "机场附加费",
    "代垫卸货费",
    "香港过磅费",
    "卸货等候费",
    "大陆登记费",
    "香港登记费",
    "压车费",
    "大陆停车费",
    "卸货费",
    "口岸停车费",
    "装货费",
    "加点费",
    "过海费"
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
    "代垫卸货费",
    "卸货费",
    "装货费",
    "加点费",
    "过海费",
    "机场附加费",
    "卸货等候费",
    "压车费",
    "装货等候费",
    "大陆登记费",
    "大陆过磅费",
    "大陆停车费",
    "口岸停车费",
    "文件打印费"
  ]);
});

test("reference statements keep project headers and amounts aligned", () => {
  const samples = [
    ["香港停车费:HKD", "香港登记费:HKD", "香港过磅费:HKD", "代垫卸货费:HKD", "卸货费:HKD", "装货费:HKD", "加点费:HKD", "过海费:HKD", "机场附加费:HKD", "卸货等候费:HKD", "压车费:HKD", "装货等候费:HKD", "打车费:RMB", "大陆登记费:RMB", "大陆过磅费:RMB", "大陆停车费:RMB", "口岸停车费:RMB", "文件打印费:RMB"],
    ["香港停车费:HKD", "香港登记费:HKD", "香港过磅费:HKD", "卸货费:HKD", "加点费:HKD", "过海费:HKD", "大陆登记费:RMB", "大陆过磅费:RMB", "大陆停车费:RMB", "文件打印费:RMB", "洗车费:RMB"],
    ["香港停车费:HKD", "香港登记费:HKD", "香港过磅费:HKD", "加油费:HKD", "打车费:HKD", "代垫装车费:HKD", "卸货费:HKD", "装货费:HKD", "加点费:HKD", "过海费:HKD", "贴标签:HKD", "大陆过磅费:RMB", "大陆停车费:RMB", "口岸停车费:RMB"],
    ["香港停车费:HKD", "香港登记费:HKD", "香港过磅费:HKD", "香港坐车费:HKD", "卸货费:HKD", "装货费:HKD", "打车费:RMB", "大陆过磅费:RMB", "大陆停车费:RMB", "文件打印费:RMB", "洗车费:RMB"]
  ];
  context.financeWageStatementOrderProjectLines = (order) => order.lines;
  context.financeWageStatementOrders = (row) => row.orders;
  context.financeWageStatementCustomerName = () => "客户";
  context.financeWageStatementRouteText = () => "路线";
  context.financeWageStatementMainlandRiderName = () => "";
  context.financeWageStatementRemarkText = () => "";

  for (const sample of samples) {
    const lines = sample.map((entry, index) => {
      const [name, currency] = entry.split(":");
      return { name, currency, key: entry, amount: index + 1, freight: false };
    });
    const order = { date: "2026-10-01", lines: [...lines].reverse() };
    const row = { driver: { name: "司机" }, orders: [order] };
    const columns = context.financeWageStatementProjectColumns(row.orders, row.driver);
    assert.deepEqual(Array.from(columns, (column) => column.key), sample);
    const exportedRow = context.financeWageStatementRows(row, columns, false)[0];
    assert.deepEqual(Array.from(exportedRow.slice(5, 5 + columns.length)), lines.map((line) => line.amount));
  }
});

test("project columns group currencies and retain unknown fees without duplicating them", () => {
  context.financeWageStatementOrderProjectLines = (order) => order.lines;
  const lines = [
    { name: "打车费", currency: "RMB", key: "打车费:RMB" },
    { name: "自定义费", currency: "HKD", key: "自定义费:HKD" },
    { name: "打车费", currency: "HKD", key: "打车费:HKD" },
    { name: "运费", currency: "HKD", key: "运费:HKD", freight: true }
  ];
  const columns = context.financeWageStatementProjectColumns([{ lines }, { lines }]);
  assert.deepEqual(Array.from(columns, (column) => column.key), ["打车费:HKD", "自定义费:HKD", "打车费:RMB"]);
});
