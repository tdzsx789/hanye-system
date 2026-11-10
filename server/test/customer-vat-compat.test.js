import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("const TRANSPORT_CUSTOMS_DECLARATION_NO_FLAG_FIELD");
const end = source.indexOf("async function loadCustomerSpecialCustomerMap", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

function createContext() {
  const context = vm.createContext({
    Array,
    Boolean,
    JSON,
    Math,
    Number,
    Object,
    Set,
    String,
    customsBusinessCustomFieldName(field = {}) {
      return String(field?.name ?? field?.label ?? field?.key ?? "").trim();
    },
    parseJsonArrayText(value) {
      try {
        const parsed = JSON.parse(String(value || "[]"));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    userTextValue(value) {
      return String(value ?? "").trim();
    },
    integerField(value) {
      const number = Number(value || 0);
      return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
    },
    normalizeCustomsBusinessCustomFields(value) {
      const source = Array.isArray(value) ? value : [];
      return source
        .map((field) => ({ name: String(field?.name || "").trim(), value: Number(field?.value || 0) }))
        .filter((field) => field.name);
    },
    normalizeCustomerVatRate(value) {
      const rate = Number(String(value ?? "").replace(/%/g, "").trim());
      if (!Number.isFinite(rate) || rate <= 0) return 0;
      return Math.min(100, Number(rate.toFixed(2)));
    },
    booleanFlag(value, fallback = false) {
      if (value === undefined || value === null || value === "") return fallback;
      return value === true || value === 1 || value === "1" || value === "true";
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test("legacy customer JSON preserves the VAT rate when vat_rate is absent", () => {
  const context = createContext();
  const row = {
    id: "KH0001",
    type: "客户",
    customer_category: "运输客户",
    name: "旧库客户",
    customs_custom_fields: JSON.stringify([
      { name: "进口报关费", value: 30 },
      { name: "__transport_customer_vat_rate__", value: 6.25 }
    ])
  };

  const mapped = context.mapCustomer(row);
  assert.equal(mapped.vatRate, 6.25);
  assert.deepEqual(mapped.customsCustomFields, [{ name: "进口报关费", value: 30 }]);
});

test("the formal VAT column takes precedence and the fallback marker can be cleared", () => {
  const context = createContext();
  const mapped = context.mapCustomer({
    id: "KH0002",
    type: "客户",
    customer_category: "运输客户",
    name: "新库客户",
    vat_rate: 13,
    customs_custom_fields: JSON.stringify([{ name: "__transport_customer_vat_rate__", value: 6 }])
  });
  assert.equal(mapped.vatRate, 13);

  const fields = context.withTransportCustomerVatRateFallback(
    [{ name: "进口报关费", value: 30 }, { name: "__transport_customer_vat_rate__", value: 6 }],
    0
  );
  assert.deepEqual(fields, [{ name: "进口报关费", value: 30 }]);
});

test("legacy customer updates keep omitted VAT and custom fields", () => {
  const context = createContext();
  const existing = {
    id: "KH0003",
    type: "客户",
    customer_category: "运输客户",
    name: "旧库客户",
    customs_custom_fields: JSON.stringify([
      { name: "进口报关费", value: 30 },
      { name: "__transport_customer_vat_rate__", value: 6 }
    ])
  };

  const legacyPayload = context.customerPayloadForUpdate({ name: "修改名称" }, existing);
  assert.equal(legacyPayload.vatRate, 6);
  assert.equal(JSON.stringify(legacyPayload.customsCustomFields), JSON.stringify([
    { name: "进口报关费", value: 30 }
  ]));

  const explicitClear = context.customerPayloadForUpdate({ vatRate: 0, customsCustomFields: [] }, existing);
  assert.equal(explicitClear.vatRate, 0);
  assert.equal(JSON.stringify(explicitClear.customsCustomFields), "[]");
});
