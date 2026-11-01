import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const start = source.indexOf("function customsBusinessDuplicateIdentifier");
const end = source.indexOf("function normalizeOtherBusinessPayload", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

function createContext() {
  const queries = [];
  let duplicate = null;
  let insertCount = 0;
  const db = {
    transaction: async (callback) => callback(),
    prepare(sql) {
      return {
        async get(...args) {
          queries.push({ type: "get", sql, args });
          if (sql.includes("pg_advisory_xact_lock")) return {};
          if (sql.includes("created_at::timestamptz")) return duplicate;
          if (sql.includes("SELECT * FROM customs_businesses WHERE id")) {
            return { id: 42, declaration_no: "DEC-1", company: "测试客户" };
          }
          throw new Error(`unexpected query: ${sql}`);
        },
        async run(...args) {
          queries.push({ type: "run", sql, args });
          if (!sql.trimStart().startsWith("INSERT INTO customs_businesses")) {
            throw new Error(`unexpected mutation: ${sql}`);
          }
          insertCount += 1;
          return { lastInsertId: 42, changes: 1 };
        }
      };
    }
  };
  const context = vm.createContext({
    db,
    String,
    CUSTOMS_BUSINESS_CREATE_LOCK_NAMESPACE: 524463,
    CUSTOMS_BUSINESS_DUPLICATE_WINDOW_SECONDS: 60,
    userTextValue: (value) => String(value ?? "").trim()
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context,
    queries,
    setDuplicate(value) {
      duplicate = value;
    },
    get insertCount() {
      return insertCount;
    }
  };
}

const payload = {
  date: "2026-11-01",
  declarationNo: "DEC-1",
  sixSheetNo: "",
  company: "测试客户",
  direction: "出口",
  itemCount: 3,
  pageCount: 0,
  customsFee: 140,
  pageFee: 0,
  manifestFee: 40,
  inspectionFee: 0,
  checkFee: 0,
  verificationFee: 0,
  otherFee: 0,
  customFieldsJson: "[]",
  total: 180,
  remark: ""
};

test("recent same-customer declaration is rejected before a second insert", async () => {
  const fixture = createContext();
  fixture.setDuplicate({ id: 41, declaration_no: "DEC-1", company: "测试客户" });
  const result = await fixture.context.createCustomsBusinessWithDuplicateProtection(payload, true);
  assert.equal(result.duplicate.id, 41);
  assert.equal(fixture.insertCount, 0);
  const duplicateQuery = fixture.queries.find((query) => query.sql.includes("created_at::timestamptz"));
  assert.equal(JSON.stringify(duplicateQuery.args), JSON.stringify([
    { company: "测试客户", declarationNo: "DEC-1", sixSheetNo: "" }
  ]));
});

test("a new declaration is inserted inside the transaction when no recent duplicate exists", async () => {
  const fixture = createContext();
  const result = await fixture.context.createCustomsBusinessWithDuplicateProtection(payload, true);
  assert.equal(result.duplicate, undefined);
  assert.equal(result.inserted.lastInsertId, 42);
  assert.equal(result.row.id, 42);
  assert.equal(fixture.insertCount, 1);
  assert(fixture.queries.some((query) => query.sql.includes("pg_advisory_xact_lock")));
});

test("six-sheet-only submissions use the six-sheet number as the duplicate identifier", () => {
  const fixture = createContext();
  assert.equal(
    fixture.context.customsBusinessDuplicateIdentifier({ declarationNo: "", sixSheetNo: " SIX-1 " }),
    "SIX-1"
  );
  assert.equal(
    fixture.context.customsBusinessDuplicateIdentifier({ declarationNo: " DEC-1 ", sixSheetNo: "SIX-1" }),
    "DEC-1"
  );
});
