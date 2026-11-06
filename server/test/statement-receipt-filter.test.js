import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("function statementReceiptCategoryFeeName");
const end = source.indexOf("function truncateDisplayText", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test("statement receipt export keeps fee attachments and excludes generic order attachments", () => {
  assert.equal(context.statementReceiptFileIsFeeAttachment({ category: "收费项目行-fee-1" }), true);
  assert.equal(context.statementReceiptFileIsFeeAttachment({ category: "收费项目-过磅费" }), true);
  assert.equal(context.statementReceiptFileIsFeeAttachment({ category: "订单附件" }), false);
  assert.equal(context.statementReceiptFileIsFeeAttachment({ category: "" }), false);
});

