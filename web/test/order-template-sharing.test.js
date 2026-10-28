import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as templatesApi from "../src/api/templates.js";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const realtimeSource = fs.readFileSync(new URL("../../server/realtime.js", import.meta.url), "utf8");
function section(text, start, end) {
  const offset = text.indexOf(start);
  assert.notEqual(offset, -1, start);
  const finish = text.indexOf(end, offset);
  assert.notEqual(finish, -1, end);
  return text.slice(offset, finish);
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const freightTemplate = (id, customerId, name = `模板${id}`) => ({
  id,
  name,
  content: JSON.stringify({ type: "order-freight-template", customerId, fees: [{ name: "中港运费" }] })
});

function createContext(rows = []) {
  const customers = [
    { id: "C1", name: "深圳市旺泰物流有限公司", shortName: "旺泰" },
    { id: "C2", name: "老胡", shortName: "老胡" }
  ];
  const context = vm.createContext({
    templateRows: { value: rows },
    templateRowsLoaded: { value: false },
    loadFeeTemplateMenuOpen: { value: false },
    orderForm: { customerId: "C1", customer: "旺泰" },
    selectedCustomer: { value: customers[1] },
    templatesApi: { listTemplates: async () => rows, getTemplateMutationVersion: () => 0 },
    transportCustomerByReference: (name, id) => customers.find((row) => row.id === id)
      || customers.find((row) => row.name === name || row.shortName === name),
    computed: (get) => ({ get value() { return get(); } }),
    activeModule: { value: "orders" },
    normalizeRoute: (value) => value,
    VEHICLE_DRIVER_MODULES: [],
    VEHICLE_EXPENSE_MODULES: [],
    BOSS_CENTER_MODULES: [],
    loggedIn: { value: true },
    document: { visibilityState: "visible" },
    realtimePendingRefresh: { buckets: new Set() },
    window: { clearTimeout() {}, setTimeout: () => 1 },
    flushRealtimeRefresh() {},
    notify() {},
    console: { warn() {} }
  });
  vm.runInContext([
    "let templateRowsRequestSerial = 0; let realtimeRefreshTimer = null;",
    section(source, "function currentOrderTemplateCustomer()", "const latestOrderTemplateSource"),
    section(source, "function realtimeAffectedModules", "function isDispatchPlanEditorOpen"),
    section(source, "function scheduleRealtimeRefresh", "function closeRealtimeConnection"),
    section(source, "async function reloadTemplateRows", "function fileEndpoint"),
    "globalThis.templateOptions = orderFreightTemplateOptions;"
  ].join("\n"), context);
  return context;
}

test("failed refresh keeps saved templates and the next load retries", async () => {
  const saved = [freightTemplate(1, "C1")];
  const context = createContext(saved);
  context.templateRowsLoaded.value = true;
  context.templatesApi.listTemplates = async () => { throw new Error("网络中断"); };
  await context.reloadTemplateRows({ silent: true });
  assert.equal(context.templateRows.value, saved);
  assert.equal(context.templateRowsLoaded.value, false);
  const shared = [...saved, freightTemplate(2, "C1")];
  context.templatesApi.listTemplates = async () => shared;
  await context.ensureTemplateRowsLoaded();
  assert.equal(context.templateRows.value, shared);
  assert.equal(context.templateRowsLoaded.value, true);
});

test("failed first load does not cache an empty list permanently", async () => {
  const context = createContext();
  context.templatesApi.listTemplates = async () => { throw new Error("网络中断"); };
  await context.ensureTemplateRowsLoaded({ silent: true });
  assert.equal(context.templateRowsLoaded.value, false);
  const saved = [freightTemplate(1, "C1")];
  context.templatesApi.listTemplates = async () => saved;
  await context.ensureTemplateRowsLoaded();
  assert.equal(context.templateRows.value, saved);
});

test("opening the menu refreshes templates created by another user even with a loaded cache", async () => {
  const saved = [freightTemplate(1, "C1")];
  const shared = [...saved, freightTemplate(2, "C1")];
  const context = createContext(saved);
  context.templateRowsLoaded.value = true;
  context.templatesApi.listTemplates = async (query) => {
    assert.equal(query, "?includeContent=1");
    return shared;
  };
  await context.toggleLoadFeeTemplateMenu();
  assert.deepEqual(Array.from(context.templateOptions.value, (item) => item.id).sort(), [1, 2]);
  await context.toggleLoadFeeTemplateMenu();
  context.templatesApi.listTemplates = async () => [...shared, freightTemplate(3, "C1")];
  await context.toggleLoadFeeTemplateMenu();
  assert.equal(context.templateOptions.value.length, 3);
});

test("an older list response cannot erase a newer list", async () => {
  const context = createContext();
  const older = deferred();
  context.templatesApi.listTemplates = () => older.promise;
  const pending = context.reloadTemplateRows();
  const shared = [freightTemplate(2, "C1")];
  context.templatesApi.listTemplates = async () => shared;
  await context.reloadTemplateRows();
  older.resolve([]);
  await pending;
  assert.equal(context.templateRows.value, shared);
  assert.equal(context.templateRowsLoaded.value, true);
});

test("a list requested before a template save cannot erase the saved record", async () => {
  const context = createContext();
  const older = deferred();
  let version = 0;
  context.templatesApi.getTemplateMutationVersion = () => version;
  context.templatesApi.listTemplates = () => older.promise;
  const pending = context.reloadTemplateRows();
  const saved = [freightTemplate(2, "C1")];
  version += 1;
  context.templateRows.value = saved;
  older.resolve([]);
  await pending;
  assert.equal(context.templateRows.value, saved);
  assert.equal(context.templateRowsLoaded.value, false);
});

test("switching accounts reloads shared templates and discards the previous account's pending list", async () => {
  const context = createContext([freightTemplate(1, "C1")]);
  Object.assign(context, {
    closeRealtimeConnection() {},
    deferredAppFontsTimer: null,
    accountTablePreferencesSaveTimer: null,
    dispatchPlanBaseRowsByDate: {},
    dispatchPlanUpdatedAtByDate: {},
    clearStoredSession() {},
    authToken: { value: "first-user" },
    currentSessionAccount: { value: { username: "first-user" } },
    currentUsername: { value: "first-user" },
    closeTransientUi() {},
    expiryReminderRows: { value: [] },
    expiryReminderSummary: { value: {} },
    expiryReminderDefaultSummary: () => ({}),
    expiryReminderPopupMutedSignature: { value: "" }
  });
  vm.runInContext(section(source, "function logout(options", "function closeTransientUi"), context);
  const oldRequest = deferred();
  context.templatesApi.listTemplates = () => oldRequest.promise;
  const pending = context.reloadTemplateRows();
  context.logout({ silent: true });
  assert.equal(context.templateRows.value.length, 0);
  assert.equal(context.templateRowsLoaded.value, false);

  context.loggedIn.value = true;
  const shared = [freightTemplate(1, "C1"), freightTemplate(2, "C1")];
  context.templatesApi.listTemplates = async () => shared;
  await context.ensureTemplateRowsLoaded();
  oldRequest.resolve([]);
  await pending;
  assert.equal(context.templateRows.value, shared);
  assert.equal(context.templateRowsLoaded.value, true);
});

test("customer matching uses the order customer across accounts and supports old names", () => {
  const rows = [
    freightTemplate(1, "C1"),
    freightTemplate(2, "C2"),
    { id: 3, name: "旧模板", content: JSON.stringify({ type: "order-freight-template", customer: "旺泰", fees: [] }) }
  ];
  const context = createContext(rows);
  assert.deepEqual(Array.from(context.templateOptions.value, (item) => item.id).sort(), [1, 3]);
  context.selectedCustomer.value = { id: "C2", name: "老胡" };
  assert.equal(context.templateOptions.value.length, 2);
  context.orderForm = { customerId: "C2", customer: "老胡" };
  assert.deepEqual(Array.from(context.templateOptions.value, (item) => item.id), [2]);
  context.orderForm = { customerId: "", customer: "" };
  assert.equal(context.templateOptions.value.length, 0);
});

test("template changes reach order pages and invalidate hidden-page caches", () => {
  const context = createContext();
  vm.runInContext([
    section(realtimeSource, "function cleanText", "function tokenFromRequest")
      .replace("export function realtimeEventFromAudit", "function realtimeEventFromAudit")
  ].join("\n"), context);
  vm.runInContext('const DATA_MUTATION_ACTIONS = new Set(["create", "update", "delete"]); const CHANGE_TYPE = "database-change";', context);
  const event = context.realtimeEventFromAudit({ action: "create", entityType: "template", entityId: "1" });
  assert.equal(event.affectedModules.includes("orders"), true);
  assert.equal(context.realtimeEventTouchesActiveModule(event), true);
  context.templateRowsLoaded.value = true;
  context.scheduleRealtimeRefresh(event);
  assert.equal(context.templateRowsLoaded.value, false);
  assert.equal(context.realtimePendingRefresh.buckets.has("templates"), true);
  context.document.visibilityState = "hidden";
  context.templateRowsLoaded.value = true;
  context.scheduleRealtimeRefresh(event);
  assert.equal(context.templateRowsLoaded.value, false);
});

test("all successful template mutations advance the list version, failures leave it unchanged", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ id: 1 }) }));
  const initial = templatesApi.getTemplateMutationVersion();
  await templatesApi.createTemplate({ name: "共享模板" });
  await templatesApi.updateTemplate(1, { name: "修改模板" });
  await templatesApi.deleteTemplate(1);
  assert.equal(templatesApi.getTemplateMutationVersion(), initial + 3);
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ message: "保存失败" }) });
  await assert.rejects(templatesApi.createTemplate({}), /保存失败/);
  assert.equal(templatesApi.getTemplateMutationVersion(), initial + 3);
});
