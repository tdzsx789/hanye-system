import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types } from "pg";
import { accountPermissionsForRole, hashPassword, normalizeAccountRole, roleLevelFor } from "./auth.js";

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

const pgHost = process.env.PGHOST || "127.0.0.1";
const pgPort = process.env.PGPORT || "5432";
const pgDatabase = process.env.PGDATABASE || "hanye";
const pgUser = process.env.PGUSER || "hanye";
const pgPassword = process.env.PGPASSWORD || "hanye";
const connectionString = process.env.DATABASE_URL || `postgres://${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPassword)}@${pgHost}:${pgPort}/${pgDatabase}`;

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
  "drivers",
  "fee_items",
  "freight_rates",
  "templates",
  "rule_items",
  "master_data",
  "app_accounts",
  "files",
  "driver_wage_rules",
  "driver_adjustments",
  "address_book",
  "customer_contacts"
]);

function withReturningId(sql) {
  const trimmed = String(sql).trim().replace(/;$/, "");
  if (!/^insert\s+into\s+/i.test(trimmed) || /\breturning\b/i.test(trimmed)) return sql;
  const table = trimmed.match(/^insert\s+into\s+("?[\w]+"?)/i)?.[1]?.replaceAll('"', "");
  return table && idReturningTables.has(table) ? `${trimmed} RETURNING id` : sql;
}

async function query(sql, args = []) {
  const compiled = compileSql(sql, args);
  const client = transactionClient.getStore() || pool;
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
      try {
        await client.query("BEGIN");
        let result;
        await transactionClient.run(client, async () => {
          result = await callback(...args);
        });
        await client.query("COMMIT");
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

async function addColumn(table, definition) {
  const column = definition.split(/\s+/)[0];
  if (!(await hasColumn(table, column))) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
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
      name TEXT NOT NULL,
      province TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      term TEXT NOT NULL DEFAULT '月结30天',
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
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
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
      status TEXT NOT NULL DEFAULT '待审核',
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
      category TEXT NOT NULL DEFAULT '正常' CHECK (category IN ('正常', '代垫')),
      name TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT '港币',
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      remark TEXT NOT NULL DEFAULT '',
      driver_role TEXT NOT NULL DEFAULT '',
      driver_name TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS dispatch_plans (
      plan_date TEXT PRIMARY KEY,
      rows_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
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
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS freight_rates (
      id BIGSERIAL PRIMARY KEY,
      direction TEXT NOT NULL DEFAULT '',
      level1 TEXT NOT NULL DEFAULT '',
      level2 TEXT NOT NULL DEFAULT '',
      level3 TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      tonnage TEXT NOT NULL DEFAULT '',
      rmb_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      hkd_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
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
      created_at TEXT NOT NULL DEFAULT (CURRENT_DATE::text),
      updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
      last_login_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS files (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      filename TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      content_base64 TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
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

    CREATE TABLE IF NOT EXISTS hidden_history_addresses (
      address_key TEXT PRIMARY KEY,
      address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_deleted_order_date ON orders(deleted_at, order_date);
    CREATE INDEX IF NOT EXISTS idx_order_fees_order_no ON order_fees(order_no);
    CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
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
      "six_sheet_no TEXT NOT NULL DEFAULT ''"
    ],
    driver_wage_rules: [
      "transport_mode TEXT NOT NULL DEFAULT '单司机'",
      "advance_fee_rates TEXT NOT NULL DEFAULT '{}'"
    ],
    drivers: [
      "type TEXT NOT NULL DEFAULT '香港司机'",
      "id_no TEXT NOT NULL DEFAULT ''",
      "birthday TEXT NOT NULL DEFAULT ''",
      "hire_date TEXT NOT NULL DEFAULT ''",
      "leave_date TEXT NOT NULL DEFAULT ''"
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
      "updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)",
      "last_login_at TEXT"
    ],
    fee_items: [
      "sort_order INTEGER NOT NULL DEFAULT 0",
      "default_driver_role TEXT NOT NULL DEFAULT ''"
    ],
    order_fees: [
      "unit_price DOUBLE PRECISION NOT NULL DEFAULT 0",
      "driver_role TEXT NOT NULL DEFAULT ''",
      "driver_name TEXT NOT NULL DEFAULT ''"
    ],
    freight_rates: [
      "level1 TEXT NOT NULL DEFAULT ''",
      "level2 TEXT NOT NULL DEFAULT ''",
      "level3 TEXT NOT NULL DEFAULT ''"
    ],
    customers: [
      "province TEXT NOT NULL DEFAULT ''",
      "address TEXT NOT NULL DEFAULT ''",
      "tax_no TEXT NOT NULL DEFAULT ''",
      "contact TEXT NOT NULL DEFAULT ''",
      "mobile TEXT NOT NULL DEFAULT ''",
      "driver_wage_adjust_hkd DOUBLE PRECISION NOT NULL DEFAULT 0",
      "default_template_id TEXT NOT NULL DEFAULT ''",
      "invoice_title TEXT NOT NULL DEFAULT ''",
      "invoice_tax_no TEXT NOT NULL DEFAULT ''",
      "invoice_bank TEXT NOT NULL DEFAULT ''",
      "invoice_account TEXT NOT NULL DEFAULT ''",
      "invoice_address_phone TEXT NOT NULL DEFAULT ''"
    ]
  };

  for (const [table, definitions] of Object.entries(migrations)) {
    for (const definition of definitions) {
      await addColumn(table, definition);
    }
  }

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
    UPDATE fee_items
    SET default_driver_role = CASE
      WHEN name LIKE '%香港%' THEN '香港司机'
      WHEN name LIKE '%大陆%' OR name LIKE '%内地%' THEN '大陆骑师'
      ELSE default_driver_role
    END
    WHERE category = '代垫'
      AND (default_driver_role IS NULL OR default_driver_role = '')
  `).run();

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
}

export async function writeAudit(action, entityType, entityId, detail = "") {
  await db.prepare(`
    INSERT INTO audit_logs (action, entity_type, entity_id, detail)
    VALUES (?, ?, ?, ?)
  `).run(action, entityType, entityId, detail);
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
