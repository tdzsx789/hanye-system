import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types } from "pg";
import { accountPermissionsForRole, hashPassword, normalizeAccountRole, roleLevelFor } from "./auth.js";

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

const pgHost = process.env.PGHOST || "127.0.0.1";
const pgPort = process.env.PGPORT || "5432";
const pgDatabase = process.env.PGDATABASE || process.env.POSTGRES_DB || "hanye";
const pgUser = process.env.PGUSER || process.env.POSTGRES_USER || "hanye";
const pgPassword = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || "hanye";
const connectionString = process.env.DATABASE_URL || `postgres://${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPassword)}@${pgHost}:${pgPort}/${pgDatabase}`;
const seedDemoDataEnabled = ["1", "true", "yes", "on"].includes(String(process.env.SEED_DEMO_DATA || "").toLowerCase());

function maskConnectionString(value) {
  try {
    const url = new URL(value);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return "postgresql";
  }
}

export const databaseInfo = maskConnectionString(connectionString);

const pool = new Pool({
  connectionString,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000
});

const transactionClient = new AsyncLocalStorage();

function transactionStoreClient(store) {
  if (!store) return null;
  return store.client || store;
}

function runAfterCommitCallbacks(callbacks = []) {
  callbacks.forEach((callback) => {
    Promise.resolve()
      .then(callback)
      .catch((error) => {
        console.error("afterCommit callback failed", error);
      });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNamedParamObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date) && !Buffer.isBuffer(value);
}

function normalizeParamValue(value) {
  return value === undefined ? null : value;
}

function compileSql(sql, args = []) {
  const source = String(sql);
  const namedParams = args.length === 1 && isNamedParamObject(args[0]) ? args[0] : null;
  const values = [];
  let positionalIndex = 0;
  let output = "";
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      output += char;
      if (char === quote) {
        if (quote === "'" && next === "'") {
          output += next;
          index += 1;
        } else {
          quote = "";
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      output += char;
      continue;
    }

    if (char === "?") {
      values.push(normalizeParamValue(args[positionalIndex]));
      positionalIndex += 1;
      output += `$${values.length}`;
      continue;
    }

    if (char === "@" && /[A-Za-z_]/.test(next || "")) {
      let end = index + 2;
      while (/[A-Za-z0-9_]/.test(source[end] || "")) end += 1;
      const name = source.slice(index + 1, end);
      values.push(normalizeParamValue(namedParams ? namedParams[name] : undefined));
      output += `$${values.length}`;
      index = end - 1;
      continue;
    }

    output += char;
  }

  return { text: output, values };
}

const idReturningTables = new Set([
  "audit_logs",
  "order_fees",
  "dispatch_plan_recycle",
  "drivers",
  "fee_items",
  "freight_rates",
  "templates",
  "rule_items",
  "master_data",
  "app_accounts",
  "files",
  "customs_businesses",
  "other_businesses",
  "driver_wage_rules",
  "driver_adjustments",
  "address_book",
  "customer_contacts",
  "driver_route_adjust_rules",
  "statement_downloads",
  "vehicle_expenses",
  "cost_center_rates",
  "vehicle_profit_exchange_rates",
  "company_expenses",
  "reminder_acknowledgements"
]);

function withReturningId(sql) {
  const trimmed = String(sql).trim().replace(/;$/, "");
  if (!/^insert\s+into\s+/i.test(trimmed) || /\breturning\b/i.test(trimmed)) return sql;
  const table = trimmed.match(/^insert\s+into\s+("?[\w]+"?)/i)?.[1]?.replaceAll('"', "");
  return table && idReturningTables.has(table) ? `${trimmed} RETURNING id` : sql;
}

async function query(sql, args = []) {
  const compiled = compileSql(sql, args);
  const client = transactionStoreClient(transactionClient.getStore()) || pool;
  return client.query(compiled.text, compiled.values);
}

class Statement {
  constructor(sql) {
    this.sql = sql;
  }

  async get(...args) {
    const result = await query(this.sql, args);
    return result.rows[0];
  }

  async all(...args) {
    const result = await query(this.sql, args);
    return result.rows;
  }

  async run(...args) {
    const result = await query(withReturningId(this.sql), args);
    const id = result.rows[0]?.id;
    return {
      changes: result.rowCount || 0,
      lastInsertId: id === undefined ? undefined : Number(id)
    };
  }
}

export const db = {
  prepare(sql) {
    return new Statement(sql);
  },

  async exec(sql) {
    await query(sql);
  },

  transaction(callback) {
    return async (...args) => {
      const client = await pool.connect();
      const context = { client, afterCommit: [] };
      try {
        await client.query("BEGIN");
        let result;
        await transactionClient.run(context, async () => {
          result = await callback(...args);
        });
        await client.query("COMMIT");
        runAfterCommitCallbacks(context.afterCommit);
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    };
  }
};

export function afterCommit(callback) {
  if (typeof callback !== "function") return;
  const context = transactionClient.getStore();
  if (context && Array.isArray(context.afterCommit)) {
    context.afterCommit.push(callback);
    return;
  }
  Promise.resolve()
    .then(callback)
    .catch((error) => {
      console.error("afterCommit callback failed", error);
    });
}

export async function withAdvisoryLock(lockId, callback) {
  const client = await pool.connect();
  const context = { client, afterCommit: [] };
  try {
    await client.query("SELECT pg_advisory_lock($1)", [Number(lockId)]);
    let result;
    await transactionClient.run(context, async () => {
      result = await callback();
    });
    runAfterCommitCallbacks(context.afterCommit);
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [Number(lockId)]).catch(() => {});
    client.release();
  }
}

async function waitForDatabase() {
  const attempts = Number(process.env.PG_CONNECT_RETRIES || 45);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      await wait(1000);
    }
  }
}

async function hasColumn(table, column) {
  const row = await db.prepare(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ?
      AND column_name = ?
    LIMIT 1
  `).get(table, column);
  return Boolean(row);
}

async function columnDataType(table, column) {
  const row = await db.prepare(`
    SELECT data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ?
      AND column_name = ?
    LIMIT 1
  `).get(table, column);
  return row?.data_type || "";
}

async function addColumn(table, definition) {
  const column = definition.split(/\s+/)[0];
  if (!(await hasColumn(table, column))) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

async function ensureTextColumn(table, column, defaultValue = "''") {
  if (!(await hasColumn(table, column))) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT NOT NULL DEFAULT ${defaultValue}`);
    return;
  }
  if ((await columnDataType(table, column)) === "text") return;
  await db.exec(`
    ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT;
    ALTER TABLE ${table} ALTER COLUMN ${column} TYPE TEXT USING COALESCE(${column}::text, '');
    ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${defaultValue};
  `);
}

function defaultPartnerShortName(name = "") {
  let text = String(name || "")
    .replace(/\s+/g, "")
    .replace(/[（(]\s*(深圳市?|广州市?|东莞市?|惠州市?|佛山市?|中山市?|珠海市?|江门市?|汕头市?|上海市?|北京市?|天津市?|重庆市?|香港|澳门|香港特别行政区|澳门特别行政区)\s*[）)]/gu, "")
    .replace(/[【】\[\]{}]/g, "")
    .trim();
  if (!text) return "";

  text = text
    .replace(/^(中华人民共和国|中国)/, "")
    .replace(/^(香港特别行政区|澳门特别行政区)/, "")
    .replace(/^(广东省|福建省|浙江省|江苏省|山东省|湖南省|湖北省|江西省|广西壮族自治区|广西省|海南省|四川省|重庆市|上海市|北京市|天津市)/, "")
    .replace(/^(深圳市?|广州市?|东莞市?|惠州市?|佛山市?|中山市?|珠海市?|江门市?|汕头市?|上海市?|北京市?|天津市?|重庆市?|香港|澳门)/u, "");

  text = text
    .replace(/(有限责任公司|股份有限公司|集团有限公司|控股有限公司|实业有限公司|科技有限公司|技术有限公司|贸易有限公司|物流有限公司|供应链管理有限公司|供应链有限公司|国际货运代理有限公司|货运代理有限公司|货物运输有限公司|运输有限公司|报关有限公司|代理有限公司|有限公司|公司)$/u, "")
    .replace(/(有限责任公司|股份有限公司|有限公司|公司)$/u, "");

  return text || String(name || "").trim();
}

async function backfillCustomerShortNames() {
  const rows = await db.prepare(`
    SELECT id, name, short_name
    FROM customers
    WHERE deleted_at IS NULL
      AND (
        COALESCE(short_name, '') = ''
        OR short_name = name
      )
  `).all();

  for (const row of rows) {
    const shortName = defaultPartnerShortName(row.name);
    if (!shortName || shortName === row.short_name) continue;
    await db.prepare("UPDATE customers SET short_name = @shortName WHERE id = @id").run({
      id: row.id,
      shortName
    });
  }
}

function localDateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function localTimestampInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeInputDate(value = "") {
  const text = String(value || "").trim().slice(0, 10);
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return "";
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return localDateInputValue(date) === text ? text : "";
}

function normalizeTimestampText(value = "") {
  const text = String(value || "").trim();
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!matched) return "";
  const date = normalizeInputDate(matched[1]);
  if (!date) return "";
  if (!matched[2]) return `${date} 00:00:00`;
  return `${date} ${matched[2]}:${matched[3]}:${matched[4] || "00"}`;
}

function dispatchRowTimestampFromId(row = {}) {
  const id = String(row?.id || "").trim();
  const matched = id.match(/(?:^|[-_])(\d{13})(?:$|[-_])/);
  if (!matched) return "";
  const timestamp = Number(matched[1]);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  if (year < 2020 || year > 2100) return "";
  return localTimestampInputValue(date);
}

function dispatchRowCreatedTimestamp(row = {}, fallbackDate = "") {
  return normalizeTimestampText(row?.createdAt || row?.created_at)
    || dispatchRowTimestampFromId(row)
    || normalizeTimestampText(fallbackDate)
    || `${localDateInputValue()} 00:00:00`;
}

function dispatchRowOrderNo(row = {}) {
  return String(row?.orderNo || row?.order_no || "").trim();
}

function dispatchRowDispatchNo(row = {}) {
  return String(row?.dispatchNo || row?.dispatch_no || "").trim();
}

function businessDateFromNo(value = "") {
  const matched = String(value || "").trim().match(/^(?:HY|PC)(\d{4})(\d{2})(\d{2})/);
  if (!matched) return "";
  return normalizeInputDate(`${matched[1]}-${matched[2]}-${matched[3]}`);
}

function dispatchRowBusinessDate(row = {}, fallbackDate = "") {
  return normalizeInputDate(row?.date)
    || normalizeInputDate(fallbackDate)
    || businessDateFromNo(dispatchRowDispatchNo(row))
    || businessDateFromNo(dispatchRowOrderNo(row))
    || dispatchRowCreatedTimestamp(row, fallbackDate).slice(0, 10);
}

function parseDispatchRowsJson(rowsJson = "[]") {
  try {
    const rows = JSON.parse(rowsJson || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function parseDispatchRowJson(rowJson = "{}") {
  try {
    const row = JSON.parse(rowJson || "{}");
    return row && typeof row === "object" && !Array.isArray(row) ? row : {};
  } catch {
    return {};
  }
}

function collectDispatchOrderDate(orderDateMap, dispatchDateMap, row = {}, fallbackDate = "", priority = 0) {
  const createdAt = dispatchRowCreatedTimestamp(row, fallbackDate);
  const businessDate = dispatchRowBusinessDate(row, fallbackDate);
  const orderNo = dispatchRowOrderNo(row);
  const dispatchNo = dispatchRowDispatchNo(row);
  const candidate = { date: businessDate, createdAt, priority };
  const assign = (map, key) => {
    if (!key || !businessDate) return;
    const existing = map.get(key);
    if (
      !existing
      || candidate.priority > existing.priority
      || (candidate.priority === existing.priority && candidate.createdAt < existing.createdAt)
    ) {
      map.set(key, candidate);
    }
  };
  assign(orderDateMap, orderNo);
  assign(dispatchDateMap, dispatchNo);
}

async function backfillDispatchRowCreationTimesAndOrderDates() {
  const orderDateMap = new Map();
  const dispatchDateMap = new Map();
  const plans = await db.prepare("SELECT plan_date, rows_json FROM dispatch_plans").all();

  for (const plan of plans) {
    const rows = parseDispatchRowsJson(plan.rows_json);
    let changed = false;
    const nextRows = rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return row;
      const createdAt = dispatchRowCreatedTimestamp(row, plan.plan_date);
      collectDispatchOrderDate(orderDateMap, dispatchDateMap, { ...row, createdAt }, plan.plan_date, 2);
      if (row.createdAt === createdAt) return row;
      changed = true;
      return { ...row, createdAt };
    });
    if (changed) {
      await db.prepare(`
        UPDATE dispatch_plans
        SET rows_json = @rowsJson, updated_at = CURRENT_TIMESTAMP
        WHERE plan_date = @planDate
      `).run({ planDate: plan.plan_date, rowsJson: JSON.stringify(nextRows) });
    }
  }

  const recycleRows = await db.prepare("SELECT id, plan_date, row_json FROM dispatch_plan_recycle").all();
  for (const recycle of recycleRows) {
    const row = parseDispatchRowJson(recycle.row_json);
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const createdAt = dispatchRowCreatedTimestamp(row, recycle.plan_date);
    const nextRow = { ...row, createdAt };
    collectDispatchOrderDate(orderDateMap, dispatchDateMap, nextRow, recycle.plan_date, 1);
    if (row.createdAt !== createdAt) {
      await db.prepare("UPDATE dispatch_plan_recycle SET row_json = @rowJson WHERE id = @id").run({
        id: recycle.id,
        rowJson: JSON.stringify(nextRow)
      });
    }
  }

  const updateOrderDate = await db.prepare(`
    UPDATE orders
    SET order_date = @orderDate
    WHERE no = @no
      AND order_date <> @orderDate
  `);
  for (const [no, item] of orderDateMap.entries()) {
    await updateOrderDate.run({ no, orderDate: item.date });
  }

  const ordersWithoutOrderNoMap = await db.prepare(`
    SELECT no, dispatch_no
    FROM orders
    WHERE COALESCE(dispatch_no, '') <> ''
  `).all();
  for (const order of ordersWithoutOrderNoMap) {
    if (orderDateMap.has(order.no)) continue;
    const item = dispatchDateMap.get(String(order.dispatch_no || "").trim());
    if (!item) continue;
    await updateOrderDate.run({ no: order.no, orderDate: item.date });
  }
}

async function dropColumnIfExists(table, column) {
  if (await hasColumn(table, column)) {
    await db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

async function initializeSchema() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('客户', '供应商')),
      customer_category TEXT NOT NULL DEFAULT '运输客户',
      name TEXT NOT NULL,
      short_name TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      term TEXT NOT NULL DEFAULT '月结30天',
      settlement_currency TEXT NOT NULL DEFAULT '',
      tax_no TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      mobile TEXT NOT NULL DEFAULT '',
      driver_wage_adjust_hkd DOUBLE PRECISION NOT NULL DEFAULT 0,
      default_template_id TEXT NOT NULL DEFAULT '',
      receivable_rmb DOUBLE PRECISION NOT NULL DEFAULT 0,
      receivable_hkd DOUBLE PRECISION NOT NULL DEFAULT 0,
      recent_order TEXT NOT NULL DEFAULT '-',
      invoice_title TEXT NOT NULL DEFAULT '',
      invoice_tax_no TEXT NOT NULL DEFAULT '',
      invoice_bank TEXT NOT NULL DEFAULT '',
      invoice_account TEXT NOT NULL DEFAULT '',
      invoice_address_phone TEXT NOT NULL DEFAULT '',
      customs_home_item_count INTEGER NOT NULL DEFAULT 6,
      customs_page_item_count INTEGER NOT NULL DEFAULT 14,
      customs_import_home_fee DOUBLE PRECISION NOT NULL DEFAULT 100,
      customs_export_home_fee DOUBLE PRECISION NOT NULL DEFAULT 150,
      customs_import_page_fee DOUBLE PRECISION NOT NULL DEFAULT 30,
      customs_export_page_fee DOUBLE PRECISION NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      no TEXT PRIMARY KEY,
      dispatch_no TEXT NOT NULL DEFAULT '',
      customer_id TEXT REFERENCES customers(id) ON UPDATE CASCADE,
      customer TEXT NOT NULL,
      business_type TEXT NOT NULL DEFAULT '运输',
      port TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT '',
      tonnage TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT '',
      quantity TEXT NOT NULL DEFAULT '',
      weight TEXT NOT NULL DEFAULT '',
      vehicle_source TEXT NOT NULL DEFAULT '',
      supplier TEXT NOT NULL DEFAULT '',
      plate TEXT NOT NULL DEFAULT '',
      driver TEXT NOT NULL DEFAULT '',
      hk_driver TEXT NOT NULL DEFAULT '',
      mainland_driver TEXT NOT NULL DEFAULT '',
      transport_mode TEXT NOT NULL DEFAULT '',
      loading TEXT NOT NULL DEFAULT '',
      unloading TEXT NOT NULL DEFAULT '',
      order_date TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
      receivable_hkd DOUBLE PRECISION NOT NULL DEFAULT 0,
      receivable_rmb DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '待确认',
      created_by_account_id BIGINT,
      created_by_username TEXT NOT NULL DEFAULT '',
      created_by_display_name TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      trip_no_enabled INTEGER NOT NULL DEFAULT 0,
      trip_no TEXT NOT NULL DEFAULT '',
      six_sheet_enabled INTEGER NOT NULL DEFAULT 0,
      six_sheet_no TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor TEXT NOT NULL DEFAULT 'admin',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
    );

    CREATE TABLE IF NOT EXISTS order_fees (
      id BIGSERIAL PRIMARY KEY,
      order_no TEXT NOT NULL REFERENCES orders(no) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT '正常' CHECK (category IN ('正常', '代垫', '公司自费')),
      name TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
      unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      unit_price_manual BOOLEAN NOT NULL DEFAULT false,
      currency TEXT NOT NULL DEFAULT '港币',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      amount_manual BOOLEAN NOT NULL DEFAULT false,
      cost DOUBLE PRECISION DEFAULT NULL,
      cost_manual BOOLEAN NOT NULL DEFAULT false,
      remark TEXT NOT NULL DEFAULT '',
      driver_role TEXT NOT NULL DEFAULT '',
      driver_name TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS dispatch_plans (
      plan_date TEXT PRIMARY KEY,
      rows_json TEXT NOT NULL DEFAULT '[]',
      created_by_account_id BIGINT,
      created_by_username TEXT NOT NULL DEFAULT '',
      created_by_display_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
    );

    CREATE TABLE IF NOT EXISTS dispatch_plan_recycle (
      id BIGSERIAL PRIMARY KEY,
      plan_date TEXT NOT NULL,
      dispatch_no TEXT NOT NULL DEFAULT '',
      order_no TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      row_json TEXT NOT NULL DEFAULT '{}',
      deleted_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      restored_at TEXT
    );

    CREATE TABLE IF NOT EXISTS vehicles (
      plate TEXT PRIMARY KEY,
      brand TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      vehicle_type TEXT NOT NULL DEFAULT '',
      purchase_date TEXT NOT NULL DEFAULT '',
      factory_date TEXT NOT NULL DEFAULT '',
      mainland_review_date TEXT NOT NULL DEFAULT '',
      hk_review_date TEXT NOT NULL DEFAULT '',
      mainland_insurance_date TEXT NOT NULL DEFAULT '',
      hk_insurance_date TEXT NOT NULL DEFAULT '',
      insurance_reminder TEXT NOT NULL DEFAULT '提前30天',
      maintenance_reminder TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '正常',
      monthly_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS vehicle_expenses (
      id BIGSERIAL PRIMARY KEY,
      expense_type TEXT NOT NULL CHECK (expense_type IN ('fuel', 'repair', 'annual', 'other')),
      name TEXT NOT NULL DEFAULT '',
      fuel_station TEXT NOT NULL DEFAULT '',
      fuel_liters DOUBLE PRECISION NOT NULL DEFAULT 0,
      odometer_km DOUBLE PRECISION NOT NULL DEFAULT 0,
      plate TEXT NOT NULL REFERENCES vehicles(plate) ON UPDATE CASCADE,
      expense_date TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      expense_year INTEGER,
      currency TEXT NOT NULL DEFAULT '人民币',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL DEFAULT '香港司机',
      name TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      id_no TEXT NOT NULL DEFAULT '',
      license TEXT NOT NULL DEFAULT '',
      birthday TEXT NOT NULL DEFAULT '',
      hire_date TEXT NOT NULL DEFAULT '',
      leave_date TEXT NOT NULL DEFAULT '',
      employment_status TEXT NOT NULL DEFAULT '在职',
      expire_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '正常',
      default_wage DOUBLE PRECISION NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS fee_items (
      id BIGSERIAL PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '正常' CHECK (category IN ('正常', '代垫')),
      name TEXT NOT NULL UNIQUE,
      currency TEXT NOT NULL DEFAULT '港币',
      default_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      default_driver_role TEXT NOT NULL DEFAULT '',
      cost_source TEXT NOT NULL DEFAULT '供应商',
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS freight_rates (
      id BIGSERIAL PRIMARY KEY,
      customer_id TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT '',
      level1 TEXT NOT NULL DEFAULT '',
      level2 TEXT NOT NULL DEFAULT '',
      level3 TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      tonnage TEXT NOT NULL DEFAULT '',
      rmb_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      hkd_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      effective_date TEXT NOT NULL DEFAULT '1970-01-01',
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS templates (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      format TEXT NOT NULL DEFAULT 'Excel',
      description TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS rule_items (
      id BIGSERIAL PRIMARY KEY,
      rule_type TEXT NOT NULL DEFAULT '业务规则',
      name TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS master_data (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      UNIQUE(type, name)
    );

    CREATE TABLE IF NOT EXISTS app_accounts (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '跟单员',
      role_level INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT '启用',
      password_hash TEXT NOT NULL DEFAULT '',
      hire_date TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT '[]',
      table_preferences TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      last_login_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reminder_acknowledgements (
      id BIGSERIAL PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES app_accounts(id) ON DELETE CASCADE,
      reminder_key TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      acknowledged_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      UNIQUE(account_id, reminder_key)
    );

    CREATE TABLE IF NOT EXISTS files (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      content_base64 TEXT NOT NULL DEFAULT '',
      storage_provider TEXT NOT NULL DEFAULT 'oss',
      bucket TEXT NOT NULL DEFAULT '',
      object_key TEXT NOT NULL DEFAULT '',
      etag TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customs_businesses (
      id BIGSERIAL PRIMARY KEY,
      business_date TEXT NOT NULL DEFAULT '',
      declaration_no TEXT NOT NULL DEFAULT '',
      six_sheet_no TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT '',
      item_count DOUBLE PRECISION NOT NULL DEFAULT 0,
      page_count DOUBLE PRECISION NOT NULL DEFAULT 0,
      customs_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      page_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      manifest_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      inspection_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      check_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      verification_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      other_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      custom_fields TEXT NOT NULL DEFAULT '[]',
      total DOUBLE PRECISION NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS other_businesses (
      id BIGSERIAL PRIMARY KEY,
      business_date TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      customer TEXT NOT NULL DEFAULT '',
      cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      income DOUBLE PRECISION NOT NULL DEFAULT 0,
      custom_fields TEXT NOT NULL DEFAULT '[]',
      total_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
      total_income DOUBLE PRECISION NOT NULL DEFAULT 0,
      profit DOUBLE PRECISION NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS driver_wage_rules (
      id BIGSERIAL PRIMARY KEY,
      driver_id BIGINT REFERENCES drivers(id) ON DELETE SET NULL,
      direction TEXT NOT NULL DEFAULT '出口',
      city TEXT NOT NULL DEFAULT '',
      transport_mode TEXT NOT NULL DEFAULT '单司机',
      currency TEXT NOT NULL DEFAULT '港币',
      base_rmb DOUBLE PRECISION NOT NULL DEFAULT 0,
      base_hkd DOUBLE PRECISION NOT NULL DEFAULT 0,
      load_per_board DOUBLE PRECISION NOT NULL DEFAULT 0,
      unload_per_board DOUBLE PRECISION NOT NULL DEFAULT 0,
      cross_sea_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      add_point_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      waiting_per_hour DOUBLE PRECISION NOT NULL DEFAULT 0,
      advance_fee_rates TEXT NOT NULL DEFAULT '{}',
      note TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cost_center_rates (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      entity_name TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT '',
      destination TEXT NOT NULL DEFAULT '',
      tonnage TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT '港币',
      cost_values TEXT NOT NULL DEFAULT '{}',
      note TEXT NOT NULL DEFAULT '',
      effective_date TEXT NOT NULL DEFAULT '1970-01-01',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT,
      UNIQUE(source, entity_id)
    );

    CREATE TABLE IF NOT EXISTS vehicle_profit_exchange_rates (
      id BIGSERIAL PRIMARY KEY,
      period_month TEXT NOT NULL UNIQUE,
      rate DOUBLE PRECISION NOT NULL DEFAULT 0.88,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS company_expenses (
      id BIGSERIAL PRIMARY KEY,
      entry_type TEXT NOT NULL DEFAULT 'expense',
      period_month TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS driver_adjustments (
      id BIGSERIAL PRIMARY KEY,
      driver_id BIGINT REFERENCES drivers(id) ON DELETE CASCADE,
      date TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '预支款',
      currency TEXT NOT NULL DEFAULT '港币',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT '待工资结算',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS address_book (
      id BIGSERIAL PRIMARY KEY,
      area TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS customer_contacts (
      id BIGSERIAL PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE ON UPDATE CASCADE,
      name TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      mobile TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      area TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      fax TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      wechat TEXT NOT NULL DEFAULT '',
      qq TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS driver_route_adjust_rules (
      id BIGSERIAL PRIMARY KEY,
      source_key TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      driver_ids TEXT NOT NULL DEFAULT '[]',
      driver_names TEXT NOT NULL DEFAULT '[]',
      driver_id BIGINT REFERENCES drivers(id) ON DELETE SET NULL,
      driver_name TEXT NOT NULL DEFAULT '',
      transport_mode TEXT NOT NULL DEFAULT '',
      loading TEXT NOT NULL DEFAULT '',
      unloading TEXT NOT NULL DEFAULT '',
      amount_hkd DOUBLE PRECISION NOT NULL DEFAULT 0,
      amount_rmb DOUBLE PRECISION NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS statement_downloads (
      id BIGSERIAL PRIMARY KEY,
      download_key TEXT NOT NULL UNIQUE,
      statement_type TEXT NOT NULL DEFAULT 'customer',
      entity_name TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '已导出',
      payment_status TEXT NOT NULL DEFAULT '未收款',
      payment_date TEXT NOT NULL DEFAULT '',
      downloaded_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS hidden_history_addresses (
      address_key TEXT PRIMARY KEY,
      address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_deleted_order_date ON orders(deleted_at, order_date);
    CREATE INDEX IF NOT EXISTS idx_order_fees_order_no ON order_fees(order_no);
    CREATE INDEX IF NOT EXISTS idx_dispatch_plan_recycle_restored_deleted ON dispatch_plan_recycle(restored_at, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_dispatch_plan_recycle_refs ON dispatch_plan_recycle(order_no, dispatch_no);
    CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_type_date ON vehicle_expenses(expense_type, deleted_at, expense_date);
    CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_plate_date ON vehicle_expenses(plate, deleted_at, expense_date);
    CREATE INDEX IF NOT EXISTS idx_vehicle_expenses_year ON vehicle_expenses(expense_year, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_customs_businesses_date ON customs_businesses(deleted_at, business_date);
    CREATE INDEX IF NOT EXISTS idx_other_businesses_date ON other_businesses(deleted_at, business_date);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_driver_route_adjust_deleted ON driver_route_adjust_rules(deleted_at, id);
    CREATE INDEX IF NOT EXISTS idx_statement_downloads_deleted ON statement_downloads(deleted_at, downloaded_at);
    CREATE INDEX IF NOT EXISTS idx_cost_center_rates_source ON cost_center_rates(source, deleted_at, entity_name);
    CREATE INDEX IF NOT EXISTS idx_vehicle_profit_exchange_rates_month ON vehicle_profit_exchange_rates(period_month);
    CREATE INDEX IF NOT EXISTS idx_company_expenses_period ON company_expenses(deleted_at, period_month);
    CREATE INDEX IF NOT EXISTS idx_reminder_ack_account_key ON reminder_acknowledgements(account_id, reminder_key);
  `);

  const migrations = {
    orders: [
      "dispatch_no TEXT NOT NULL DEFAULT ''",
      "plate TEXT NOT NULL DEFAULT ''",
      "driver TEXT NOT NULL DEFAULT ''",
      "hk_driver TEXT NOT NULL DEFAULT ''",
      "mainland_driver TEXT NOT NULL DEFAULT ''",
      "transport_mode TEXT NOT NULL DEFAULT ''",
      "remark TEXT NOT NULL DEFAULT ''",
      "trip_no_enabled INTEGER NOT NULL DEFAULT 0",
      "trip_no TEXT NOT NULL DEFAULT ''",
      "six_sheet_enabled INTEGER NOT NULL DEFAULT 0",
      "six_sheet_no TEXT NOT NULL DEFAULT ''",
      "created_by_account_id BIGINT",
      "created_by_username TEXT NOT NULL DEFAULT ''",
      "created_by_display_name TEXT NOT NULL DEFAULT ''"
    ],
    dispatch_plans: [
      "created_by_account_id BIGINT",
      "created_by_username TEXT NOT NULL DEFAULT ''",
      "created_by_display_name TEXT NOT NULL DEFAULT ''"
    ],
    driver_wage_rules: [
      "transport_mode TEXT NOT NULL DEFAULT '单司机'",
      "advance_fee_rates TEXT NOT NULL DEFAULT '{}'"
    ],
    cost_center_rates: [
      "origin TEXT NOT NULL DEFAULT ''",
      "destination TEXT NOT NULL DEFAULT ''",
      "tonnage TEXT NOT NULL DEFAULT ''",
      "currency TEXT NOT NULL DEFAULT '港币'",
      "effective_date TEXT NOT NULL DEFAULT '1970-01-01'"
    ],
    statement_downloads: [
      "status TEXT NOT NULL DEFAULT '已导出'",
      "payment_status TEXT NOT NULL DEFAULT '未收款'",
      "payment_date TEXT NOT NULL DEFAULT ''"
    ],
    drivers: [
      "type TEXT NOT NULL DEFAULT '香港司机'",
      "id_no TEXT NOT NULL DEFAULT ''",
      "birthday TEXT NOT NULL DEFAULT ''",
      "hire_date TEXT NOT NULL DEFAULT ''",
      "leave_date TEXT NOT NULL DEFAULT ''",
      "employment_status TEXT NOT NULL DEFAULT '在职'"
    ],
    address_book: ["area TEXT NOT NULL DEFAULT ''"],
    customer_contacts: [
      "area TEXT NOT NULL DEFAULT ''",
      "address TEXT NOT NULL DEFAULT ''"
    ],
    app_accounts: [
      "role_level INTEGER NOT NULL DEFAULT 2",
      "password_hash TEXT NOT NULL DEFAULT ''",
      "hire_date TEXT NOT NULL DEFAULT ''",
      "phone TEXT NOT NULL DEFAULT ''",
      "email TEXT NOT NULL DEFAULT ''",
      "note TEXT NOT NULL DEFAULT ''",
      "table_preferences TEXT NOT NULL DEFAULT '{}'",
      "updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)",
      "last_login_at TEXT"
    ],
    fee_items: [
      "sort_order INTEGER NOT NULL DEFAULT 0",
      "default_driver_role TEXT NOT NULL DEFAULT ''",
      "cost_source TEXT NOT NULL DEFAULT '供应商'"
    ],
    order_fees: [
      "quantity DOUBLE PRECISION NOT NULL DEFAULT 1",
      "unit_price DOUBLE PRECISION NOT NULL DEFAULT 0",
      "unit_price_manual BOOLEAN NOT NULL DEFAULT false",
      "amount_manual BOOLEAN NOT NULL DEFAULT false",
      "cost DOUBLE PRECISION DEFAULT NULL",
      "cost_manual BOOLEAN NOT NULL DEFAULT false",
      "driver_role TEXT NOT NULL DEFAULT ''",
      "driver_name TEXT NOT NULL DEFAULT ''"
    ],
    freight_rates: [
      "customer_id TEXT NOT NULL DEFAULT ''",
      "customer_name TEXT NOT NULL DEFAULT ''",
      "level1 TEXT NOT NULL DEFAULT ''",
      "level2 TEXT NOT NULL DEFAULT ''",
      "level3 TEXT NOT NULL DEFAULT ''",
      "effective_date TEXT NOT NULL DEFAULT '1970-01-01'",
      "updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)"
    ],
    customers: [
      "customer_category TEXT NOT NULL DEFAULT '运输客户'",
      "province TEXT NOT NULL DEFAULT ''",
      "address TEXT NOT NULL DEFAULT ''",
      "settlement_currency TEXT NOT NULL DEFAULT ''",
      "tax_no TEXT NOT NULL DEFAULT ''",
      "contact TEXT NOT NULL DEFAULT ''",
      "mobile TEXT NOT NULL DEFAULT ''",
      "driver_wage_adjust_hkd DOUBLE PRECISION NOT NULL DEFAULT 0",
      "default_template_id TEXT NOT NULL DEFAULT ''",
      "invoice_title TEXT NOT NULL DEFAULT ''",
      "invoice_tax_no TEXT NOT NULL DEFAULT ''",
      "invoice_bank TEXT NOT NULL DEFAULT ''",
      "invoice_account TEXT NOT NULL DEFAULT ''",
      "invoice_address_phone TEXT NOT NULL DEFAULT ''",
      "customs_home_item_count INTEGER NOT NULL DEFAULT 6",
      "customs_page_item_count INTEGER NOT NULL DEFAULT 14",
      "customs_import_home_fee DOUBLE PRECISION NOT NULL DEFAULT 100",
      "customs_export_home_fee DOUBLE PRECISION NOT NULL DEFAULT 150",
      "customs_import_page_fee DOUBLE PRECISION NOT NULL DEFAULT 30",
      "customs_export_page_fee DOUBLE PRECISION NOT NULL DEFAULT 30"
    ],
    files: [
      "storage_provider TEXT NOT NULL DEFAULT 'oss'",
      "bucket TEXT NOT NULL DEFAULT ''",
      "object_key TEXT NOT NULL DEFAULT ''",
      "etag TEXT NOT NULL DEFAULT ''"
    ],
    customs_businesses: [
      "custom_fields TEXT NOT NULL DEFAULT '[]'",
      "verification_fee DOUBLE PRECISION NOT NULL DEFAULT 0",
      "deleted_at TEXT"
    ],
    other_businesses: [
      "custom_fields TEXT NOT NULL DEFAULT '[]'",
      "total_cost DOUBLE PRECISION NOT NULL DEFAULT 0",
      "total_income DOUBLE PRECISION NOT NULL DEFAULT 0",
      "profit DOUBLE PRECISION NOT NULL DEFAULT 0",
      "remark TEXT NOT NULL DEFAULT ''",
      "deleted_at TEXT"
    ],
    vehicle_expenses: [
      "fuel_station TEXT NOT NULL DEFAULT ''",
      "fuel_liters DOUBLE PRECISION NOT NULL DEFAULT 0",
      "odometer_km DOUBLE PRECISION NOT NULL DEFAULT 0",
      "start_date TEXT NOT NULL DEFAULT ''",
      "end_date TEXT NOT NULL DEFAULT ''"
    ],
    company_expenses: [
      "entry_type TEXT NOT NULL DEFAULT 'expense'"
    ]
  };

  for (const [table, definitions] of Object.entries(migrations)) {
    for (const definition of definitions) {
      await addColumn(table, definition);
    }
  }

  await addColumn("audit_logs", "actor TEXT NOT NULL DEFAULT 'admin'");

  await ensureTextColumn("orders", "quantity");
  await ensureTextColumn("customers", "short_name");
  await backfillCustomerShortNames();

  await db.exec(`
    ALTER TABLE order_fees ALTER COLUMN quantity SET DEFAULT 1;
    UPDATE order_fees SET quantity = 1 WHERE quantity IS NULL OR quantity <= 0;
    ALTER TABLE order_fees DROP CONSTRAINT IF EXISTS order_fees_category_check;
    ALTER TABLE order_fees
      ADD CONSTRAINT order_fees_category_check
      CHECK (category IN ('正常', '代垫', '公司自费'));
    ALTER TABLE fee_items DROP CONSTRAINT IF EXISTS fee_items_category_check;
    UPDATE fee_items
    SET cost_source = CASE
      WHEN COALESCE(TRIM(cost_source), '') = '' THEN '公司自费'
      WHEN COALESCE(cost_source, '') LIKE '%公司自费%' THEN cost_source
      ELSE CONCAT(cost_source, ',公司自费')
    END
    WHERE category = '公司自费';
    UPDATE fee_items
    SET category = '正常'
    WHERE category IS NULL OR category NOT IN ('正常', '代垫');
    ALTER TABLE fee_items
      ADD CONSTRAINT fee_items_category_check
      CHECK (category IN ('正常', '代垫'));
    ALTER TABLE files ALTER COLUMN storage_provider SET DEFAULT 'oss';
    CREATE INDEX IF NOT EXISTS idx_files_object_key ON files(storage_provider, object_key);
    CREATE INDEX IF NOT EXISTS idx_freight_rates_customer_scope
      ON freight_rates(customer_id, direction, level1, level2, level3, tonnage)
      WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_route_adjust_source_key
      ON driver_route_adjust_rules(source_key)
      WHERE source_key <> '';
  `);

  await db.prepare(`
    UPDATE customers
    SET settlement_currency = '人民币结算'
    WHERE type = '客户'
      AND COALESCE(settlement_currency, '') = ''
  `).run();

  await db.exec(`
    ALTER TABLE customers ALTER COLUMN customer_category SET DEFAULT '运输客户';
    UPDATE customers
    SET customer_category = CASE
      WHEN type = '客户' AND customer_category = '报关客户' THEN '报关客户'
      WHEN type = '客户' THEN '运输客户'
      ELSE ''
    END
    WHERE customer_category IS NULL
       OR customer_category NOT IN ('运输客户', '报关客户', '')
       OR (type = '客户' AND customer_category = '')
       OR (type = '供应商' AND customer_category <> '');
    ALTER TABLE customers ALTER COLUMN customer_category SET NOT NULL;
    ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_customer_category_check;
    ALTER TABLE customers
      ADD CONSTRAINT customers_customer_category_check
      CHECK (customer_category IN ('运输客户', '报关客户', ''));
  `);

  await dropColumnIfExists("app_accounts", "department");
  await dropColumnIfExists("app_accounts", "position");

  const accountRows = await db.prepare("SELECT id, role FROM app_accounts WHERE deleted_at IS NULL").all();
  for (const row of accountRows) {
    const role = normalizeAccountRole(row.role);
    const permissions = JSON.stringify(accountPermissionsForRole(role));
    await db.prepare(`
      UPDATE app_accounts
      SET role = @role,
          role_level = @roleLevel,
          permissions = @permissions,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
        AND (role <> @role OR role_level <> @roleLevel OR permissions <> @permissions)
    `).run({
      id: row.id,
      role,
      roleLevel: roleLevelFor(role),
      permissions
    });
  }

  await db.prepare(`
    UPDATE app_accounts
    SET username = 'Zhongyuanni',
        updated_at = CURRENT_TIMESTAMP
    WHERE username = 'gendanyuan1'
      AND display_name LIKE '%钟苑妮%'
      AND deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM app_accounts
        WHERE lower(username) = lower('Zhongyuanni')
          AND deleted_at IS NULL
      )
  `).run();

  const adminRole = "管理员";
  const adminPermissions = JSON.stringify(accountPermissionsForRole(adminRole));
  const adminPasswordHash = hashPassword("admin");
  const adminAccount = await db.prepare("SELECT id, display_name, password_hash FROM app_accounts WHERE username = 'admin' ORDER BY id ASC LIMIT 1").get();
  if (adminAccount) {
    await db.prepare(`
      UPDATE app_accounts
      SET display_name = CASE WHEN COALESCE(display_name, '') = '' THEN '系统管理员' ELSE display_name END,
          role = @role,
          role_level = @roleLevel,
          status = '启用',
          password_hash = CASE WHEN COALESCE(password_hash, '') = '' THEN @passwordHash ELSE password_hash END,
          permissions = @permissions,
          updated_at = CURRENT_TIMESTAMP,
          deleted_at = NULL
      WHERE id = @id
        AND (
          COALESCE(display_name, '') = ''
          OR COALESCE(role, '') <> @role
          OR COALESCE(role_level, 0) <> @roleLevel
          OR COALESCE(status, '') <> '启用'
          OR COALESCE(password_hash, '') = ''
          OR COALESCE(permissions, '') <> @permissions
          OR deleted_at IS NOT NULL
        )
    `).run({
      id: adminAccount.id,
      role: adminRole,
      roleLevel: roleLevelFor(adminRole),
      passwordHash: adminPasswordHash,
      permissions: adminPermissions
    });
  } else {
    await db.prepare(`
      INSERT INTO app_accounts (username, display_name, role, role_level, status, password_hash, permissions)
      VALUES ('admin', '系统管理员', @role, @roleLevel, '启用', @passwordHash, @permissions)
    `).run({
      role: adminRole,
      roleLevel: roleLevelFor(adminRole),
      passwordHash: adminPasswordHash,
      permissions: adminPermissions
    });
  }

  await db.prepare(`
    UPDATE drivers
    SET type = '大陆骑师'
    WHERE (type IS NULL OR type = '' OR type = '香港司机')
      AND (note LIKE '%大陆%' OR note LIKE '%国内%' OR note LIKE '%骑师%')
  `).run();

  await db.prepare(`
    UPDATE drivers
    SET employment_status = '在职'
    WHERE employment_status IS NULL OR TRIM(employment_status) = ''
  `).run();

  await db.prepare(`
    UPDATE fee_items
    SET default_driver_role = CASE
      WHEN name LIKE '%香港%' THEN '香港司机'
      WHEN name LIKE '%大陆%' OR name LIKE '%内地%' THEN '大陆骑师'
      ELSE default_driver_role
    END
    WHERE category = '代垫'
      AND (default_driver_role IS NULL OR default_driver_role = '')
  `).run();

  await db.prepare(`
    UPDATE fee_items
    SET cost_source = '供应商'
    WHERE cost_source IS NULL OR TRIM(cost_source) = ''
  `).run();

  await db.prepare(`
    UPDATE cost_center_rates
    SET source = CASE
      WHEN source = '司机' THEN '香港司机'
      WHEN source = '其他平台' THEN '大陆骑师'
      ELSE source
    END
    WHERE source IN ('司机', '其他平台')
  `).run();

  await db.prepare(`
    UPDATE cost_center_rates
    SET tonnage = '3T',
        updated_at = CURRENT_TIMESTAMP
    WHERE source = '供应商'
      AND (tonnage IS NULL OR TRIM(tonnage) = '')
  `).run();

  await db.prepare(`
    UPDATE vehicle_expenses
    SET start_date = COALESCE(NULLIF(start_date, ''), CASE
          WHEN expense_type = 'annual' AND expense_year IS NOT NULL THEN expense_year::text || '-01-01'
          WHEN expense_type = 'annual' AND expense_date ~ '^[0-9]{4}-' THEN LEFT(expense_date, 4) || '-01-01'
          ELSE ''
        END),
        end_date = COALESCE(NULLIF(end_date, ''), CASE
          WHEN expense_type = 'annual' AND expense_year IS NOT NULL THEN expense_year::text || '-12-31'
          WHEN expense_type = 'annual' AND expense_date ~ '^[0-9]{4}-' THEN LEFT(expense_date, 4) || '-12-31'
          ELSE ''
        END)
    WHERE expense_type = 'annual'
      AND (COALESCE(start_date, '') = '' OR COALESCE(end_date, '') = '')
  `).run();

  await db.prepare(`
    UPDATE fee_items
    SET cost_source = regexp_replace(
      regexp_replace(cost_source, '(^|[,，、])其他平台([,，、]|$)', '\\1大陆骑师\\2', 'g'),
      '(^|[,，、])司机([,，、]|$)',
      '\\1香港司机\\2',
      'g'
    )
    WHERE cost_source LIKE '%司机%'
       OR cost_source LIKE '%其他平台%'
  `).run();

  await db.exec(`
    UPDATE order_fees AS order_fee
    SET category = '公司自费'
    FROM fee_items AS fee_item
    WHERE order_fee.name = fee_item.name
      AND COALESCE(fee_item.cost_source, '') LIKE '%公司自费%'
      AND order_fee.category <> '公司自费';

    UPDATE orders AS order_row
    SET receivable_hkd = COALESCE((
          SELECT SUM(
            CASE
              WHEN order_fee.currency IN ('人民币', 'RMB') THEN 0
              ELSE COALESCE(order_fee.amount, 0)
            END
          )
          FROM order_fees AS order_fee
          WHERE order_fee.order_no = order_row.no
        ), 0),
        receivable_rmb = COALESCE((
          SELECT SUM(
            CASE
              WHEN order_fee.currency IN ('人民币', 'RMB') THEN COALESCE(order_fee.amount, 0)
              ELSE 0
            END
          )
          FROM order_fees AS order_fee
          WHERE order_fee.order_no = order_row.no
        ), 0)
    WHERE EXISTS (
      SELECT 1
      FROM order_fees AS order_fee
      WHERE order_fee.order_no = order_row.no
    );
  `);

  const contactRows = await db.prepare(`
    SELECT id, remark
    FROM customer_contacts
    WHERE deleted_at IS NULL
      AND (area = '' OR address = '')
      AND (remark LIKE '%片区：%' OR remark LIKE '%地址：%')
  `).all();
  for (const row of contactRows) {
    const area = String(row.remark || "").match(/片区：([^；]+)/)?.[1]?.trim() || "";
    const address = String(row.remark || "").match(/地址：([^；]+)/)?.[1]?.trim() || "";
    if (!area && !address) continue;
    await db.prepare(`
      UPDATE customer_contacts
      SET area = CASE WHEN area = '' THEN @area ELSE area END,
          address = CASE WHEN address = '' THEN @address ELSE address END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id: row.id, area, address });
  }

  await db.prepare(`
    UPDATE freight_rates
    SET level1 = COALESCE(NULLIF(level1, ''), city)
    WHERE deleted_at IS NULL AND COALESCE(level1, '') = '' AND COALESCE(city, '') <> ''
  `).run();

  await db.prepare(`
    UPDATE customers
    SET province = '广东省'
    WHERE deleted_at IS NULL AND COALESCE(province, '') = ''
  `).run();

  await ensureTonnageMasterData();
  await ensureOrderStatusMasterData();
  await reconcileLegacyPendingReviewOrders();
  await backfillDispatchRowCreationTimesAndOrderDates();

  if (seedDemoDataEnabled) {
    await seedDemoData();
  }
}

const DEMO_CUSTOMERS = [
  {
    id: "KH00021053",
    type: "客户",
    name: "深圳市汉业国际货运代理有限公司",
    province: "广东省",
    city: "深圳市",
    address: "深圳市南山区蛇口太子路18号海景广场12楼",
    term: "月结30天",
    taxNo: "91440300MA5HANYE01",
    contact: "刘小姐",
    mobile: "13800138001",
    driverWageAdjustHKD: 20,
    defaultTemplateId: "",
    receivableRMB: 86500,
    receivableHKD: 126800,
    recentOrder: "2026-08-03",
    createdAt: "2026-06-01",
    invoiceTitle: "深圳市汉业国际货运代理有限公司",
    invoiceTaxNo: "91440300MA5HANYE01",
    invoiceBank: "招商银行深圳南山支行",
    invoiceAccount: "7559000012345678",
    invoiceAddressPhone: "深圳市南山区蛇口太子路18号 0755-26668888"
  },
  {
    id: "KH00021054",
    type: "客户",
    name: "深圳市文永供应链管理有限公司",
    province: "广东省",
    city: "深圳市",
    address: "深圳市龙岗区坂田街道雪岗北路2018号仓储园B栋",
    term: "月结45天",
    taxNo: "91440300MA5WENYONG",
    contact: "周经理",
    mobile: "13900139002",
    driverWageAdjustHKD: 0,
    defaultTemplateId: "",
    receivableRMB: 54200,
    receivableHKD: 18200,
    recentOrder: "2026-08-02",
    createdAt: "2026-06-03",
    invoiceTitle: "深圳市文永供应链管理有限公司",
    invoiceTaxNo: "91440300MA5WENYONG",
    invoiceBank: "中国银行深圳坂田支行",
    invoiceAccount: "7699000098765432",
    invoiceAddressPhone: "深圳市龙岗区坂田街道雪岗北路2018号 0755-28889999"
  },
  {
    id: "KH00021055",
    type: "客户",
    name: "深圳市环联程物流有限公司",
    province: "广东省",
    city: "深圳市",
    address: "深圳市宝安区福永街道怀德南路66号",
    term: "月结30天",
    taxNo: "91440300MA5HUANLC",
    contact: "邓生",
    mobile: "13700137003",
    driverWageAdjustHKD: -10,
    defaultTemplateId: "",
    receivableRMB: 31800,
    receivableHKD: 98600,
    recentOrder: "2026-06-29",
    createdAt: "2026-06-05",
    invoiceTitle: "深圳市环联程物流有限公司",
    invoiceTaxNo: "91440300MA5HUANLC",
    invoiceBank: "平安银行深圳宝安支行",
    invoiceAccount: "110146000123456",
    invoiceAddressPhone: "深圳市宝安区福永街道怀德南路66号 0755-27336666"
  },
  {
    id: "KH00021056",
    type: "客户",
    name: "香港恒达贸易有限公司",
    province: "香港",
    city: "香港",
    address: "香港九龙观塘开源道55号开联工业中心",
    term: "月结15天",
    taxNo: "",
    contact: "陈小姐",
    mobile: "+852 6123 4567",
    driverWageAdjustHKD: 0,
    defaultTemplateId: "",
    receivableRMB: 12800,
    receivableHKD: 43200,
    recentOrder: "2026-08-01",
    createdAt: "2026-06-08",
    invoiceTitle: "香港恒达贸易有限公司",
    invoiceTaxNo: "",
    invoiceBank: "HSBC Hong Kong",
    invoiceAccount: "400-123456-838",
    invoiceAddressPhone: "香港九龙观塘开源道55号 +852 2388 6688"
  },
  {
    id: "GY00021001",
    type: "供应商",
    name: "深圳市飞龙通达物流有限公司",
    province: "广东省",
    city: "深圳市",
    address: "深圳市罗湖区清水河一路跨境物流园A区",
    term: "月结30天",
    taxNo: "91440300MA5FEILONG",
    contact: "曾生",
    mobile: "13600136001",
    driverWageAdjustHKD: 0,
    defaultTemplateId: "",
    receivableRMB: 0,
    receivableHKD: 0,
    recentOrder: "2026-06-30",
    createdAt: "2026-06-01",
    invoiceTitle: "深圳市飞龙通达物流有限公司",
    invoiceTaxNo: "91440300MA5FEILONG",
    invoiceBank: "建设银行深圳罗湖支行",
    invoiceAccount: "44201500000012345678",
    invoiceAddressPhone: "深圳市罗湖区清水河一路 0755-22338888"
  },
  {
    id: "GY00021002",
    type: "供应商",
    name: "香港顺安跨境物流有限公司",
    province: "香港",
    city: "香港",
    address: "香港新界葵涌货柜码头南路8号",
    term: "月结15天",
    taxNo: "",
    contact: "黄生",
    mobile: "+852 6012 8899",
    driverWageAdjustHKD: 0,
    defaultTemplateId: "",
    receivableRMB: 0,
    receivableHKD: 0,
    recentOrder: "2026-08-03",
    createdAt: "2026-06-02",
    invoiceTitle: "香港顺安跨境物流有限公司",
    invoiceTaxNo: "",
    invoiceBank: "Bank of China Hong Kong",
    invoiceAccount: "012-875-12345678",
    invoiceAddressPhone: "香港新界葵涌货柜码头南路8号 +852 2422 8899"
  },
  {
    id: "GY00021003",
    type: "供应商",
    name: "深圳市粤港报关服务有限公司",
    province: "广东省",
    city: "深圳市",
    address: "深圳市福田区福强路口岸服务中心3楼",
    term: "现结",
    taxNo: "91440300MA5YUEGANG",
    contact: "吴小姐",
    mobile: "13500135003",
    driverWageAdjustHKD: 0,
    defaultTemplateId: "",
    receivableRMB: 0,
    receivableHKD: 0,
    recentOrder: "2026-08-02",
    createdAt: "2026-06-06",
    invoiceTitle: "深圳市粤港报关服务有限公司",
    invoiceTaxNo: "91440300MA5YUEGANG",
    invoiceBank: "工商银行深圳福田支行",
    invoiceAccount: "4000022009201234567",
    invoiceAddressPhone: "深圳市福田区福强路口岸服务中心3楼 0755-83886666"
  }
];

const DEMO_CUSTOMER_CONTACTS = [
  { customerId: "KH00021053", name: "刘小姐", gender: "女", title: "物流主管", mobile: "13800138001", phone: "0755-26668888", area: "深圳 / 南山 / 蛇口", address: "蛇口太子路18号海景广场12楼", fax: "0755-26668889", email: "liujie@hanye-logistics.example", wechat: "hanye-liu", qq: "", remark: "默认对账联系人" },
  { customerId: "KH00021054", name: "周经理", gender: "男", title: "供应链经理", mobile: "13900139002", phone: "0755-28889999", area: "深圳 / 龙岗 / 坂田", address: "雪岗北路2018号仓储园B栋", fax: "", email: "zhou@wenyong.example", wechat: "wenyong-zhou", qq: "", remark: "进口业务联系人" },
  { customerId: "KH00021055", name: "邓生", gender: "男", title: "仓库负责人", mobile: "13700137003", phone: "0755-27336666", area: "深圳 / 宝安 / 福永", address: "怀德南路66号", fax: "", email: "deng@huanliancheng.example", wechat: "hlc-deng", qq: "", remark: "装货现场联系人" },
  { customerId: "KH00021056", name: "陈小姐", gender: "女", title: "贸易跟单", mobile: "+852 6123 4567", phone: "+852 2388 6688", area: "香港 / 九龙 / 观塘", address: "开源道55号开联工业中心", fax: "", email: "chan@hangtat.example", wechat: "", qq: "", remark: "香港卸货联系人" }
];

const DEMO_ADDRESS_BOOK = [
  { area: "深圳 / 南山 / 蛇口", contact: "刘小姐", phone: "13800138001", address: "蛇口太子路18号海景广场12楼", note: "客户办公室/文件交接" },
  { area: "深圳 / 龙岗 / 坂田", contact: "周经理", phone: "13900139002", address: "雪岗北路2018号仓储园B栋", note: "文永坂田仓" },
  { area: "深圳 / 宝安 / 福永", contact: "邓生", phone: "13700137003", address: "怀德南路66号福永仓", note: "环联程常用装货点" },
  { area: "香港 / 新界 / 元朗", contact: "何小姐", phone: "+852 6122 7788", address: "元朗工业区宏业东街22号", note: "进口装货点" },
  { area: "香港 / 九龙 / 葵涌", contact: "梁生", phone: "+852 6233 8899", address: "葵涌货柜码头南路8号", note: "码头交货点" },
  { area: "香港 / 沙田 / 火炭", contact: "林生", phone: "+852 6333 2211", address: "火炭坳背湾街45号", note: "出口卸货点" }
];

const DEMO_VEHICLES = [
  { plate: "粤ZFC62港", brand: "五十铃", model: "NPR", type: "3T中港车", purchaseDate: "2023-03-18", factoryDate: "2022-12-01", mainlandReviewDate: "2027-03-18", hkReviewDate: "2027-02-28", mainlandInsuranceDate: "2027-03-10", hkInsuranceDate: "2027-02-20", insuranceReminder: "提前30天", maintenanceReminder: "每10000公里", status: "正常", monthlyCost: 12800, note: "常跑莲塘/深圳湾，带尾板" },
  { plate: "粤ZYR22港", brand: "日野", model: "700", type: "12T中港车", purchaseDate: "2022-09-12", factoryDate: "2022-04-01", mainlandReviewDate: "2026-09-12", hkReviewDate: "2026-08-30", mainlandInsuranceDate: "2026-09-01", hkInsuranceDate: "2026-08-20", insuranceReminder: "提前30天", maintenanceReminder: "每8000公里", status: "正常", monthlyCost: 16500, note: "大吨位线路，适合福永/葵涌" },
  { plate: "粤Z1234港", brand: "东风", model: "天锦", type: "5T外派车", purchaseDate: "2024-01-10", factoryDate: "2023-10-01", mainlandReviewDate: "2027-01-10", hkReviewDate: "2026-12-20", mainlandInsuranceDate: "2026-12-31", hkInsuranceDate: "2026-12-20", insuranceReminder: "提前30天", maintenanceReminder: "供应商负责", status: "正常", monthlyCost: 0, note: "飞龙通达外派车辆样例" },
  { plate: "港AU7421", brand: "Mercedes-Benz", model: "Actros", type: "香港本地车", purchaseDate: "2021-07-08", factoryDate: "2021-01-01", mainlandReviewDate: "", hkReviewDate: "2026-11-15", mainlandInsuranceDate: "", hkInsuranceDate: "2026-11-01", insuranceReminder: "提前45天", maintenanceReminder: "每月保养", status: "正常", monthlyCost: 9800, note: "香港本地提派备用" },
  { plate: "粤B8D936", brand: "江铃", model: "顺达", type: "大陆接驳车", purchaseDate: "2024-05-22", factoryDate: "2024-02-01", mainlandReviewDate: "2027-05-22", hkReviewDate: "", mainlandInsuranceDate: "2027-05-01", hkInsuranceDate: "", insuranceReminder: "提前30天", maintenanceReminder: "每10000公里", status: "正常", monthlyCost: 7200, note: "口岸转国内车样例" }
];

const DEMO_DRIVERS = [
  { type: "香港司机", name: "李永洪", phone: "+852 6111 8899", idNo: "H123456(7)", license: "HK-LIC-0001", birthday: "1982-05-16", hireDate: "2022-04-01", leaveDate: "", expireAt: "2027-04-30", status: "正常", defaultWage: 620, note: "熟悉莲塘/元朗进口线路" },
  { type: "香港司机", name: "廖永贤", phone: "+852 6222 8899", idNo: "K765432(1)", license: "HK-LIC-0002", birthday: "1979-11-03", hireDate: "2021-09-15", leaveDate: "", expireAt: "2027-09-30", status: "正常", defaultWage: 680, note: "12T及口岸转车经验" },
  { type: "香港司机", name: "陈志强", phone: "+852 6333 8899", idNo: "E246810(3)", license: "HK-LIC-0003", birthday: "1988-02-22", hireDate: "2024-01-20", leaveDate: "", expireAt: "2027-01-19", status: "正常", defaultWage: 600, note: "外派车对接司机" },
  { type: "香港司机", name: "黄启明", phone: "+852 6444 8899", idNo: "Y135790(2)", license: "HK-LIC-0004", birthday: "1985-08-09", hireDate: "2023-06-01", leaveDate: "", expireAt: "2026-12-31", status: "正常", defaultWage: 580, note: "香港本地提派" },
  { type: "大陆骑师", name: "张伟强", phone: "13800138005", idNo: "440301198910101234", license: "粤B-A2-0005", birthday: "1989-10-10", hireDate: "2024-03-05", leaveDate: "", expireAt: "2028-03-04", status: "正常", defaultWage: 360, note: "大陆接驳/口岸转国内车" },
  { type: "大陆骑师", name: "王敏", phone: "13600136006", idNo: "440306199208081234", license: "粤B-B2-0006", birthday: "1992-08-08", hireDate: "2025-02-18", leaveDate: "", expireAt: "2028-02-17", status: "正常", defaultWage: 330, note: "深圳市内短驳" }
];

const DEMO_FEE_ITEMS = [
  { category: "正常", name: "基础运费", currency: "港币", defaultAmount: 0, defaultDriverRole: "", sortOrder: 1 },
  { category: "正常", name: "装货费", currency: "港币", defaultAmount: 120, defaultDriverRole: "", sortOrder: 2 },
  { category: "正常", name: "卸货费", currency: "港币", defaultAmount: 120, defaultDriverRole: "", sortOrder: 3 },
  { category: "正常", name: "加点费", currency: "港币", defaultAmount: 180, defaultDriverRole: "", sortOrder: 4 },
  { category: "正常", name: "等候费", currency: "港币", defaultAmount: 80, defaultDriverRole: "", sortOrder: 5 },
  { category: "正常", name: "报关服务费", currency: "人民币", defaultAmount: 350, defaultDriverRole: "", sortOrder: 6 },
  { category: "正常", name: "查验服务费", currency: "人民币", defaultAmount: 500, defaultDriverRole: "", sortOrder: 7 },
  { category: "代垫", name: "过海费", currency: "港币", defaultAmount: 180, defaultDriverRole: "香港司机", sortOrder: 8 },
  { category: "代垫", name: "停车费", currency: "港币", defaultAmount: 60, defaultDriverRole: "跟随订单司机", sortOrder: 9 },
  { category: "代垫", name: "香港司机代垫", currency: "港币", defaultAmount: 120, defaultDriverRole: "香港司机", sortOrder: 10 },
  { category: "代垫", name: "大陆骑师代垫", currency: "人民币", defaultAmount: 80, defaultDriverRole: "大陆骑师", sortOrder: 11 }
];

const DEMO_FREIGHT_RATES = [
  { direction: "出口", level1: "深圳", level2: "南山", level3: "蛇口", city: "蛇口", tonnage: "3T", rmbAmount: 0, hkdAmount: 1680, sortOrder: 1 },
  { direction: "出口", level1: "深圳", level2: "南山", level3: "蛇口", city: "蛇口", tonnage: "5T", rmbAmount: 0, hkdAmount: 2380, sortOrder: 2 },
  { direction: "出口", level1: "深圳", level2: "宝安", level3: "福永", city: "福永", tonnage: "5T", rmbAmount: 0, hkdAmount: 2580, sortOrder: 3 },
  { direction: "出口", level1: "深圳", level2: "宝安", level3: "福永", city: "福永", tonnage: "12T", rmbAmount: 0, hkdAmount: 4200, sortOrder: 4 },
  { direction: "进口", level1: "香港", level2: "新界", level3: "元朗", city: "元朗", tonnage: "3T", rmbAmount: 1850, hkdAmount: 0, sortOrder: 5 },
  { direction: "进口", level1: "香港", level2: "新界", level3: "元朗", city: "元朗", tonnage: "5T", rmbAmount: 2300, hkdAmount: 0, sortOrder: 6 },
  { direction: "进口", level1: "香港", level2: "九龙", level3: "葵涌", city: "葵涌", tonnage: "5T", rmbAmount: 2600, hkdAmount: 0, sortOrder: 7 }
];

const DEMO_ORDERS = [
  {
    no: "HY2606300001",
    dispatchNo: "PC260630001",
    customerId: "KH00021053",
    customer: "深圳市汉业国际货运代理有限公司",
    businessType: "运输",
    port: "深圳湾海关",
    direction: "出口",
    tonnage: "5T",
    currency: "港币",
    quantity: 18,
    weight: "1280kg",
    vehicleSource: "外派车辆",
    supplier: "深圳市飞龙通达物流有限公司",
    plate: "粤Z1234港",
    driver: "陈志强",
    hkDriver: "陈志强",
    mainlandDriver: "",
    transportMode: "单司机",
    loading: "深圳 / 南山 / 蛇口仓",
    unloading: "香港 / 九龙 / 葵涌货柜码头",
    date: "2026-06-30",
    receivableHKD: 2380,
    receivableRMB: 0,
    status: "正常",
    remark: "模板预览样例：外派车辆出口运输",
    tripNoEnabled: 1,
    tripNo: "TRIP-0630-01",
    sixSheetEnabled: 0,
    sixSheetNo: ""
  },
  {
    no: "HY2606300002",
    dispatchNo: "PC260630002",
    customerId: "KH00021054",
    customer: "深圳市文永供应链管理有限公司",
    businessType: "运输+报关",
    port: "莲塘海关",
    direction: "进口",
    tonnage: "3T",
    currency: "人民币",
    quantity: 32,
    weight: "860kg",
    vehicleSource: "本公司车辆",
    supplier: "-",
    plate: "粤ZFC62港",
    driver: "李永洪",
    hkDriver: "李永洪",
    mainlandDriver: "",
    transportMode: "双司机",
    loading: "香港 / 新界 / 元朗工业区",
    unloading: "深圳 / 龙岗 / 坂田仓库",
    date: "2026-06-30",
    receivableHKD: 0,
    receivableRMB: 1850,
    status: "已审核",
    remark: "模板预览样例：进口运输+报关",
    tripNoEnabled: 1,
    tripNo: "TRIP-0630-02",
    sixSheetEnabled: 1,
    sixSheetNo: "LS2026063002"
  },
  {
    no: "HY2606300003",
    dispatchNo: "PC260629001",
    customerId: "KH00021055",
    customer: "深圳市环联程物流有限公司",
    businessType: "运输",
    port: "文锦渡海关",
    direction: "出口",
    tonnage: "12T",
    currency: "港币",
    quantity: 6,
    weight: "4600kg",
    vehicleSource: "本公司车辆",
    supplier: "-",
    plate: "粤ZYR22港",
    driver: "廖永贤",
    hkDriver: "廖永贤",
    mainlandDriver: "张伟强",
    transportMode: "口岸转国内车",
    loading: "深圳 / 宝安 / 福永仓",
    unloading: "香港 / 沙田 / 火炭仓",
    date: "2026-06-29",
    receivableHKD: 4200,
    receivableRMB: 0,
    status: "正常",
    remark: "模板预览样例：口岸转国内车",
    tripNoEnabled: 0,
    tripNo: "",
    sixSheetEnabled: 0,
    sixSheetNo: ""
  },
  {
    no: "HY2608019001",
    dispatchNo: "PC260801901",
    customerId: "KH00021056",
    customer: "香港恒达贸易有限公司",
    businessType: "运输",
    port: "深圳湾海关",
    direction: "出口",
    tonnage: "5T",
    currency: "港币",
    quantity: 20,
    weight: "1500kg",
    vehicleSource: "本公司车辆",
    supplier: "-",
    plate: "港AU7421",
    driver: "黄启明",
    hkDriver: "黄启明",
    mainlandDriver: "",
    transportMode: "单司机",
    loading: "深圳 / 南山 / 蛇口仓",
    unloading: "香港 / 九龙 / 观塘开联工业中心",
    date: "2026-08-01",
    receivableHKD: 2550,
    receivableRMB: 0,
    status: "通关中",
    remark: "当前月样例：香港客户出口",
    tripNoEnabled: 1,
    tripNo: "TRIP-0801-01",
    sixSheetEnabled: 0,
    sixSheetNo: ""
  },
  {
    no: "HY2608029001",
    dispatchNo: "PC260802901",
    customerId: "KH00021054",
    customer: "深圳市文永供应链管理有限公司",
    businessType: "运输+报关",
    port: "莲塘海关",
    direction: "进口",
    tonnage: "5T",
    currency: "人民币",
    quantity: 24,
    weight: "1260kg",
    vehicleSource: "外派车辆",
    supplier: "香港顺安跨境物流有限公司",
    plate: "港AU7421",
    driver: "黄启明",
    hkDriver: "黄启明",
    mainlandDriver: "",
    transportMode: "单司机",
    loading: "香港 / 新界 / 元朗工业区",
    unloading: "深圳 / 龙岗 / 坂田仓库",
    date: "2026-08-02",
    receivableHKD: 0,
    receivableRMB: 2250,
    status: "已审核",
    remark: "当前月样例：供应商外派进口",
    tripNoEnabled: 0,
    tripNo: "",
    sixSheetEnabled: 1,
    sixSheetNo: "LS2026080201"
  },
  {
    no: "HY2608030001",
    dispatchNo: "PC260803001",
    customerId: "KH00021053",
    customer: "深圳市汉业国际货运代理有限公司",
    businessType: "运输+报关",
    port: "大桥海关",
    direction: "出口",
    tonnage: "3T",
    currency: "港币",
    quantity: 12,
    weight: "980kg",
    vehicleSource: "本公司车辆",
    supplier: "-",
    plate: "粤ZFC62港",
    driver: "李永洪",
    hkDriver: "李永洪",
    mainlandDriver: "王敏",
    transportMode: "双司机",
    loading: "深圳 / 龙岗 / 坂田仓库",
    unloading: "香港 / 新界 / 元朗工业区",
    date: "2026-08-03",
    receivableHKD: 2800,
    receivableRMB: 500,
    status: "待确认",
    remark: "当前月样例：同一订单含港币和人民币收费",
    tripNoEnabled: 1,
    tripNo: "TRIP-0803-01",
    sixSheetEnabled: 1,
    sixSheetNo: "LS2026080301"
  }
];

const DEMO_ORDER_FEES = {
  HY2606300001: [
    { category: "正常", name: "基础运费", quantity: 1, unitPrice: 2100, currency: "港币", amount: 2100, remark: "5T 蛇口至葵涌", driverRole: "", driverName: "" },
    { category: "正常", name: "装货费", quantity: 18, unitPrice: 10, currency: "港币", amount: 180, remark: "按板数", driverRole: "", driverName: "" },
    { category: "代垫", name: "过海费", quantity: 1, unitPrice: 100, currency: "港币", amount: 100, remark: "司机代垫", driverRole: "香港司机", driverName: "陈志强" }
  ],
  HY2606300002: [
    { category: "正常", name: "基础运费", quantity: 1, unitPrice: 1500, currency: "人民币", amount: 1500, remark: "3T 元朗至坂田", driverRole: "", driverName: "" },
    { category: "正常", name: "报关服务费", quantity: 1, unitPrice: 350, currency: "人民币", amount: 350, remark: "莲塘进口报关", driverRole: "", driverName: "" }
  ],
  HY2606300003: [
    { category: "正常", name: "基础运费", quantity: 1, unitPrice: 3600, currency: "港币", amount: 3600, remark: "12T 福永至火炭", driverRole: "", driverName: "" },
    { category: "正常", name: "装货费", quantity: 6, unitPrice: 50, currency: "港币", amount: 300, remark: "大板装货", driverRole: "", driverName: "" },
    { category: "正常", name: "卸货费", quantity: 6, unitPrice: 50, currency: "港币", amount: 300, remark: "香港卸货", driverRole: "", driverName: "" }
  ],
  HY2608019001: [
    { category: "正常", name: "基础运费", quantity: 1, unitPrice: 2300, currency: "港币", amount: 2300, remark: "5T 深圳湾出口", driverRole: "", driverName: "" },
    { category: "正常", name: "加点费", quantity: 1, unitPrice: 250, currency: "港币", amount: 250, remark: "观塘加点", driverRole: "", driverName: "" }
  ],
  HY2608029001: [
    { category: "正常", name: "基础运费", quantity: 1, unitPrice: 1800, currency: "人民币", amount: 1800, remark: "5T 元朗至坂田", driverRole: "", driverName: "" },
    { category: "正常", name: "报关服务费", quantity: 1, unitPrice: 350, currency: "人民币", amount: 350, remark: "进口报关", driverRole: "", driverName: "" },
    { category: "正常", name: "等候费", quantity: 1, unitPrice: 100, currency: "人民币", amount: 100, remark: "装货等候", driverRole: "", driverName: "" }
  ],
  HY2608030001: [
    { category: "正常", name: "基础运费", quantity: 1, unitPrice: 2500, currency: "港币", amount: 2500, remark: "3T 大桥出口", driverRole: "", driverName: "" },
    { category: "代垫", name: "香港司机代垫", quantity: 1, unitPrice: 300, currency: "港币", amount: 300, remark: "香港停车/杂费", driverRole: "香港司机", driverName: "李永洪" },
    { category: "正常", name: "查验服务费", quantity: 1, unitPrice: 500, currency: "人民币", amount: 500, remark: "大桥查验", driverRole: "", driverName: "" }
  ]
};

const DEMO_DRIVER_WAGE_RULES = [
  { driverName: "", direction: "出口", city: "深圳", transportMode: "单司机", currency: "港币", baseRMB: 0, baseHKD: 520, loadPerBoard: 10, unloadPerBoard: 10, crossSeaFee: 180, addPointFee: 120, waitingPerHour: 80, advanceFeeRates: { "过海费": 180, "停车费": 60, "香港司机代垫": 120 }, note: "通用单司机出口规则" },
  { driverName: "", direction: "进口", city: "香港", transportMode: "单司机", currency: "港币", baseRMB: 0, baseHKD: 560, loadPerBoard: 10, unloadPerBoard: 10, crossSeaFee: 180, addPointFee: 120, waitingPerHour: 80, advanceFeeRates: { "过海费": 180, "停车费": 60 }, note: "通用单司机进口规则" },
  { driverName: "李永洪", direction: "进口", city: "香港", transportMode: "双司机", currency: "人民币", baseRMB: 420, baseHKD: 260, loadPerBoard: 8, unloadPerBoard: 8, crossSeaFee: 180, addPointFee: 100, waitingPerHour: 70, advanceFeeRates: { "香港司机代垫": 120, "大陆骑师代垫": 80 }, note: "李永洪双司机进口规则" },
  { driverName: "廖永贤", direction: "出口", city: "深圳", transportMode: "口岸转国内车", currency: "港币", baseRMB: 280, baseHKD: 680, loadPerBoard: 12, unloadPerBoard: 12, crossSeaFee: 220, addPointFee: 150, waitingPerHour: 90, advanceFeeRates: { "过海费": 220, "停车费": 80 }, note: "12T 出口/口岸转车" },
  { driverName: "张伟强", direction: "出口", city: "深圳", transportMode: "口岸转国内车", currency: "人民币", baseRMB: 360, baseHKD: 0, loadPerBoard: 6, unloadPerBoard: 6, crossSeaFee: 0, addPointFee: 50, waitingPerHour: 50, advanceFeeRates: { "大陆骑师代垫": 80 }, note: "大陆骑师接驳规则" }
];

const DEMO_DRIVER_ADJUSTMENTS = [
  { driverName: "李永洪", date: "2026-08-01", type: "预支款", currency: "港币", amount: 500, status: "待工资结算", note: "8月预支生活费" },
  { driverName: "廖永贤", date: "2026-07-30", type: "报销", currency: "港币", amount: 180, status: "待工资结算", note: "停车票报销" },
  { driverName: "张伟强", date: "2026-08-02", type: "预支款", currency: "人民币", amount: 300, status: "待工资结算", note: "国内接驳油费预支" }
];

const DEMO_RULE_ITEMS = [
  { ruleType: "业务规则", name: "订单审核规则", content: "订单状态为“已审核”后，不允许普通删除；需要先由管理员撤回或走回收站流程。", enabled: 1 },
  { ruleType: "财务规则", name: "对账导出规则", content: "客户对账优先按订单日期筛选；同一订单的港币、人民币应收分开汇总。", enabled: 1 },
  { ruleType: "车辆司机规则", name: "司机工资规则", content: "司机工资按司机、方向、城市、运输模式匹配；无专属规则时使用通用规则。", enabled: 1 }
];

const STANDARD_TONNAGE_MASTER_DATA = [
  { type: "吨位", name: "3T", value: "3T", sortOrder: 1 },
  { type: "吨位", name: "5T", value: "5T", sortOrder: 2 },
  { type: "吨位", name: "8T", value: "8T", sortOrder: 3 },
  { type: "吨位", name: "10T", value: "10T", sortOrder: 4 },
  { type: "吨位", name: "12T", value: "12T", sortOrder: 5 },
  { type: "吨位", name: "20尺柜", value: "20尺柜", sortOrder: 6 },
  { type: "吨位", name: "40尺柜", value: "40尺柜", sortOrder: 7 },
  { type: "吨位", name: "45尺柜", value: "45尺柜", sortOrder: 8 }
];

const DEMO_MASTER_DATA = [
  { type: "口岸", name: "深圳湾海关", value: "深圳湾海关", sortOrder: 1 },
  { type: "口岸", name: "莲塘海关", value: "莲塘海关", sortOrder: 2 },
  { type: "口岸", name: "文锦渡海关", value: "文锦渡海关", sortOrder: 3 },
  { type: "口岸", name: "大桥海关", value: "大桥海关", sortOrder: 4 },
  ...STANDARD_TONNAGE_MASTER_DATA,
  { type: "账期", name: "现结", value: "现结", sortOrder: 1 },
  { type: "账期", name: "月结15天", value: "月结15天", sortOrder: 2 },
  { type: "账期", name: "月结30天", value: "月结30天", sortOrder: 3 },
  { type: "账期", name: "月结45天", value: "月结45天", sortOrder: 4 },
  { type: "城市", name: "深圳", value: "深圳", sortOrder: 1 },
  { type: "城市", name: "香港", value: "香港", sortOrder: 2 },
  { type: "订单状态", name: "待确认", value: "待确认", sortOrder: 1 },
  { type: "订单状态", name: "预排", value: "预排", sortOrder: 2 },
  { type: "订单状态", name: "正常", value: "正常", sortOrder: 3 },
  { type: "订单状态", name: "通关中", value: "通关中", sortOrder: 4 },
  { type: "订单状态", name: "已签收", value: "已签收", sortOrder: 5 },
  { type: "订单状态", name: "已审核", value: "已审核", sortOrder: 6 },
  { type: "订单状态", name: "缺票据", value: "缺票据", sortOrder: 7 },
  { type: "订单状态", name: "费用待确认", value: "费用待确认", sortOrder: 8 }
];

function demoExportTemplateContent() {
  return JSON.stringify({
    type: "visual-export-template",
    orientation: "landscape",
    header: "汉业物流订单明细\n导出日期：{{date}}",
    headerX: 24,
    headerY: 18,
    headerTextItems: [
      { id: "demo-title", text: "汉业物流订单明细", x: 24, y: 18, width: 360, align: "left", fontFamily: "standard-serif-cn", fontSize: 18, color: "#17233c" },
      { id: "demo-subtitle", text: "导出日期：{{date}}    制表人：{{user}}", x: 24, y: 48, width: 420, align: "left", fontFamily: "standard-sans-cn", fontSize: 11, color: "#475569" }
    ],
    footerTextItems: [
      { id: "demo-footer", text: "第 {{page}} / {{pages}} 页", x: 760, y: 742, width: 180, align: "right", fontFamily: "standard-sans-cn", fontSize: 10, color: "#64748b" }
    ],
    logo: "",
    logoName: "",
    logoWidth: 92,
    logoHeight: 56,
    logoFit: "contain",
    logoX: 18,
    logoY: 12,
    footer: "第 {{page}} / {{pages}} 页",
    headerHeight: 82,
    footerHeight: 52,
    headerFontFamily: "standard-serif-cn",
    headerFontSize: 14,
    headerTextColor: "#17233c",
    tableFontFamily: "standard-serif-cn",
    tableFontSize: 10,
    tableTextColor: "#1f2937",
    tableHeaderTextColor: "#164e8f",
    tableHeaderBgColor: "#eef6ff",
    tableBorderColor: "#dbeafe",
    tableBorderWidth: 1,
    tableHeaderBold: true,
    tableBold: false,
    tableAlign: "left",
    footerFontFamily: "standard-sans-cn",
    footerFontSize: 10,
    footerTextColor: "#64748b",
    columns: [
      { key: "dispatchNo", label: "排车单号", visible: true, width: 86, fontSize: 10 },
      { key: "no", label: "订单号", visible: true, width: 90, fontSize: 10 },
      { key: "customer", label: "客户", visible: true, width: 142, fontSize: 10 },
      { key: "businessType", label: "业务", visible: true, width: 58, fontSize: 10 },
      { key: "port", label: "口岸", visible: true, width: 76, fontSize: 10 },
      { key: "direction", label: "进出口", visible: true, width: 54, fontSize: 10 },
      { key: "tonnage", label: "吨位", visible: true, width: 46, fontSize: 10 },
      { key: "quantity", label: "件数", visible: true, width: 44, fontSize: 10 },
      { key: "loading", label: "装货地", visible: true, width: 150, fontSize: 10 },
      { key: "unloading", label: "卸货地", visible: true, width: 150, fontSize: 10 },
      { key: "date", label: "日期", visible: true, width: 72, fontSize: 10 },
      { key: "__hkdTotal", label: "港币合计", visible: true, width: 74, fontSize: 10, align: "right" },
      { key: "__rmbTotal", label: "人民币合计", visible: true, width: 78, fontSize: 10, align: "right" },
      { key: "status", label: "状态", visible: true, width: 58, fontSize: 10 }
    ]
  });
}

function demoDispatchPlanRows(date) {
  const rows = DEMO_ORDERS
    .filter((order) => order.date === date)
    .map((order, index) => ({
      id: `demo-${date}-${index + 1}`,
      createdAt: `${date} ${index === 0 ? "08:30:00" : index === 1 ? "12:30:00" : "15:30:00"}`,
      dispatchNo: order.dispatchNo,
      orderNo: order.no,
      customer: order.customer,
      plate: order.plate,
      port: order.port,
      direction: order.direction,
      tonnage: order.tonnage,
      quantity: order.quantity,
      weight: order.weight,
      loading: order.loading,
      unloading: order.unloading,
      loadTime: `${date} ${index === 0 ? "09:30" : index === 1 ? "13:30" : "16:00"}`,
      vehicleSource: order.vehicleSource,
      supplier: order.supplier,
      transportMode: order.transportMode,
      driver: order.driver,
      hkDriver: order.hkDriver,
      mainlandDriver: order.mainlandDriver,
      status: order.status === "已审核" ? "已派车" : "待派车",
      note: order.remark
    }));
  return rows;
}

async function seedCustomer(item) {
  await db.prepare(`
    INSERT INTO customers
      (id, type, name, short_name, province, city, address, term, tax_no, contact, mobile, driver_wage_adjust_hkd,
       default_template_id, receivable_rmb, receivable_hkd, recent_order, invoice_title, invoice_tax_no,
       invoice_bank, invoice_account, invoice_address_phone, created_at)
    SELECT
      @id, @type, @name, COALESCE(@shortName, ''), @province, @city, @address, @term, @taxNo, @contact, @mobile, @driverWageAdjustHKD,
      @defaultTemplateId, @receivableRMB, @receivableHKD, @recentOrder, @invoiceTitle, @invoiceTaxNo,
      @invoiceBank, @invoiceAccount, @invoiceAddressPhone, @createdAt
    WHERE NOT EXISTS (
      SELECT 1 FROM customers
      WHERE id = @id OR (deleted_at IS NULL AND type = @type AND name = @name)
    )
    ON CONFLICT (id) DO NOTHING
  `).run(item);
}

async function seedCustomerContact(item) {
  await db.prepare(`
    INSERT INTO customer_contacts
      (customer_id, name, gender, title, mobile, phone, area, address, fax, email, wechat, qq, remark)
    SELECT
      @customerId, @name, @gender, @title, @mobile, @phone, @area, @address, @fax, @email, @wechat, @qq, @remark
    WHERE EXISTS (
      SELECT 1 FROM customers WHERE id = @customerId AND deleted_at IS NULL
    )
      AND NOT EXISTS (
        SELECT 1 FROM customer_contacts
        WHERE deleted_at IS NULL AND customer_id = @customerId AND name = @name AND mobile = @mobile
      )
  `).run(item);
}

async function seedAddressBook(item) {
  await db.prepare(`
    INSERT INTO address_book (area, contact, phone, address, note)
    SELECT @area, @contact, @phone, @address, @note
    WHERE NOT EXISTS (
      SELECT 1 FROM address_book
      WHERE deleted_at IS NULL AND address = @address AND phone = @phone
    )
  `).run(item);
}

async function seedVehicle(item) {
  await db.prepare(`
    INSERT INTO vehicles
      (plate, brand, model, vehicle_type, purchase_date, factory_date, mainland_review_date,
       hk_review_date, mainland_insurance_date, hk_insurance_date, insurance_reminder,
       maintenance_reminder, status, monthly_cost, note)
    VALUES
      (@plate, @brand, @model, @type, @purchaseDate, @factoryDate, @mainlandReviewDate,
       @hkReviewDate, @mainlandInsuranceDate, @hkInsuranceDate, @insuranceReminder,
       @maintenanceReminder, @status, @monthlyCost, @note)
    ON CONFLICT (plate) DO NOTHING
  `).run(item);
}

async function seedDriver(item) {
  await db.prepare(`
    INSERT INTO drivers
      (type, name, phone, id_no, license, birthday, hire_date, leave_date, employment_status, expire_at, status, default_wage, note)
    VALUES
      (@type, @name, @phone, @idNo, @license, @birthday, @hireDate, @leaveDate, @employmentStatus, @expireAt, @status, @defaultWage, @note)
    ON CONFLICT (name) DO NOTHING
  `).run({ ...item, employmentStatus: item.employmentStatus || "在职" });
}

async function seedFeeItem(item) {
  await db.prepare(`
    INSERT INTO fee_items (category, name, currency, default_amount, default_driver_role, cost_source, sort_order)
    VALUES (@category, @name, @currency, @defaultAmount, @defaultDriverRole, @costSource, @sortOrder)
    ON CONFLICT (name) DO NOTHING
  `).run({ ...item, costSource: item.costSource || "供应商" });
}

async function seedFreightRate(item) {
  await db.prepare(`
    INSERT INTO freight_rates (customer_id, customer_name, direction, level1, level2, level3, city, tonnage, rmb_amount, hkd_amount, sort_order)
    SELECT '', '', @direction, @level1, @level2, @level3, @city, @tonnage, @rmbAmount, @hkdAmount, @sortOrder
    WHERE NOT EXISTS (
      SELECT 1 FROM freight_rates
      WHERE deleted_at IS NULL
        AND customer_id = ''
        AND direction = @direction
        AND level1 = @level1
        AND level2 = @level2
        AND level3 = @level3
        AND tonnage = @tonnage
    )
  `).run(item);
}

async function seedOrder(item) {
  const customer = await db.prepare(`
    SELECT id, name
    FROM customers
    WHERE deleted_at IS NULL
      AND (id = ? OR (type = '客户' AND name = ?))
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(item.customerId, item.customer, item.customerId);
  if (!customer) return;

  await db.prepare(`
    INSERT INTO orders
      (no, dispatch_no, customer_id, customer, business_type, port, direction, tonnage, currency, quantity,
       weight, vehicle_source, supplier, plate, driver, hk_driver, mainland_driver, transport_mode, loading, unloading,
       order_date, receivable_hkd, receivable_rmb, status, remark, trip_no_enabled, trip_no, six_sheet_enabled, six_sheet_no)
    VALUES
      (@no, @dispatchNo, @customerId, @customer, @businessType, @port, @direction, @tonnage, @currency, @quantity,
       @weight, @vehicleSource, @supplier, @plate, @driver, @hkDriver, @mainlandDriver, @transportMode, @loading, @unloading,
       @date, @receivableHKD, @receivableRMB, @status, @remark, @tripNoEnabled, @tripNo, @sixSheetEnabled, @sixSheetNo)
    ON CONFLICT (no) DO NOTHING
  `).run({ ...item, customerId: customer.id, customer: customer.name });
}

async function seedOrderFees(orderNo, fees, sourceOrder = null) {
  const order = await db.prepare("SELECT no, customer_id, customer FROM orders WHERE no = ? AND deleted_at IS NULL").get(orderNo);
  if (!order) return;
  if (sourceOrder && order.customer_id !== sourceOrder.customerId && order.customer !== sourceOrder.customer) return;
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM order_fees WHERE order_no = ?").get(orderNo);
  if (Number(existing?.count || 0) > 0) return;

  const insert = db.prepare(`
    INSERT INTO order_fees (order_no, category, name, quantity, unit_price, unit_price_manual, currency, amount, amount_manual, cost, cost_manual, remark, driver_role, driver_name)
    VALUES (@orderNo, @category, @name, @quantity, @unitPrice, @unitPriceManual, @currency, @amount, @amountManual, @cost, @costManual, @remark, @driverRole, @driverName)
  `);
  for (const fee of fees) {
    await insert.run({
      orderNo,
      ...fee,
      unitPriceManual: Boolean(fee.unitPriceManual || fee.unit_price_manual),
      amountManual: Boolean(fee.amountManual || fee.amount_manual),
      cost: fee.cost ?? null,
      costManual: Boolean(fee.costManual || fee.cost_manual)
    });
  }
}

async function driverIdByName(name) {
  if (!name) return null;
  const row = await db.prepare("SELECT id FROM drivers WHERE deleted_at IS NULL AND name = ? LIMIT 1").get(name);
  return row?.id || null;
}

async function seedDriverWageRule(item) {
  const driverId = await driverIdByName(item.driverName);
  if (item.driverName && !driverId) return;
  const params = {
    ...item,
    driverId,
    advanceFeeRates: JSON.stringify(item.advanceFeeRates || {})
  };
  await db.prepare(`
    INSERT INTO driver_wage_rules
      (driver_id, direction, city, transport_mode, currency, base_rmb, base_hkd, load_per_board, unload_per_board,
       cross_sea_fee, add_point_fee, waiting_per_hour, advance_fee_rates, note)
    SELECT
      @driverId, @direction, @city, @transportMode, @currency, @baseRMB, @baseHKD, @loadPerBoard, @unloadPerBoard,
      @crossSeaFee, @addPointFee, @waitingPerHour, @advanceFeeRates, @note
    WHERE NOT EXISTS (
      SELECT 1 FROM driver_wage_rules
      WHERE deleted_at IS NULL
        AND COALESCE(driver_id, 0) = COALESCE(@driverId, 0)
        AND direction = @direction
        AND city = @city
        AND transport_mode = @transportMode
    )
  `).run(params);
}

async function seedDriverAdjustment(item) {
  const driverId = await driverIdByName(item.driverName);
  if (!driverId) return;
  await db.prepare(`
    INSERT INTO driver_adjustments (driver_id, date, type, currency, amount, status, note)
    SELECT @driverId, @date, @type, @currency, @amount, @status, @note
    WHERE NOT EXISTS (
      SELECT 1 FROM driver_adjustments
      WHERE deleted_at IS NULL
        AND driver_id = @driverId
        AND date = @date
        AND type = @type
        AND currency = @currency
        AND amount = @amount
        AND note = @note
    )
  `).run({ ...item, driverId });
}

async function seedTemplate() {
  await db.prepare(`
    INSERT INTO templates (name, format, description, content, updated_at)
    VALUES
      ('标准订单导出模板', '通用', '演示数据：订单导出、客户对账、司机对账可复用的基础模板', @content, CURRENT_TIMESTAMP)
    ON CONFLICT (name) DO NOTHING
  `).run({ content: demoExportTemplateContent() });
}

async function seedRuleItem(item) {
  await db.prepare(`
    INSERT INTO rule_items (rule_type, name, content, enabled)
    SELECT @ruleType, @name, @content, @enabled
    WHERE NOT EXISTS (
      SELECT 1 FROM rule_items
      WHERE deleted_at IS NULL AND rule_type = @ruleType AND name = @name
    )
  `).run(item);
}

async function seedMasterData(item) {
  await db.prepare(`
    INSERT INTO master_data (type, name, value, sort_order)
    VALUES (@type, @name, @value, @sortOrder)
    ON CONFLICT (type, name) DO NOTHING
  `).run(item);
}

async function ensureOrderStatusMasterData() {
  const statuses = [
    { type: "订单状态", name: "待确认", value: "待确认", sortOrder: 1 },
    { type: "订单状态", name: "预排", value: "预排", sortOrder: 2 },
    { type: "订单状态", name: "正常", value: "正常", sortOrder: 3 },
    { type: "订单状态", name: "通关中", value: "通关中", sortOrder: 4 },
    { type: "订单状态", name: "已签收", value: "已签收", sortOrder: 5 },
    { type: "订单状态", name: "已审核", value: "已审核", sortOrder: 6 },
    { type: "订单状态", name: "缺票据", value: "缺票据", sortOrder: 7 },
    { type: "订单状态", name: "费用待确认", value: "费用待确认", sortOrder: 8 }
  ];
  await db.prepare(`
    UPDATE master_data
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE type = '订单状态' AND name = '待审核' AND deleted_at IS NULL
  `).run();
  for (const item of statuses) {
    await seedMasterData(item);
    await db.prepare(`
      UPDATE master_data
      SET value = @value, sort_order = @sortOrder, deleted_at = NULL
      WHERE type = @type AND name = @name
    `).run(item);
  }
}

async function ensureTonnageMasterData() {
  for (const item of STANDARD_TONNAGE_MASTER_DATA) {
    await seedMasterData(item);
    await db.prepare(`
      UPDATE master_data
      SET value = @value, sort_order = @sortOrder, deleted_at = NULL
      WHERE type = @type AND name = @name
    `).run(item);
  }
}

async function reconcileLegacyPendingReviewOrders() {
  await db.exec("ALTER TABLE orders ALTER COLUMN status SET DEFAULT '待确认'");
  await db.prepare(`
    WITH dispatch_rows AS (
      SELECT
        row->>'orderNo' AS order_no,
        row->>'dispatchNo' AS dispatch_no,
        COALESCE(NULLIF(row->>'status', ''), '预排') AS dispatch_status
      FROM dispatch_plans
      CROSS JOIN LATERAL jsonb_array_elements(rows_json::jsonb) AS row
    ),
    mapped AS (
      SELECT
        o.no,
        CASE
          WHEN BOOL_OR(dispatch_rows.dispatch_status IN ('已签收', '完成结算')) THEN '已签收'
          WHEN BOOL_OR(dispatch_rows.dispatch_status = '通关中') THEN '通关中'
          WHEN BOOL_OR(dispatch_rows.dispatch_status = '异常滞留') THEN '费用待确认'
          WHEN BOOL_OR(dispatch_rows.dispatch_status IN ('预排', '待预排', '已预排', '已派车', '待派车')) THEN '预排'
          ELSE '正常'
        END AS next_status
      FROM orders o
      JOIN dispatch_rows
        ON dispatch_rows.order_no = o.no
        OR (o.dispatch_no <> '' AND dispatch_rows.dispatch_no = o.dispatch_no)
      WHERE o.deleted_at IS NULL AND o.status = '待审核'
      GROUP BY o.no
    )
    UPDATE orders
    SET status = mapped.next_status
    FROM mapped
    WHERE orders.no = mapped.no
      AND orders.deleted_at IS NULL
      AND orders.status = '待审核'
  `).run();
  await db.prepare(`
    UPDATE orders
    SET status = '已签收'
    WHERE deleted_at IS NULL AND status = '待审核'
  `).run();
}

async function seedDispatchPlan(date) {
  const rows = demoDispatchPlanRows(date);
  if (rows.length === 0) return;
  await db.prepare(`
    INSERT INTO dispatch_plans (plan_date, rows_json, updated_at)
    VALUES (@date, @rowsJson, CURRENT_TIMESTAMP)
    ON CONFLICT (plan_date) DO NOTHING
  `).run({ date, rowsJson: JSON.stringify(rows) });
}

async function seedHiddenHistoryAddress(address) {
  const key = String(address || "").replace(/\s+/g, "").toLowerCase();
  if (!key) return;
  await db.prepare(`
    INSERT INTO hidden_history_addresses (address_key, address)
    VALUES (@key, @address)
    ON CONFLICT (address_key) DO NOTHING
  `).run({ key, address });
}

async function seedDemoData() {
  for (const item of DEMO_CUSTOMERS) await seedCustomer(item);
  for (const item of DEMO_CUSTOMER_CONTACTS) await seedCustomerContact(item);
  for (const item of DEMO_ADDRESS_BOOK) await seedAddressBook(item);
  for (const item of DEMO_VEHICLES) await seedVehicle(item);
  for (const item of DEMO_DRIVERS) await seedDriver(item);
  for (const item of DEMO_FEE_ITEMS) await seedFeeItem(item);
  for (const item of DEMO_FREIGHT_RATES) await seedFreightRate(item);
  for (const item of DEMO_ORDERS) await seedOrder(item);
  for (const [orderNo, fees] of Object.entries(DEMO_ORDER_FEES)) {
    await seedOrderFees(orderNo, fees, DEMO_ORDERS.find((item) => item.no === orderNo));
  }
  for (const item of DEMO_DRIVER_WAGE_RULES) await seedDriverWageRule(item);
  for (const item of DEMO_DRIVER_ADJUSTMENTS) await seedDriverAdjustment(item);
  for (const item of DEMO_RULE_ITEMS) await seedRuleItem(item);
  for (const item of DEMO_MASTER_DATA) await seedMasterData(item);
  await seedTemplate();
  await seedDispatchPlan("2026-06-30");
  await seedDispatchPlan("2026-08-03");
  await seedHiddenHistoryAddress("历史地址样例：深圳 / 南山 / 科技园临时仓");
}

export async function writeAudit(action, entityType, entityId, detail = "", actor = "admin") {
  await db.prepare(`
    INSERT INTO audit_logs (actor, action, entity_type, entity_id, detail)
    VALUES (?, ?, ?, ?, ?)
  `).run(actor || "admin", action, entityType, entityId, detail);
}

await waitForDatabase();
const initClient = await pool.connect();
try {
  await initClient.query("SELECT pg_advisory_lock(524458)");
  await transactionClient.run(initClient, async () => {
    await initializeSchema();
  });
} finally {
  await initClient.query("SELECT pg_advisory_unlock(524458)");
  initClient.release();
}
