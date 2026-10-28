import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function removeDispatchLocationEntry");
const end = source.indexOf("function selectedAddressBookOptionsForApply", start);
const removeHelper = source.slice(start, end);

function createContext(initialEntries) {
  const state = { entries: initialEntries };
  const context = vm.createContext({
    state,
    window: { confirm: () => true },
    dispatchLocationDistrictPicker: { key: "loading:0", keyword: "test" },
    dispatchLocationEntries: () => state.entries,
    setDispatchLocationEntries: (_target, entries) => { state.entries = entries; }
  });
  vm.runInContext(removeHelper, context);
  return context;
}

test("the first dispatch location can be removed while another remains", () => {
  const context = createContext([{ detail: "首个地址" }, { detail: "第二个地址" }]);

  context.removeDispatchLocationEntry("loading", 0);

  assert.deepEqual(JSON.parse(JSON.stringify(context.state.entries)), [{ detail: "第二个地址" }]);
});

test("the final dispatch location cannot be removed", () => {
  const context = createContext([{ detail: "唯一地址" }]);

  context.removeDispatchLocationEntry("unloading", 0);

  assert.deepEqual(JSON.parse(JSON.stringify(context.state.entries)), [{ detail: "唯一地址" }]);
});

test("any dispatch location can be removed while multiple locations remain", () => {
  const context = createContext([
    { detail: "首个地址" },
    { detail: "第二个地址" },
    { detail: "第三个地址" }
  ]);

  context.removeDispatchLocationEntry("unloading", 2);

  assert.deepEqual(JSON.parse(JSON.stringify(context.state.entries)), [
    { detail: "首个地址" },
    { detail: "第二个地址" }
  ]);
});
