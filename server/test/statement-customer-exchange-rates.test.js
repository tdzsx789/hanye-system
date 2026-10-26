import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("function statementCustomerExchangeRateCustomer");
const end = source.indexOf("function monthStartInputValue", start);
const rateHelpers = source.slice(start, end);

function createContext({ settings = [], legacyRows = [], hasLegacyTable = false } = {}) {
  const queries = [];
  const context = vm.createContext({
    normalizePeriodMonthKey(value) {
      const match = String(value || "").trim().match(/^(\d{4})-(\d{1,2})$/);
      if (!match) return "";
      const month = Number(match[2]);
      return month >= 1 && month <= 12 ? `${match[1]}-${String(month).padStart(2, "0")}` : "";
    },
    userTextValue: (value) => String(value ?? "").trim(),
    db: {
      prepare(sql) {
        return {
          async all(...params) {
            queries.push({ sql, params });
            if (sql.includes("FROM app_settings")) return settings;
            if (sql.includes("FROM statement_customer_exchange_rates")) return legacyRows;
            throw new Error(`Unexpected query: ${sql}`);
          },
          async get(...params) {
            queries.push({ sql, params });
            if (sql.includes("to_regclass")) return { name: hasLegacyTable ? "statement_customer_exchange_rates" : null };
            throw new Error(`Unexpected query: ${sql}`);
          }
        };
      }
    }
  });
  vm.runInContext(rateHelpers, context);
  return { context, queries };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("customer exchange rates load from existing app_settings without a new table", async () => {
  const { context, queries } = createContext({
    settings: [{
      key: "statement_customer_exchange_rate:2026-10:id:customer-1",
      value: JSON.stringify({
        periodMonth: "2026-10",
        customerKey: "id:customer-1",
        customerId: "customer-1",
        customerName: "客户甲",
        rate: 7.82,
        updatedAt: "2026-10-27T00:00:00.000Z"
      })
    }]
  });

  const rows = await context.loadStatementCustomerExchangeRateRows();
  assert.deepEqual(plain(rows), [{
    period_month: "2026-10",
    customer_key: "id:customer-1",
    customer_id: "customer-1",
    customer_name: "客户甲",
    rate: 7.82,
    created_at: "",
    updated_at: "2026-10-27T00:00:00.000Z"
  }]);
  assert.equal(queries.some(({ sql }) => sql.includes("FROM statement_customer_exchange_rates")), false);
  assert.equal(context.statementCustomerExchangeRateSettingKey("2026-10", "id:customer-1"), "statement_customer_exchange_rate:2026-10:id:customer-1");
});

test("existing customer exchange rate tables remain readable and app_settings wins on duplicate keys", async () => {
  const { context } = createContext({
    hasLegacyTable: true,
    legacyRows: [{
      period_month: "2026-10",
      customer_key: "id:customer-1",
      customer_id: "customer-1",
      customer_name: "旧名称",
      rate: 7.8,
      created_at: "2026-10-01",
      updated_at: "2026-10-02"
    }],
    settings: [{
      key: "statement_customer_exchange_rate:2026-10:id:customer-1",
      value: JSON.stringify({
        periodMonth: "2026-10",
        customerKey: "id:customer-1",
        customerId: "customer-1",
        customerName: "客户甲",
        rate: 7.82,
        updatedAt: "2026-10-27T00:00:00.000Z"
      })
    }]
  });

  const rows = await context.loadStatementCustomerExchangeRateRows();
  assert.deepEqual(plain(rows).map(({ customer_name, rate }) => ({ customer_name, rate })), [
    { customer_name: "客户甲", rate: 7.82 }
  ]);
});
