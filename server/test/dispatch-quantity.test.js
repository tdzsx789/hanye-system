import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0 && to > from);
  return source.slice(from, to);
}

function contextFor(orders = []) {
  const queries = [];
  const context = vm.createContext({
    queries,
    userTextValue: (value) => String(value ?? "").trim(),
    requestCanViewSpecialCustomerOrders: ({ account }) => account?.role === "管理员",
    orderColumnExists: async () => true,
    orderMatchesSpecialCustomer: (order) => order.customer_id === "special",
    db: { prepare: (sql) => ({ all: async (...args) => { queries.push({ sql, args }); return orders; } }) }
  });
  vm.runInContext([
    section("function dispatchRowText", "function dispatchRowBooleanField"),
    section("function dispatchRowReferenceValue", "function dispatchRowLoadTime"),
    section("function dispatchRowQuantityWasEdited", "function dispatchRowCreatorFields"),
    section("function dispatchQuantityOrderLookup", "async function loadOrdersLinkedToOrderRow"),
    section("function compactLookupValues", "function lookupHasAny"),
    section("function dispatchExportText", "function dispatchExportOptionalText")
  ].join("\n"), context);
  return context;
}

test("historical blank or stale dispatch quantities use the current linked order", async () => {
  const ctx = contextFor([{ no: "O1", dispatch_no: "D1", quantity: "465件16板" }]);
  const rows = [{ orderNo: "O1", quantity: "" }, { dispatch_no: "D1", quantity: "old" }];
  const lookup = await ctx.loadDispatchQuantityOrders(rows, { role: "跟单员" }, {});
  assert.deepEqual(rows.map((row) => ctx.resolveDispatchRowQuantity(row, lookup).quantity), ["465件16板", "465件16板"]);
  assert.equal(ctx.queries.length, 1, "hydrate the whole list with one order query");
});

test("an explicitly cleared order quantity stays blank even with old nested export data", async () => {
  const ctx = contextFor([{ no: "O1", quantity: "" }]);
  const lookup = await ctx.loadDispatchQuantityOrders([{ orderNo: "O1" }], { role: "管理员" }, {});
  assert.equal(ctx.resolveDispatchRowQuantity({ orderNo: "O1", quantity: "20", order: { quantity: "30" } }, lookup).quantity, "");
});

test("unlinked dispatch rows keep their quantity and linked groups resolve only an unambiguous order", () => {
  const ctx = contextFor();
  const a = { no: "O1", dispatch_no: "D1", quantity: "12" };
  const b = { no: "O2", dispatch_no: "D2", quantity: "24" };
  const lookup = ctx.dispatchQuantityOrderLookup([a, b]);
  assert.equal(ctx.resolveDispatchRowQuantity({ quantity: "manual" }, lookup).quantity, "manual");
  assert.equal(ctx.resolveDispatchRowQuantity({ linkedOrderNos: ["O1"] }, lookup).quantity, "12");
  assert.equal(ctx.resolveDispatchRowQuantity({ linkedOrderNos: ["O1", "O2"], quantity: "group" }, lookup).quantity, "group");
  assert.equal(ctx.resolveDispatchRowQuantity({ orderNo: "O2", linkedOrderNos: ["O1", "O2"] }, lookup).quantity, "24");
});

test("duplicate dispatch numbers do not silently take another order's quantity", () => {
  const ctx = contextFor();
  const lookup = ctx.dispatchQuantityOrderLookup([
    { no: "O1", dispatch_no: "D1", quantity: "12" },
    { no: "O2", dispatch_no: "D1", quantity: "24" }
  ]);
  assert.equal(ctx.resolveDispatchRowQuantity({ dispatchNo: "D1", quantity: "original" }, lookup).quantity, "original");
  assert.equal(ctx.resolveDispatchRowQuantity({ orderNo: "O2", dispatchNo: "D1" }, lookup).quantity, "24");
});

test("quantity hydration respects special-customer visibility without needing the orders API", async () => {
  const ctx = contextFor([
    { no: "O1", customer_id: "normal", quantity: "12" },
    { no: "O2", customer_id: "special", quantity: "secret" }
  ]);
  const rows = [{ orderNo: "O1" }, { orderNo: "O2", orderRestricted: true, quantity: "" }];
  const lookup = await ctx.loadDispatchQuantityOrders(rows, { role: "跟单员" }, {});
  assert.equal(ctx.resolveDispatchRowQuantity(rows[0], lookup).quantity, "12");
  assert.equal(ctx.resolveDispatchRowQuantity(rows[1], lookup).quantity, "");
  assert.equal(lookup.byNo.has("O2"), false);
  assert.equal(JSON.stringify(ctx.queries[0].args[0]), '["O1"]');
});

test("a stale auto-save or missing baseline cannot overwrite the order's newer quantity", () => {
  const ctx = contextFor();
  assert.equal(ctx.dispatchRowQuantityWasEdited({ quantity: "20" }, { quantity: "" }, { quantity: "20" }), false);
  assert.equal(ctx.dispatchRowQuantityWasEdited({ quantity: "20" }, { quantity: "" }, null), false);
  assert.equal(ctx.dispatchRowQuantityWasEdited({}, { quantity: "20" }, { quantity: "20" }), false);
  assert.equal(ctx.dispatchRowQuantityWasEdited({ quantity: "30" }, { quantity: "" }, { quantity: "20" }), true);
  assert.equal(ctx.dispatchRowQuantityWasEdited({ quantity: "" }, { quantity: "20" }, { quantity: "20" }), true);
});
