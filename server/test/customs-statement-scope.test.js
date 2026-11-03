import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("async function loadCustomsStatementExportRows");
const end = source.indexOf("function customsStatementExportContext", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

function createFixture({ customers = [], businesses = [], hasCustomerTypeColumn = true } = {}) {
  const queries = [];
  const context = vm.createContext({
    db: {
      prepare(sql) {
        return {
          async all(...args) {
            queries.push({ sql, args });
            if (sql.includes("FROM customers")) return customers;
            if (sql.includes("FROM customs_businesses")) return businesses;
            throw new Error(`unexpected query: ${sql}`);
          }
        };
      }
    },
    String,
    Set,
    customsStatementSafeCompany(value) {
      return String(value || "").trim() || "未填写客户";
    },
    customsBusinessPeriodBounds() {
      return { start: "", end: "" };
    },
    loadLinkedCustomsBusinessIdSet: async () => new Set(),
    customerColumnExists: async (column) => column === "customs_customer_type" && hasCustomerTypeColumn,
    mapCustomsBusiness(row) {
      return {
        id: row.id,
        company: row.company,
        total: Number(row.total || 0)
      };
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, queries };
}

test("customer type scope includes every customs customer sharing the type", async () => {
  const fixture = createFixture({
    customers: [
      { name: "甲客户", short_name: "甲", customs_customer_type: "电商" },
      { name: "乙客户", short_name: "乙", customs_customer_type: "电商" },
      { name: "丙客户", short_name: "丙", customs_customer_type: "一般贸易" }
    ],
    businesses: [
      { id: 1, company: "甲客户", total: 10 },
      { id: 2, company: "乙客户", total: 20 },
      { id: 3, company: "丙客户", total: 30 }
    ]
  });

  const rows = await fixture.context.loadCustomsStatementExportRows("甲客户", "all", { scope: "customerType" });
  assert.deepEqual(Array.from(rows, (row) => row.company), ["甲客户", "乙客户"]);
  assert.equal(fixture.queries.filter(({ sql }) => sql.includes("FROM customers")).length, 1);
});

test("customer type scope returns no rows when the selected customer has no type", async () => {
  const fixture = createFixture({
    customers: [{ name: "甲客户", short_name: "甲", customs_customer_type: "" }],
    businesses: [{ id: 1, company: "甲客户", total: 10 }]
  });

  const rows = await fixture.context.loadCustomsStatementExportRows("甲客户", "all", { scope: "customerType" });
  assert.deepEqual(Array.from(rows), []);
  assert.equal(fixture.queries.filter(({ sql }) => sql.includes("FROM customs_businesses")).length, 0);
});

test("default customer scope remains limited to the selected customer", async () => {
  const fixture = createFixture({
    businesses: [
      { id: 1, company: "甲客户", total: 10 },
      { id: 2, company: "乙客户", total: 20 }
    ]
  });

  const rows = await fixture.context.loadCustomsStatementExportRows("甲客户", "all");
  assert.deepEqual(Array.from(rows, (row) => row.company), ["甲客户"]);
});

test("customer type scope stays safe when the legacy customers table lacks the new column", async () => {
  const fixture = createFixture({
    hasCustomerTypeColumn: false,
    customers: [{ name: "甲客户", short_name: "甲" }],
    businesses: [{ id: 1, company: "甲客户", total: 10 }]
  });

  const rows = await fixture.context.loadCustomsStatementExportRows("甲客户", "all", { scope: "customerType" });
  assert.deepEqual(Array.from(rows), []);
  assert.equal(fixture.queries.filter(({ sql }) => sql.includes("FROM customers")).length, 0);
  assert.equal(fixture.queries.filter(({ sql }) => sql.includes("FROM customs_businesses")).length, 0);
});
