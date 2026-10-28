import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const clientSource = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8");

function extract(source) {
  const start = source.indexOf("function statementFilenamePeriodLabel");
  assert.notEqual(start, -1);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1);
  return source.slice(start, end + 2);
}

for (const [label, source] of [["client", clientSource], ["server", serverSource]]) {
  test(`${label} export names identify a same-month date range once`, () => {
    const context = vm.createContext({ exportFilenamePart: (value) => value });
    vm.runInContext(extract(source), context);

    assert.equal(context.statementFilenamePeriodLabel("2026-10-01", "2026-10-31"), "2026年10月");
    assert.equal(context.statementFilenamePeriodLabel("2026-01-01", "2026-12-31"), "2026年");
    assert.equal(context.statementFilenamePeriodLabel("2026-10-01", "2026-11-30"), "2026年10月至2026年11月");
  });
}
