import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import vm from "node:vm";
import express from "express";
import pg from "pg";
import { canAccessModule } from "../auth.js";

const source = fs.readFileSync(new URL("../index.js", import.meta.url), "utf8");
const dbSource = fs.readFileSync(new URL("../db.js", import.meta.url), "utf8");
function section(text, start, end) {
  const offset = text.indexOf(start);
  assert.notEqual(offset, -1, start);
  const finish = text.indexOf(end, offset);
  assert.notEqual(finish, -1, end);
  return text.slice(offset, finish);
}

// Exercise the real template routes and SQL adapter against a private schema.
// Run inside the API container with ORDER_TEMPLATE_TEST_DATABASE=1; public data
// and public sequences are never changed.
test("saved order templates survive API restart and are readable by another order user", {
  skip: process.env.ORDER_TEMPLATE_TEST_DATABASE !== "1"
}, async () => {
  const schema = `codex_template_test_${crypto.randomBytes(8).toString("hex")}`;
  const admin = new pg.Pool();
  const services = new Set();
  const users = {
    first: { id: 1, username: "template-user-a", role: "跟单员" },
    second: { id: 2, username: "template-user-b", role: "跟单员" }
  };

  async function startService() {
    const pool = new pg.Pool({ options: `-c search_path=${schema}` });
    const app = express();
    const context = vm.createContext({
      app, pool, Buffer,
      transactionClient: { getStore: () => null },
      transactionStoreClient: () => null,
      canAccessModule,
      writeAudit: async () => {},
      auditChangeSummary: () => "test template change",
      auditPreviewValue: (value) => value
    });
    vm.runInContext([
      section(dbSource, "function isNamedParamObject", "export const db ="),
      "const db = { prepare(sql) { return new Statement(sql); } };",
      section(source, "function templateContentType", "function mapRule"),
      section(source, "function requiredModuleForRequest", 'app.use("/api", authenticateApiRequest')
    ].join("\n"), context);
    app.use(express.json());
    app.use("/api", (req, res, next) => {
      req.account = users[req.get("X-Test-User")];
      if (!req.account) return res.sendStatus(401);
      next();
    }, context.authorizeApiRequest);
    vm.runInContext(section(source, 'app.get("/api/templates",', 'app.get("/api/rules",'), context);
    app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }));
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const service = {
      url: `http://127.0.0.1:${server.address().port}/api`,
      async close() {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await pool.end();
        services.delete(service);
      }
    };
    services.add(service);
    return service;
  }

  async function request(service, user, path, method = "GET", body) {
    const response = await fetch(`${service.url}${path}`, {
      method,
      headers: { "X-Test-User": user, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const createTable = section(dbSource, "CREATE TABLE IF NOT EXISTS templates (", "CREATE TABLE IF NOT EXISTS rule_items");
    await admin.query(createTable.replace("templates (", `${schema}.templates (`));
    const first = await startService();
    const second = await startService();
    const content = {
      type: "order-freight-template", customerId: "CUSTOMER-A", customer: "测试客户",
      fees: [{ name: "中港运费", amount: 123.45, currency: "人民币" }]
    };
    const payload = { name: "测试客户/跨用户持久化模板", content: JSON.stringify(content) };
    const created = await request(first, "first", "/templates", "POST", payload);
    assert.equal(created.status, 201);
    const id = created.body.id;

    async function assertReadable(service, user, amount) {
      const listed = await request(service, user, "/templates?includeContent=1");
      assert.equal(listed.status, 200);
      const row = listed.body.find((item) => item.id === id);
      assert(row, "saved template must remain in the shared list");
      assert.equal(row.contentLoaded, true);
      assert.equal(JSON.parse(row.content).customerId, "CUSTOMER-A");
      assert.equal(JSON.parse(row.content).fees[0].amount, amount);
      const detail = await request(service, user, `/templates/${id}`);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.content, row.content);
    }

    await assertReadable(first, "first", 123.45);
    await assertReadable(second, "second", 123.45);
    const duplicate = await request(second, "second", "/templates", "POST", payload);
    assert.equal(duplicate.status, 409);
    await assertReadable(second, "second", 123.45);

    const updatedContent = { ...content, fees: [{ ...content.fees[0], amount: 456.78 }] };
    const updated = await request(first, "first", `/templates/${id}`, "PATCH", { content: JSON.stringify(updatedContent) });
    assert.equal(updated.status, 200);
    await assertReadable(second, "second", 456.78);

    const simultaneousPayload = { ...payload, name: "测试客户/同时保存模板" };
    const simultaneous = await Promise.all([
      request(first, "first", "/templates", "POST", simultaneousPayload),
      request(second, "second", "/templates", "POST", simultaneousPayload)
    ]);
    assert.deepEqual(simultaneous.map((result) => result.status).sort(), [201, 409]);
    const simultaneousId = simultaneous.find((result) => result.status === 201).body.id;
    const shared = await request(second, "second", `/templates/${simultaneousId}`);
    assert.equal(shared.status, 200);
    assert.equal(shared.body.content, payload.content);

    await first.close();
    await second.close();
    const restarted = await startService();
    await assertReadable(restarted, "first", 456.78);
    await assertReadable(restarted, "second", 456.78);
    const simultaneousAfterRestart = await request(restarted, "second", `/templates/${simultaneousId}`);
    assert.equal(simultaneousAfterRestart.status, 200);
    assert.equal(simultaneousAfterRestart.body.content, payload.content);
    const persisted = await admin.query(`SELECT count(*)::integer AS count FROM ${schema}.templates`);
    assert.equal(persisted.rows[0].count, 2);
  } finally {
    await Promise.all([...services].map((service) => service.close()));
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
