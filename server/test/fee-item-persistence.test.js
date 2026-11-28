import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import vm from "node:vm";
import express from "express";
import pg from "pg";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const dbSource = fs.readFileSync(new URL("../db.js", import.meta.url), "utf8");
function section(text, start, end) {
  const offset = text.indexOf(start);
  assert.notEqual(offset, -1, start);
  const finish = text.indexOf(end, offset);
  assert.notEqual(finish, -1, end);
  return text.slice(offset, finish);
}

// Exercise the real routes and legacy database constraint in an isolated schema.
test("fee items can be recreated after deletion and reject name conflicts", {
  skip: process.env.FEE_ITEM_TEST_DATABASE !== "1"
}, async () => {
  const schema = "codex_fee_test_" + crypto.randomBytes(8).toString("hex");
  const admin = new pg.Pool();
  let pool;
  let server;
  try {
    await admin.query("CREATE SCHEMA " + schema);
    const createTable = section(dbSource, "CREATE TABLE IF NOT EXISTS fee_items (", "CREATE TABLE IF NOT EXISTS freight_rates");
    await admin.query(createTable.replace("fee_items (", schema + ".fee_items ("));
    pool = new pg.Pool({ options: "-c search_path=" + schema });
    const app = express();
    app.use(express.json());
    const context = vm.createContext({
      app, pool, Buffer,
      transactionClient: { getStore: () => null },
      transactionStoreClient: () => null,
      userTextValue: (value) => String(value || "").trim(),
      textValue: (value) => String(value ?? ""),
      writeAudit: async () => {},
      auditChangeSummary: () => "test"
    });
    vm.runInContext([
      section(dbSource, "function isNamedParamObject", "export const db ="),
      "const db = { prepare(sql) { return new Statement(sql); } };",
      section(source, "const EXPORT_FEE_NAME_ALIASES", "function exportTemplateColumnOrder"),
      section(source, "const FEE_ITEM_CATEGORY_OPTIONS", "function mapFreightRate"),
      section(source, 'app.get("/api/fee-items",', 'app.get("/api/freight-rates",')
    ].join("\n"), context);
    app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
    server = http.createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = "http://127.0.0.1:" + server.address().port + "/api/fee-items";
    async function request(path = "", method = "GET", body) {
      const response = await fetch(url + path, {
        method, headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: await response.json() };
    }
    const initial = { category: "正常", name: "口岸停车费", currency: "港币", costSources: ["香港司机"], defaultAmount: 10 };
    const created = await request("", "POST", initial);
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal((await request("/" + id, "DELETE")).status, 200);
    const recreated = await request("", "POST", { ...initial, currency: "人民币", costSources: ["大陆骑师"], defaultAmount: 0, defaultDriverRole: "" });
    assert.equal(recreated.status, 201);
    assert.equal(recreated.body.id, id);
    assert.equal(recreated.body.currency, "人民币");
    assert.deepEqual(recreated.body.costSources, ["大陆骑师"]);
    assert.equal(recreated.body.defaultAmount, 0);
    assert.equal(recreated.body.defaultDriverRole, "");
    assert.equal((await request()).body.find((item) => item.id === id).costSource, "大陆骑师");
    assert.equal((await request("", "POST", initial)).status, 409);
    const other = await request("", "POST", { ...initial, name: "其他费用" });
    assert.equal(other.status, 201);
    assert.equal((await request("/" + other.body.id, "PATCH", { name: initial.name })).status, 409);
    assert.equal((await request("/" + id, "DELETE")).status, 200);
    const deletedConflict = await request("/" + other.body.id, "PATCH", { name: initial.name });
    assert.equal(deletedConflict.status, 409);
    assert.match(deletedConflict.body.message, /曾被删除/);
    const edited = await request("/" + other.body.id, "PATCH", { costSources: ["大陆骑师"], defaultAmount: 42 });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.defaultAmount, 42);
    assert.deepEqual(edited.body.costSources, ["大陆骑师"]);
    const concurrent = await Promise.all([request("", "POST", initial), request("", "POST", initial)]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
    const tax = await request("", "POST", { ...initial, name: "代垫香港政府税金", defaultAmount: 200 });
    assert.equal(tax.status, 201);
    assert.equal(tax.body.name, "香港政府税金");
    assert.equal((await request("", "POST", { ...initial, name: "香港政府税金" })).status, 409);
    assert.equal((await pool.query("SELECT name FROM fee_items WHERE id = $1", [tax.body.id])).rows[0].name, "香港政府税金");

    // Historical databases can still store the former name without a migration.
    await pool.query("UPDATE fee_items SET name = $1 WHERE id = $2", ["代垫香港政府税金", tax.body.id]);
    assert.equal((await request("", "POST", { ...initial, name: "香港政府税金" })).status, 409);
    assert.equal((await request("", "POST", { ...initial, name: "代垫香港政府税金" })).status, 409);
    assert.equal((await request("/" + other.body.id, "PATCH", { name: "香港政府税金" })).status, 409);
    const legacyEdited = await request("/" + tax.body.id, "PATCH", { name: "香港政府税金", defaultAmount: 250 });
    assert.equal(legacyEdited.status, 200);
    assert.equal(legacyEdited.body.name, "香港政府税金");
    assert.equal(legacyEdited.body.defaultAmount, 250);
    assert.equal((await pool.query("SELECT name FROM fee_items WHERE id = $1", [tax.body.id])).rows[0].name, "代垫香港政府税金");
    assert.equal((await request("/" + tax.body.id, "DELETE")).status, 200);
    const legacyRestored = await request("", "POST", { ...initial, name: "香港政府税金", defaultAmount: 300 });
    assert.equal(legacyRestored.status, 201);
    assert.equal(legacyRestored.body.id, tax.body.id);
    assert.equal(legacyRestored.body.name, "香港政府税金");
    assert.equal(legacyRestored.body.defaultAmount, 300);
    assert.equal((await request("/" + other.body.id, "PATCH", { name: "代垫香港政府税金" })).status, 409);

    // Older versions may already have created both aliases. Editing either ID
    // must still work, and a deleted alias must not mask an active counterpart.
    const twin = await pool.query("INSERT INTO fee_items (category, name, currency) VALUES ($1, $2, $3) RETURNING id", ["正常", "香港政府税金", "人民币"]);
    const twinId = twin.rows[0].id;
    for (const itemId of [tax.body.id, twinId]) {
      const editedTwin = await request("/" + itemId, "PATCH", { name: "香港政府税金", defaultAmount: 420 });
      assert.equal(editedTwin.status, 200);
      assert.equal(editedTwin.body.defaultAmount, 420);
    }
    assert.equal((await request("/" + tax.body.id, "DELETE")).status, 200);
    assert.equal((await request("", "POST", { ...initial, name: "香港政府税金" })).status, 409);
    assert.equal((await pool.query("SELECT deleted_at FROM fee_items WHERE id = $1", [tax.body.id])).rows[0].deleted_at != null, true);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (pool) await pool.end();
    await admin.query("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
    await admin.end();
  }
});
