import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import OSS from "ali-oss";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import zlib from "node:zlib";
import {
  ACCOUNT_ROLES,
  accountPermissionsForAccount,
  accountPermissionsForRole,
  allowedModulesForAccount,
  allowedModulesForRole,
  canAccessModule,
  hashPassword,
  normalizeAccountRole,
  roleLevelFor,
  verifyPassword
} from "./auth.js";
import PDFDocument from "pdfkit";
import { afterCommit, db, databaseInfo, listenRealtimeEvents, publishRealtimeEvent, startupDatabaseMaintenanceEnabled, withAdvisoryLock, writeAudit as writeAuditRecord } from "./db.js";
import { createRealtimeHub, realtimeEventFromAudit } from "./realtime.js";

const app = express();
const port = Number(process.env.PORT || 5174);
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const SHARED_DIRECTION = "进出口通用";
const extraCorsOrigins = new Set(
  String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);
const SAFE_FILE_TYPES = [
  { extensions: [".png"], mimes: ["image/png"] },
  { extensions: [".jpg", ".jpeg"], mimes: ["image/jpeg", "image/pjpeg"] },
  { extensions: [".webp"], mimes: ["image/webp"] },
  { extensions: [".gif"], mimes: ["image/gif"] },
  { extensions: [".bmp"], mimes: ["image/bmp", "image/x-ms-bmp"] },
  { extensions: [".tif", ".tiff"], mimes: ["image/tiff"] },
  { extensions: [".avif"], mimes: ["image/avif"] },
  { extensions: [".heic"], mimes: ["image/heic", "image/heif"] },
  { extensions: [".heif"], mimes: ["image/heif", "image/heic"] },
  { extensions: [".svg"], mimes: ["image/svg+xml"] },
  { extensions: [".pdf"], mimes: ["application/pdf"] },
  {
    extensions: [".xls"],
    mimes: ["application/vnd.ms-excel", "application/octet-stream", "application/xls", ""]
  },
  {
    extensions: [".xlsx"],
    mimes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
      "application/zip",
      ""
    ]
  },
  { extensions: [".csv"], mimes: ["text/csv", "application/csv", "application/octet-stream", ""] }
];
const PREVIEW_MIMES = new Set(SAFE_FILE_TYPES.flatMap((item) => item.mimes));
const AUTH_TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 7 * 24 * 60 * 60);
const VEHICLE_PROFIT_EXCHANGE_RATE_MODULES = ["bossVehicleProfit", "bossSupplierProfit", "bossDashboard", "bossCompanyProfit", "financeWages", "financeSupplierStatements", "financeCustomsStatements"];
const COMPANY_EXPENSE_MODULES = ["bossCompanyExpenses", "bossDashboard", "bossCompanyProfit"];
const BOSS_CENTER_READ_MODULES = ["bossDashboard", "bossUnreceived", "bossCompanyProfit", "bossVehicleProfit", "bossSupplierProfit", "bossCompanyExpenses"];
const ORDER_CREATE_LOCK_ID = 524460;
const VEHICLE_EXPENSE_CREATE_LOCK_NAMESPACE = 524461;
const AUTH_SECRET = process.env.HANYE_AUTH_SECRET || process.env.AUTH_SECRET || "hanye-system-local-dev-secret";
const VEHICLE_EXPENSE_TYPES = new Set(["fuel", "repair", "annual", "other"]);
const VEHICLE_ANNUAL_EXPENSE_NAMES = new Set(["大陆保险", "香港保险", "大陆年审", "香港年审", "牌头费"]);
const VEHICLE_ANNUAL_EXPENSE_NAME_ALIASES = new Map([
  ["大陆保险费", "大陆保险"],
  ["香港保险费", "香港保险"],
  ["大陆年审费", "大陆年审"],
  ["香港年审费", "香港年审"],
  ["保险费", "大陆保险"],
  ["年审费", "大陆年审"]
]);
const VEHICLE_ANNUAL_EXPENSE_REMINDER_FIELDS = new Map([
  ["大陆保险", "mainland_insurance_date"],
  ["香港保险", "hk_insurance_date"],
  ["大陆年审", "mainland_review_date"],
  ["香港年审", "hk_review_date"]
]);
const VEHICLE_PROFIT_DEFAULT_EXCHANGE_RATE = 0.88;
const OWN_VEHICLE_SOURCE = "汉业物流";
const LEGACY_OWN_VEHICLE_SOURCE = "本公司车辆";
const OSS_ACCESS_KEY_ID = String(process.env.OSS_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || "").trim();
const OSS_ACCESS_KEY_SECRET = String(process.env.OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || "").trim();
const OSS_BUCKET = String(process.env.OSS_BUCKET || "").trim();
const OSS_REGION = String(process.env.OSS_REGION || "").trim();
const OSS_ENDPOINT = String(process.env.OSS_ENDPOINT || "").trim();
const OSS_KEY_PREFIX = String(process.env.OSS_KEY_PREFIX || "hanye-system/uploads").trim();
const OSS_SIGNED_URL_EXPIRES_SECONDS = Math.max(60, Number(process.env.OSS_SIGNED_URL_EXPIRES_SECONDS || 60 * 60));
const OSS_CONFIG_REQUESTED = Boolean(OSS_BUCKET || OSS_REGION || OSS_ENDPOINT || OSS_ACCESS_KEY_ID || OSS_ACCESS_KEY_SECRET);
const OSS_ENABLED = Boolean(OSS_BUCKET && (OSS_REGION || OSS_ENDPOINT) && OSS_ACCESS_KEY_ID && OSS_ACCESS_KEY_SECRET);
const ossClient = OSS_ENABLED ? new OSS({
  accessKeyId: OSS_ACCESS_KEY_ID,
  accessKeySecret: OSS_ACCESS_KEY_SECRET,
  bucket: OSS_BUCKET,
  cname: truthyEnv(process.env.OSS_CNAME),
  endpoint: OSS_ENDPOINT || undefined,
  internal: truthyEnv(process.env.OSS_INTERNAL),
  region: OSS_REGION || undefined,
  secure: !falsyEnv(process.env.OSS_SECURE)
}) : null;
const fileStorageProvider = ossClient ? "oss" : "oss-unconfigured";
const auditActorContext = new AsyncLocalStorage();
let realtimeHub = null;

function auditActorFromAccount(account = {}) {
  return String(account.name || account.displayName || account.username || "").trim() || "admin";
}

async function writeAudit(action, entityType, entityId, detail = "") {
  const actor = auditActorContext.getStore() || "admin";
  await writeAuditRecord(action, entityType, entityId, detail, actor);
  const event = realtimeEventFromAudit({ action, entityType, entityId, detail, actor });
  if (event) {
    afterCommit(async () => {
      realtimeHub?.broadcast(event);
      await publishRealtimeEvent(event);
    });
  }
}

if (OSS_CONFIG_REQUESTED && !OSS_ENABLED) {
  console.warn("OSS config is incomplete. File uploads are disabled until OSS is configured.");
} else if (!OSS_ENABLED) {
  console.warn("OSS is required for file storage. File uploads are disabled until OSS is configured.");
}

function truthyEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function falsyEnv(value) {
  return ["0", "false", "no", "off"].includes(String(value || "").trim().toLowerCase());
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlJson(value) {
  return base64UrlEncode(JSON.stringify(value));
}

function signTokenPayload(encodedHeader, encodedPayload) {
  return crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
}

function createAuthToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + AUTH_TOKEN_TTL_SECONDS;
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const payload = base64UrlJson({
    sub: String(account.id),
    username: account.username,
    role: normalizeAccountRole(account.role),
    iat: now,
    exp: expiresAt
  });
  return {
    token: `${header}.${payload}.${signTokenPayload(header, payload)}`,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}

function verifyAuthToken(token = "") {
  const [header, payload, signature] = String(token || "").split(".");
  if (!header || !payload || !signature) return null;
  const expected = signTokenPayload(header, payload);
  const expectedBytes = Buffer.from(expected);
  const signatureBytes = Buffer.from(signature);
  if (expectedBytes.length !== signatureBytes.length || !crypto.timingSafeEqual(expectedBytes, signatureBytes)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.sub || !parsed?.username || Number(parsed.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function bearerTokenFromRequest(req) {
  const header = String(req.headers.authorization || "");
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return String(req.query.token || "").trim();
}

function normalizeTransportMode(value = "") {
  const text = String(value || "").trim();
  if (text === "香港司机直送") return "单司机";
  if (text === "香港司机 + 大陆骑师接驳") return "双司机";
  if (text === "口岸交货") return "口岸转国内车";
  return ["单司机", "双司机", "口岸转国内车"].includes(text) ? text : "";
}

function normalizePortText(value = "") {
  return String(value || "")
    .replace(/\s*(?:海关|海關)\s*$/u, "")
    .trim();
}

function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "过磅"].includes(text)) return true;
  if (["0", "false", "no", "off", "不用过磅"].includes(text)) return false;
  return fallback;
}

const ADMIN_ONLY_DELETE_ORDER_STATUSES = new Set(["待确认", "通关中"]);
const DISPATCH_PLAN_DEFAULT_STATUS = "预排";
const DISPATCH_STATUS_OPTIONS = ["预排", "已派车", "通关中", "已签收", "异常滞留"];
const DISPATCH_STATUS_TO_ORDER_STATUS = {
  "预排": "预排",
  "待预排": "预排",
  "已预排": "预排",
  "已派车": "预排",
  "通关中": "通关中",
  "已签收": "已签收",
  "异常滞留": "费用待确认"
};
const ORDER_STATUS_TO_DISPATCH_STATUS = {
  "预排": "预排",
  "正常": "预排",
  "通关中": "通关中",
  "已签收": "已签收",
  "费用待确认": "异常滞留"
};
const ORDER_STATUS_OPTIONS = ["待确认", "预排", "正常", "通关中", "已签收", "已审核", "缺票据", "费用待确认"];
const ORDER_STATUS_RANK = {
  "待确认": 10,
  "预排": 20,
  "正常": 25,
  "已派车": 30,
  "通关中": 40,
  "缺票据": 45,
  "费用待确认": 50,
  "已签收": 60,
  "已审核": 70
};
const ORDER_SIGN_REQUIREMENT_CUSTOMERS = [
  { keywords: ["恒泰通"], tripNo: true, sixSheetNo: true },
  { keywords: ["前海慧华"], tripNo: true, sixSheetNo: true },
  { keywords: ["深佩"], sixSheetNo: true }
];

function requestHasAdminOrderDeletePermission(req) {
  return normalizeAccountRole(req.account?.role) === "管理员";
}

function requestCanManageOrderAudit(req) {
  return ["财务", "管理员"].includes(normalizeAccountRole(req.account?.role));
}

function normalizeDispatchPlanStatus(status = "") {
  const text = String(status || "").trim();
  if (text === "待预排" || text === "已预排") return DISPATCH_PLAN_DEFAULT_STATUS;
  if (text === "完成结算") return "已签收";
  return DISPATCH_STATUS_OPTIONS.includes(text) ? text : DISPATCH_PLAN_DEFAULT_STATUS;
}

function normalizeOrderStatus(status = "", fallback = "待确认") {
  const text = String(status || "").trim();
  if (text === "已派车") return "预排";
  if (ORDER_STATUS_OPTIONS.includes(text)) return text;
  return fallback;
}

function normalizedSignRequirementText(value = "") {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function orderSignRequirementForCustomer(customer = {}, fallbackName = "") {
  const values = [
    customer?.id,
    customer?.name,
    customer?.short_name,
    customer?.shortName,
    fallbackName
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return ORDER_SIGN_REQUIREMENT_CUSTOMERS.find((rule) =>
    values.some((value) =>
      rule.keywords.some((keyword) => normalizedSignRequirementText(value).includes(normalizedSignRequirementText(keyword)))
    )
  ) || null;
}

function missingOrderSignRequiredFieldLabels(order = {}, customer = {}) {
  const requirement = orderSignRequirementForCustomer(customer, order.customer);
  if (!requirement) return [];
  const labels = [];
  if (requirement.tripNo && !String(order.tripNo || order.trip_no || "").trim()) labels.push("车次号");
  if (requirement.sixSheetNo && !String(order.sixSheetNo || order.six_sheet_no || "").trim()) labels.push("六联单号");
  return labels;
}

function orderSignRequiredMessage(labels = []) {
  return labels.length ? `请先填写${labels.join("和")}后再签收` : "";
}

function orderStatusRank(status = "") {
  return ORDER_STATUS_RANK[normalizeOrderStatus(status, "")] || 0;
}

function shouldPreventOrderStatusDowngrade(currentStatus = "", nextStatus = "") {
  const current = normalizeOrderStatus(currentStatus, "");
  const next = normalizeOrderStatus(nextStatus, "");
  if (!current || !next || current === next) return false;
  if (current === "已审核") return true;
  if (["通关中", "费用待确认", "缺票据", "已签收"].includes(current)) {
    return orderStatusRank(next) < orderStatusRank(current);
  }
  return false;
}

app.disable("x-powered-by");

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const allowed =
      extraCorsOrigins.has("*") ||
      extraCorsOrigins.has(origin) ||
      origin === "http://127.0.0.1:5173" ||
      origin === "http://localhost:5173" ||
      origin === "http://127.0.0.1:8080" ||
      origin === "http://localhost:8080" ||
      origin === "https://524458.cn" ||
      origin === "https://www.524458.cn" ||
      origin === "http://524458.cn" ||
      origin === "http://www.524458.cn" ||
      /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:5173$/.test(origin) ||
      /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:5173$/.test(origin) ||
      /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}:5173$/.test(origin);

    callback(allowed ? null : new Error("Not allowed by CORS"), allowed);
  }
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
    if (!acceptsGzip) return originalJson(payload);
    const body = Buffer.from(JSON.stringify(payload));
    if (body.length < 1024) return originalJson(payload);
    const gzipped = zlib.gzipSync(body);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Vary", "Accept-Encoding");
    res.setHeader("Content-Length", String(gzipped.length));
    return res.send(gzipped);
  };
  next();
});
app.use(express.json({ limit: "12mb" }));

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function normalizeVehicleSource(value = "") {
  const text = String(value || "").trim();
  if (text === LEGACY_OWN_VEHICLE_SOURCE) return OWN_VEHICLE_SOURCE;
  return text;
}

function normalizeEffectiveDate(value = "", fallback = todayInputValue()) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function mapCustomer(row) {
  const customerCategory = row.type === "客户" && row.customer_category === "报关客户" ? "报关客户" : row.type === "客户" ? "运输客户" : "";
  const customsDefaults = {
    customsHomeItemCount: 6,
    customsPageItemCount: 14,
    customsImportHomeFee: 100,
    customsExportHomeFee: 150,
    customsImportPageFee: 30,
    customsExportPageFee: 30,
    customsManifestFee: 0,
    customsVerificationFee: 0
  };
  return {
    id: row.id,
    type: row.type,
    customerCategory,
    name: row.name,
    shortName: row.short_name || "",
    customsCustomerType: row.customs_customer_type || "",
    province: row.province || "广东省",
    city: row.city,
    address: row.address || "",
    term: row.term,
    settlementCurrency: row.settlement_currency || (row.type === "客户" ? "人民币结算" : ""),
    taxNo: row.tax_no || "",
    contact: row.contact || "",
    mobile: row.mobile || "",
    driverWageAdjustHKD: row.driver_wage_adjust_hkd || 0,
    defaultTemplateId: row.default_template_id || "",
    receivableRMB: row.receivable_rmb,
    receivableHKD: row.receivable_hkd,
    recentOrder: row.recent_order,
    customsHomeItemCount: Number(row.customs_home_item_count ?? customsDefaults.customsHomeItemCount),
    customsPageItemCount: Number(row.customs_page_item_count ?? customsDefaults.customsPageItemCount),
    customsImportHomeFee: Number(row.customs_import_home_fee ?? customsDefaults.customsImportHomeFee),
    customsExportHomeFee: Number(row.customs_export_home_fee ?? customsDefaults.customsExportHomeFee),
    customsImportPageFee: Number(row.customs_import_page_fee ?? customsDefaults.customsImportPageFee),
    customsExportPageFee: Number(row.customs_export_page_fee ?? customsDefaults.customsExportPageFee),
    customsManifestFee: Number(row.customs_manifest_fee ?? customsDefaults.customsManifestFee ?? 0),
    customsVerificationFee: Number(row.customs_verification_fee ?? customsDefaults.customsVerificationFee),
    customsCustomFields: normalizeCustomsBusinessCustomFields(row.customs_custom_fields),
    createdAt: row.created_at,
    invoice: {
      title: row.invoice_title || row.name || "",
      taxNo: row.invoice_tax_no || row.tax_no || "",
      bank: row.invoice_bank || "",
      account: row.invoice_account || "",
      address: row.address || "",
      addressPhone: row.invoice_address_phone || row.address || ""
    }
  };
}

const customerColumnAvailability = new Map();

async function tableColumnExists(table, column) {
  const tableName = String(table || "").trim();
  const columnName = String(column || "").trim();
  if (!tableName || !columnName) return false;
  const key = `${tableName}.${columnName}`;
  if (!customerColumnAvailability.has(key)) {
    const row = await db.prepare(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `).get(tableName, columnName);
    customerColumnAvailability.set(key, Boolean(row));
  }
  return customerColumnAvailability.get(key);
}

async function customerColumnExists(column) {
  return tableColumnExists("customers", column);
}

async function customsBusinessColumnExists(column) {
  return tableColumnExists("customs_businesses", column);
}

let customerCustomsCustomerTypeColumnReady = false;

async function ensureCustomerCustomsCustomerTypeColumn() {
  if (customerCustomsCustomerTypeColumnReady) return;
  await db.exec(`
    ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS customs_customer_type TEXT NOT NULL DEFAULT '';
  `);
  customerColumnAvailability.set("customers.customs_customer_type", true);
  customerCustomsCustomerTypeColumnReady = true;
}

let orderFeeCostCurrencyColumnReady = false;
let orderFeeInsertColumnSupportCache = null;

async function ensureOrderFeeCostCurrencyColumn() {
  if (orderFeeCostCurrencyColumnReady) return;
  await Promise.all([
    tableColumnExists("order_fees", "client_key"),
    tableColumnExists("order_fees", "cost_currency"),
    tableColumnExists("order_fees", "cost_hkd"),
    tableColumnExists("order_fees", "cost_rmb"),
    tableColumnExists("order_fees", "cost_parts_json"),
    tableColumnExists("order_fees", "advance_address"),
    tableColumnExists("order_fees", "fx_links_json")
  ]);
  orderFeeCostCurrencyColumnReady = true;
}

async function orderFeeInsertColumnSupport() {
  if (orderFeeInsertColumnSupportCache) return orderFeeInsertColumnSupportCache;
  const support = {
    clientKey: await tableColumnExists("order_fees", "client_key"),
    costCurrency: await tableColumnExists("order_fees", "cost_currency"),
    costHKD: await tableColumnExists("order_fees", "cost_hkd"),
    costRMB: await tableColumnExists("order_fees", "cost_rmb"),
    costPartsJson: await tableColumnExists("order_fees", "cost_parts_json"),
    advanceAddress: await tableColumnExists("order_fees", "advance_address"),
    fxLinksJson: await tableColumnExists("order_fees", "fx_links_json")
  };
  orderFeeInsertColumnSupportCache = support;
  return support;
}

function normalizeCustomerPayload(body, id = "") {
  const invoice = body.invoice || {};
  const numericOrDefault = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const name = userTextValue(body.name);
  const shortName = userTextValue(body.shortName || body.short_name);
  const customsCustomerType = userTextValue(body.customsCustomerType || body.customs_customer_type);
  const address = userMultilineTextValue(body.address || invoice.address);
  const taxNo = userTextValue(body.taxNo || invoice.taxNo);
  const type = body.type === "供应商" ? "供应商" : "客户";
  const customerCategory = type === "客户" && (body.customerCategory || body.customer_category) === "报关客户" ? "报关客户" : type === "客户" ? "运输客户" : "";
  const settlementCurrency = userTextValue(body.settlementCurrency);
  return {
    id,
    type,
    customerCategory,
    name,
    shortName,
    customsCustomerType: type === "客户" && customerCategory === "报关客户" ? customsCustomerType : "",
    province: userTextValue(body.province || "广东省"),
    city: userTextValue(body.city || "深圳市"),
    address,
    term: userTextValue(body.term || "月结30天"),
    settlementCurrency: type === "客户" ? (settlementCurrency || "人民币结算") : "",
    taxNo,
    contact: userTextValue(body.contact),
    mobile: userTextValue(body.mobile),
    driverWageAdjustHKD: Number(body.driverWageAdjustHKD || 0),
    defaultTemplateId: String(body.defaultTemplateId || "").trim(),
    receivableRMB: Number(body.receivableRMB || 0),
    receivableHKD: Number(body.receivableHKD || 0),
    recentOrder: userTextValue(body.recentOrder || "-"),
    customsHomeItemCount: numericOrDefault(body.customsHomeItemCount ?? body.customs_home_item_count, 6),
    customsPageItemCount: numericOrDefault(body.customsPageItemCount ?? body.customs_page_item_count, 14),
    customsImportHomeFee: numericOrDefault(body.customsImportHomeFee ?? body.customs_import_home_fee, 100),
    customsExportHomeFee: numericOrDefault(body.customsExportHomeFee ?? body.customs_export_home_fee, 150),
    customsImportPageFee: numericOrDefault(body.customsImportPageFee ?? body.customs_import_page_fee, 30),
    customsExportPageFee: numericOrDefault(body.customsExportPageFee ?? body.customs_export_page_fee, 30),
    customsManifestFee: numericOrDefault(body.customsManifestFee ?? body.customs_manifest_fee, 0),
    customsVerificationFee: numericOrDefault(body.customsVerificationFee ?? body.customs_verification_fee, 0),
    customsCustomFields: normalizeCustomsBusinessCustomFields(body.customsCustomFields ?? body.customs_custom_fields),
    customsCustomFieldsJson: JSON.stringify(normalizeCustomsBusinessCustomFields(body.customsCustomFields ?? body.customs_custom_fields)),
    createdAt: body.createdAt || todayInputValue(),
    invoiceTitle: userTextValue(body.invoiceTitle || invoice.title || name),
    invoiceTaxNo: userTextValue(body.invoiceTax || invoice.taxNo || taxNo),
    invoiceBank: userTextValue(body.invoiceBank || invoice.bank),
    invoiceAccount: userTextValue(body.invoiceAccount || invoice.account),
    invoiceAddressPhone: userMultilineTextValue(body.invoiceAddressPhone || invoice.addressPhone || address)
  };
}

function mapOrder(row) {
  const createdByName = row.created_by_display_name || row.created_by_username || "";
  const loadingLocations = normalizeLocationEntries(row.loading_locations, row.loading);
  const unloadingLocations = normalizeLocationEntries(row.unloading_locations, row.unloading);
  return {
    no: row.no,
    dispatchNo: row.dispatch_no || "",
    customerId: row.customer_id,
    customer: userTextValue(row.customer),
    businessType: userTextValue(row.business_type),
    port: normalizePortText(row.port),
    needsWeighing: Boolean(row.needs_weighing),
    direction: userTextValue(row.direction),
    tonnage: userTextValue(row.tonnage),
    currency: userTextValue(row.currency),
    quantity: userTextValue(row.quantity),
    weight: userTextValue(row.weight),
    vehicleSource: normalizeVehicleSource(row.vehicle_source),
    supplier: userTextValue(row.supplier),
    plate: normalizePlateText(row.plate),
    driver: userTextValue(row.driver),
    hkDriver: userTextValue(row.hk_driver),
    mainlandDriver: userTextValue(row.mainland_driver),
    transportMode: normalizeTransportMode(row.transport_mode || ""),
    loading: composeLocationEntriesText(loadingLocations) || userRawMultilineTextValue(row.loading),
    loadingLocations,
    unloading: composeLocationEntriesText(unloadingLocations) || userRawMultilineTextValue(row.unloading),
    unloadingLocations,
    date: row.order_date,
    receivableHKD: row.receivable_hkd,
    receivableRMB: row.receivable_rmb,
    status: userTextValue(row.status),
    operatingUnit: userTextValue(row.operating_unit),
    createdByAccountId: row.created_by_account_id || null,
    createdByUsername: row.created_by_username || "",
    createdByName,
    remark: userMultilineTextValue(row.remark),
    tripNoEnabled: Boolean(row.trip_no_enabled),
    tripNo: userTextValue(row.trip_no),
    sixSheetEnabled: Boolean(row.six_sheet_enabled),
    sixSheetNo: userTextValue(row.six_sheet_no),
    chargedAt: userTextValue(row.charged_at),
    fees: []
  };
}

function normalizeOrderChargedAt(value = "") {
  const text = userTextValue(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function orderIsCharged(order = {}) {
  return Boolean(normalizeOrderChargedAt(order.chargedAt || order.charged_at));
}

function orderChargeDateCn(value = "") {
  const chargedAt = normalizeOrderChargedAt(value);
  if (!chargedAt) return "";
  const [year, month, day] = chargedAt.split("-");
  return `${year}年${month}月${day}日`;
}

function orderChargeNoteText(order = {}) {
  const dateText = orderChargeDateCn(order.chargedAt || order.charged_at);
  return dateText ? `于${dateText}已收费` : "";
}

function creatorFieldsFromAccount(account = {}) {
  const username = String(account.username || "").trim();
  const displayName = String(account.displayName || account.display_name || username).trim();
  const accountId = Number(account.id);
  return {
    createdByAccountId: Number.isFinite(accountId) && accountId > 0 ? accountId : null,
    createdByUsername: username,
    createdByName: displayName || username
  };
}

function creatorFieldsFromRecord(record = {}) {
  const accountId = Number(record.createdByAccountId ?? record.created_by_account_id ?? 0);
  const username = String(record.createdByUsername || record.created_by_username || "").trim();
  const name = String(
    record.createdByName ||
    record.createdByDisplayName ||
    record.created_by_display_name ||
    username ||
    ""
  ).trim();
  return {
    createdByAccountId: Number.isFinite(accountId) && accountId > 0 ? accountId : null,
    createdByUsername: username,
    createdByName: name
  };
}

function creatorFieldsHaveValue(fields = {}) {
  return Boolean(fields.createdByAccountId || fields.createdByUsername || fields.createdByName);
}

const ORDER_EXPORT_COLUMNS = [
  ["排车单号", "dispatchNo", 82],
  ["订单号", "no", 82],
  ["客户", "customer", 118],
  ["业务", "businessType", 46],
  ["口岸", "port", 70],
  ["进出口", "direction", 44],
  ["吨位", "tonnage", 42],
  ["币种", "currency", 42],
  ["件数", "quantity", 42],
  ["重量", "weight", 56],
  ["装货地", "loading", 140],
  ["卸货地", "unloading", 140],
  ["日期", "date", 64],
  ["港币", "receivableHKD", 50],
  ["人民币", "receivableRMB", 54],
  ["状态", "status", 50]
];
const ORDER_EXPORT_REMOVED_COLUMN_KEYS = new Set(["createdByName"]);
const ORDER_EXPORT_SYSTEM_TOTAL_COLUMNS = [
  { key: "__rmbTotal", label: "RMB合计", width: 64, fontSize: 8, system: true },
  { key: "__hkdTotal", label: "HKD合计", width: 64, fontSize: 8, system: true }
];
const ORDER_EXPORT_SYSTEM_TOTAL_COLUMN_KEYS = new Set(ORDER_EXPORT_SYSTEM_TOTAL_COLUMNS.map((column) => column.key));
const ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN = { key: "__sequence", label: "序号", width: 42, fontSize: 8, system: true };
const ORDER_EXPORT_CHARGE_NOTE_COLUMN = { key: "__chargeNote", label: "收费备注", width: 128, fontSize: 8, system: true };
const ORDER_EXPORT_OPERATING_UNIT_COLUMN = { key: "operatingUnit", label: "经营单位", width: 96, fontSize: 8, system: true };

function normalizeExportTemplate(template = null) {
  if (!template || template.type !== "visual-export-template") return null;
  const fallbackColumns = ORDER_EXPORT_COLUMNS.map(([label, key, width]) => ({ label, key, width }));
  const columns = Array.isArray(template.columns) && template.columns.length
    ? template.columns
    : fallbackColumns;
  const headerTextColor = validHexColor(template.headerTextColor, "#17233c");
  const footerTextColor = validHexColor(template.footerTextColor, "#64748b");
  const headerTextItems = Array.isArray(template.headerTextItems) ? template.headerTextItems : [];
  const footerTextItems = exportTemplateFooterItems(template, footerTextColor);
  return {
    orientation: ["portrait", "landscape", "fluid"].includes(template.orientation) ? template.orientation : "landscape",
    headerTextItems: headerTextItems.map((item) => ({
      ...item,
      color: validHexColor(item.color, headerTextColor),
      width: Math.max(80, Math.min(520, Number(item.width || 260))),
      align: ["left", "center", "right"].includes(item.align) ? item.align : "left"
    })),
    footerTextItems: footerTextItems.map((item) => ({
      ...item,
      color: validHexColor(item.color, footerTextColor),
      width: Math.max(80, Math.min(520, Number(item.width || 280))),
      align: ["left", "center", "right"].includes(item.align) ? item.align : "left"
    })),
    header: String(template.header || ""),
    footer: String(template.footer || ""),
    logo: String(template.logo || ""),
    logoWidth: Number(template.logoWidth || 92),
    logoHeight: Number(template.logoHeight || 56),
    logoFit: template.logoFit === "cover" ? "cover" : "contain",
    logoX: Number(template.logoX ?? 18),
    logoY: Number(template.logoY ?? 12),
    headerHeight: Math.max(48, Math.min(180, Number(template.headerHeight || 92))),
    footerHeight: Math.max(28, Math.min(140, Number(template.footerHeight || 70))),
    headerFontSize: Number(template.headerFontSize || 14),
    headerTextColor,
    tableFontSize: Math.max(5, Math.min(22, Number(template.tableFontSize || 8))),
    tableTextColor: validHexColor(template.tableTextColor, "#17233c"),
    tableHeaderTextColor: validHexColor(template.tableHeaderTextColor, "#1f2a44"),
    tableHeaderBgColor: validHexColor(template.tableHeaderBgColor, "#f1f5f9"),
    tableBorderColor: validHexColor(template.tableBorderColor, "#d9e3f2"),
    tableBorderWidth: Math.max(0, Math.min(6, Number(template.tableBorderWidth ?? 1))),
    tableHeaderBold: template.tableHeaderBold !== false,
    tableBold: Boolean(template.tableBold),
    tableAlign: ["left", "center", "right"].includes(template.tableAlign) ? template.tableAlign : "left",
    footerFontSize: Number(template.footerFontSize || 9),
    footerTextColor,
    columns: columns
      .filter((column) => column?.visible !== false && !ORDER_EXPORT_REMOVED_COLUMN_KEYS.has(String(column.key || "")))
      .map((column) => ({
        label: String(column.label || column.key || ""),
        key: String(column.key || ""),
        feeItemId: String(column.feeItemId || ""),
        feeName: String(column.feeName || ""),
        feeCurrency: String(column.feeCurrency || ""),
        fontSize: Math.max(5, Math.min(22, Number(column.fontSize || template.tableFontSize || 8))),
        width: Number(column.width || fallbackColumns.find((item) => item.key === column.key)?.width || 76),
        order: Number(column.order || column.sortOrder || 0) || 0,
        headerBold: typeof column.headerBold === "boolean" ? column.headerBold : ""
      }))
      .filter((column) => column.key)
  };
}

function exportTemplateFooterItems(template = null, fallbackColor = "#64748b") {
  const footerTextItems = Array.isArray(template?.footerTextItems) ? template.footerTextItems : [];
  const explicitItems = footerTextItems
    .map((item) => ({
      ...item,
      text: String(item?.text || "").replace(/\s+/g, " ").trim()
    }))
    .filter((item) => item.text && !isSystemGeneratedExportFooterText(item.text));
  if (explicitItems.length) return explicitItems;
  const footerText = String(template?.footer || "").replace(/\s+/g, " ").trim();
  if (!footerText || isSystemGeneratedExportFooterText(footerText)) return [];
  return [{
    text: footerText,
    x: 0,
    y: 0,
    fontSize: template?.footerFontSize || 9,
    color: fallbackColor,
    bold: false
  }];
}

function isSystemGeneratedExportFooterText(value = "") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return true;
  const pageSuffix = "第 {{page}} 页 / 共 {{pages}} 页";
  const stripped = text.endsWith(pageSuffix)
    ? text.slice(0, -pageSuffix.length).trim()
    : text;
  const compact = stripped.replace(/\s+/g, "");
  const looksLikeGeneratedPayee =
    compact.includes("收款账号")
    && /户名[:：]/.test(compact)
    && /账号[:：]/.test(compact)
    && /开户行[:：]/.test(compact);
  return stripped === "制表人：{{user}}" || stripped === "制表人:{{user}}" || looksLikeGeneratedPayee;
}

function validHexColor(value, fallback) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function templateText(text, context) {
  return String(text || "")
    .replaceAll("{{title}}", context.title)
    .replaceAll("{{date}}", context.date)
    .replaceAll("{{user}}", context.user)
    .replaceAll("{{page}}", String(context.page || ""))
    .replaceAll("{{pages}}", String(context.pages || ""));
}

function dataUrlBuffer(value) {
  const match = String(value || "").match(/^data:image\/(?:png|jpe?g);base64,(.+)$/i);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}

function dataUrlImage(value) {
  const match = String(value || "").match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!match) return null;
  return {
    buffer: Buffer.from(match[2], "base64"),
    extension: match[1].toLowerCase().startsWith("jp") ? "jpeg" : "png"
  };
}

function sanitizeFilename(value) {
  const fallback = `file-${Date.now()}`;
  const filename = textValue(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const safe = filename.split(/[\\/]/).pop() || fallback;
  return safe.slice(0, 120) || fallback;
}

function fileExtension(filename) {
  const name = textValue(filename).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function normalizeMime(value) {
  return textValue(value || "application/octet-stream").split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

function fileTypeRule(filename, mime) {
  const extension = fileExtension(filename);
  const normalizedMime = normalizeMime(mime);
  return SAFE_FILE_TYPES.find((rule) =>
    rule.extensions.includes(extension)
    && (rule.mimes.includes(normalizedMime) || normalizedMime === "application/octet-stream" || normalizedMime === "")
  ) || null;
}

function bufferMatchesMime(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/pjpeg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/gif") return buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a";
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mime === "image/bmp" || mime === "image/x-ms-bmp") return buffer.subarray(0, 2).toString("ascii") === "BM";
  if (mime === "image/tiff") {
    const littleEndian = buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00]));
    const bigEndian = buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]));
    return littleEndian || bigEndian;
  }
  if (mime === "image/avif") return buffer.subarray(4, 12).toString("ascii").startsWith("ftypavif");
  if (mime === "image/heic" || mime === "image/heif") return /^ftyphei[cfmsx]|^ftypmif1/.test(buffer.subarray(4, 12).toString("ascii"));
  if (mime === "image/svg+xml") return /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buffer.toString("utf8", 0, Math.min(buffer.length, 2048)));
  if (mime === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  return true;
}

function validateStoredFilePayload(item) {
  const filename = sanitizeFilename(item.filename);
  const mime = normalizeMime(item.mime);
  const rule = fileTypeRule(filename, mime);
  if (!rule) return { error: "不支持的文件类型，请上传图片、PDF 或 Excel 文件" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(item.contentBase64) || item.contentBase64.length % 4 !== 0) {
    return { error: "文件内容格式不正确" };
  }
  const buffer = Buffer.from(item.contentBase64, "base64");
  if (!buffer.length) return { error: "文件内容不能为空" };
  if (buffer.length > MAX_UPLOAD_BYTES) return { error: `文件不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` };
  if (Number(item.size || 0) > 0 && Math.abs(Number(item.size) - buffer.length) > 8) {
    return { error: "文件大小校验失败，请重新上传" };
  }
  if (!bufferMatchesMime(buffer, mime)) return { error: "文件类型与内容不匹配，已拒绝上传" };
  return { filename, mime, size: buffer.length, contentBase64: buffer.toString("base64") };
}

function cleanOssPrefix(value) {
  return String(value || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");
}

function ossHashSegment(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
}

function ossObjectKeyForFile(item, file) {
  const dateParts = todayInputValue().split("-");
  const extension = fileExtension(file.filename) || ".bin";
  const entityType = String(item.entityType || "file").replace(/[^A-Za-z0-9_-]/g, "") || "file";
  const entityHash = ossHashSegment(`${item.entityType}:${item.entityId}`);
  const prefix = cleanOssPrefix(OSS_KEY_PREFIX);
  return [
    prefix,
    entityType,
    entityHash,
    dateParts[0],
    dateParts[1],
    `${crypto.randomUUID()}${extension}`
  ].filter(Boolean).join("/");
}

function contentDispositionHeader(disposition, filename) {
  const fallback = sanitizeFilename(filename)
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\;]/g, "_") || "download";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function deleteOssObjectByKey(objectKey) {
  if (!ossClient || !objectKey) return;
  try {
    await ossClient.delete(objectKey);
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || error?.res?.status || 0);
    if (status === 404 || error?.code === "NoSuchKey") return;
    throw error;
  }
}

async function deleteStoredOssObject(row) {
  if (row?.storage_provider !== "oss" || !row?.object_key) return;
  await deleteOssObjectByKey(row.object_key);
}

async function ossStorageForUpload(item, file) {
  if (!ossClient) {
    throw new Error("OSS 文件存储未配置，不能上传附件");
  }
  const buffer = Buffer.from(file.contentBase64, "base64");
  const objectKey = ossObjectKeyForFile(item, file);
  const result = await ossClient.put(objectKey, buffer, {
    mime: file.mime,
    headers: {
      "Content-Disposition": contentDispositionHeader("attachment", file.filename)
    }
  });
  return {
    storageProvider: "oss",
    bucket: OSS_BUCKET,
    objectKey,
    etag: String(result?.res?.headers?.etag || "").replaceAll('"', ""),
    contentBase64: ""
  };
}

function signedOssUrl(row, disposition = "attachment") {
  if (!ossClient || !row?.object_key) return "";
  try {
    return ossClient.signatureUrl(row.object_key, {
      expires: OSS_SIGNED_URL_EXPIRES_SECONDS,
      response: {
        "content-disposition": contentDispositionHeader(disposition, row.filename)
      }
    });
  } catch (error) {
    console.warn("Failed to sign OSS url", {
      objectKey: row.object_key,
      filename: row.filename,
      error: error?.message || error
    });
    return "";
  }
}

async function migrateDatabaseFilesToOss() {
  return withAdvisoryLock(524459, async () => {
    const rows = await db.prepare(`
      SELECT * FROM files
      WHERE COALESCE(storage_provider, 'database') <> 'oss'
        AND COALESCE(object_key, '') = ''
        AND COALESCE(content_base64, '') <> ''
      ORDER BY id ASC
    `).all();
    if (rows.length === 0) return { migrated: 0, skipped: 0 };
    if (!ossClient) {
      console.warn(`Found ${rows.length} database-stored file(s), but OSS is not configured. Configure OSS and restart to migrate them.`);
      return { migrated: 0, skipped: rows.length };
    }

    let migrated = 0;
    for (const row of rows) {
      const file = {
        filename: sanitizeFilename(row.filename),
        mime: normalizeMime(row.mime),
        contentBase64: row.content_base64
      };
      const objectKey = ossObjectKeyForFile({ entityType: row.entity_type, entityId: row.entity_id }, file);
      const result = await ossClient.put(objectKey, Buffer.from(file.contentBase64, "base64"), {
        mime: file.mime,
        headers: {
          "Content-Disposition": contentDispositionHeader("attachment", file.filename)
        }
      });
      await db.prepare(`
        UPDATE files
        SET storage_provider = 'oss',
            bucket = @bucket,
            object_key = @objectKey,
            etag = @etag,
            content_base64 = ''
        WHERE id = @id
      `).run({
        id: row.id,
        bucket: OSS_BUCKET,
        objectKey,
        etag: String(result?.res?.headers?.etag || "").replaceAll('"', "")
      });
      migrated += 1;
    }
    console.log(`Migrated ${migrated} database-stored file(s) to OSS.`);
    return { migrated, skipped: 0 };
  });
}

function resolvePdfFontConfig() {
  const envPath = String(process.env.PDF_FONT_PATH || "").trim();
  const envFamily = String(process.env.PDF_FONT_FAMILY || "").trim();
  return [
    envPath ? { path: envPath, family: envFamily || undefined } : null,
    { path: "/usr/share/fonts/wenquanyi/wqy-zenhei.ttc" },
    { path: "/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc" },
    { path: "/usr/share/fonts/TTF/wqy-zenhei.ttc" },
    { path: "/usr/share/fonts/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJKsc-Regular" },
    { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", family: "NotoSansCJKsc-Regular" },
    { path: "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc", family: "NotoSerifCJKsc-Regular" },
    { path: "/Library/Fonts/Arial Unicode.ttf" },
    { path: "/System/Library/Fonts/Supplemental/Arial Unicode.ttf" },
    { path: "C:/Windows/Fonts/msyh.ttc", family: "MicrosoftYaHei" },
    { path: "C:/Windows/Fonts/simsun.ttc", family: "SimSun" },
    { path: "C:/Windows/Fonts/simhei.ttf" }
  ].filter(Boolean).find((item) => fs.existsSync(item.path)) || null;
}

const USER_TEXT_COMPAT_CHAR_MAP = {
  "⺅": "亻",
  "⺆": "冂",
  "⺈": "刀",
  "⺉": "刂",
  "⺊": "卜",
  "⺋": "卩",
  "⺌": "小",
  "⺍": "小",
  "⺎": "兀",
  "⺏": "尢",
  "⺐": "尢",
  "⺑": "彐",
  "⺒": "巳",
  "⺓": "幺",
  "⺔": "彑",
  "⺕": "彐",
  "⺖": "忄",
  "⺗": "心",
  "⺘": "扌",
  "⺙": "攵",
  "⺛": "旡",
  "⺜": "日",
  "⺝": "月",
  "⺞": "歹",
  "⺟": "母",
  "⺠": "民",
  "⺡": "氵",
  "⺢": "氺",
  "⺣": "灬",
  "⺤": "爫",
  "⺥": "爫",
  "⺦": "丬",
  "⺧": "牛",
  "⺨": "犭",
  "⺩": "王",
  "⺪": "疋",
  "⺫": "目",
  "⺬": "礻",
  "⺭": "礻",
  "⺮": "竹",
  "⺯": "糹",
  "⺰": "纟",
  "⺱": "罒",
  "⺲": "罒",
  "⺳": "罒",
  "⺴": "罒",
  "⺵": "罒",
  "⺶": "羊",
  "⺷": "羊",
  "⺸": "羊",
  "⺹": "老",
  "⺺": "聿",
  "⺻": "聿",
  "⺼": "月",
  "⺽": "臼",
  "⺾": "艹",
  "⺿": "艹",
  "⻀": "艹",
  "⻁": "虎",
  "⻂": "衤",
  "⻃": "西",
  "⻄": "西",
  "⻅": "见",
  "⻆": "角",
  "⻇": "角",
  "⻈": "讠",
  "⻉": "贝",
  "⻊": "足",
  "⻋": "车",
  "⻌": "辶",
  "⻍": "辶",
  "⻎": "辶",
  "⻏": "阝",
  "⻐": "钅",
  "⻑": "長",
  "⻒": "镸",
  "⻓": "长",
  "⻔": "门",
  "⻕": "阝",
  "⻖": "阝",
  "⻗": "雨",
  "⻘": "青",
  "⻙": "韦",
  "⻚": "页",
  "⻛": "风",
  "⻜": "飞",
  "⻝": "食",
  "⻞": "食",
  "⻟": "食",
  "⻠": "饣",
  "⻢": "马",
  "⻣": "骨",
  "⻥": "鱼",
  "⻦": "鸟",
  "⻧": "卤",
  "⻨": "麦",
  "⻩": "黄",
  "⻪": "黾",
  "⻫": "齐",
  "⻬": "齐",
  "⻭": "齿",
  "⻮": "齿",
  "⻯": "龙",
  "⻰": "龙",
  "⻱": "龟",
  "⻲": "龟",
  "⻳": "龟"
};
const USER_TEXT_COMPAT_CHAR_RE = new RegExp(`[${Object.keys(USER_TEXT_COMPAT_CHAR_MAP).join("")}]`, "g");
const USER_TEXT_CJK = "\\u3400-\\u9fff\\uf900-\\ufaff";

function normalizeUserText(value = "", options = {}) {
  const source = String(value ?? "");
  let text = typeof source.normalize === "function" ? source.normalize("NFKC") : source;
  text = text
    .replace(USER_TEXT_COMPAT_CHAR_RE, (char) => USER_TEXT_COMPAT_CHAR_MAP[char] || char)
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n");
  if (options.singleLine) text = text.replace(/\n+/g, " ");
  if (options.compactCjkSpacing) {
    text = text
      .replace(new RegExp(`([${USER_TEXT_CJK}])[\\t ]+(?=[${USER_TEXT_CJK}])`, "gu"), "$1")
      .replace(new RegExp(`([${USER_TEXT_CJK}])[\\t ]+(?=\\d)`, "gu"), "$1")
      .replace(new RegExp(`(\\d)[\\t ]+(?=[${USER_TEXT_CJK}])`, "gu"), "$1")
      .replace(/(\d)[\t ]+(?=\d)/g, "$1")
      .replace(/(\d)\s*-\s*(?=\d)/g, "$1-")
      .replace(new RegExp(`([${USER_TEXT_CJK}])\\s*([:：])\\s*`, "gu"), "$1$2")
      .replace(new RegExp(`([:：])\\s*(?=[${USER_TEXT_CJK}\\d])`, "gu"), "$1");
  }
  if (options.collapseSpaces !== false) text = text.replace(/[ \t]{2,}/g, " ");
  return options.trim === false ? text : text.trim();
}

function userTextValue(value, options = {}) {
  return normalizeUserText(value, {
    singleLine: options.singleLine !== false,
    compactCjkSpacing: true
  });
}

function userMultilineTextValue(value) {
  return normalizeUserText(value, { compactCjkSpacing: true });
}

function userRawMultilineTextValue(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function normalizeLocationPartText(value = "") {
  return userTextValue(value);
}

function normalizeLocationDetailText(value = "") {
  return normalizeUserText(value, { trim: false, collapseSpaces: false });
}

function composeLocationEntryText(city = "", district = "", detail = "") {
  const cityText = normalizeLocationPartText(city);
  const districtText = normalizeLocationPartText(district);
  const detailText = normalizeLocationDetailText(detail);
  if (!cityText && !districtText) return detailText;
  if (cityText && !districtText && !detailText) return cityText;
  if (cityText && districtText && !detailText) return [cityText, districtText].join(" / ");
  if (cityText && !districtText && detailText) return [cityText, "", detailText].join(" / ");
  return [cityText, districtText, detailText].join(" / ");
}

function splitLegacyLocationEntry(value = "") {
  const text = String(value ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return { city: "", district: "", detail: "" };
  const normalized = text.replace(/[／｜|]/g, "/");
  if (!normalized.includes("/")) {
    return { city: "", district: "", detail: text };
  }
  const parts = normalized.split("/").map((part) => part.trim());
  if (!looksLikeLegacyStructuredLocationParts(parts)) {
    return { city: "", district: "", detail: text };
  }
  return {
    city: normalizeLocationPartText(parts[0] || ""),
    district: normalizeLocationPartText(parts[1] || ""),
    detail: normalizeLocationDetailText(parts.slice(2).join(" / "))
  };
}

function looksLikeLegacyStructuredLocationCity(value = "") {
  const text = normalizeLocationPartText(value);
  if (!text || text.length > 12) return false;
  if (["香港", "澳门", "深圳", "东莞", "广州", "惠州", "佛山", "中山", "珠海", "江门", "肇庆"].includes(text)) return true;
  return /(?:市|盟|地区|自治州|特别行政区|特別行政區)$/.test(text);
}

function looksLikeLegacyStructuredLocationDistrict(value = "") {
  const text = normalizeLocationPartText(value);
  if (!text || text.length > 18) return false;
  if (["九龙", "九龍", "新界", "港岛", "港島", "柴湾", "柴灣", "荃湾", "荃灣", "沙田", "屯门", "屯門"].includes(text)) return true;
  return /(?:区|區|县|縣|镇|鎮|乡|鄉|街道|开发区|工業區|工业区|新区)$/.test(text);
}

function looksLikeLegacyStructuredLocationParts(parts = []) {
  const [city = "", district = ""] = parts;
  if (!looksLikeLegacyStructuredLocationCity(city)) return false;
  if (!district) return true;
  return looksLikeLegacyStructuredLocationDistrict(district) || normalizeLocationPartText(district).length <= 12;
}

function parseLocationEntriesJson(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  const text = String(value ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {
    // Not JSON; callers may still treat the value as a legacy location string.
  }
  return [];
}

function normalizeLocationEntry(row) {
  if (row && typeof row === "object" && !Array.isArray(row)) {
    const hasStructuredParts = Object.prototype.hasOwnProperty.call(row, "city")
      || Object.prototype.hasOwnProperty.call(row, "district")
      || Object.prototype.hasOwnProperty.call(row, "detail");
    if (hasStructuredParts) {
      return {
        city: normalizeLocationPartText(row.city),
        district: normalizeLocationPartText(row.district),
        detail: normalizeLocationDetailText(row.detail)
      };
    }
    if (Object.prototype.hasOwnProperty.call(row, "value")) {
      return splitLegacyLocationEntry(row.value);
    }
  }
  return splitLegacyLocationEntry(row);
}

function locationEntryHasValue(row = {}) {
  return Boolean(String(row.city || row.district || row.detail || "").trim());
}

function splitLegacyLocationEntries(value = "") {
  const raw = String(value ?? "").replace(/\r\n?/g, "\n");
  if (!raw.trim()) return [];
  return raw
    .split(/[；;]+/)
    .map((entry) => normalizeLocationEntry(entry))
    .filter(locationEntryHasValue);
}

function normalizeLocationEntries(value, fallbackText = "", options = {}) {
  const parsed = parseLocationEntriesJson(value)
    .map((entry) => normalizeLocationEntry(entry))
    .filter(locationEntryHasValue);
  if (parsed.length) return parsed;
  const fallback = normalizeLocationDetailText(fallbackText || (typeof value === "string" ? value : ""));
  if (options.fallbackAsDetail && fallback) {
    return [{ city: "", district: "", detail: fallback }];
  }
  if (typeof value === "string" && options.parseLegacy !== false) {
    return splitLegacyLocationEntries(fallback);
  }
  return [];
}

function hasOwnValue(row = {}, key = "") {
  return row && typeof row === "object" && Object.prototype.hasOwnProperty.call(row, key);
}

function locationEntriesPayloadValue(row = {}, target = "", existingValue = "") {
  const camelKey = `${target}Locations`;
  const snakeKey = `${target}_locations`;
  if (hasOwnValue(row, camelKey)) return { provided: true, value: row[camelKey] };
  if (hasOwnValue(row, snakeKey)) return { provided: true, value: row[snakeKey] };
  return { provided: false, value: existingValue };
}

function normalizeLocationEntriesFromPayload(row = {}, target = "", fallbackText = "", existingValue = "") {
  const { provided, value } = locationEntriesPayloadValue(row, target, existingValue);
  if (provided) {
    return normalizeLocationEntries(value, fallbackText, {
      parseLegacy: false,
      fallbackAsDetail: true
    });
  }
  return normalizeLocationEntries(value, fallbackText);
}

function composeLocationEntriesText(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => composeLocationEntryText(entry.city, entry.district, entry.detail))
    .filter((entry) => String(entry || "").trim())
    .join("；");
}

function locationEntriesJson(entries = []) {
  return JSON.stringify((Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      city: normalizeLocationPartText(entry.city),
      district: normalizeLocationPartText(entry.district),
      detail: normalizeLocationDetailText(entry.detail)
    }))
    .filter(locationEntryHasValue));
}

function normalizePlateText(value = "") {
  return userTextValue(value)
    .replace(/\s+/g, "")
    .toUpperCase();
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function htmlEscape(value) {
  return textValue(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function csvCell(value) {
  return `"${textValue(value).replaceAll('"', '""')}"`;
}

function csvRows(headers, rows) {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function shortLocationValue(value) {
  const text = firstExportLocationLine(value);
  const parts = text
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 2 ? parts.slice(0, 2).join(" / ") : text;
}

function firstExportLocationLine(value) {
  const text = textValue(value).replace(/\r/g, "\n").trim();
  if (!text) return "";
  const parts = text
    .split(/[；;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] || text;
}

function dispatchExportNormalizeLocationText(value = "") {
  return String(value || "")
    .replace(/[市区县區镇鎮街道\s/｜|,，-]/g, "")
    .toLowerCase();
}

function dispatchExportLocationAnnotationIndex(value = "") {
  const text = String(value || "").trim();
  if (!text) return -1;
  const patterns = [
    /\s*[+＋]/,
    /\s*(?:联系人|聯絡人|联系电话|電話|手机|手機|备注|備注|客户要求|注意事项|注意事項|仓库|倉庫|货好|貨好|装货地址|卸货地址|进口交货地址|交货地址|提货地址)\s*[:：]?/i
  ];
  let index = -1;
  patterns.forEach((pattern) => {
    const matchIndex = text.search(pattern);
    if (matchIndex >= 0 && (index < 0 || matchIndex < index)) {
      index = matchIndex;
    }
  });
  return index;
}

function dispatchExportTrimLocationAnnotation(value = "") {
  const text = String(value || "").replace(/\r/g, "\n").trim();
  if (!text) return "";
  const cutIndex = dispatchExportLocationAnnotationIndex(text);
  if (cutIndex === 0) return "";
  if (cutIndex > 0) return text.slice(0, cutIndex).trim();
  return text;
}

function dispatchExportLocationParts(value = "") {
  const text = dispatchExportTrimLocationAnnotation(firstExportLocationLine(value));
  if (!text) return { city: "", district: "", detail: "" };
  if (["香港", "澳门"].includes(text.trim())) {
    return { city: text.trim(), district: "", detail: "" };
  }
  if (text.includes("/")) {
    const parts = text.split("/").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        city: parts[0] || "",
        district: parts[1] || "",
        detail: parts.slice(2).join(" / ")
      };
    }
    return { city: parts[0] || "", district: "", detail: "" };
  }
  const compact = text.replace(/\s+/g, "");
  const cityMatch = compact.match(/^(.+?(?:市|盟|州|地区|特別行政區|特别行政区|香港|澳门))/);
  if (cityMatch) {
    const city = cityMatch[1] || "";
    const rest = compact.slice(city.length);
    const districtMatch = rest.match(/^(.+?(?:区|區|县|縣|镇|鎮|乡|鄉|街道))/);
    return {
      city,
      district: districtMatch?.[1] || "",
      detail: districtMatch ? rest.slice(districtMatch[1].length) : rest
    };
  }
  return {
    city: "",
    district: "",
    detail: text
  };
}

function dispatchExportLocationSummaryPart(value = "") {
  const parts = dispatchExportLocationParts(value);
  return {
    city: dispatchExportTrimLocationAnnotation(parts.city),
    district: dispatchExportTrimLocationAnnotation(parts.district),
    source: dispatchExportTrimLocationAnnotation(firstExportLocationLine(value))
  };
}

function dispatchExportLooksLikeDistrictOnly(value = "") {
  const text = dispatchExportTrimLocationAnnotation(value).replace(/\s+/g, "");
  if (!text) return false;
  if (text.length > 8) return false;
  if (/[0-9:：@#（）()]/.test(text)) return false;
  return !/^(?:联系人|聯絡人|联系电话|電話|手机|手機|备注|備注|客户要求|注意事项|注意事項|仓库|倉庫|货好|貨好|装货地址|卸货地址|进口交货地址|交货地址|提货地址)/i.test(text);
}

function dispatchExportLocationSummarySegments(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .split(/[；;]+/)
    .flatMap((item) => item.split(/[+＋]/))
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => dispatchExportLocationSummaryPart(item))
    .filter((item) => item.city || item.district || item.source);
}

function dispatchExportLocationSummary(value = "") {
  return dispatchExportLocationSummarySegments(value)
    .map((entry) => String(entry.district || entry.city || entry.source || "").trim())
    .filter(Boolean)
    .join(" + ");
}

function exportLocationCityDistrict(value) {
  const text = firstExportLocationLine(value);
  if (!text) return "";
  if (text.includes("/")) {
    const parts = text
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 3 && /省|自治区|自治州|特别行政区|特別行政區/.test(parts[0])) {
      return parts.slice(1, 3).join("");
    }
    if (parts.length >= 2) return parts.slice(0, 2).join("");
    return parts[0] || "";
  }
  const compact = text.replace(/\s+/g, "");
  const cityMatch = compact.match(/^(.+?(?:市|盟|州|地区|特別行政區|特别行政区))/);
  if (cityMatch) {
    const city = cityMatch[1] || "";
    const rest = compact.slice(city.length);
    const districtMatch = rest.match(/^(.+?(?:区|區|县|縣|镇|鎮|乡|鄉|街道))/);
    return `${city}${districtMatch?.[1] || ""}`;
  }
  return shortLocationValue(text).replace(/\s*\/\s*/g, "");
}

function exportFeeColumnComparableName(column = {}) {
  return exportFeeColumnName(column)
    .replace(/\s*(?:RMB|HKD|人民币|港币)$/i, "")
    .trim();
}

function exportLocationFeeType(column = {}) {
  const feeName = exportFeeColumnComparableName(column);
  if (feeName.includes("装货费")) return "loading";
  if (feeName.includes("卸货费")) return "unloading";
  return "";
}

function formatFeeMathNumber(value) {
  const rawText = textValue(value).trim();
  const amount = Number(value);
  if (!Number.isFinite(amount)) return rawText;
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(2).replace(/\.?0+$/, "");
}

function exportFeeCalculationText(fee = {}) {
  const unitPriceValue = fee.unitPrice ?? fee.unit_price ?? fee.price;
  const amountValue = fee.amount ?? 0;
  const amountNumber = Number(amountValue || 0);
  const unitPriceText = textValue(unitPriceValue).trim();
  const unitPriceNumber = Number(unitPriceValue);
  const rawQuantityValue = fee.quantity ?? fee.qty;
  const quantityTextRaw = textValue(rawQuantityValue).trim();
  const quantityValue = quantityTextRaw
    ? rawQuantityValue
    : (Number.isFinite(amountNumber) && amountNumber !== 0 ? 1 : "");
  const quantityText = textValue(quantityValue).trim();
  const derivedUnitPrice = !unitPriceText && quantityText
    ? (Number.isFinite(Number(quantityValue)) && Number(quantityValue) !== 0 ? amountNumber / Number(quantityValue) : null)
    : null;
  const resolvedUnitPriceValue = unitPriceText && Number.isFinite(unitPriceNumber)
    ? unitPriceValue
    : derivedUnitPrice;
  const hasUsefulUnitPrice = Number.isFinite(Number(resolvedUnitPriceValue))
    && (Number(resolvedUnitPriceValue) !== 0 || amountNumber === 0);
  if (quantityText && hasUsefulUnitPrice) {
    return `${formatFeeMathNumber(quantityValue)}*${formatFeeMathNumber(resolvedUnitPriceValue)}=${formatFeeMathNumber(amountValue)}`;
  }
  return formatFeeMathNumber(amountValue);
}

function locationFeeDetailForColumn(order, column) {
  const locationType = exportLocationFeeType(column);
  if (!locationType) return "";
  const locationText = exportLocationCityDistrict(order?.[locationType]);
  const rows = feeRowsForColumn(order, column)
    .filter((fee) => Number(fee.amount || 0) !== 0);
  return rows
    .map((fee) => [locationText, exportFeeCalculationText(fee)].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("；");
}

function exportFeeAdvanceAddress(fee = {}) {
  return textValue(fee.advanceAddress || fee.advance_address).trim();
}

function exportFeeAdvanceAddressDisplay(fee = {}) {
  const text = exportFeeAdvanceAddress(fee);
  if (!text) return "";
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => shortLocationValue(line.trim()))
    .filter(Boolean)
    .join("；");
}

function isAdvanceExportFee(fee = {}) {
  return textValue(fee.category).trim() === "代垫";
}

function formatExportAmount(value, emptyZero = true) {
  const amount = Number(value || 0);
  if (!amount && emptyZero) return "";
  return amount ? amount.toLocaleString("zh-Hans-CN") : "0";
}

function duplicateFeeDisplayForColumn(rows = []) {
  const detailRows = rows.filter((fee) => Number(fee.amount || 0) !== 0);
  if (detailRows.length <= 1) return "";
  const parts = detailRows
    .map((fee) => {
      const amountText = formatExportAmount(Number(fee.amount || 0), false);
      const address = isAdvanceExportFee(fee) ? exportFeeAdvanceAddressDisplay(fee) : "";
      return `${address}${amountText}`;
    })
    .filter(Boolean);
  if (parts.length <= 1) return "";
  const total = detailRows.reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
  return `${parts.join("+")}=${formatExportAmount(total, false)}`;
}

function exportFeeItemCurrencyForColumn(column = {}) {
  const feeItemId = textValue(column?.feeItemId).trim();
  const feeName = textValue(column?.feeName || column?.label).trim();
  const columnCurrency = textValue(column?.feeCurrency).trim();
  if (feeItemId) {
    const row = db
      .prepare("SELECT currency FROM fee_items WHERE id = ? AND deleted_at IS NULL")
      .get(Number(feeItemId));
    if (row?.currency) return row.currency;
  }
  if (columnCurrency) return columnCurrency;
  if (feeName) {
    const row = db
      .prepare("SELECT currency FROM fee_items WHERE name = ? AND deleted_at IS NULL")
      .get(feeName);
    if (row?.currency) return row.currency;
  }
  return "";
}

function feeAmountForColumn(order, column) {
  return feeRowsForColumn(order, column)
    .reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
}

function feeDisplayForColumn(order, column, options = {}) {
  const rows = feeRowsForColumn(order, column);
  const duplicateDetail = duplicateFeeDisplayForColumn(rows);
  if (duplicateDetail) return duplicateDetail;
  const locationDetail = locationFeeDetailForColumn(order, column);
  if (locationDetail) return locationDetail;
  if (options.includeAdvanceAddress) {
    const detailRows = rows
      .filter((fee) => Number(fee.amount || 0) !== 0 || exportFeeAdvanceAddress(fee))
      .map((fee) => {
        const amountText = formatExportAmount(Number(fee.amount || 0));
        if (!amountText) return "";
        const address = isAdvanceExportFee(fee) ? exportFeeAdvanceAddressDisplay(fee) : "";
        return address ? `${address}：${amountText}` : amountText;
      })
      .filter(Boolean);
    if (detailRows.length) return detailRows.join("；");
  }
  const amount = rows.reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
  const amountText = formatExportAmount(amount);
  if (amountText) return amountText;
  return "";
}

function feeRemarkForColumn(order, column) {
  const remarks = feeRowsForColumn(order, column)
    .map((fee) => textValue(fee.remark).trim())
    .filter(Boolean);
  return Array.from(new Set(remarks)).join("；");
}

function exportOrderColumnComment(order, column) {
  if (!isExportFeeItemColumn(column)) return "";
  return feeRemarkForColumn(order, column);
}

function feeHasRecordedValue(fee) {
  if (!textValue(fee?.name).trim()) return false;
  return Number(fee?.amount || 0) !== 0
    || Boolean(textValue(fee?.quantity).trim())
    || Boolean(textValue(fee?.remark).trim());
}

function feeRowsForColumn(order, column) {
  const fees = Array.isArray(order?.fees) ? order.fees : [];
  const feeItemId = textValue(column?.feeItemId).trim();
  const rawFeeName = textValue(column?.feeName || column?.label).trim();
  const feeName = exportFeeColumnComparableName(column);
  const feeCurrency = exportFeeItemCurrencyForColumn(column);
  const normalizedColumnCurrency = normalizeFeeCurrency(feeCurrency);
  if (!feeItemId && !rawFeeName && !feeName) return [];
  return fees.filter((fee) => {
    const name = textValue(fee.name).trim();
    const itemId = textValue(fee.feeItemId || fee.fee_item_id).trim();
    const currencyMatches = !feeCurrency || normalizeFeeCurrency(fee.currency) === normalizedColumnCurrency;
    if (feeItemId && itemId) return itemId === feeItemId && currencyMatches;
    return (name === rawFeeName || name === feeName) && currencyMatches;
  });
}

function feeColumnHasRecordedValue(column, orders = []) {
  return orders.some((order) => feeRowsForColumn(order, column).some(feeHasRecordedValue));
}

function isExportAmountColumn(column) {
  const key = textValue(column?.key);
  const label = textValue(column?.label);
  return key === "__hkdTotal"
    || key === "__rmbTotal"
    || key === "receivableHKD"
    || key === "receivableRMB"
    || key.startsWith("fee-item-")
    || isExportFeeItemColumn(column)
    || /金额|应收|港币|人民币|运费|税金|过磅费|停车费|登记费|等候费|装货费|卸货费/.test(label);
}

function exportOrderColumnAmount(order, column) {
  const key = textValue(column?.key);
  if (key === "__sequence") return 0;
  if (key === "__chargeNote") return 0;
  if (key === "__hkdTotal") return Number(order?.receivableHKD || 0);
  if (key === "__rmbTotal") return Number(order?.receivableRMB || 0);
  if (isExportFeeItemColumn(column)) return feeAmountForColumn(order, column);
  if (key === "receivableHKD" || key === "receivableRMB") return Number(order?.[key] || 0);
  return Number(order?.[key] || 0);
}

function exportOrderColumnValue(order, column, rowIndex = 0, options = {}) {
  const key = textValue(column?.key);
  if (key === "__sequence") return rowIndex + 1;
  if (key === "__chargeNote") return orderChargeNoteText(order);
  if (key === "__hkdTotal") return formatExportAmount(order?.receivableHKD);
  if (key === "__rmbTotal") return formatExportAmount(order?.receivableRMB);
  if (key === "loading" || key === "unloading") return shortLocationValue(order?.[key]);
  if (isExportFeeItemColumn(column)) return feeDisplayForColumn(order, column, options);
  if (key === "receivableHKD" || key === "receivableRMB") return formatExportAmount(order?.[key]);
  const value = order?.[key];
  if (value !== undefined && value !== null && value !== "" && Number(value) === 0) return "";
  return value ?? "";
}

function normalizeExportExchange(input = null) {
  const mode = textValue(input?.mode || input?.exchangeMode).trim();
  const rate = Number(input?.rate ?? input?.exchangeRate ?? 0);
  if (!["hkd-to-rmb", "rmb-to-hkd"].includes(mode) || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return { mode, rate };
}

function exportTotalAmountForColumn(orders, column, exchange = null, options = {}) {
  const key = textValue(column?.key);
  const hkdTotal = orders.reduce((sum, order) => sum + Number(order?.receivableHKD || 0), 0);
  const rmbTotal = orders.reduce((sum, order) => sum + Number(order?.receivableRMB || 0), 0);
  if (!options.rawCurrencyTotals && exchange?.mode === "hkd-to-rmb" && (key === "__rmbTotal" || key === "receivableRMB")) {
    return rmbTotal + (hkdTotal * exchange.rate);
  }
  if (!options.rawCurrencyTotals && exchange?.mode === "rmb-to-hkd" && (key === "__hkdTotal" || key === "receivableHKD")) {
    return hkdTotal + (rmbTotal / exchange.rate);
  }
  return orders.reduce((sum, order) => sum + exportOrderColumnAmount(order, column), 0);
}

function exportTotalRow(orders, columns, exchangeInput = null, options = {}) {
  const exchange = normalizeExportExchange(exchangeInput);
  const totalOrders = Array.isArray(options.totalOrders) ? options.totalOrders : orders;
  return columns.map((column, index) => {
    if (index === 0) return "合计";
    if (!isExportAmountColumn(column)) return "";
    return formatExportAmount(exportTotalAmountForColumn(totalOrders, column, exchange, options), false);
  });
}

function exportSettlementTotalSummary(orders = [], exchangeInput = null) {
  const exchange = normalizeExportExchange(exchangeInput);
  if (!exchange) return null;
  const hkd = orders.reduce((sum, order) => sum + Number(order?.receivableHKD || 0), 0);
  const rmb = orders.reduce((sum, order) => sum + Number(order?.receivableRMB || 0), 0);
  if (exchange.mode === "rmb-to-hkd") {
    return {
      currency: "港币",
      label: "总计港币合计：",
      amount: hkd + (rmb / exchange.rate),
      hkd,
      rmb,
      rate: exchange.rate,
      targetKeys: ["__hkdTotal", "receivableHKD"]
    };
  }
  return {
    currency: "人民币",
    label: "总计人民币合计：",
    amount: rmb + (hkd * exchange.rate),
    hkd,
    rmb,
    rate: exchange.rate,
    targetKeys: ["__rmbTotal", "receivableRMB"]
  };
}

function exportPreferredColumnIndex(columns = [], keys = []) {
  for (const key of keys) {
    const index = columns.findIndex((column) => textValue(column?.key) === key);
    if (index >= 0) return index;
  }
  return -1;
}

function exportSettlementTotalTargetIndex(columns = [], summary = null) {
  const keys = Array.isArray(summary?.targetKeys) ? summary.targetKeys : [];
  const index = exportPreferredColumnIndex(columns, keys);
  return index >= 0 ? index : Math.max(0, columns.length - 1);
}

function exportSettlementTotalRow(orders, columns, exchangeInput = null, options = {}) {
  const totalOrders = Array.isArray(options.totalOrders) ? options.totalOrders : orders;
  const summary = exportSettlementTotalSummary(totalOrders, exchangeInput);
  if (!summary) return null;
  const targetIndex = exportSettlementTotalTargetIndex(columns, summary);
  const labelIndex = Math.max(0, targetIndex - 1);
  const values = columns.map(() => "");
  values[labelIndex] = summary.label;
  values[targetIndex] = formatExportAmount(summary.amount, false);
  return {
    kind: "settlementTotal",
    values,
    summary,
    labelIndex,
    targetIndex
  };
}

function isCustomerStatementExportTitle(title = "") {
  return textValue(title).trim().startsWith("客户对账单");
}

function shouldIncludeSettlementTotal(title = "", exchangeInput = null) {
  return isCustomerStatementExportTitle(title) && Boolean(normalizeExportExchange(exchangeInput));
}

function exportOrderNoForSort(order = {}) {
  return textValue(order?.no || order?.orderNo || order?.order_no).trim();
}

function sortOrdersForExport(orders = []) {
  return [...orders];
}

function exportTableRowData(orders, columns, exchange = null, options = {}) {
  const sortedOrders = sortOrdersForExport(orders);
  const includeSettlementTotal = Boolean(options.includeSettlementTotal);
  const totalOrders = options.excludeChargedFromTotals
    ? sortedOrders.filter((order) => !orderIsCharged(order))
    : sortedOrders;
  const valueOptions = {
    includeAdvanceAddress: Boolean(options.includeAdvanceAddress)
  };
  const rows = sortedOrders.map((order, rowIndex) => ({
    kind: "order",
    order,
    values: columns.map((column) => exportOrderColumnValue(order, column, rowIndex, valueOptions))
  }));
  rows.push({
    kind: "total",
    values: exportTotalRow(sortedOrders, columns, exchange, {
      rawCurrencyTotals: includeSettlementTotal,
      totalOrders
    })
  });
  if (includeSettlementTotal) {
    const settlementRow = exportSettlementTotalRow(sortedOrders, columns, exchange, { totalOrders });
    if (settlementRow) rows.push(settlementRow);
  }
  return { sortedOrders, totalOrders, rows };
}

function exportTableRows(orders, columns, exchange = null, options = {}) {
  return exportTableRowData(orders, columns, exchange, options).rows.map((row) => row.values);
}

function exportFilenamePart(value, fallback = "未填写") {
  return textValue(value || fallback)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .trim() || fallback;
}

function exportOrderDailySequence(order) {
  const match = textValue(order?.no).match(/(\d+)$/);
  if (!match) return "01";
  return String(Number(match[1].slice(-2)) || 1).padStart(2, "0");
}

function orderExportFilename(orders, extension) {
  const first = orders[0] || {};
  const customer = exportFilenamePart(first.customer || "客户");
  const date = exportFilenamePart(first.date || todayInputValue()).replaceAll("-", "");
  const sequence = exportOrderDailySequence(first);
  return `${customer}_${date}${sequence}.${extension}`;
}

async function exportTemplateById(templateId) {
  const id = Number(templateId || 0);
  if (!id) return null;
  const row = await db.prepare("SELECT * FROM templates WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row?.content) return null;
  try {
    const content = JSON.parse(row.content);
    return content?.type === "visual-export-template" ? content : null;
  } catch {
    return null;
  }
}

async function exportTemplateMetaById(templateId) {
  const id = Number(templateId || 0);
  if (!id) return null;
  return db.prepare("SELECT id, name, content FROM templates WHERE id = ? AND deleted_at IS NULL").get(id);
}

function isKenfaExportTemplatePayload(value = null) {
  if (!value || typeof value !== "object") return false;
  return value.type === "kenfa-export-template" || value.exportKind === "kenfa";
}

function exportColumnsFromTemplate(template = null) {
  const normalized = normalizeExportTemplate(template);
  const columns = normalized?.columns?.length
    ? normalized.columns
    : ORDER_EXPORT_COLUMNS.map(([label, key, width]) => ({ label, key, width }));
  const withoutSequenceColumn = columns.filter((column) =>
    column.key !== ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN.key
    && !ORDER_EXPORT_REMOVED_COLUMN_KEYS.has(String(column.key || ""))
  );
  const visibleColumns = withoutSequenceColumn.filter((column) => column.visible !== false);
  const bodyColumns = visibleColumns.filter((column) => !ORDER_EXPORT_SYSTEM_TOTAL_COLUMN_KEYS.has(column.key));
  const totalColumns = ORDER_EXPORT_SYSTEM_TOTAL_COLUMNS.map((systemColumn) => ({
    ...systemColumn,
    ...(visibleColumns.find((column) => column.key === systemColumn.key) || {})
  }));
  return [{ ...ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN }, ...bodyColumns, ...totalColumns];
}

function normalizeFeeCurrency(value = "") {
  const text = textValue(value).trim().toUpperCase();
  if (text === "人民币" || text === "RMB") return "RMB";
  return "HKD";
}

function currencyDisplay(value = "") {
  return normalizeFeeCurrency(value) === "RMB" ? "RMB" : "HKD";
}

function currencyNameDisplay(value = "") {
  return normalizeFeeCurrency(value) === "RMB" ? "人民币" : "港币";
}

function exportColumnCurrencyLabel(column = {}) {
  const key = textValue(column.key);
  if (key === "__hkdTotal" || key === "receivableHKD") return "HKD";
  if (key === "__rmbTotal" || key === "receivableRMB") return "RMB";
  if (key.startsWith("fee-item-") || column.feeItemId || column.feeName) {
    const feeCurrency = exportFeeItemCurrencyForColumn(column);
    return feeCurrency ? currencyDisplay(feeCurrency) : "";
  }
  return "";
}

function exportColumnBaseLabel(column = {}) {
  const label = textValue(column.label);
  const currency = exportColumnCurrencyLabel(column);
  if (!currency) return label;
  const normalizedCurrency = normalizeFeeCurrency(currency);
  const displayCurrency = currencyNameDisplay(currency);
  return label
    .replace(new RegExp(`\\s*(?:${currency}|${normalizedCurrency}|${displayCurrency})$`, "i"), "")
    .trim() || label;
}

function exportColumnHeaderText(column = {}) {
  const currency = exportColumnCurrencyLabel(column);
  return currency ? `${exportColumnBaseLabel(column)}\n${currency}` : exportColumnBaseLabel(column);
}

function exportColumnHeaderHtml(column = {}) {
  const currency = exportColumnCurrencyLabel(column);
  const label = htmlEscape(exportColumnBaseLabel(column));
  if (!currency) return label;
  return `<span class="table-header-label">${label}</span><span class="table-header-currency">${htmlEscape(currency)}</span>`;
}

function exportColumnHeaderBold(column = {}, template = null) {
  if (column.headerBold === true) return true;
  if (column.headerBold === false) return false;
  return template?.tableHeaderBold !== false;
}

function pdfTextWithWeight(doc, text, x, y, options = {}, bold = false) {
  doc.text(text, x, y, options);
  if (bold) doc.text(text, x + 0.18, y, options);
}

function dynamicExportFeeColumns(orders = [], existingColumns = []) {
  const existingFeeKeys = new Set(existingColumns
    .filter(isExportFeeItemColumn)
    .map((column) => `${textValue(column.feeName || column.label).trim()}|${normalizeFeeCurrency(exportFeeItemCurrencyForColumn(column))}`)
    .filter((key) => !key.startsWith("|")));
  const feeColumns = [];
  const seen = new Set();
  orders.forEach((order) => {
    (Array.isArray(order?.fees) ? order.fees : []).forEach((fee) => {
      const name = textValue(fee.name).trim();
      const currency = normalizeFeeCurrency(fee.currency);
      if (!feeHasRecordedValue(fee)) return;
      const key = `${name}|${currency}`;
      if (existingFeeKeys.has(key)) return;
      if (seen.has(key)) return;
      seen.add(key);
      feeColumns.push({
        key: `fee-item-dynamic-${feeColumns.length + 1}`,
        label: name,
        feeName: name,
        feeCurrency: currency,
        width: Math.max(76, Math.min(140, stringDisplayWidth(`${name} ${currency}`) * 8))
      });
    });
  });
  return feeColumns;
}

function exportFeeColumnName(column = {}) {
  return textValue(column.feeName || column.label).trim();
}

function exportFeeColumnKey(column = {}) {
  return `${exportFeeColumnName(column)}|${normalizeFeeCurrency(exportFeeItemCurrencyForColumn(column))}`;
}

function mergeExportColumnsByTemplateOrder(templateColumns = [], includedColumns = [], dynamicColumns = []) {
  const includedSet = new Set(includedColumns);
  const usedDynamic = new Set();
  const result = [];
  templateColumns.forEach((column) => {
    if (includedSet.has(column)) result.push(column);
    if (!isExportFeeItemColumn(column)) return;
    const templateName = exportFeeColumnName(column);
    dynamicColumns.forEach((dynamicColumn) => {
      if (usedDynamic.has(dynamicColumn)) return;
      if (exportFeeColumnName(dynamicColumn) !== templateName) return;
      result.push(dynamicColumn);
      usedDynamic.add(dynamicColumn);
    });
  });
  dynamicColumns.forEach((column) => {
    if (!usedDynamic.has(column)) result.push(column);
  });
  return result;
}

function ordersHaveOperatingUnit(orders = []) {
  return orders.some((order) => textValue(order?.operatingUnit || order?.operating_unit).trim());
}

function insertOperatingUnitExportColumn(columns = []) {
  if (columns.some((column) => textValue(column?.key) === ORDER_EXPORT_OPERATING_UNIT_COLUMN.key)) return columns;
  const nextColumns = [...columns];
  const customerIndex = nextColumns.findIndex((column) => textValue(column?.key) === "customer");
  nextColumns.splice(customerIndex >= 0 ? customerIndex + 1 : Math.min(4, nextColumns.length), 0, { ...ORDER_EXPORT_OPERATING_UNIT_COLUMN });
  return nextColumns;
}

function exportColumnsForOrders(templatePayload = null, orders = [], options = {}) {
  const template = normalizeExportTemplate(templatePayload);
  const columns = exportColumnsFromTemplate(templatePayload);
  const sequenceColumn = columns.find((column) => column.key === ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN.key);
  const templateBodyColumns = columns.filter((column) =>
    column.key !== ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN.key
    && !ORDER_EXPORT_SYSTEM_TOTAL_COLUMN_KEYS.has(column.key)
  );
  const bodyColumns = templateBodyColumns.filter((column) =>
    column.key !== ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN.key
    && (!isExportFeeItemColumn(column) || feeColumnHasRecordedValue(column, orders))
  );
  const totalColumns = ORDER_EXPORT_SYSTEM_TOTAL_COLUMNS.map((systemColumn) => ({
    ...systemColumn,
    ...(columns.find((column) => column.key === systemColumn.key) || {})
  }));
  const dynamicColumns = dynamicExportFeeColumns(orders, bodyColumns);
  const chargeNoteColumns = options.includeChargeNoteColumn && orders.some(orderIsCharged)
    ? [{ ...ORDER_EXPORT_CHARGE_NOTE_COLUMN }]
    : [];
  const mergedBodyColumns = mergeExportColumnsByTemplateOrder(
    templateBodyColumns,
    bodyColumns,
    dynamicColumns
  );
  const exportBodyColumns = options.includeOperatingUnitColumn && ordersHaveOperatingUnit(orders)
    ? insertOperatingUnitExportColumn(mergedBodyColumns)
    : mergedBodyColumns;
  return [
    sequenceColumn || { ...ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN },
    ...exportBodyColumns,
    ...totalColumns,
    ...chargeNoteColumns
  ].map((column) => ({
    ...column,
    width: exportColumnAutoWidth(column, orders, { fluid: template?.orientation === "fluid" })
  }));
}

function exportTemplateTextRows(templatePayload = null, title = "订单导出") {
  const template = normalizeExportTemplate(templatePayload);
  const context = {
    title,
    date: todayInputValue(),
    user: "高级管理员",
    page: 1,
    pages: 1
  };
  const headerItems = template
    ? (
      template.headerTextItems.length
        ? template.headerTextItems
        : [{ text: template.header || "{{title}}\n日期：{{date}}" }]
    )
    : [{ text: title }, { text: `导出时间：${todayInputValue()}` }];
  const footerItems = exportTemplateFooterItems(template);
  return {
    headerRows: headerItems
      .map((item) => templateText(item.text, context))
      .filter(Boolean)
      .flatMap((text) => text.split(/\r?\n/).filter(Boolean)),
    footerRows: footerItems
      .map((item) => templateText(item.text, context))
      .filter(Boolean)
      .flatMap((text) => text.split(/\r?\n/).filter(Boolean))
  };
}

function renderOrdersCsv(orders, title = "订单导出", templatePayload = null, exchange = null) {
  const isCustomerStatement = isCustomerStatementExportTitle(title);
  const columns = exportColumnsForOrders(templatePayload, orders, {
    includeChargeNoteColumn: isCustomerStatement,
    includeOperatingUnitColumn: isCustomerStatement
  });
  const headers = columns.map(exportColumnHeaderText);
  const rows = exportTableRows(orders, columns, exchange, {
    includeSettlementTotal: shouldIncludeSettlementTotal(title, exchange),
    includeAdvanceAddress: isCustomerStatement,
    excludeChargedFromTotals: isCustomerStatement
  });
  const { headerRows, footerRows } = exportTemplateTextRows(templatePayload, title);
  const csvBodyRows = [
    ...headerRows.map((text) => [text]),
    ...(headerRows.length ? [[]] : []),
    headers,
    ...rows,
    ...(footerRows.length ? [[], ...footerRows.map((text) => [text])] : [])
  ];
  return csvRows(csvBodyRows[0] || [], csvBodyRows.slice(1));
}

function stringDisplayWidth(value) {
  return Array.from(textValue(value)).reduce((sum, char) => {
    return sum + (/[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1);
  }, 0);
}

function cellDisplayWidth(value) {
  const lines = textValue(value).split(/\r?\n/);
  return Math.max(...lines.map(stringDisplayWidth), 0);
}

function exportCellLineCount(value, columnWidth = 76) {
  const usableWidth = Math.max(1, Number(columnWidth || 76) - 10);
  const maxCharsPerLine = Math.max(1, Math.floor(usableWidth / 6.5));
  const explicitLines = textValue(value).split(/\r?\n/);
  const estimated = explicitLines.reduce((sum, line) => {
    return sum + Math.max(1, Math.ceil(stringDisplayWidth(line) / maxCharsPerLine));
  }, 0);
  return Math.min(10, Math.max(1, estimated));
}

function isExportFeeItemColumn(column = {}) {
  const key = textValue(column.key);
  return key.startsWith("fee-item-") || column.feeItemId || column.feeName;
}

function exportColumnMinimumWidth(column = {}) {
  const key = textValue(column.key);
  if (key === ORDER_EXPORT_CHARGE_NOTE_COLUMN.key) return 88;
  const isFeeColumn = isExportFeeItemColumn(column);
  const widthUnits = Math.max(
    stringDisplayWidth(exportColumnBaseLabel(column)),
    stringDisplayWidth(exportColumnCurrencyLabel(column))
  );
  const baseWidth = widthUnits * 5.2 + 16;
  return Math.max(isFeeColumn ? 46 : 34, Math.min(isFeeColumn ? 90 : 120, baseWidth));
}

function exportColumnMaxWidth(column = {}) {
  const key = textValue(column.key);
  if (key === ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN.key) return 42;
  if (key === ORDER_EXPORT_CHARGE_NOTE_COLUMN.key) return 138;
  if (key === "date") return 72;
  if (["direction", "currency", "tonnage"].includes(key)) return 50;
  if (["quantity", "weight", "status"].includes(key)) return 68;
  if (["plate", "driver", "hkDriver", "mainlandDriver"].includes(key)) return 82;
  if (["dispatchNo", "no", "sixSheetNo", "tripNo"].includes(key)) return 98;
  if (["customer", "supplier", "operatingUnit"].includes(key)) return 138;
  if (["loading", "unloading"].includes(key)) return 132;
  if (key === "__hkdTotal" || key === "__rmbTotal" || key === "receivableHKD" || key === "receivableRMB") return 76;
  if (exportLocationFeeType(column)) return 150;
  if (isExportFeeItemColumn(column)) return 112;
  return 118;
}

function exportColumnFluidMaxWidth(column = {}) {
  const key = textValue(column.key);
  if (key === ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN.key) return 42;
  if (key === ORDER_EXPORT_CHARGE_NOTE_COLUMN.key) return 180;
  if (["direction", "currency", "tonnage"].includes(key)) return 56;
  if (key === "date") return 76;
  if (key === "customer" || key === "supplier" || key === "operatingUnit") return 240;
  if (key === "loading" || key === "unloading") return 260;
  if (exportLocationFeeType(column)) return 240;
  if (isExportFeeItemColumn(column)) return 180;
  return 180;
}

function exportColumnAutoWidth(column = {}, orders = [], options = {}) {
  const sidePadding = options.fluid ? 14 : 10;
  const headerWidth = exportColumnMinimumWidth(column);
  const valueWidth = orders.reduce((max, order, index) => {
    return Math.max(max, cellDisplayWidth(exportOrderColumnValue(order, column, index)));
  }, 0);
  const contentWidth = valueWidth ? valueWidth * (options.fluid ? 6.5 : 4.2) + 18 + sidePadding : 0;
  return Math.round(Math.max(
    headerWidth + sidePadding,
    Math.min(options.fluid ? exportColumnFluidMaxWidth(column) : exportColumnMaxWidth(column), contentWidth || headerWidth)
  ));
}

function excelArgb(value, fallback = "#17233c") {
  return `FF${validHexColor(value, fallback).slice(1).toUpperCase()}`;
}

function excelAlignment(align = "left") {
  return ["left", "center", "right"].includes(align) ? align : "left";
}

function excelColumnWidthForExport(column = {}, headerValue = "", rowValues = [], template = null) {
  const tableFontSize = Number(template?.tableFontSize || 8);
  const bodyFontSize = Number(column.fontSize || tableFontSize);
  const fontScale = Math.max(0.75, bodyFontSize / 11);
  const headerScale = Math.max(0.75, tableFontSize / 11);
  const headerWidth = cellDisplayWidth(headerValue) * headerScale;
  const bodyWidth = rowValues.reduce((max, value) => {
    return Math.max(max, cellDisplayWidth(value) * fontScale);
  }, 0);
  const maxWidth = template?.orientation === "fluid" ? 72 : 46;
  return Math.max(6, Math.min(maxWidth, Math.ceil(Math.max(headerWidth, bodyWidth) + 2)));
}

function excelCellLineCount(value, excelColumnWidth = 12) {
  const width = Math.max(4, Number(excelColumnWidth || 12));
  const maxCharsPerLine = Math.max(1, Math.floor(width * 1.7));
  return textValue(value).split(/\r?\n/).reduce((sum, line) => {
    return sum + Math.max(1, Math.ceil(stringDisplayWidth(line) / maxCharsPerLine));
  }, 0);
}

function excelRowHeightForText(value, fontSize = 10, excelColumnWidth = 12, minHeight = 18) {
  const lines = excelCellLineCount(value, excelColumnWidth);
  return Math.min(260, Math.max(minHeight, Math.ceil(lines * Number(fontSize || 10) * 1.35 + 8)));
}

function excelSingleLineValue(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\s*[\r\n]+\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

function excelColumnLetter(columnNumber = 1) {
  let n = Math.max(1, Number(columnNumber || 1));
  let text = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    text = String.fromCharCode(65 + remainder) + text;
    n = Math.floor((n - 1) / 26);
  }
  return text;
}

function exportSettlementTotalExcelFormula(summary, columns = [], totalRowNumber = 1) {
  if (!summary?.rate) return "";
  const hkdIndex = exportPreferredColumnIndex(columns, ["__hkdTotal", "receivableHKD"]);
  const rmbIndex = exportPreferredColumnIndex(columns, ["__rmbTotal", "receivableRMB"]);
  if (hkdIndex < 0 || rmbIndex < 0) return "";
  const hkdCell = `${excelColumnLetter(hkdIndex + 1)}${totalRowNumber}`;
  const rmbCell = `${excelColumnLetter(rmbIndex + 1)}${totalRowNumber}`;
  const rate = Number(summary.rate || 0);
  if (!Number.isFinite(rate) || rate <= 0) return "";
  return summary.currency === "港币"
    ? `${hkdCell}+${rmbCell}/${rate}`
    : `${rmbCell}+${hkdCell}*${rate}`;
}

function applyExcelTemplateLogo(workbook, worksheet, template, headerBlockRows, columnWidths = []) {
  const image = template?.logo ? dataUrlImage(template.logo) : null;
  if (!image) return;
  try {
    const imageId = workbook.addImage(image);
    const logoWidth = Math.max(36, Math.min(180, Number(template.logoWidth || 92)));
    const logoHeight = Math.max(24, Math.min(120, Number(template.logoHeight || 56)));
    const logoX = Math.max(0, Number(template.logoX || 0));
    const logoY = Math.max(0, Number(template.logoY || 0));
    worksheet.addImage(imageId, {
      tl: { col: logoX / 72, row: logoY / 20 },
      ext: { width: logoWidth, height: logoHeight },
      editAs: "oneCell"
    });
    const firstLogoRow = Math.max(1, Math.min(headerBlockRows, 1 + Math.floor(logoY / 20)));
    const row = worksheet.getRow(firstLogoRow);
    row.height = Math.max(Number(row.height || 0), Math.ceil(logoHeight * 0.75) + 6);
    if (columnWidths.length) {
      const firstLogoColumn = Math.max(1, Math.min(columnWidths.length, 1 + Math.floor(logoX / 72)));
      const currentWidth = worksheet.getColumn(firstLogoColumn).width || columnWidths[firstLogoColumn - 1] || 10;
      worksheet.getColumn(firstLogoColumn).width = Math.max(currentWidth, Math.ceil(logoWidth / 7));
    }
  } catch {
    // Ignore unsupported image payloads so data export still succeeds.
  }
}

function statementReceiptImageExtension(file = {}) {
  const mime = normalizeMime(file.mime || "");
  const filename = String(file.filename || "").toLowerCase();
  if (mime === "image/png" || filename.endsWith(".png")) return "png";
  if (mime === "image/jpeg" || mime === "image/pjpeg" || /\.(jpe?g)$/i.test(filename)) return "jpeg";
  return "";
}

let receiptSharpPromise = null;

function loadReceiptSharp() {
  if (!receiptSharpPromise) {
    receiptSharpPromise = import("sharp")
      .then((module) => module.default || module)
      .catch(() => null);
  }
  return receiptSharpPromise;
}

async function trimReceiptImageBuffer(buffer, extension = "") {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const normalizedExtension = String(extension || "").toLowerCase();
  if (!bytes.length || !["png", "jpeg"].includes(normalizedExtension)) return bytes;
  const sharp = await loadReceiptSharp();
  if (!sharp) return bytes;
  try {
    const image = sharp(bytes, { failOn: "none" }).rotate();
    const { data } = await image.trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    return data?.length ? data : bytes;
  } catch {
    return bytes;
  }
}

function statementReceiptImageLabel(file = {}) {
  const fee = file.fee && typeof file.fee === "object" ? file.fee : null;
  if (fee?.name) {
    const name = userTextValue(fee.name);
    const address = normalizeOrderFeeCategory(fee.category) === "代垫"
      ? statementReceiptAddressSummary(fee.advanceAddress || fee.advance_address)
      : "";
    return address ? `${name}：${address}` : name;
  }
  const category = String(file.category || "").trim();
  if (category.startsWith("收费项目-")) {
    const name = category.replace(/^收费项目-/, "").trim();
    if (name) return name;
  }
  return "订单附件";
}

function statementReceiptCategoryFeeName(category = "") {
  const text = String(category || "").trim();
  if (!text.startsWith("收费项目-")) return "";
  return text.replace(/^收费项目-/, "").trim();
}

function statementReceiptCategoryClientKey(category = "") {
  const text = String(category || "").trim();
  if (!text.startsWith("收费项目行-")) return "";
  return text.replace(/^收费项目行-/, "").trim();
}

function truncateDisplayText(value = "", maxWidth = 28) {
  const text = userTextValue(value);
  if (!text || stringDisplayWidth(text) <= maxWidth) return text;
  let output = "";
  let width = 0;
  const limit = Math.max(1, Number(maxWidth || 1) - 1);
  for (const char of Array.from(text)) {
    const charWidth = stringDisplayWidth(char);
    if (width + charWidth > limit) break;
    output += char;
    width += charWidth;
  }
  return `${output}…`;
}

function statementReceiptAddressSummary(value = "") {
  const text = userTextValue(value)
    .replace(/^(发生)?地址[:：\s]*/u, "")
    .trim();
  return truncateDisplayText(text, 20);
}

function statementImageDimensions(buffer, extension = "") {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!bytes.length) return null;
  if (extension === "png" && bytes.length >= 24 && bytes.readUInt32BE(12) === 0x49484452) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (extension === "jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const size = bytes.readUInt16BE(offset + 2);
      if (size < 2) break;
      if (
        marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3
        || marker === 0xc5 || marker === 0xc6 || marker === 0xc7
        || marker === 0xc9 || marker === 0xca || marker === 0xcb
        || marker === 0xcd || marker === 0xce || marker === 0xcf
      ) {
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7)
        };
      }
      offset += 2 + size;
    }
  }
  return null;
}

function fitImageBox(imageWidth, imageHeight, maxWidth = 160, maxHeight = 140, options = {}) {
  const width = Math.max(1, Number(imageWidth || 1));
  const height = Math.max(1, Number(imageHeight || 1));
  const maxScale = options.allowUpscale ? Math.max(1, Number(options.maxScale || 1.8)) : 1;
  const ratio = Math.min(maxWidth / width, maxHeight / height, maxScale);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio)
  };
}

function excelColumnWidthToPixels(width = 10) {
  return Math.max(1, Math.floor(Number(width || 10) * 7 + 5));
}

function imagePixelHeightToExcelRowHeight(pixelHeight = 1, padding = 16) {
  return Math.ceil(Math.max(1, Number(pixelHeight || 1)) * 0.75 + padding);
}

function excelRowHeightToPixels(rowHeight = 22) {
  return Math.max(1, Number(rowHeight || 22) / 0.75);
}

function statementReceiptDateLabel(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return text || "未填写日期";
  return `${Number(match[2])}月${Number(match[3])}号`;
}

async function loadOrderReceiptImageRows(orders = []) {
  const orderNos = orders.map((order) => String(order.no || "").trim()).filter(Boolean);
  if (!orderNos.length) return [];
  const placeholders = orderNos.map(() => "?").join(",");
  const orderMeta = new Map(orders.map((order) => [
    String(order.no || "").trim(),
    {
      no: String(order.no || "").trim(),
      date: String(order.date || "").trim(),
      customer: String(order.customer || "").trim()
    }
  ]));
  const feeRows = await db.prepare(`
    SELECT order_no, client_key, category, name, advance_address
    FROM order_fees
    WHERE order_no IN (${placeholders})
    ORDER BY order_no ASC, id ASC
  `).all(...orderNos);
  const feesByClientKey = new Map();
  const feesByLegacyName = new Map();
  feeRows.forEach((row) => {
    const orderNo = String(row.order_no || "").trim();
    const name = userTextValue(row.name);
    const clientKey = String(row.client_key || "").trim();
    const fee = {
      clientKey,
      category: normalizeOrderFeeCategory(row.category),
      name,
      advanceAddress: userTextValue(row.advance_address)
    };
    if (orderNo && clientKey) feesByClientKey.set(`${orderNo}::${clientKey}`, fee);
    if (orderNo && name && !feesByLegacyName.has(`${orderNo}::${name}`)) {
      feesByLegacyName.set(`${orderNo}::${name}`, fee);
    }
  });
  const rows = await db.prepare(`
    SELECT *
    FROM files
    WHERE deleted_at IS NULL
      AND entity_type = 'order'
      AND entity_id IN (${placeholders})
    ORDER BY entity_id ASC, created_at ASC, id ASC
  `).all(...orderNos);
  return rows
    .map((row) => {
      const orderNo = String(row.entity_id || "").trim();
      const clientKey = statementReceiptCategoryClientKey(row.category);
      const legacyFeeName = statementReceiptCategoryFeeName(row.category);
      const fee = (clientKey ? feesByClientKey.get(`${orderNo}::${clientKey}`) : null)
        || (legacyFeeName ? feesByLegacyName.get(`${orderNo}::${legacyFeeName}`) : null)
        || null;
      return {
        ...row,
        extension: statementReceiptImageExtension(row),
        order: orderMeta.get(orderNo) || null,
        fee
      };
    })
    .filter((row) => row.extension && row.order);
}

async function fetchReceiptImageBuffer(file = {}) {
  if (file.storage_provider !== "oss" || !file.object_key || !ossClient) return null;
  const url = signedOssUrl(file, "inline");
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) return null;
    return trimReceiptImageBuffer(buffer, file.extension);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function addStatementReceiptSheet(workbook, orders = []) {
  const receiptRows = await loadOrderReceiptImageRows(orders);
  const worksheet = workbook.addWorksheet("票据");
  const receiptColumnWidth = 46;
  const receiptColumnPixelWidth = excelColumnWidthToPixels(receiptColumnWidth);
  const receiptImageCellPadding = 1;
  const receiptColumnImageWidth = Math.max(320, receiptColumnPixelWidth - receiptImageCellPadding * 2);
  const receiptImageMaxHeight = 560;
  worksheet.properties.defaultRowHeight = 22;
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 }
  };
  worksheet.columns = [
    { width: receiptColumnWidth },
    { width: receiptColumnWidth },
    { width: receiptColumnWidth }
  ];
  const border = { style: "thin", color: { argb: excelArgb("#d9e3f2") } };
  let cursorRow = 1;
  if (!receiptRows.length) {
    worksheet.mergeCells(cursorRow, 1, cursorRow, 3);
    const emptyCell = worksheet.getCell(cursorRow, 1);
    emptyCell.value = "未找到可导出的票据图片";
    emptyCell.font = { name: "Microsoft YaHei", size: 12, bold: true, color: { argb: excelArgb("#b91c1c") } };
    emptyCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelArgb("#fef2f2") } };
    emptyCell.alignment = { vertical: "middle", horizontal: "center" };
    emptyCell.border = { top: border, left: border, bottom: border, right: border };
    worksheet.getRow(cursorRow).height = 24;
    return;
  }
  const grouped = new Map();
  receiptRows.forEach((file) => {
    const date = file.order.date || "未填写日期";
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(file);
  });
  const sortedGroups = Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
  for (const [date, files] of sortedGroups) {
    if (files.length > worksheet.columnCount) {
      for (let index = worksheet.columnCount + 1; index <= files.length; index += 1) {
        worksheet.getColumn(index).width = receiptColumnWidth;
      }
    }
    const lastColumn = Math.max(1, files.length);
    worksheet.mergeCells(cursorRow, 1, cursorRow, lastColumn);
    const dateCell = worksheet.getCell(cursorRow, 1);
    dateCell.value = statementReceiptDateLabel(date);
    dateCell.font = { name: "Microsoft YaHei", size: 13, bold: true, color: { argb: excelArgb("#17233c") } };
    dateCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelArgb("#f1f5f9") } };
    dateCell.alignment = { vertical: "middle", horizontal: "left" };
    dateCell.border = { top: border, left: border, bottom: border, right: border };
    worksheet.getRow(cursorRow).height = 24;
    cursorRow += 1;

    const titleRowNumber = cursorRow;
    const imageRowNumber = cursorRow + 1;
    const rowHeights = [];
    const titleHeights = [];
    files.forEach((file, itemIndex) => {
      const startColumn = 1 + itemIndex;
      const titleCell = worksheet.getCell(titleRowNumber, startColumn);
      const label = statementReceiptImageLabel(file);
      titleCell.value = label;
      titleCell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: excelArgb("#334155") } };
      titleCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelArgb("#f8fafc") } };
      titleCell.border = { top: border, left: border, bottom: border, right: border };
      titleHeights.push(Math.min(48, excelRowHeightForText(label, 10, receiptColumnWidth, 26)));
    });
    for (let itemIndex = 0; itemIndex < files.length; itemIndex += 1) {
      const file = files[itemIndex];
      const startColumn = 1 + itemIndex;
      const imageCell = worksheet.getCell(imageRowNumber, startColumn);
      imageCell.alignment = { vertical: "middle", horizontal: "center" };
      imageCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelArgb("#ffffff") } };
      imageCell.border = { top: border, left: border, bottom: border, right: border };
      const imageBuffer = await fetchReceiptImageBuffer(file);
      if (!imageBuffer) {
        imageCell.value = "图片读取失败";
        imageCell.font = { name: "Microsoft YaHei", size: 10, color: { argb: excelArgb("#dc2626") } };
        imageCell.alignment = { vertical: "middle", horizontal: "center" };
        imageCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelArgb("#fff1f2") } };
        imageCell.border = { top: border, left: border, bottom: border, right: border };
        rowHeights.push(72);
        continue;
      }
      const dims = statementImageDimensions(imageBuffer, file.extension) || { width: 4, height: 3 };
      const box = fitImageBox(dims.width, dims.height, receiptColumnImageWidth, receiptImageMaxHeight, { allowUpscale: true, maxScale: 8 });
      const imageId = workbook.addImage({
        buffer: imageBuffer,
        extension: file.extension
      });
      rowHeights.push(imagePixelHeightToExcelRowHeight(box.height, 2));
      file._receiptImage = { imageId, box, startColumn };
    }
    worksheet.getRow(titleRowNumber).height = Math.max(26, ...titleHeights);
    const imageRowHeight = Math.max(120, ...rowHeights);
    worksheet.getRow(imageRowNumber).height = imageRowHeight;
    const imageRowPixelHeight = excelRowHeightToPixels(imageRowHeight);
    for (const file of files) {
      if (!file._receiptImage) continue;
      const { imageId, box, startColumn } = file._receiptImage;
      const columnPixelWidth = excelColumnWidthToPixels(worksheet.getColumn(startColumn).width || receiptColumnWidth);
      const horizontalOffset = Math.max(receiptImageCellPadding, (columnPixelWidth - box.width) / 2);
      const verticalOffset = Math.max(receiptImageCellPadding, (imageRowPixelHeight - box.height) / 2);
      worksheet.addImage(imageId, {
        tl: {
          col: startColumn - 1 + horizontalOffset / columnPixelWidth,
          row: imageRowNumber - 1 + verticalOffset / imageRowPixelHeight
        },
        ext: { width: box.width, height: box.height },
        editAs: "oneCell"
      });
      delete file._receiptImage;
    }
    cursorRow += 2;
    cursorRow += 1;
  }
}

function pdfTextHeight(doc, value, width, fontSize, options = {}) {
  doc.fontSize(Number(fontSize || 8));
  return doc.heightOfString(textValue(value), {
    width: Math.max(1, Number(width || 1)),
    lineGap: Number(options.lineGap ?? 1)
  });
}

function pdfRowHeightForValues(doc, values = [], columns = [], template = null) {
  const baseHeight = template?.orientation === "fluid"
    ? Math.max(22, Number(template?.tableFontSize || 8) * 1.35 + 12)
    : Math.max(28, Number(template?.tableFontSize || 8) * 2.35 + 12);
  const contentHeight = values.reduce((max, value, index) => {
    const column = columns[index] || {};
    const height = pdfTextHeight(doc, value, Number(column.width || 0) - 6, column.fontSize || template?.tableFontSize || 8, { lineGap: 1 });
    return Math.max(max, height + 12);
  }, baseHeight);
  return Math.min(180, Math.max(baseHeight, Math.ceil(contentHeight)));
}

function pdfTemplatePageHeight(template = null) {
  return template?.orientation === "portrait" ? 842 : 595;
}

function pdfFooterItemY(item = {}, template = null) {
  const rawY = Number(item.y || 0);
  const footerHeight = Math.max(28, Math.min(140, Number(template?.footerHeight || 70)));
  const pageHeight = pdfTemplatePageHeight(template);
  if (!Number.isFinite(rawY) || rawY < 0) return 0;
  if (rawY > pageHeight * 1.5) return 0;
  if (rawY >= pageHeight - footerHeight) return Math.max(0, rawY - (pageHeight - footerHeight));
  return Math.max(0, Math.min(rawY, footerHeight - 4));
}

async function renderOrdersXlsxBuffer(orders, title = "订单导出", templatePayload = null, exchange = null, options = {}) {
  const template = normalizeExportTemplate(templatePayload);
  const isCustomerStatement = isCustomerStatementExportTitle(title);
  const columns = exportColumnsForOrders(templatePayload, orders, {
    includeChargeNoteColumn: isCustomerStatement,
    includeOperatingUnitColumn: isCustomerStatement
  });
  const headers = columns.map(exportColumnHeaderText);
  const includeSettlementTotal = shouldIncludeSettlementTotal(title, exchange);
  const tableData = exportTableRowData(orders, columns, exchange, {
    includeSettlementTotal,
    includeAdvanceAddress: isCustomerStatement,
    excludeChargedFromTotals: isCustomerStatement
  });
  const rows = tableData.rows.map((row) => row.values);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "汉业管理系统";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("订单导出");
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: template?.orientation === "portrait" ? "portrait" : "landscape",
    fitToPage: template?.orientation !== "fluid",
    fitToWidth: template?.orientation === "fluid" ? 0 : 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.3,
      right: 0.3,
      top: 0.35,
      bottom: 0.35,
      header: 0.1,
      footer: 0.1
    }
  };
  const context = {
    title,
    date: todayInputValue(),
    user: "高级管理员",
    page: 1,
    pages: 1
  };

  const excelColumnWidths = columns.map((column, index) =>
    excelColumnWidthForExport(
      column,
      headers[index],
      rows.map((row) => row[index]),
      template
    )
  );
  const settlementTotalRow = includeSettlementTotal ? tableData.rows.find((row) => row.kind === "settlementTotal") || null : null;
  if (settlementTotalRow) {
    const settlementDisplayValue = formatExportAmount(settlementTotalRow.summary?.amount, false);
    const settlementWidth = Math.min(
      24,
      Math.max(
        excelColumnWidths[settlementTotalRow.targetIndex] || 0,
        cellDisplayWidth(settlementDisplayValue) + 4,
        16
      )
    );
    excelColumnWidths[settlementTotalRow.targetIndex] = settlementWidth;
  }
  excelColumnWidths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  const headerHeight = template?.headerHeight || 72;
  const headerBlockRows = Math.max(2, Math.ceil(headerHeight / 20));
  const mergeEndColumn = Math.max(1, columns.length);
  const headerItems = template
    ? (
      template.headerTextItems.length
        ? template.headerTextItems
        : [{ text: template.header || "{{title}}\n日期：{{date}}", color: template.headerTextColor, fontSize: template.headerFontSize, bold: true }]
    )
    : [{ text: title, fontSize: 15, bold: true }, { text: `导出时间：${todayInputValue()}    订单数：${orders.length}`, fontSize: 9, color: "#64748b" }];

  applyExcelTemplateLogo(workbook, worksheet, template, headerBlockRows, excelColumnWidths);

  headerItems.forEach((item, itemIndex) => {
    const text = templateText(item.text, context);
    if (!text) return;
    const rowNumber = Math.max(1, Math.min(headerBlockRows, 1 + Math.floor(Number(item.y ?? itemIndex * 18) / 20)));
    const columnNumber = Math.max(1, Math.min(mergeEndColumn, 1 + Math.floor(Number(item.x || 0) / 72)));
    const fontSize = Number(item.fontSize || template?.headerFontSize || 14);
    const cell = worksheet.getCell(rowNumber, columnNumber);
    cell.value = text;
    cell.font = {
      name: "Microsoft YaHei",
      size: fontSize,
      bold: Boolean(item.bold),
      color: { argb: excelArgb(item.color || template?.headerTextColor || "#17233c") }
    };
    cell.alignment = { vertical: "middle", horizontal: excelAlignment(item.align), wrapText: true };
    const mergedWidth = excelColumnWidths.slice(columnNumber - 1).reduce((sum, width) => sum + Number(width || 0), 0);
    const row = worksheet.getRow(rowNumber);
    row.height = Math.max(
      Number(row.height || 0),
      excelRowHeightForText(text, fontSize, Math.max(mergedWidth, excelColumnWidths[columnNumber - 1] || 12), 20)
    );
    if (columnNumber < mergeEndColumn) {
      try {
        worksheet.mergeCells(rowNumber, columnNumber, rowNumber, mergeEndColumn);
      } catch {
        // Multiple text boxes can intentionally share a row; keep the cell unmerged.
      }
    }
  });

  const tableStartRow = headerBlockRows + 2;
  const borderStyle = template?.tableBorderWidth === 0 ? undefined : {
    style: Number(template?.tableBorderWidth || 1) > 1 ? "medium" : "thin",
    color: { argb: excelArgb(template?.tableBorderColor || "#d9e3f2") }
  };
  const tableBorder = borderStyle
    ? { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle }
    : {};
  const headerRow = worksheet.getRow(tableStartRow);
  headerRow.values = headers;
  const tableFontSize = Number(template?.tableFontSize || 8);
  const headerRowMinHeight = Math.max(44, tableFontSize * 3.2 + 16);
  headerRow.height = headers.reduce((height, header, index) =>
    Math.max(
      height,
      excelRowHeightForText(header, tableFontSize, excelColumnWidths[index] || 12, headerRowMinHeight)
    ), headerRowMinHeight);
  headerRow.eachCell((cell, columnNumber) => {
    const column = columns[columnNumber - 1] || {};
    cell.font = {
      name: "Microsoft YaHei",
      size: tableFontSize,
      bold: exportColumnHeaderBold(column, template),
      color: { argb: excelArgb(template?.tableHeaderTextColor || "#1f2a44") }
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: excelArgb(template?.tableHeaderBgColor || "#f1f5f9") }
    };
    cell.alignment = { vertical: "middle", horizontal: excelAlignment(template?.tableAlign), wrapText: true };
    cell.border = tableBorder;
  });

  const sortedOrders = tableData.sortedOrders;
  const totalOrders = tableData.totalOrders || sortedOrders;
  const totalRowOffset = tableData.rows.findIndex((row) => row.kind === "total");
  const totalRowNumber = totalRowOffset >= 0 ? tableStartRow + 1 + totalRowOffset : 0;
  rows.forEach((rowValues, rowIndex) => {
    const rowMeta = tableData.rows[rowIndex] || {};
    const isTotalRow = rowMeta.kind === "total";
    const isSettlementTotalRow = rowMeta.kind === "settlementTotal";
    const isSummaryRow = isTotalRow || isSettlementTotalRow;
    const sourceOrder = rowMeta.kind === "order" ? rowMeta.order : null;
    const row = worksheet.getRow(tableStartRow + 1 + rowIndex);
    const excelRowValues = rowValues.map(excelSingleLineValue);
    row.values = excelRowValues;
    row.height = Math.max(isSettlementTotalRow ? 24 : 22, tableFontSize * 1.9 + 12);
    row.eachCell((cell, columnNumber) => {
      const column = columns[columnNumber - 1] || {};
      const isChargeNoteColumn = textValue(column.key) === ORDER_EXPORT_CHARGE_NOTE_COLUMN.key;
      const isChargeNoteCell = isChargeNoteColumn && !isSummaryRow && sourceOrder && orderChargeNoteText(sourceOrder);
      if (isSettlementTotalRow && columnNumber - 1 === rowMeta.targetIndex) {
        const formula = exportSettlementTotalExcelFormula(rowMeta.summary, columns, totalRowNumber);
        cell.value = formula
          ? { formula, result: Number(rowMeta.summary?.amount || 0) }
          : Number(rowMeta.summary?.amount || 0);
        cell.numFmt = "#,##0.00";
      } else if (!isSettlementTotalRow && isExportAmountColumn(column) && (isTotalRow || (!exportLocationFeeType(column) && !isExportFeeItemColumn(column)))) {
        const amount = isTotalRow
          ? exportTotalAmountForColumn(totalOrders, column, exchange, { rawCurrencyTotals: includeSettlementTotal })
          : exportOrderColumnAmount(sourceOrder, column);
        if (isTotalRow || Number(amount || 0) !== 0) {
          cell.value = Number(amount || 0);
          cell.numFmt = "#,##0";
        } else {
          cell.value = "";
        }
      }
      cell.font = {
        name: "Microsoft YaHei",
        size: Number(column.fontSize || tableFontSize),
        bold: isSummaryRow || Boolean(isChargeNoteCell) || Boolean(template?.tableBold),
        color: { argb: isChargeNoteCell ? excelArgb("#047857") : excelArgb(template?.tableTextColor || "#17233c") }
      };
      if (isTotalRow) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: excelArgb(template?.tableHeaderBgColor || "#f1f5f9") }
        };
      }
      if (isSettlementTotalRow && columnNumber - 1 === rowMeta.labelIndex) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFFF00" }
        };
      }
      if (isChargeNoteCell) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: excelArgb("#dcfce7") }
        };
      }
      const horizontal = isSettlementTotalRow
        ? (columnNumber - 1 === rowMeta.targetIndex ? "right" : "center")
        : (isChargeNoteColumn ? "center" : excelAlignment(template?.tableAlign));
      cell.alignment = { vertical: "middle", horizontal, wrapText: isChargeNoteColumn };
      if (!isSummaryRow && sourceOrder) {
        const comment = exportOrderColumnComment(sourceOrder, column);
        if (comment) {
          cell.note = comment;
        }
      }
      cell.border = tableBorder;
    });
  });

  const footerItems = exportTemplateFooterItems(template, template?.footerTextColor);
  let footerRowNumber = tableStartRow + rows.length + 2;
  footerItems.forEach((item) => {
    const lines = templateText(item.text, context).split(/\r?\n/).filter(Boolean);
    lines.forEach((line) => {
      const row = worksheet.getRow(footerRowNumber);
      const cell = row.getCell(1);
      cell.value = line;
      cell.font = {
        name: "Microsoft YaHei",
        size: Number(item.fontSize || template?.footerFontSize || 9),
        bold: Boolean(item.bold),
        color: { argb: excelArgb(item.color || template?.footerTextColor || "#64748b") }
      };
      cell.alignment = { vertical: "middle", horizontal: excelAlignment(item.align), wrapText: true };
      row.height = Math.max(
        Number(row.height || 0),
        excelRowHeightForText(line, Number(item.fontSize || template?.footerFontSize || 9), excelColumnWidths.reduce((sum, width) => sum + Number(width || 0), 0), 18)
      );
      if (mergeEndColumn > 1) worksheet.mergeCells(footerRowNumber, 1, footerRowNumber, mergeEndColumn);
      footerRowNumber += 1;
    });
  });

  const shouldIncludeReceiptSheet = Boolean(options.includeReceiptSheet) || String(title || "").startsWith("客户对账单");
  if (shouldIncludeReceiptSheet) {
    await addStatementReceiptSheet(workbook, orders);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const KENFA_LOGO_FILE_URL = new URL("./assets/kenfa-logo.png", import.meta.url);
const KENFA_LOGO_BUFFER = fs.existsSync(KENFA_LOGO_FILE_URL) ? fs.readFileSync(KENFA_LOGO_FILE_URL) : null;
const KENFA_LOGO_DATA_URL = KENFA_LOGO_BUFFER ? `data:image/png;base64,${KENFA_LOGO_BUFFER.toString("base64")}` : "";
const KENFA_COMPANY_NAME = "深圳市汉业国际货运代理有限公司";
const KENFA_COMPANY_ADDRESS = "ADD:深圳市南山区招商街道桃花园社区南海大道1115号美年国际广场4栋1205A";
const KENFA_COMPANY_CONTACT = "联系人:刘先生   TEL:0755-83007202";

function kenfaAmountToRmb(amount = 0, currency = "人民币", exchange = null) {
  const value = Number(amount || 0);
  if (normalizeFeeCurrency(currency) === "HKD" && exchange?.mode === "hkd-to-rmb" && exchange.rate) {
    return value * Number(exchange.rate || 0);
  }
  return value;
}

function kenfaOrderRmbAmount(order = {}, exchange = null) {
  const rmb = Number(order.receivableRMB || 0);
  const hkd = Number(order.receivableHKD || 0);
  if (exchange?.mode === "hkd-to-rmb" && exchange.rate) return rmb + hkd * Number(exchange.rate || 0);
  return rmb;
}

function kenfaInvoiceDate(order = {}) {
  return textValue(order.date || todayInputValue()).slice(0, 10) || todayInputValue();
}

function kenfaInvoiceNo(date = "", index = 0) {
  const compact = date.replaceAll("-", "").slice(2);
  return index > 0 ? `KF${compact}-${index + 1}` : `KF${compact}`;
}

function kenfaDestination(order = {}) {
  return shortLocationValue(order.unloading || order.loading || "");
}

function kenfaPortOfDeparture(order = {}) {
  return shortLocationValue(order.loading || order.port || "");
}

function kenfaCargoOwner(orders = []) {
  return textValue(orders[0]?.customer || "客户");
}

function groupedKenfaOrders(orders = []) {
  const groups = new Map();
  sortOrdersForExport(orders).forEach((order) => {
    const date = kenfaInvoiceDate(order);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(order);
  });
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function kenfaSetCell(cell, value, options = {}) {
  cell.value = value;
  cell.font = {
    name: options.fontName || "Arial",
    size: Number(options.size || 10),
    bold: Boolean(options.bold),
    italic: Boolean(options.italic),
    color: { argb: options.color ? excelArgb(options.color) : "FF000000" }
  };
  cell.alignment = {
    vertical: "middle",
    horizontal: options.align || "left",
    wrapText: options.wrap !== false
  };
  if (options.border !== false) {
    const border = { style: options.borderStyle || "thin", color: { argb: options.borderColor || "FF000000" } };
    cell.border = { top: border, left: border, bottom: border, right: border };
  }
  if (options.fill) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelArgb(options.fill) } };
  }
  if (options.numFmt) cell.numFmt = options.numFmt;
}

function kenfaThinBorder() {
  const border = { style: "thin", color: { argb: "FF000000" } };
  return { top: border, left: border, bottom: border, right: border };
}

function kenfaBlankMergedCell(worksheet, range, options = {}) {
  kenfaMerge(worksheet, range);
  const [start, end] = range.split(":");
  kenfaSetCell(worksheet.getCell(start), options.value ?? "", options);
  const matchStart = start.match(/^([A-Z]+)(\d+)$/);
  const matchEnd = end.match(/^([A-Z]+)(\d+)$/);
  if (!matchStart || !matchEnd) return;
  const startCol = worksheet.getColumn(matchStart[1]).number;
  const endCol = worksheet.getColumn(matchEnd[1]).number;
  const startRow = Number(matchStart[2]);
  const endRow = Number(matchEnd[2]);
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      worksheet.getCell(row, col).border = options.border === false ? undefined : kenfaThinBorder();
    }
  }
}

function kenfaAddLogo(workbook, worksheet, anchor = {}) {
  try {
    const logoBuffer = KENFA_LOGO_BUFFER;
    if (!logoBuffer) return;
    const imageId = workbook.addImage({
      buffer: logoBuffer,
      extension: "png"
    });
    worksheet.addImage(imageId, {
      tl: { col: Number(anchor.col ?? 0.4), row: Number(anchor.row ?? 0.6) },
      ext: { width: Number(anchor.width || 205), height: Number(anchor.height || 74) },
      editAs: "oneCell"
    });
  } catch (error) {
    console.warn("Kenfa logo render failed", error.message);
  }
}

function kenfaFormatDateCn(date = "") {
  const match = textValue(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return textValue(date);
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function kenfaFeeLabel(name = "") {
  const text = textValue(name).trim();
  const labels = [
    [/中港|吨车|运费/, "China Hong Kong ton fare                              中港吨车费"],
    [/香港报关|报关/, "Customs declaration in Hong Kong                                     香港报关"],
    [/无缝/, "Hong Kong seamless         香港无缝"],
    [/过磅|称重/, "Weighing fee                   过磅费"],
    [/停车/, "Factory parking fee            工厂停车费"]
  ];
  return labels.find(([pattern]) => pattern.test(text))?.[1] || text || "Service fee";
}

function kenfaDailyFeeRows(dayOrders = [], exchange = null) {
  const rows = [];
  dayOrders.forEach((order) => {
    const feeRows = Array.isArray(order.fees) ? order.fees.filter(feeHasRecordedValue) : [];
    feeRows.forEach((fee) => {
      rows.push({
        name: kenfaFeeLabel(fee.name),
        remark: fee.note || (order.no ? `Order: ${order.no}` : ""),
        amount: Number(kenfaAmountToRmb(fee.amount, fee.currency, exchange).toFixed(2))
      });
    });
    if (!feeRows.length) {
      rows.push({
        name: order.businessType || "China Hong Kong ton fare                              中港吨车费",
        remark: [order.no ? `Order: ${order.no}` : "", normalizePortText(order.port), order.direction || ""].filter(Boolean).join("  "),
        amount: Number(kenfaOrderRmbAmount(order, exchange).toFixed(2))
      });
    }
  });
  return rows.length ? rows : [{ name: "China Hong Kong ton fare                              中港吨车费", remark: "", amount: 0 }];
}

function kenfaMerge(worksheet, range) {
  try {
    worksheet.mergeCells(range);
  } catch {
    // Template-like merged cells can overlap when a future edit shifts rows; keep export alive.
  }
}

function kenfaApplyDailyLayout(worksheet) {
  [16.5, 11, 5.33, 11.16, 3.83, 11, 2.5, 7.66, 4.5, 4.16, 27.16, 24].forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
  [20, 34.5, 14.25, 15, 34.5, 45.75, 25.75, 60.75, 55.5, 42, 25.75, 42.75, 48, 30.75, 30, 41.25, 28.75, 25.75, 25.75, 23, 25.75].forEach((height, index) => {
    worksheet.getRow(index + 1).height = height;
  });
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 }
  };
}

function addKenfaDailySheet(workbook, date, dayOrders, index, exchange = null) {
  const first = dayOrders[0] || {};
  const invoiceNo = kenfaInvoiceNo(date, index);
  const worksheet = workbook.addWorksheet(String(index + 1));
  kenfaApplyDailyLayout(worksheet);
  kenfaAddLogo(workbook, worksheet, { col: 0.25, row: 0.4, width: 205, height: 74 });
  ["A1:E3", "F1:K1", "F2:K2", "F3:K4", "A4:E4"].forEach((range) => kenfaMerge(worksheet, range));
  kenfaSetCell(worksheet.getCell("F1"), KENFA_COMPANY_NAME, { bold: true, size: 14, align: "left", border: false });
  kenfaSetCell(worksheet.getCell("F2"), KENFA_COMPANY_ADDRESS, { size: 11, border: false });
  kenfaSetCell(worksheet.getCell("F3"), KENFA_COMPANY_CONTACT, { size: 11, border: false });
  kenfaSetCell(worksheet.getCell("A4"), "", { border: false });

  kenfaBlankMergedCell(worksheet, "A5:K5", { value: "INVOICE", bold: true, size: 22, align: "center" });
  kenfaBlankMergedCell(worksheet, "A6:A6", { value: "Cargo owner        货主：", bold: true, size: 11 });
  kenfaBlankMergedCell(worksheet, "B6:F6", { value: kenfaCargoOwner(dayOrders), bold: true, size: 11, align: "center" });
  kenfaBlankMergedCell(worksheet, "G6:I6", { value: "INV No.:", bold: true, size: 11, align: "right" });
  kenfaBlankMergedCell(worksheet, "J6:K6", { value: invoiceNo, color: "#ff0000", size: 11 });
  kenfaBlankMergedCell(worksheet, "B7:C7", { value: "" });
  kenfaBlankMergedCell(worksheet, "E7:G7", { value: "" });
  kenfaBlankMergedCell(worksheet, "H7:J7", { value: "运输時間:", bold: true, size: 11 });
  kenfaSetCell(worksheet.getCell("K7"), kenfaFormatDateCn(date), { size: 11 });
  kenfaSetCell(worksheet.getCell("A8"), "Port of departure            起運港：", { bold: true, size: 11 });
  kenfaBlankMergedCell(worksheet, "B8:C8", { value: kenfaPortOfDeparture(first), size: 11 });
  kenfaSetCell(worksheet.getCell("D8"), "Port of destination\n目的港：", { bold: true, size: 11 });
  kenfaBlankMergedCell(worksheet, "E8:G8", { value: kenfaDestination(first), size: 11 });
  kenfaBlankMergedCell(worksheet, "H8:J8", { value: "Delivery license plate\n交货车牌：", bold: true, size: 11 });
  kenfaSetCell(worksheet.getCell("K8"), first.plate || "", { size: 11 });
  kenfaSetCell(worksheet.getCell("A9"), "number of packages\n件數：", { bold: true, size: 11 });
  kenfaBlankMergedCell(worksheet, "B9:C9", { value: first.quantity || "", size: 11 });
  kenfaSetCell(worksheet.getCell("D9"), "number of packages\n重量(KG):", { bold: true, size: 11 });
  kenfaBlankMergedCell(worksheet, "E9:G9", { value: first.weight || "", size: 11 });
  kenfaBlankMergedCell(worksheet, "H9:J9", { value: "exchange rate\n汇率：", bold: true, size: 11 });
  kenfaSetCell(worksheet.getCell("K9"), exchange?.mode === "hkd-to-rmb" ? Number(exchange.rate || 0) : "", { size: 11 });
  kenfaSetCell(worksheet.getCell("A10"), "model of car          车型：", { bold: true, size: 11 });
  kenfaBlankMergedCell(worksheet, "B10:C10", { value: first.tonnage || first.transportMode || "", bold: true, size: 11 });
  kenfaSetCell(worksheet.getCell("D10"), "Number of plates板", { bold: true, size: 11 });
  kenfaBlankMergedCell(worksheet, "E10:G10", { value: first.quantity || "", size: 11 });
  kenfaBlankMergedCell(worksheet, "H10:J10", { value: "currency system币制", bold: true, size: 11 });
  kenfaSetCell(worksheet.getCell("K10"), "人民币/RMB", { size: 11 });

  kenfaBlankMergedCell(worksheet, "A11:B11", { value: "費用名称:", bold: true, align: "center", size: 11 });
  kenfaBlankMergedCell(worksheet, "C11:J11", { value: "备注：", bold: true, align: "center", size: 11 });
  kenfaSetCell(worksheet.getCell("K11"), "金额：", { bold: true, size: 11 });

  const firstDetailRow = 12;
  const feeRows = kenfaDailyFeeRows(dayOrders, exchange).slice(0, 12);
  feeRows.forEach((fee, rowIndex) => {
    const rowNumber = firstDetailRow + rowIndex;
    kenfaBlankMergedCell(worksheet, `A${rowNumber}:B${rowNumber}`, { value: fee.name, size: 11, align: "center" });
    kenfaBlankMergedCell(worksheet, `C${rowNumber}:J${rowNumber}`, { value: fee.remark, size: 10, align: "center" });
    kenfaSetCell(worksheet.getCell(`K${rowNumber}`), fee.amount, { size: 11, numFmt: "#,##0.00" });
    worksheet.getRow(rowNumber).height = [42.75, 48, 30.75, 30, 41.25][rowIndex] || 30;
  });

  const totalRow = firstDetailRow + Math.max(feeRows.length, 1);
  kenfaBlankMergedCell(worksheet, `A${totalRow}:J${totalRow}`, { value: "", size: 11 });
  kenfaSetCell(worksheet.getCell(`K${totalRow}`), { formula: `SUM(K${firstDetailRow}:K${totalRow - 1})` }, { size: 11, numFmt: "#,##0.00" });
  kenfaBlankMergedCell(worksheet, `I${totalRow + 1}:K${totalRow + 1}`, { value: "制表：  廖木凤", bold: true, align: "center", size: 11, border: false });
  kenfaBlankMergedCell(worksheet, `A${totalRow + 2}:C${totalRow + 2}`, { value: "備註: ", bold: true, size: 11, border: false });
  kenfaBlankMergedCell(worksheet, `A${totalRow + 3}:K${totalRow + 3}`, { value: "INVOICE如有問題,煩請於三日內與本公司經辦人聯系更改.", bold: true, size: 11, border: false });

  return {
    sheetName: worksheet.name,
    invoiceNo,
    date,
    departure: kenfaPortOfDeparture(first),
    destination: kenfaDestination(first),
    totalCell: `'${worksheet.name}'!K${totalRow}`
  };
}

async function renderKenfaStatementXlsxBuffer(orders, title = "客户对账单", exchangeInput = null) {
  const exchange = normalizeExportExchange(exchangeInput);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "汉业管理系统";
  workbook.created = new Date();
  const groups = groupedKenfaOrders(orders);
  const dailySummaries = groups.map(([date, dayOrders], index) => addKenfaDailySheet(workbook, date, dayOrders, index, exchange));
  const summary = workbook.addWorksheet("总表");
  [6.16, 12.5, 15.66, 3.5, 7.66, 18.33, 14.66, 10.66, 20.66, 9, 14.16, 9].forEach((width, index) => {
    summary.getColumn(index + 1).width = width;
  });
  [17, 15, 15, 25.5, 42, 33.75, 17.25, 49.5].forEach((height, index) => {
    summary.getRow(index + 1).height = height;
  });
  summary.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.35, bottom: 0.35, header: 0.1, footer: 0.1 }
  };
  const startDate = groups[0]?.[0] || "";
  const endDate = groups[groups.length - 1]?.[0] || "";
  const customer = kenfaCargoOwner(orders);
  kenfaAddLogo(workbook, summary, { col: 0.35, row: 0.55, width: 205, height: 74 });
  ["A1:D4", "E1:I1", "E2:I2", "E3:I3", "A5:I5", "B6:G6", "F7:I7"].forEach((range) => kenfaMerge(summary, range));
  kenfaSetCell(summary.getCell("E1"), KENFA_COMPANY_NAME, { bold: true, size: 14, border: false });
  kenfaSetCell(summary.getCell("E2"), KENFA_COMPANY_ADDRESS, { bold: true, size: 11, border: false });
  kenfaSetCell(summary.getCell("E3"), KENFA_COMPANY_CONTACT, { bold: true, size: 11, border: false });
  const titleMonth = endDate ? `${endDate.slice(0, 4)}年${Number(endDate.slice(5, 7))}月份结书` : "月份结书";
  kenfaSetCell(summary.getCell("A5"), titleMonth, { bold: true, size: 22, align: "center", border: false });
  kenfaSetCell(summary.getCell("A6"), "TO：", { bold: true, size: 12, border: false });
  kenfaSetCell(summary.getCell("B6"), customer, { bold: true, size: 11, align: "center", border: false });
  kenfaSetCell(summary.getCell("A7"), `statement No 对帐单号：KFJM${(endDate || todayInputValue()).replaceAll("-", "").slice(0, 6)}A`, { bold: true, size: 11, border: false });
  kenfaSetCell(summary.getCell("F7"), `${startDate || "全部"}-${endDate || "全部"}`, { size: 11, border: false });

  const headerRow = 8;
  const headers = [
    "序号",
    "Invoice date\n发票日期",
    "Port of departure\n起运地",
    "Port of destination\n目的地",
    "",
    "",
    "Invoice No\n发票编号",
    "",
    "Total amount（RMB）\n总金额(人民币)"
  ];
  headers.forEach((value, index) => {
    kenfaSetCell(summary.getCell(headerRow, index + 1), value, { bold: true, align: "center", size: index === 8 ? 12 : 11 });
  });
  kenfaMerge(summary, `D${headerRow}:F${headerRow}`);
  kenfaMerge(summary, `G${headerRow}:H${headerRow}`);
  dailySummaries.forEach((item, index) => {
    const rowNumber = headerRow + 1 + index;
    summary.getRow(rowNumber).height = 18;
    kenfaSetCell(summary.getCell(rowNumber, 1), index + 1, { bold: true, align: "center", size: 11 });
    kenfaSetCell(summary.getCell(rowNumber, 2), item.date, { align: "center", size: 11 });
    kenfaSetCell(summary.getCell(rowNumber, 3), item.departure, { bold: true, align: "center", size: 11 });
    kenfaMerge(summary, `D${rowNumber}:F${rowNumber}`);
    kenfaSetCell(summary.getCell(rowNumber, 4), item.destination, { bold: true, align: "center", size: 11 });
    kenfaMerge(summary, `G${rowNumber}:H${rowNumber}`);
    kenfaSetCell(summary.getCell(rowNumber, 7), item.invoiceNo, { bold: true, align: "center", size: 11 });
    kenfaSetCell(summary.getCell(rowNumber, 9), { formula: item.totalCell }, { align: "right", numFmt: "#,##0.00", size: 11, color: index === 10 ? "#ff0000" : "#000000" });
  });
  const totalRow = Math.max(headerRow + 1 + dailySummaries.length, 24);
  kenfaMerge(summary, `A${totalRow}:H${totalRow}`);
  kenfaSetCell(summary.getCell(totalRow, 1), "", { bold: true, align: "right" });
  kenfaSetCell(summary.getCell(totalRow, 9), { formula: `SUM(I${headerRow + 1}:I${totalRow - 1})` }, { bold: true, align: "right", numFmt: "#,##0.00", size: 12 });
  const vatRow = totalRow + 1;
  kenfaMerge(summary, `A${vatRow}:H${vatRow}`);
  kenfaMerge(summary, `G${vatRow}:H${vatRow}`);
  kenfaSetCell(summary.getCell(vatRow, 7), "含6%增值税价格", { align: "center", size: 11, border: false });
  kenfaSetCell(summary.getCell(vatRow, 9), { formula: `I${totalRow}*1.06` }, { bold: true, align: "right", numFmt: "#,##0.00", size: 12, border: false });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function renderOrdersExcelHtml(orders, title = "订单导出", templatePayload = null, exchange = null) {
  const template = normalizeExportTemplate(templatePayload);
  const isCustomerStatement = isCustomerStatementExportTitle(title);
  const columns = exportColumnsForOrders(templatePayload, orders, {
    includeChargeNoteColumn: isCustomerStatement,
    includeOperatingUnitColumn: isCustomerStatement
  });
  const context = {
    title,
    date: todayInputValue(),
    user: "高级管理员",
    page: 1,
    pages: 1
  };
  const headerItems = template
    ? (
      template.headerTextItems.length
        ? template.headerTextItems
        : [{ text: template.header || "{{title}}\n日期：{{date}}", color: template.headerTextColor, fontSize: template.headerFontSize }]
    )
    : [{ text: title }, { text: `导出时间：${todayInputValue()}    订单数：${orders.length}` }];
  const footerItems = exportTemplateFooterItems(template, template?.footerTextColor);
  const headerHtml = headerItems
    .filter((item) => item?.text)
    .map((item) => `<div class="header-line" style="color:${htmlEscape(item.color || template?.headerTextColor || "#17233c")};font-size:${Number(item.fontSize || template?.headerFontSize || 14)}px;font-weight:${item.bold ? 700 : 400};text-align:${htmlEscape(item.align || "left")};width:${Math.max(80, Math.min(520, Number(item.width || 260)))}px;">${htmlEscape(templateText(item.text, context)).replaceAll("\n", "<br>")}</div>`)
    .join("");
  const logoWidth = template ? Math.max(48, Math.min(180, Number(template.logoWidth || 92))) : 92;
  const logoHeight = template ? Math.max(28, Math.min(120, Number(template.logoHeight || 56))) : 56;
  const logoFit = template?.logoFit === "cover" ? "cover" : "contain";
  const logoSource = template?.logo && dataUrlBuffer(template.logo)
    ? template.logo
    : (isCustomerStatement ? KENFA_LOGO_DATA_URL : "");
  const logoHtml = logoSource
    ? `<td class="header-logo-cell" style="width:${logoWidth + 16}px;"><img class="header-logo" src="${htmlEscape(logoSource)}" style="width:${logoWidth}px;height:${logoHeight}px;object-fit:${logoFit};" alt="logo"></td>`
    : "";
  const headerBlockHtml = logoHtml
    ? `<table class="header-layout"><tr>${logoHtml}<td class="header-text-cell">${headerHtml}</td></tr></table>`
    : headerHtml;
  const footerHtml = footerItems
    .filter((item) => item?.text)
    .map((item) => `<div class="footer-line" style="color:${htmlEscape(item.color || template?.footerTextColor || "#64748b")};font-size:${Number(item.fontSize || template?.footerFontSize || 9)}px;font-weight:${item.bold ? 700 : 400};text-align:${htmlEscape(item.align || "left")};width:${Math.max(80, Math.min(520, Number(item.width || 280)))}px;">${htmlEscape(templateText(item.text, context)).replaceAll("\n", "<br>")}</div>`)
    .join("");
  const headerBg = template?.tableHeaderBgColor || "#f1f5f9";
  const headerColor = template?.tableHeaderTextColor || "#1f2a44";
  const textColor = template?.tableTextColor || "#17233c";
  const borderColor = template?.tableBorderColor || "#d9e3f2";
  const tableFontSize = Number(template?.tableFontSize || 11);
  const tableFontWeight = template?.tableBold ? 700 : 400;
  const tableHeaderFontWeight = template?.tableHeaderBold === false ? 400 : 700;
  const tableAlign = template?.tableAlign || "left";
  const tablePixelWidth = columns.reduce((sum, column) => sum + Number(column.width || 76), 0);
  const tableWidthCss = template?.orientation === "fluid" ? `${Math.max(1, tablePixelWidth)}px` : "100%";
  const tableData = exportTableRowData(orders, columns, exchange, {
    includeSettlementTotal: shouldIncludeSettlementTotal(title, exchange),
    includeAdvanceAddress: isCustomerStatement,
    excludeChargedFromTotals: isCustomerStatement
  });
  const rowsHtml = tableData.rows.map((rowData) => `
    <tr${rowData.kind === "total" || rowData.kind === "settlementTotal" ? ' class="total-row"' : ""}>
      ${rowData.values.map((value, columnIndex) => `<td${rowData.kind === "settlementTotal" && columnIndex === rowData.labelIndex ? ' class="settlement-total-label"' : ""}>${htmlEscape(value)}</td>`).join("")}
    </tr>
  `).join("");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; color: ${textColor}; }
    .header { margin-bottom: 14px; }
    .header-layout { border-collapse: collapse; width: 100%; margin: 0 0 8px 0; }
    .header-layout td { border: 0; padding: 0; vertical-align: top; }
    .header-logo-cell { padding-top: 4px; }
    .header-logo { display: block; }
    .header-line { font-weight: 700; line-height: 1.45; margin: 2px 0; }
    .data-table { border-collapse: collapse; width: ${tableWidthCss}; font-size: ${tableFontSize}px; text-align: ${tableAlign}; }
    .data-table th { background: ${headerBg}; color: ${headerColor}; font-weight: ${tableHeaderFontWeight}; }
    .data-table th, .data-table td { border: 1px solid ${borderColor}; padding: 6px 8px; line-height: 1.25; mso-number-format: "\\@"; vertical-align: top; }
    .data-table th { overflow-wrap: anywhere; white-space: normal; }
    .data-table td { overflow-wrap: normal; white-space: nowrap; }
    .data-table th span { display: block; }
    .data-table .table-header-currency { margin-top: 2px; color: ${headerColor}; font-size: 0.86em; }
    .data-table td { font-weight: ${tableFontWeight}; }
    .data-table .total-row td { background: ${headerBg}; font-weight: 700; }
    .data-table .settlement-total-label { background: #ffff00 !important; text-align: center; }
    .footer { margin-top: 14px; color: #64748b; }
  </style>
</head>
<body>
  <div class="header">${headerBlockHtml}</div>
  <table class="data-table">
    <thead><tr>${columns.map((column) => `<th style="font-weight:${exportColumnHeaderBold(column, template) ? 700 : 400};">${exportColumnHeaderHtml(column)}</th>`).join("")}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer">${footerHtml}</div>
</body>
</html>`;
}

const ORDER_DEFAULT_SORT_SQL = `
      ORDER BY
        CASE WHEN COALESCE(NULLIF(plate, ''), NULLIF(supplier, '')) IS NULL THEN 1 ELSE 0 END,
        COALESCE(NULLIF(plate, ''), NULLIF(supplier, '')),
        order_date ASC,
        no ASC
    `;

async function loadExportOrders(orderNos = []) {
  if (orderNos.length > 0) {
    const placeholders = orderNos.map(() => "?").join(",");
    const rows = await db.prepare(`
      SELECT * FROM orders
      WHERE deleted_at IS NULL AND no IN (${placeholders})
      ${ORDER_DEFAULT_SORT_SQL}
    `).all(...orderNos);
    const orderIndex = new Map(orderNos.map((no, index) => [no, index]));
    const hydrated = await hydrateOrderFees(rows.map(mapOrder));
    return hydrated.sort((a, b) => (orderIndex.get(a.no) ?? 0) - (orderIndex.get(b.no) ?? 0));
  }
  const rows = await db.prepare(`
    SELECT * FROM orders
    WHERE deleted_at IS NULL
    ${ORDER_DEFAULT_SORT_SQL}
  `).all();
  return hydrateOrderFees(rows.map(mapOrder));
}

function normalizeExportOrderFee(fee = {}) {
  if (!fee || typeof fee !== "object") return null;
  const amount = Number(fee.amount || 0);
  const name = String(fee.name || "").trim();
  if (!name && !amount) return null;
  return {
    name,
    currency: String(fee.currency || "港币").trim() || "港币",
    amount,
    quantity: fee.quantity ?? fee.qty ?? "",
    unitPrice: fee.unitPrice ?? fee.unit_price ?? fee.price ?? "",
    category: String(fee.category || "正常").trim() || "正常",
    feeItemId: String(fee.feeItemId || fee.fee_item_id || "").trim(),
    driverRole: String(fee.driverRole || fee.driver_role || "").trim(),
    driverName: String(fee.driverName || fee.driver_name || "").trim(),
    advanceAddress: String(fee.advanceAddress || fee.advance_address || "").trim(),
    note: String(fee.note || "").trim()
  };
}

function normalizeExportBoolean(value = false) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function normalizeExportOrderSnapshot(order = {}) {
  const snapshot = {};
  Object.entries(order || {}).forEach(([key, value]) => {
    if (key === "fees") return;
    if (value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      snapshot[key] = value;
    }
  });
  snapshot.dispatchNo = String(snapshot.dispatchNo || order.dispatchNo || "");
  snapshot.no = String(snapshot.no || order.no || "");
  snapshot.createdByName = String(snapshot.createdByName || order.createdByName || order.created_by_display_name || order.createdByUsername || order.created_by_username || "");
  snapshot.createdByUsername = String(snapshot.createdByUsername || order.createdByUsername || order.created_by_username || "");
  snapshot.customer = String(snapshot.customer || order.customer || "");
  snapshot.businessType = String(snapshot.businessType || order.businessType || "");
  snapshot.port = normalizePortText(snapshot.port || order.port || "");
  snapshot.direction = String(snapshot.direction || order.direction || "");
  snapshot.tonnage = String(snapshot.tonnage || order.tonnage || "");
  snapshot.currency = String(snapshot.currency || order.currency || "港币");
  snapshot.quantity = snapshot.quantity ?? order.quantity ?? "";
  snapshot.weight = String(snapshot.weight || order.weight || "");
  snapshot.vehicleSource = String(snapshot.vehicleSource || order.vehicleSource || "");
  snapshot.plate = String(snapshot.plate || order.plate || "");
  snapshot.driver = String(snapshot.driver || order.driver || "");
  snapshot.hkDriver = String(snapshot.hkDriver || order.hkDriver || order.hk_driver || "");
  snapshot.mainlandDriver = String(snapshot.mainlandDriver || order.mainlandDriver || order.mainland_driver || "");
  snapshot.transportMode = String(snapshot.transportMode || order.transportMode || "");
  snapshot.supplier = String(snapshot.supplier || order.supplier || "");
  snapshot.loading = String(snapshot.loading || order.loading || "");
  snapshot.unloading = String(snapshot.unloading || order.unloading || "");
  snapshot.date = String(snapshot.date || order.date || "");
  snapshot.receivableHKD = Number(snapshot.receivableHKD ?? order.receivableHKD ?? 0);
  snapshot.receivableRMB = Number(snapshot.receivableRMB ?? order.receivableRMB ?? 0);
  snapshot.status = String(snapshot.status || order.status || "");
  snapshot.operatingUnit = String(snapshot.operatingUnit || order.operatingUnit || order.operating_unit || "");
  snapshot.chargedAt = normalizeOrderChargedAt(snapshot.chargedAt || order.chargedAt || order.charged_at || "");
  snapshot.remark = String(snapshot.remark || order.remark || "");
  snapshot.tripNoEnabled = normalizeExportBoolean(snapshot.tripNoEnabled ?? order.tripNoEnabled ?? order.trip_no_enabled);
  snapshot.tripNo = String(snapshot.tripNo || order.tripNo || order.trip_no || "");
  snapshot.sixSheetEnabled = normalizeExportBoolean(snapshot.sixSheetEnabled ?? order.sixSheetEnabled ?? order.six_sheet_enabled);
  snapshot.sixSheetNo = String(snapshot.sixSheetNo || order.sixSheetNo || order.six_sheet_no || "");
  snapshot.fees = Array.isArray(order.fees)
    ? order.fees.map(normalizeExportOrderFee).filter(Boolean)
    : [];
  return snapshot;
}

async function loadExportOrdersFromRequest(body = {}, orderNos = []) {
  const snapshotOrders = Array.isArray(body.orders)
    ? body.orders.map(normalizeExportOrderSnapshot).filter((order) => order.no || order.dispatchNo || order.customer || order.supplier)
    : [];
  if (snapshotOrders.length > 0) return snapshotOrders;
  return loadExportOrders(orderNos);
}

function renderOrdersPdf(res, orders, title = "订单导出", templatePayload = null, filename = "", exchange = null) {
  const template = normalizeExportTemplate(templatePayload);
  const isCustomerStatement = isCustomerStatementExportTitle(title);
  const sourceColumns = exportColumnsForOrders(templatePayload, orders, {
    includeChargeNoteColumn: isCustomerStatement,
    includeOperatingUnitColumn: isCustomerStatement
  });
  const tableWidth = sourceColumns.reduce((sum, column) => sum + Number(column.width || 76), 0);
  const fluidPageWidth = Math.max(842, Math.ceil(tableWidth + 48));
  const layout = template?.orientation === "portrait" ? "portrait" : "landscape";
  const doc = new PDFDocument({
    size: template?.orientation === "fluid" ? [fluidPageWidth, 595] : "A4",
    layout,
    margin: 24,
    bufferPages: true
  });
  const fontConfig = resolvePdfFontConfig();
  let fontUnavailable = false;
  function usePdfFont() {
    if (!fontConfig || fontUnavailable) return;
    try {
      if (fontConfig.family) doc.font(fontConfig.path, fontConfig.family);
      else doc.font(fontConfig.path);
    } catch (error) {
      fontUnavailable = true;
      console.warn(`PDF font unavailable: ${fontConfig.path}`, error.message);
    }
  }
  usePdfFont();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename || `${title}-${todayInputValue()}.pdf`)}`);
  doc.pipe(res);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const scale = template?.orientation === "fluid" ? 1 : Math.min(1, pageWidth / tableWidth);
  const columns = sourceColumns.map((column) => ({
    ...column,
    width: Number(column.width || 76) * scale,
    fontSize: Number(column.fontSize || template?.tableFontSize || 8)
  }));
  const startX = doc.page.margins.left;
  const tableHeaderHeight = Math.max(30, Number(template?.tableFontSize || 8) * 2.45 + 12);
  const headerHeight = template?.headerHeight || 58;
  const footerHeight = template?.footerHeight || 28;
  const footerFontSize = template?.footerFontSize || 8;
  const contextBase = {
    title,
    date: todayInputValue(),
    user: "高级管理员"
  };

  function measureFooterReserve() {
    if (!template?.footerTextItems?.length) return footerHeight;
    usePdfFont();
    const reserve = template.footerTextItems.reduce((max, item) => {
      doc.fontSize(Number(item.fontSize || footerFontSize));
      const textHeight = doc.heightOfString(templateText(item.text, { ...contextBase, page: 999, pages: 999 }), {
        width: pageWidth - Number(item.x || 0),
        lineGap: 2
      });
      return Math.max(max, pdfFooterItemY(item, template) + Math.ceil(textHeight) + 8);
    }, footerHeight);
    return Math.max(footerHeight, reserve);
  }

  const footerReserve = measureFooterReserve();

  function drawHeader() {
    if (template) {
      const logoBuffer = dataUrlBuffer(template.logo || (isCustomerStatement ? KENFA_LOGO_DATA_URL : ""));
      if (logoBuffer) {
        try {
          const logoWidth = Math.max(36, Math.min(180, Number(template.logoWidth || 92)));
          const logoHeight = Math.max(24, Math.min(120, Number(template.logoHeight || 56)));
          const logoBox = template.logoFit === "cover"
            ? { cover: [logoWidth, logoHeight] }
            : { fit: [logoWidth, logoHeight] };
          doc.image(logoBuffer, startX + template.logoX, doc.page.margins.top + template.logoY, logoBox);
          usePdfFont();
        } catch {
          // Ignore invalid image payloads so export still succeeds.
        }
      }
      if (template.headerTextItems.length) {
        template.headerTextItems.forEach((item) => {
          const fontSize = Number(item.fontSize || template.headerFontSize || 14);
          usePdfFont();
          doc.fontSize(fontSize).fillColor(item.color || template.headerTextColor || "#17233c");
          doc.text(
            templateText(item.text, contextBase),
            startX + Number(item.x || 0),
            doc.page.margins.top + Number(item.y || 0),
            {
              width: Math.min(Number(item.width || 260), pageWidth - Number(item.x || 0)),
              align: item.align || "left",
              lineGap: 2
            }
          );
        });
      } else {
        usePdfFont();
        doc.fontSize(template.headerFontSize).fillColor(template.headerTextColor || "#17233c").text(
          templateText(template.header || "{{title}}\n日期：{{date}}", contextBase),
          startX,
          doc.page.margins.top,
          { width: pageWidth }
        );
      }
    } else {
      usePdfFont();
      doc.fontSize(15).fillColor("#17233c").text(title, startX, 18, { continued: false });
      doc.fontSize(9).fillColor("#64748b").text(`导出时间：${todayInputValue()}    订单数：${orders.length}`, startX, 38);
    }
    let x = startX;
    const y = doc.page.margins.top + headerHeight;
    doc.rect(startX, y, columns.reduce((sum, column) => sum + column.width, 0), tableHeaderHeight).fill(template?.tableHeaderBgColor || "#f1f5f9");
    usePdfFont();
    doc.fillColor(template?.tableHeaderTextColor || "#1f2a44").fontSize(template?.tableFontSize || 8);
    columns.forEach((column, columnIndex) => {
      doc.lineWidth(template?.tableBorderWidth ?? 1).rect(x, y, column.width, tableHeaderHeight).strokeColor(template?.tableBorderColor || "#d9e3f2").stroke();
      const currency = exportColumnCurrencyLabel(column);
      const labelHeight = currency ? Math.max(9, tableHeaderHeight * 0.45) : tableHeaderHeight - 8;
      const headerBold = exportColumnHeaderBold(column, template);
      pdfTextWithWeight(doc, exportColumnBaseLabel(column), x + 3, y + (currency ? 5 : 8), {
        width: column.width - 6,
        height: labelHeight,
        align: template?.tableAlign || "left",
        lineGap: 1
      }, headerBold);
      if (currency) {
        doc.fontSize(Math.max(5, Number(template?.tableFontSize || 8) - 1));
        pdfTextWithWeight(doc, currency, x + 3, y + 5 + labelHeight, {
          width: column.width - 6,
          height: tableHeaderHeight - labelHeight - 6,
          align: template?.tableAlign || "left",
          lineGap: 1
        }, headerBold);
        doc.fontSize(template?.tableFontSize || 8);
      }
      x += column.width;
    });
    return y + tableHeaderHeight;
  }

  const includeSettlementTotal = shouldIncludeSettlementTotal(title, exchange);
  const { rows: pdfRows } = exportTableRowData(orders, columns, exchange, {
    includeSettlementTotal,
    includeAdvanceAddress: isCustomerStatement,
    excludeChargedFromTotals: isCustomerStatement
  });
  let y = drawHeader();
  pdfRows.forEach((rowData) => {
    usePdfFont();
    const currentRowHeight = pdfRowHeightForValues(doc, rowData.values, columns, template);
    if (y + currentRowHeight > doc.page.height - doc.page.margins.bottom - footerReserve) {
      doc.addPage();
      y = drawHeader();
    }
    let x = startX;
    doc.fillColor(template?.tableTextColor || "#17233c");
    columns.forEach((column, columnIndex) => {
      usePdfFont();
      doc.fontSize(column.fontSize || template?.tableFontSize || 7.3);
      if (rowData.kind === "total" || rowData.kind === "settlementTotal") {
        doc.rect(x, y, column.width, currentRowHeight).fill(template?.tableHeaderBgColor || "#f1f5f9");
        doc.fillColor(template?.tableTextColor || "#17233c");
      }
      if (rowData.kind === "settlementTotal" && columnIndex === rowData.labelIndex) {
        doc.rect(x, y, column.width, currentRowHeight).fill("#ffff00");
        doc.fillColor(template?.tableTextColor || "#17233c");
      }
      doc.lineWidth(template?.tableBorderWidth ?? 1).rect(x, y, column.width, currentRowHeight).strokeColor(template?.tableBorderColor || "#e9eef6").stroke();
      const textOptions = {
        width: column.width - 6,
        align: template?.tableAlign || "left",
        lineGap: 1,
        height: currentRowHeight - 8
      };
      doc.text(textValue(rowData.values[columnIndex]), x + 3, y + 6, textOptions);
      x += column.width;
    });
    y += currentRowHeight;
  });

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const page = index + 1 - range.start;
    if (template?.footerTextItems?.length) {
      template.footerTextItems.forEach((item) => {
        usePdfFont();
        doc.fontSize(Number(item.fontSize || footerFontSize)).fillColor(item.color || template.footerTextColor || "#64748b");
        doc.text(
          templateText(item.text, { ...contextBase, page, pages: range.count }),
          doc.page.margins.left + Number(item.x || 0),
          doc.page.height - doc.page.margins.bottom - footerReserve + pdfFooterItemY(item, template),
          {
            width: Math.min(Number(item.width || 280), pageWidth - Number(item.x || 0)),
            align: item.align || "left",
            lineGap: 2
          }
        );
      });
    } else {
      const footerText = `第 ${page} / ${range.count} 页`;
      usePdfFont();
      doc.fontSize(footerFontSize);
      const footerTextHeight = doc.heightOfString(footerText, {
        width: pageWidth,
        lineGap: 2
      });
      doc.fillColor("#64748b").text(
        footerText,
        doc.page.margins.left,
        doc.page.height - doc.page.margins.bottom - footerTextHeight,
        { align: "right", width: pageWidth, lineGap: 2 }
      );
    }
  }

  doc.end();
}

function mapOrderFee(row) {
  const quantity = Number(row.quantity || 0) > 0 ? Number(row.quantity) : 1;
  return {
    id: row.id,
    clientKey: userTextValue(row.client_key),
    category: userTextValue(row.category),
    name: userTextValue(row.name),
    quantity,
    unitPrice: row.unit_price || 0,
    unitPriceManual: Boolean(row.unit_price_manual),
    currency: userTextValue(row.currency),
    amount: row.amount,
    amountManual: Boolean(row.amount_manual),
    cost: row.cost == null ? null : Number(row.cost || 0),
    costCurrency: userTextValue(row.cost_currency || row.currency || "港币"),
    costHKD: row.cost_hkd == null ? null : Number(row.cost_hkd || 0),
    costRMB: row.cost_rmb == null ? null : Number(row.cost_rmb || 0),
    costParts: normalizeOrderFeeCostParts(row.cost_parts_json),
    costManual: Boolean(row.cost_manual),
    fxLinks: parseJsonObjectText(row.fx_links_json, {}),
    advanceAddress: userTextValue(row.advance_address),
    remark: userTextValue(row.remark),
    driverRole: userTextValue(row.driver_role),
    driverName: userTextValue(row.driver_name)
  };
}

function mapAddressBook(row) {
  return {
    id: row.id,
    area: userTextValue(row.area),
    contact: userTextValue(row.contact),
    phone: userTextValue(row.phone),
    address: userMultilineTextValue(row.address),
    note: userTextValue(row.note),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function mapCustomerContact(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    name: userTextValue(row.name),
    gender: userTextValue(row.gender),
    title: userTextValue(row.title),
    mobile: userTextValue(row.mobile),
    phone: userTextValue(row.phone),
    area: userTextValue(row.area),
    address: userMultilineTextValue(row.address),
    fax: userTextValue(row.fax),
    email: userTextValue(row.email),
    wechat: userTextValue(row.wechat),
    qq: userTextValue(row.qq),
    remark: userTextValue(row.remark),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function normalizeAddressBookPayload(body) {
  return {
    area: userTextValue(body.area),
    contact: userTextValue(body.contact),
    phone: userTextValue(body.phone),
    address: userMultilineTextValue(body.address),
    note: userTextValue(body.note)
  };
}

function addressHistoryKey(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function normalizeCustomerContactPayload(body, existing = null) {
  return {
    customerId: String(body.customerId || body.customer_id || existing?.customer_id || "").trim(),
    name: userTextValue(body.name || existing?.name),
    gender: userTextValue(body.gender || existing?.gender),
    title: userTextValue(body.title || existing?.title),
    mobile: userTextValue(body.mobile || existing?.mobile),
    phone: userTextValue(body.phone || existing?.phone),
    area: userTextValue(body.area || existing?.area),
    address: userMultilineTextValue(body.address || existing?.address),
    fax: userTextValue(body.fax || existing?.fax),
    email: userTextValue(body.email || existing?.email),
    wechat: userTextValue(body.wechat || existing?.wechat),
    qq: userTextValue(body.qq || existing?.qq),
    remark: userTextValue(body.remark || existing?.remark)
  };
}

function mapVehicle(row) {
  return {
    plate: normalizePlateText(row.plate),
    brand: userTextValue(row.brand),
    model: userTextValue(row.model),
    type: userTextValue(row.vehicle_type),
    purchaseDate: row.purchase_date,
    factoryDate: row.factory_date,
    mainlandReviewDate: row.mainland_review_date,
    hkReviewDate: row.hk_review_date,
    mainlandInsuranceDate: row.mainland_insurance_date,
    hkInsuranceDate: row.hk_insurance_date,
    insuranceReminder: userTextValue(row.insurance_reminder),
    maintenanceReminder: userTextValue(row.maintenance_reminder),
    maintenanceDueDate: userTextValue(row.maintenance_due_date),
    maintenanceDueKm: Number(row.maintenance_due_km || 0),
    status: userTextValue(row.status),
    monthlyCost: row.monthly_cost,
    note: userTextValue(row.note)
  };
}

function mapVehicleExpense(row) {
  const year = row.expense_year || String(row.start_date || row.expense_date || "").slice(0, 4) || "";
  const startDate = row.start_date || "";
  const endDate = row.end_date || "";
  const fuelLiters = Number(row.fuel_liters || 0);
  const fuelPricePerLiter = Number(row.fuel_price_per_liter || 0) || (fuelLiters > 0 && Number(row.amount || 0) > 0 ? Number((Number(row.amount || 0) / fuelLiters).toFixed(1)) : 0);
  const repairItems = normalizeVehicleRepairItems(row.repair_items_json);
  const fallbackRepairItems = row.expense_type === "repair" && repairItems.length === 0
    ? normalizeVehicleRepairItems([{
      content: userTextValue(row.name) || "维修费",
      quantity: 1,
      unit: "项",
      unitPrice: Number(row.amount || 0),
      amount: Number(row.amount || 0)
    }])
    : [];
  return {
    id: row.id,
    type: row.expense_type,
    name: row.expense_type === "annual" ? normalizeVehicleAnnualExpenseName(row.name) : userTextValue(row.name),
    fuelStation: userTextValue(row.fuel_station),
    fuelLiters,
    fuelPricePerLiter,
    odometerKm: Number(row.odometer_km || 0),
    isMaintenance: Boolean(row.is_maintenance),
    maintenanceNextDate: userTextValue(row.maintenance_next_date),
    maintenanceNextKm: Number(row.maintenance_next_km || 0),
    repairItems: repairItems.length ? repairItems : fallbackRepairItems,
    plate: normalizePlateText(row.plate),
    date: row.expense_date || "",
    year,
    startDate,
    endDate,
    currency: userTextValue(row.currency || "人民币"),
    amount: Number(row.amount || 0),
    note: userTextValue(row.note),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function normalizeVehicleAnnualExpenseName(value = "") {
  const text = userTextValue(value);
  if (VEHICLE_ANNUAL_EXPENSE_NAME_ALIASES.has(text)) return VEHICLE_ANNUAL_EXPENSE_NAME_ALIASES.get(text);
  return VEHICLE_ANNUAL_EXPENSE_NAMES.has(text) ? text : "大陆保险";
}

function vehicleAnnualExpenseReminderField(name = "") {
  return VEHICLE_ANNUAL_EXPENSE_REMINDER_FIELDS.get(normalizeVehicleAnnualExpenseName(name)) || "";
}

function vehicleAnnualExpenseReminderDate(row = {}) {
  return String(row.end_date || row.endDate || row.expense_date || row.date || "").trim();
}

async function syncVehicleAnnualExpenseReminderDates(plate) {
  const normalizedPlate = normalizePlateText(plate);
  if (!normalizedPlate) return null;
  const vehicle = await db.prepare("SELECT plate FROM vehicles WHERE plate = ? AND deleted_at IS NULL").get(normalizedPlate);
  if (!vehicle) return null;
  const rows = await db.prepare(`
    SELECT name, expense_date, start_date, end_date
    FROM vehicle_expenses
    WHERE deleted_at IS NULL
      AND expense_type = 'annual'
      AND plate = ?
    ORDER BY COALESCE(NULLIF(end_date, ''), NULLIF(start_date, ''), expense_date) DESC, id DESC
  `).all(normalizedPlate);
  const nextValues = {
    mainland_review_date: "",
    hk_review_date: "",
    mainland_insurance_date: "",
    hk_insurance_date: ""
  };
  rows.forEach((row) => {
    const field = vehicleAnnualExpenseReminderField(row.name);
    if (!field || nextValues[field]) return;
    nextValues[field] = vehicleAnnualExpenseReminderDate(row);
  });
  await db.prepare(`
    UPDATE vehicles
    SET mainland_review_date = ?,
        hk_review_date = ?,
        mainland_insurance_date = ?,
        hk_insurance_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE plate = ? AND deleted_at IS NULL
  `).run(
    nextValues.mainland_review_date,
    nextValues.hk_review_date,
    nextValues.mainland_insurance_date,
    nextValues.hk_insurance_date,
    normalizedPlate
  );
  return nextValues;
}

async function syncVehicleMaintenanceReminderDate(plate) {
  const normalizedPlate = normalizePlateText(plate);
  if (!normalizedPlate) return null;
  const vehicle = await db.prepare("SELECT plate FROM vehicles WHERE plate = ? AND deleted_at IS NULL").get(normalizedPlate);
  if (!vehicle) return null;
  const hasMaintenanceNextKm = await vehicleExpenseHasMaintenanceNextKmColumn();
  const selectMaintenanceNextKm = hasMaintenanceNextKm ? ", maintenance_next_km" : "";
  const maintenanceProgressCondition = hasMaintenanceNextKm ? "OR COALESCE(maintenance_next_km, 0) > 0" : "";
  const row = await db.prepare(`
    SELECT maintenance_next_date${selectMaintenanceNextKm}
    FROM vehicle_expenses
    WHERE deleted_at IS NULL
      AND expense_type = 'repair'
      AND COALESCE(is_maintenance, false) = true
      AND (
        COALESCE(NULLIF(maintenance_next_date, ''), '') <> ''
        ${maintenanceProgressCondition}
      )
      AND plate = ?
    ORDER BY COALESCE(NULLIF(expense_date, ''), created_at) DESC, id DESC
    LIMIT 1
  `).get(normalizedPlate);
  const maintenanceDueDate = String(row?.maintenance_next_date || "").trim();
  const maintenanceDueKm = hasMaintenanceNextKm ? Number(row?.maintenance_next_km || 0) : 0;
  await db.prepare(`
    UPDATE vehicles
    SET maintenance_due_date = ?,
        maintenance_due_km = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE plate = ? AND deleted_at IS NULL
  `).run(maintenanceDueDate, maintenanceDueKm, normalizedPlate);
  return { maintenanceDueDate, maintenanceDueKm };
}

function normalizeVehicleExpenseCurrency(value = "") {
  const text = String(value || "").trim().toUpperCase();
  if (text === "HKD" || text === "港币") return "港币";
  return "人民币";
}

function vehicleRepairNumberField(value, decimals = 2) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Number(number.toFixed(decimals));
}

function normalizeVehicleRepairItems(value = []) {
  const source = Array.isArray(value) ? value : parseJsonArrayText(value);
  return source
    .map((item, index) => {
      const content = userTextValue(
        item?.content
        ?? item?.itemContent
        ?? item?.repairItemContent
        ?? item?.name
        ?? item?.item
        ?? ""
      );
      const quantity = vehicleRepairNumberField(item?.quantity ?? item?.qty, 3);
      const unit = userTextValue(item?.unit ?? "");
      let unitPrice = vehicleRepairNumberField(item?.unitPrice ?? item?.unit_price ?? item?.price);
      let amount = vehicleRepairNumberField(item?.amount ?? item?.total ?? item?.priceYuan ?? item?.price_yuan);
      if (!amount && quantity > 0 && unitPrice > 0) amount = vehicleRepairNumberField(quantity * unitPrice);
      if (!unitPrice && quantity > 0 && amount > 0) unitPrice = vehicleRepairNumberField(amount / quantity);
      return {
        content,
        quantity,
        unit,
        unitPrice,
        amount,
        sortOrder: Number.isFinite(Number(item?.sortOrder ?? item?.sort_order)) ? Number(item?.sortOrder ?? item?.sort_order) : index
      };
    })
    .filter((item) => item.content)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .slice(0, 100);
}

function vehicleRepairItemsTotal(items = []) {
  return vehicleRepairNumberField(normalizeVehicleRepairItems(items).reduce((sum, item) => sum + Number(item.amount || 0), 0));
}

function vehicleRepairSummaryName(items = []) {
  const names = normalizeVehicleRepairItems(items)
    .map((item) => item.content)
    .filter(Boolean);
  if (names.length === 0) return "维修费";
  if (names.length <= 2) return names.join("、");
  return `${names.slice(0, 2).join("、")}等${names.length}项`;
}

function normalizeVehicleExpensePayload(body = {}, current = null) {
  const type = VEHICLE_EXPENSE_TYPES.has(String(body.type || body.expenseType || current?.expense_type || "fuel"))
    ? String(body.type || body.expenseType || current?.expense_type || "fuel")
    : "fuel";
  const rawName = userTextValue(body.name ?? current?.name ?? "");
  const currentYear = Number(current?.expense_year || String(current?.expense_date || "").slice(0, 4) || new Date().getFullYear());
  const yearValue = Number(body.year ?? body.expenseYear ?? current?.expense_year ?? currentYear);
  const year = Number.isInteger(yearValue) && yearValue >= 2000 && yearValue <= 2100 ? yearValue : currentYear || new Date().getFullYear();
  const rawDate = String(body.date || body.expenseDate || current?.expense_date || todayInputValue()).trim();
  const otherMonth = normalizePeriodMonthKey(rawDate || current?.expense_date || todayInputValue());
  const explicitStartDate = String(body.startDate || body.start_date || "").trim();
  const explicitEndDate = String(body.endDate || body.end_date || "").trim();
  const startDate = type === "annual"
    ? explicitStartDate || String(current?.start_date || "").trim() || `${year}-01-01`
    : "";
  const endDate = type === "annual"
    ? explicitEndDate || String(current?.end_date || "").trim() || addInputYears(startDate, 1)
    : "";
  const startYear = Number(String(startDate || "").slice(0, 4));
  const annualYear = type === "annual" && Number.isInteger(startYear) && startYear >= 2000 && startYear <= 2100 ? startYear : year;
  const date = type === "annual"
    ? startDate || `${year}-01-01`
    : (type === "other" ? otherMonth : rawDate);
  const defaultNames = {
    fuel: "加油记录",
    repair: "维修费",
    annual: "大陆保险",
    other: ""
  };
  const amountRaw = Number(body.amount ?? current?.amount ?? 0);
  const repairItems = type === "repair"
    ? normalizeVehicleRepairItems(body.repairItems ?? body.repair_items ?? current?.repair_items_json ?? [])
    : [];
  const isMaintenance = type === "repair"
    ? booleanFlag(body.isMaintenance ?? body.is_maintenance ?? current?.is_maintenance ?? false)
    : false;
  const maintenanceNextDate = type === "repair" && isMaintenance
    ? String(body.maintenanceNextDate || body.maintenance_next_date || current?.maintenance_next_date || "").trim()
    : "";
  const rawOdometerKm = Number(body.odometerKm ?? body.odometer_km ?? current?.odometer_km ?? 0);
  const normalizedOdometerKm = Number.isFinite(rawOdometerKm) && rawOdometerKm > 0
    ? Number(rawOdometerKm.toFixed(2))
    : 0;
  const maintenanceNextKm = type === "repair" && isMaintenance
    ? vehicleRepairNumberField(body.maintenanceNextKm ?? body.maintenance_next_km ?? current?.maintenance_next_km ?? 0, 2)
    : 0;
  const repairFallbackItems = type === "repair" && repairItems.length === 0 && (rawName || Number(amountRaw || 0) > 0)
    ? normalizeVehicleRepairItems([{
      content: rawName || defaultNames.repair,
      quantity: 1,
      unit: "项",
      unitPrice: Number(amountRaw || 0),
      amount: Number(amountRaw || 0)
    }])
    : [];
  const normalizedRepairItems = repairItems.length ? repairItems : repairFallbackItems;
  const name = type === "annual"
    ? normalizeVehicleAnnualExpenseName(rawName || current?.name || "大陆保险")
    : (type === "repair" ? vehicleRepairSummaryName(normalizedRepairItems) : (rawName || defaultNames[type]));
  const fuelLitersRaw = Number(body.fuelLiters ?? body.fuel_liters ?? current?.fuel_liters ?? 0);
  const derivedFuelPrice = fuelLitersRaw > 0 && Number(body.amount ?? current?.amount ?? 0) > 0
    ? Number((Number(body.amount ?? current?.amount ?? 0) / fuelLitersRaw).toFixed(1))
    : 0;
  const fuelPriceRaw = Number(body.fuelPricePerLiter ?? body.fuel_price_per_liter ?? current?.fuel_price_per_liter ?? derivedFuelPrice ?? 0);
  const roundedFuelLiters = type === "fuel" ? Number(fuelLitersRaw.toFixed(1)) : 0;
  const roundedFuelPrice = type === "fuel" ? Number(fuelPriceRaw.toFixed(1)) : 0;
  let roundedAmount = Number.isFinite(amountRaw) ? amountRaw : 0;
  if (type === "fuel") {
    if (roundedFuelPrice > 0 && roundedFuelLiters > 0) {
      roundedAmount = Number((roundedFuelLiters * roundedFuelPrice).toFixed(1));
    } else if (roundedFuelPrice > 0 && roundedAmount > 0 && roundedFuelLiters <= 0) {
      const litersFromAmount = roundedAmount / roundedFuelPrice;
      roundedAmount = Number(roundedAmount.toFixed(1));
      return {
        type,
        name,
        fuelStation: userTextValue(body.fuelStation ?? body.fuel_station ?? current?.fuel_station ?? ""),
        fuelLiters: Number(litersFromAmount.toFixed(1)),
        fuelPricePerLiter: roundedFuelPrice,
        odometerKm: normalizedOdometerKm,
        plate: normalizePlateText(body.plate ?? current?.plate ?? ""),
        date,
        year: type === "annual" ? annualYear : null,
        startDate,
        endDate,
        currency: normalizeVehicleExpenseCurrency(body.currency ?? current?.currency ?? "人民币"),
        amount: roundedAmount,
        repairItems: [],
        repairItemsJson: "[]",
        isMaintenance: false,
        maintenanceNextDate: "",
        maintenanceNextKm: 0,
        note: userTextValue(body.note ?? current?.note ?? "")
      };
    }
    if (roundedFuelPrice > 0 && roundedAmount > 0 && roundedFuelLiters > 0) {
      roundedAmount = Number((roundedFuelLiters * roundedFuelPrice).toFixed(1));
    }
  }
  return {
    type,
    name,
    fuelStation: type === "fuel"
      ? userTextValue(body.fuelStation ?? body.fuel_station ?? current?.fuel_station ?? "")
      : "",
    fuelLiters: type === "fuel" ? roundedFuelLiters : 0,
    fuelPricePerLiter: type === "fuel" ? roundedFuelPrice : 0,
    odometerKm: type === "fuel" || (type === "repair" && isMaintenance) ? normalizedOdometerKm : 0,
    plate: normalizePlateText(body.plate ?? current?.plate ?? ""),
    date,
    year: type === "annual" ? annualYear : null,
    startDate,
    endDate,
    currency: type === "repair" ? "人民币" : normalizeVehicleExpenseCurrency(body.currency ?? current?.currency ?? "人民币"),
    amount: type === "fuel"
      ? Number(roundedAmount.toFixed(1))
      : (type === "repair" ? vehicleRepairItemsTotal(normalizedRepairItems) : Number(body.amount ?? current?.amount ?? 0)),
    repairItems: normalizedRepairItems,
    repairItemsJson: type === "repair" ? JSON.stringify(normalizedRepairItems) : "[]",
    isMaintenance,
    maintenanceNextDate,
    maintenanceNextKm,
    note: userTextValue(body.note ?? current?.note ?? "")
  };
}

function vehicleExpenseCreateKey(item = {}) {
  return [
    item.type,
    item.plate,
    item.date,
    item.startDate,
    item.endDate,
    item.year ?? "",
    item.name,
    item.currency,
    Number(item.amount || 0).toFixed(3),
    Number(item.fuelLiters || 0).toFixed(3),
    Number(item.fuelPricePerLiter || 0).toFixed(3),
    Number(item.odometerKm || 0).toFixed(3),
    item.isMaintenance ? "1" : "0",
    item.maintenanceNextDate,
    Number(item.maintenanceNextKm || 0).toFixed(3),
    item.repairItemsJson || "[]",
    item.note
  ].map((value) => String(value ?? "")).join("\u001f");
}

async function lockVehicleExpenseCreation(item = {}) {
  await db.prepare("SELECT pg_advisory_xact_lock(?, hashtext(?))").get(VEHICLE_EXPENSE_CREATE_LOCK_NAMESPACE, vehicleExpenseCreateKey(item));
}

let vehicleExpenseHasMaintenanceNextKmColumnCache;

async function vehicleExpenseHasMaintenanceNextKmColumn() {
  if (vehicleExpenseHasMaintenanceNextKmColumnCache !== undefined) {
    return vehicleExpenseHasMaintenanceNextKmColumnCache;
  }
  try {
    const row = await db.prepare(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `).get("vehicle_expenses", "maintenance_next_km");
    vehicleExpenseHasMaintenanceNextKmColumnCache = Boolean(row);
  } catch (error) {
    console.warn("Failed to inspect vehicle_expenses schema", error);
    vehicleExpenseHasMaintenanceNextKmColumnCache = false;
  }
  return vehicleExpenseHasMaintenanceNextKmColumnCache;
}

async function findRecentDuplicateVehicleExpense(item = {}, hasMaintenanceNextKm = true) {
  return db.prepare(`
    SELECT *
    FROM vehicle_expenses
    WHERE deleted_at IS NULL
      AND expense_type = @type
      AND plate = @plate
      AND expense_date = @date
      AND COALESCE(start_date, '') = @startDate
      AND COALESCE(end_date, '') = @endDate
      AND expense_year IS NOT DISTINCT FROM @year
      AND COALESCE(name, '') = @name
      AND COALESCE(currency, '') = @currency
      AND ABS(COALESCE(amount, 0) - @amount) < 0.000001
      AND ABS(COALESCE(fuel_liters, 0) - @fuelLiters) < 0.000001
      AND ABS(COALESCE(fuel_price_per_liter, 0) - @fuelPricePerLiter) < 0.000001
      AND ABS(COALESCE(odometer_km, 0) - @odometerKm) < 0.000001
      AND COALESCE(is_maintenance, false) = @isMaintenance
      AND COALESCE(maintenance_next_date, '') = @maintenanceNextDate
      ${hasMaintenanceNextKm ? "AND ABS(COALESCE(maintenance_next_km, 0) - @maintenanceNextKm) < 0.000001" : ""}
      AND COALESCE(repair_items_json, '[]') = @repairItemsJson
      AND COALESCE(note, '') = @note
      AND COALESCE(NULLIF(created_at, ''), CURRENT_TIMESTAMP::text)::timestamptz >= CURRENT_TIMESTAMP - INTERVAL '30 seconds'
    ORDER BY id DESC
    LIMIT 1
  `).get(item);
}

function mapDriver(row) {
  return {
    id: row.id,
    type: userTextValue(row.type || "香港司机"),
    name: userTextValue(row.name),
    phone: userTextValue(row.phone),
    idNo: userTextValue(row.id_no),
    license: userTextValue(row.license),
    birthday: row.birthday,
    hireDate: row.hire_date,
    leaveDate: row.leave_date,
    employmentStatus: userTextValue(row.employment_status || "在职"),
    expireAt: row.expire_at,
    status: userTextValue(row.status),
    defaultWage: row.default_wage,
    note: userTextValue(row.note)
  };
}

const FEE_ITEM_CATEGORY_OPTIONS = ["正常", "代垫"];
const ORDER_FEE_CATEGORY_OPTIONS = ["正常", "代垫", "公司自费"];
const FEE_ITEM_COST_SOURCE_OPTIONS = ["供应商", "香港司机", "大陆骑师", "公司自费", "其他支出"];

function normalizeFeeItemCategory(value = "", fallback = "正常") {
  const category = userTextValue(value);
  return FEE_ITEM_CATEGORY_OPTIONS.includes(category) ? category : fallback;
}

function normalizeOrderFeeCategory(value = "", fallback = "正常") {
  const category = userTextValue(value);
  return ORDER_FEE_CATEGORY_OPTIONS.includes(category) ? category : fallback;
}

function normalizeFeeItemCostSourceToken(value = "") {
  const source = userTextValue(value);
  if (source === "司机") return "香港司机";
  if (source === "其他平台") return "大陆骑师";
  return source;
}

function normalizeFeeItemCostSources(value = "供应商") {
  let parsedValue = value;
  if (typeof parsedValue === "string" && parsedValue.trim().startsWith("[")) {
    try {
      parsedValue = JSON.parse(parsedValue);
    } catch {
      parsedValue = value;
    }
  }
  const rawValues = Array.isArray(parsedValue)
    ? parsedValue
    : String(parsedValue || "供应商")
      .replace(/，/g, ",")
      .replace(/、/g, ",")
      .split(",");
  const sources = rawValues
    .map(normalizeFeeItemCostSourceToken)
    .filter((source, index, list) => FEE_ITEM_COST_SOURCE_OPTIONS.includes(source) && list.indexOf(source) === index);
  return sources.length ? sources : ["供应商"];
}

function feeItemCostSourceText(value = "供应商") {
  return normalizeFeeItemCostSources(value).join(",");
}

function feeItemCategoryValue(category = "") {
  return normalizeFeeItemCategory(category);
}

function feeItemCostSourceValue(value = "供应商") {
  return feeItemCostSourceText(value);
}

function mapFeeItem(row) {
  const costSources = normalizeFeeItemCostSources(row.cost_source);
  return {
    id: row.id,
    category: feeItemCategoryValue(row.category),
    name: userTextValue(row.name),
    currency: userTextValue(row.currency),
    defaultAmount: row.default_amount,
    defaultDriverRole: userTextValue(row.default_driver_role),
    costSource: costSources.join(","),
    costSources,
    sortOrder: row.sort_order
  };
}

function mapFreightRate(row) {
  return {
    id: row.id,
    customerId: row.customer_id || "",
    customerName: userTextValue(row.customer_name),
    direction: userTextValue(row.direction),
    level1: userTextValue(row.level1 || row.city),
    level2: userTextValue(row.level2),
    level3: userTextValue(row.level3),
    city: userTextValue(row.city),
    tonnage: userTextValue(row.tonnage),
    rmbAmount: row.rmb_amount,
    hkdAmount: row.hkd_amount,
    sortOrder: row.sort_order,
    effectiveDate: row.effective_date || "1970-01-01",
    updatedAt: row.updated_at || ""
  };
}

function mapDriverWageRule(row) {
  let advanceFeeRates = {};
  try {
    advanceFeeRates = JSON.parse(row.advance_fee_rates || "{}") || {};
  } catch {
    advanceFeeRates = {};
  }
  return {
    id: row.id,
    driverId: row.driver_id,
    direction: userTextValue(row.direction),
    city: userTextValue(row.city),
    transportMode: normalizeTransportMode(row.transport_mode || "单司机") || "单司机",
    currency: userTextValue(row.currency),
    baseRMB: row.base_rmb,
    baseHKD: row.base_hkd,
    loadPerBoard: row.load_per_board,
    unloadPerBoard: row.unload_per_board,
    crossSeaFee: row.cross_sea_fee,
    addPointFee: row.add_point_fee,
    waitingPerHour: row.waiting_per_hour,
    advanceFeeRates,
    note: userTextValue(row.note)
  };
}

function normalizeCostCenterSource(value = "") {
  const source = normalizeFeeItemCostSourceToken(value);
  return FEE_ITEM_COST_SOURCE_OPTIONS.includes(source) ? source : "";
}

function normalizeCostCenterCurrency(value = "", fallback = "港币") {
  const text = String(value || "").trim().toUpperCase();
  if (text === "RMB" || text === "人民币") return "人民币";
  if (text === "HKD" || text === "港币") return "港币";
  return fallback === "人民币" ? "人民币" : "港币";
}

function normalizeCostCenterValue(value = 0, fallbackCurrency = "港币") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const amount = Number(value.amount ?? value.value ?? value.cost ?? 0);
    return {
      amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
      currency: normalizeCostCenterCurrency(value.currency, fallbackCurrency)
    };
  }
  const amount = Number(value || 0);
  return {
    amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
    currency: normalizeCostCenterCurrency("", fallbackCurrency)
  };
}

function normalizeCostCenterValues(value = {}, fallbackCurrency = "港币") {
  let parsedValue = value;
  if (typeof parsedValue === "string") {
    try {
      parsedValue = JSON.parse(parsedValue || "{}") || {};
    } catch {
      parsedValue = {};
    }
  }
  return Object.fromEntries(
    Object.entries(parsedValue || {})
      .map(([key, amount]) => [String(key), normalizeCostCenterValue(amount, fallbackCurrency)])
      .filter(([key]) => key)
  );
}

function mapCostCenterRate(row) {
  const source = normalizeCostCenterSource(row.source);
  return {
    id: row.id,
    source,
    entityId: row.entity_id || "",
    entityName: userTextValue(row.entity_name),
    origin: userTextValue(row.origin),
    destination: userTextValue(row.destination),
    tonnage: userTextValue(row.tonnage || (source === "供应商" ? "3T" : "")),
    currency: userTextValue(row.currency || "港币"),
    costValues: normalizeCostCenterValues(row.cost_values, row.currency || "港币"),
    note: userTextValue(row.note),
    effectiveDate: row.effective_date || "1970-01-01",
    updatedAt: row.updated_at || row.created_at || ""
  };
}

function normalizePeriodMonthKey(value = "") {
  const matched = String(value || "").trim().match(/^(\d{4})-(\d{1,2})/);
  if (!matched) return "";
  const monthNumber = Number(matched[2]);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return "";
  return `${matched[1]}-${String(monthNumber).padStart(2, "0")}`;
}

function normalizeVehicleProfitExchangeRate(value = VEHICLE_PROFIT_DEFAULT_EXCHANGE_RATE) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : VEHICLE_PROFIT_DEFAULT_EXCHANGE_RATE;
}

function mapVehicleProfitExchangeRate(row) {
  return {
    id: row.id,
    periodMonth: row.period_month || "",
    rate: normalizeVehicleProfitExchangeRate(row.rate),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || ""
  };
}

function mapCompanyExpense(row) {
  return {
    id: row.id,
    entryType: row.entry_type || "expense",
    periodMonth: row.period_month || "",
    category: row.category || "",
    employeeName: row.employee_name || "",
    amount: Number(row.amount || 0),
    note: row.note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || row.created_at || ""
  };
}

function readCompanyExpensePayload(body = {}, current = null) {
  const entryType = String(body.entryType ?? body.entry_type ?? current?.entry_type ?? "expense").trim();
  return {
    entryType: entryType === "income" ? "income" : "expense",
    periodMonth: normalizePeriodMonthKey(body.periodMonth ?? body.period_month ?? body.month ?? current?.period_month ?? ""),
    category: userTextValue(body.category ?? current?.category ?? ""),
    employeeName: userTextValue(body.employeeName ?? body.employee_name ?? current?.employee_name ?? ""),
    amount: Number(body.amount ?? current?.amount ?? 0),
    note: userTextValue(body.note ?? current?.note ?? "")
  };
}

function companyExpenseRequiresEmployeeName(item = {}) {
  return String(item.entryType || "").trim() === "expense" && String(item.category || "").trim() === "员工工资";
}

function validateCompanyExpensePayload(item = {}) {
  if (!item.periodMonth) return "请选择有效月份";
  if (!item.category) return "请填写项目名称";
  if (!Number.isFinite(item.amount) || item.amount <= 0) return "请填写大于 0 的金额";
  if (companyExpenseRequiresEmployeeName(item) && !String(item.employeeName || "").trim()) {
    return "请填写员工姓名";
  }
  return "";
}

function readCostCenterRatePayload(body = {}, current = null) {
  const origin = userTextValue(body.origin ?? current?.origin ?? "");
  const destination = userTextValue(body.destination ?? current?.destination ?? "");
  const source = normalizeCostCenterSource(body.source ?? current?.source ?? "");
  const tonnage = userTextValue(body.tonnage ?? current?.tonnage ?? "") || (source === "供应商" ? "3T" : "");
  const fallbackEffectiveDate = current?.effective_date || todayInputValue();
  const entityName = userTextValue(body.entityName ?? body.entity_name ?? current?.entity_name ?? "")
    || [origin, destination].filter(Boolean).join(" - ")
    || source;
  return {
    source,
    entityId: String(body.entityId ?? body.entity_id ?? current?.entity_id ?? "").trim(),
    entityName,
    origin,
    destination,
    tonnage,
    currency: normalizeCostCenterCurrency(body.currency ?? current?.currency ?? "港币"),
    costValues: JSON.stringify(normalizeCostCenterValues(
      body.costValues ?? body.cost_values ?? current?.cost_values,
      body.currency ?? current?.currency ?? "港币"
    )),
    note: userTextValue(body.note ?? current?.note ?? ""),
    effectiveDate: normalizeEffectiveDate(
      body.effectiveDate ?? body.effective_date ?? body.modifiedDate ?? body.modified_date ?? current?.effective_date,
      fallbackEffectiveDate
    )
  };
}

function mapDriverAdjustment(row) {
  return {
    id: row.id,
    driverId: row.driver_id,
    date: row.date,
    type: row.type,
    currency: row.currency,
    amount: row.amount,
    status: row.status,
    note: row.note,
    createdAt: row.created_at
  };
}

function parseJsonArrayText(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeOrderFeeCostSplitPart(part = {}, index = 0) {
  const fallbackCurrency = index === 1 ? "人民币" : "港币";
  const rawAmount = Number(part.amount ?? part.sourceAmount ?? 0);
  return {
    role: userTextValue(part.role || (index === 0 ? "香港司机" : "大陆骑师")),
    driverName: userTextValue(part.driverName || part.driver_name),
    currency: normalizeCostCenterCurrency(part.currency || part.sourceCurrency || fallbackCurrency, fallbackCurrency),
    amount: Number.isFinite(rawAmount) && rawAmount >= 0 ? Number(rawAmount.toFixed(2)) : 0,
    matched: Boolean(part.matched)
  };
}

function normalizeOrderFeeCostParts(value = []) {
  const source = Array.isArray(value) ? value : parseJsonArrayText(value);
  return source.map((part, index) => normalizeOrderFeeCostSplitPart(part, index));
}

function mapDriverRouteAdjustRule(row) {
  const driverIds = parseJsonArrayText(row.driver_ids)
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const driverNames = parseJsonArrayText(row.driver_names)
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  return {
    id: row.id,
    sourceKey: row.source_key || "",
    customerName: row.customer_name || "",
    driverIds,
    driverNames,
    driverId: row.driver_id || "",
    driverName: row.driver_name || "",
    transportMode: normalizeTransportMode(row.transport_mode || ""),
    loading: row.loading || "",
    unloading: row.unloading || "",
    amountHKD: row.amount_hkd || 0,
    amountRMB: row.amount_rmb || 0,
    note: row.note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function mapStatementDownload(row) {
  const type = normalizeStatementType(row.statement_type || "customer");
  const status = normalizeStatementDownloadStatus(row.status || "已导出", type);
  const paymentStatus = statementStatusIsSettled(status, type)
    ? statementFinalStatusForType(type)
    : normalizeStatementPaymentStatus(row.payment_status || "未收款", type);
  return {
    id: row.id,
    key: row.download_key || "",
    downloadKey: row.download_key || "",
    type,
    statementType: type,
    entityName: row.entity_name || "全部",
    start: row.start_date || "",
    end: row.end_date || "",
    periodKey: row.period_key || "",
    periodMode: row.period_mode || inferStatementPeriodMode(row.period_key || "") || inferStatementPeriodModeFromRange(row.start_date, row.end_date),
    status,
    paymentStatus,
    paymentDate: row.payment_date || "",
    amountHKD: Number(row.amount_hkd || 0),
    amountRMB: Number(row.amount_rmb || 0),
    recordCount: Number(row.record_count || 0),
    snapshotReady: Boolean(row.snapshot_ready),
    downloadedAt: row.downloaded_at || row.updated_at || row.created_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function mapCustomsBusiness(row) {
  const customFields = normalizeCustomsBusinessCustomFields(row.custom_fields);
  const knownTotalWithoutHomeFee = Number(row.customs_fee || 0)
    + Number(row.page_fee || 0)
    + Number(row.manifest_fee || 0)
    + Number(row.inspection_fee || 0)
    + Number(row.check_fee || 0)
    + Number(row.verification_fee || 0)
    + customsBusinessCustomFieldsTotal(customFields);
  return {
    id: row.id,
    date: row.business_date || "",
    declarationNo: userTextValue(row.declaration_no),
    sixSheetNo: userTextValue(row.six_sheet_no),
    company: userTextValue(row.company),
    direction: userTextValue(row.direction),
    itemCount: Number(row.item_count || 0),
    pageCount: Number(row.page_count || 0),
    homeFee: 0,
    customsFee: Number(row.customs_fee || 0),
    pageFee: Number(row.page_fee || 0),
    manifestFee: Number(row.manifest_fee || 0),
    inspectionFee: Number(row.inspection_fee || 0),
    checkFee: Number(row.check_fee || 0),
    verificationFee: Number(row.verification_fee || 0),
    otherFee: Number(row.other_fee || 0),
    customFields,
    total: Number(row.total || 0),
    remark: userTextValue(row.remark),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    deletedAt: row.deleted_at || ""
  };
}

function mapOtherBusiness(row) {
  return {
    id: row.id,
    date: row.business_date || "",
    title: userTextValue(row.title),
    customer: userTextValue(row.customer),
    cost: Number(row.cost || 0),
    income: Number(row.income || 0),
    customFields: normalizeOtherBusinessCustomFields(row.custom_fields),
    totalCost: Number(row.total_cost || 0),
    totalIncome: Number(row.total_income || 0),
    profit: Number(row.profit || 0),
    remark: userTextValue(row.remark),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    deletedAt: row.deleted_at || ""
  };
}

function normalizeCustomsBusinessDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayInputValue();
}

function normalizeCustomsMonth(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(text) ? text : todayInputValue().slice(0, 7);
}

function normalizeCustomsYear(value) {
  const text = String(value || "").trim().slice(0, 4);
  return /^\d{4}$/.test(text) ? text : todayInputValue().slice(0, 4);
}

function nextMonthValue(month) {
  const [year, monthIndex] = normalizeCustomsMonth(month).split("-").map(Number);
  const next = new Date(year, monthIndex, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function dateInputFromDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function parseInputDate(value) {
  const text = String(value || "").trim();
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return dateInputFromDate(date) === text ? date : null;
}

function addInputDays(value, days) {
  const date = parseInputDate(value) || parseInputDate(todayInputValue()) || new Date();
  date.setDate(date.getDate() + Number(days || 0));
  return dateInputFromDate(date);
}

function addInputYears(value, years) {
  const date = parseInputDate(value) || parseInputDate(todayInputValue()) || new Date();
  date.setFullYear(date.getFullYear() + Number(years || 0));
  return dateInputFromDate(date);
}

const EXPIRY_REMINDER_WINDOW_DAYS = 30;
const VEHICLE_EXPIRY_REMINDER_FIELDS = [
  { field: "mainland_review_date", camelField: "mainlandReviewDate", label: "大陆年审", type: "mainlandReview" },
  { field: "hk_review_date", camelField: "hkReviewDate", label: "香港年审", type: "hkReview" },
  { field: "mainland_insurance_date", camelField: "mainlandInsuranceDate", label: "大陆保险", type: "mainlandInsurance" },
  { field: "hk_insurance_date", camelField: "hkInsuranceDate", label: "香港保险", type: "hkInsurance" },
  { field: "maintenance_due_date", camelField: "maintenanceDueDate", label: "保养", type: "maintenance" }
];

function inputDateDaysUntil(value, referenceValue = todayInputValue()) {
  const target = parseInputDate(value);
  const reference = parseInputDate(referenceValue);
  if (!target || !reference) return null;
  const targetUtc = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  const referenceUtc = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
  return Math.ceil((targetUtc - referenceUtc) / 86400000);
}

function expiryReminderStatus(days) {
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  return "upcoming";
}

function expiryReminderSeverity(days) {
  if (days <= 0 || days <= 7) return "danger";
  return "warning";
}

function expiryReminderStatusText(days) {
  if (days < 0) return "已过期";
  if (days === 0) return "今天到期";
  if (days <= 7) return "7天内到期";
  return "30天内到期";
}

function expiryReminderMessage(owner, itemLabel, days) {
  if (days < 0) return `${owner}${itemLabel}已过期${Math.abs(days)}天`;
  if (days === 0) return `${owner}${itemLabel}今天到期`;
  return `${owner}${itemLabel}到期还剩${days}天`;
}

function expiryReminderSortRank(days) {
  if (days < 0) return 0;
  if (days === 0) return 1;
  if (days <= 7) return 2;
  return 3;
}

function buildExpiryReminderRow(source = {}, options = {}) {
  const expireDate = String(options.expireDate || "").trim();
  const days = inputDateDaysUntil(expireDate, options.referenceDate);
  if (days === null || days > EXPIRY_REMINDER_WINDOW_DAYS) return null;
  const entityName = String(options.entityName || "").trim();
  const itemLabel = String(options.itemLabel || "").trim();
  const key = [
    options.entityType,
    options.entityId,
    options.field,
    expireDate
  ].map((part) => String(part || "").trim()).join(":");
  if (!entityName || !itemLabel || !key || key.includes("::")) return null;
  return {
    key,
    entityType: options.entityType,
    entityId: String(options.entityId || "").trim(),
    entityName,
    entityLabel: options.entityLabel || entityName,
    itemType: options.itemType || options.field,
    itemLabel,
    field: options.camelField || options.field,
    expireDate,
    days,
    status: expiryReminderStatus(days),
    statusText: expiryReminderStatusText(days),
    severity: expiryReminderSeverity(days),
    message: expiryReminderMessage(entityName, itemLabel, days),
    sourceStatus: source.status || "",
    sortRank: expiryReminderSortRank(days)
  };
}

function summarizeExpiryReminderRows(rows = []) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    if (!row.acknowledged) summary.unacknowledged += 1;
    if (row.entityType === "driver") summary.drivers += 1;
    if (row.entityType === "vehicle") summary.vehicles += 1;
    if (row.days < 0) summary.overdue += 1;
    if (row.days === 0) summary.dueToday += 1;
    if (row.days >= 0 && row.days <= 7) summary.dueIn7 += 1;
    if (row.days >= 0 && row.days <= EXPIRY_REMINDER_WINDOW_DAYS) summary.dueIn30 += 1;
    return summary;
  }, {
    total: 0,
    unacknowledged: 0,
    overdue: 0,
    dueToday: 0,
    dueIn7: 0,
    dueIn30: 0,
    drivers: 0,
    vehicles: 0
  });
}

async function loadExpiryReminderRowsForAccount(accountId) {
  const referenceDate = todayInputValue();
  const [vehicleRows, driverRows, ackRows] = await Promise.all([
    db.prepare("SELECT * FROM vehicles WHERE deleted_at IS NULL ORDER BY plate ASC").all(),
    db.prepare("SELECT * FROM drivers WHERE deleted_at IS NULL ORDER BY id ASC").all(),
    accountId
      ? db.prepare("SELECT reminder_key, acknowledged_at FROM reminder_acknowledgements WHERE account_id = ?").all(accountId)
      : Promise.resolve([])
  ]);
  const acknowledgementMap = new Map(
    ackRows.map((row) => [row.reminder_key, row.acknowledged_at || ""])
  );
  const rows = [];
  for (const vehicle of vehicleRows) {
    for (const config of VEHICLE_EXPIRY_REMINDER_FIELDS) {
      const row = buildExpiryReminderRow(vehicle, {
        referenceDate,
        entityType: "vehicle",
        entityId: vehicle.plate,
        entityName: vehicle.plate,
        entityLabel: "车辆",
        field: config.field,
        camelField: config.camelField,
        itemType: config.type,
        itemLabel: config.label,
        expireDate: vehicle[config.field]
      });
      if (row) rows.push(row);
    }
  }
  for (const driver of driverRows) {
    const row = buildExpiryReminderRow(driver, {
      referenceDate,
      entityType: "driver",
      entityId: driver.id,
      entityName: driver.name,
      entityLabel: driver.type || "司机",
      field: "expire_at",
      camelField: "expireAt",
      itemType: "driverCertificate",
      itemLabel: `${driver.type || "司机"}证件`,
      expireDate: driver.expire_at
    });
    if (row) rows.push(row);
  }
  rows.forEach((row) => {
    row.acknowledged = acknowledgementMap.has(row.key);
    row.acknowledgedAt = acknowledgementMap.get(row.key) || "";
  });
  rows.sort((left, right) =>
    left.sortRank - right.sortRank
    || left.days - right.days
    || left.entityType.localeCompare(right.entityType)
    || left.entityName.localeCompare(right.entityName, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
    || left.itemLabel.localeCompare(right.itemLabel, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
  );
  const summary = summarizeExpiryReminderRows(rows);
  return {
    rows,
    unacknowledgedRows: rows.filter((row) => !row.acknowledged),
    summary,
    today: referenceDate,
    windowDays: EXPIRY_REMINDER_WINDOW_DAYS
  };
}

function normalizeDispatchPlanDate(value, fallback = todayInputValue()) {
  const text = String(value || "").trim();
  return parseInputDate(text) ? text : fallback;
}

function dispatchPlanPeriodBounds(query = {}) {
  const period = String(query.period || "").trim() || "today";
  if (period === "all") return { start: "", end: "" };

  const today = parseInputDate(todayInputValue()) || new Date();
  const singleDay = (offset) => {
    const startDate = new Date(today);
    startDate.setDate(today.getDate() + offset);
    const start = dateInputFromDate(startDate);
    return { start, end: addInputDays(start, 1) };
  };

  if (period === "yesterday") return singleDay(-1);
  if (period === "today") return singleDay(0);
  if (period === "tomorrow") return singleDay(1);

  if (period === "week") {
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const start = dateInputFromDate(startDate);
    return { start, end: addInputDays(start, 7) };
  }

  if (period === "month") {
    const start = dateInputFromDate(new Date(today.getFullYear(), today.getMonth(), 1));
    const end = dateInputFromDate(new Date(today.getFullYear(), today.getMonth() + 1, 1));
    return { start, end };
  }

  if (period === "lastMonth") {
    const start = dateInputFromDate(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    const end = dateInputFromDate(new Date(today.getFullYear(), today.getMonth(), 1));
    return { start, end };
  }

  if (period === "custom") {
    const start = normalizeDispatchPlanDate(query.start || query.from || query.begin);
    const end = normalizeDispatchPlanDate(query.end || query.to, start);
    const first = start <= end ? start : end;
    const last = start <= end ? end : start;
    return { start: first, end: addInputDays(last, 1) };
  }

  return singleDay(0);
}

function customsBusinessPeriodBounds(query = {}) {
  const period = String(query.period || "").trim();
  const mode = String(query.mode || "").trim();
  if (period === "all" || mode === "all") return { start: "", end: "" };

  if (["yesterday", "today", "tomorrow", "week", "month", "lastMonth"].includes(period)) {
    return dispatchPlanPeriodBounds({ period });
  }

  const periodDayMatched = period.match(/^day:(\d{4}-\d{2}-\d{2})$/);
  if (periodDayMatched || mode === "day") {
    const day = normalizeCustomsBusinessDate(periodDayMatched?.[1] || query.day || query.date);
    return { start: day, end: addInputDays(day, 1) };
  }

  const rangeMatched = period.match(/^range:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  if (rangeMatched || mode === "range") {
    const start = normalizeCustomsBusinessDate(rangeMatched?.[1] || query.start || query.from || query.begin);
    const end = normalizeCustomsBusinessDate(rangeMatched?.[2] || query.end || query.to);
    const first = start <= end ? start : end;
    const last = start <= end ? end : start;
    return { start: first, end: addInputDays(last, 1) };
  }

  const periodYearMatched = period.match(/^year:(\d{4})$/);
  if (periodYearMatched || mode === "year") {
    const year = normalizeCustomsYear(periodYearMatched?.[1] || query.year);
    return { start: `${year}-01-01`, end: `${Number(year) + 1}-01-01` };
  }

  const month = normalizeCustomsMonth(period || query.month);
  return { start: `${month}-01`, end: `${nextMonthValue(month)}-01` };
}

const CUSTOMS_STATEMENT_EXPORT_COLUMNS = [
  { key: "__sequence", label: "序号", width: 8, pdfWidth: 26, align: "center" },
  { key: "date", label: "日期", width: 12, pdfWidth: 52 },
  { key: "declarationNo", label: "报关单号", width: 18, pdfWidth: 70 },
  { key: "sixSheetNo", label: "六联单号", width: 16, pdfWidth: 60 },
  { key: "company", label: "客户", width: 28, pdfWidth: 110 },
  { key: "direction", label: "进出口", width: 10, pdfWidth: 42 },
  { key: "itemCount", label: "品名项数", width: 10, pdfWidth: 34, amount: true },
  { key: "pageCount", label: "续页", width: 8, pdfWidth: 30, amount: true },
  { key: "pageFee", label: "续页费", width: 11, pdfWidth: 44, amount: true },
  { key: "customsFee", label: "报关费", width: 11, pdfWidth: 44, amount: true },
  { key: "manifestFee", label: "舱单费", width: 11, pdfWidth: 44, amount: true },
  { key: "inspectionFee", label: "报检费", width: 11, pdfWidth: 44, amount: true },
  { key: "checkFee", label: "查验费", width: 11, pdfWidth: 44, amount: true },
  { key: "verificationFee", label: "核注费", width: 11, pdfWidth: 44, amount: true },
  { key: "otherFee", label: "其他费用", width: 12, pdfWidth: 44, amount: true },
  { key: "total", label: "合计", width: 12, pdfWidth: 48, amount: true },
  { key: "remark", label: "备注", width: 20, pdfWidth: 66 }
];

const CUSTOMS_STATEMENT_EXPORT_COLUMN_MAP = new Map(
  CUSTOMS_STATEMENT_EXPORT_COLUMNS.map((column) => [column.key, column])
);

function customsStatementSafeCompany(value = "") {
  return String(value || "").trim() || "未填写客户";
}

function customsStatementFilename(company = "客户", start = "", end = "", extension = "xlsx") {
  return `${exportFilenamePart(company)}_报关对账_${start || "全部"}_${end || "全部"}.${extension}`;
}

function normalizeCustomsStatementExportColumns(columns = []) {
  const normalized = [];
  const seen = new Set(["__sequence", "actions"]);
  if (Array.isArray(columns)) {
    columns.forEach((column) => {
      const key = String(column?.key || "").trim();
      if (!key || seen.has(key)) return;
      if (key.startsWith("custom:")) {
        const label = String(column?.label || key.slice(7)).trim().slice(0, 40);
        if (!label) return;
        normalized.push({ key, label, width: Math.max(10, Math.min(24, Math.ceil(label.length * 1.6 + 6))), pdfWidth: 44, amount: true, custom: true });
        seen.add(key);
        return;
      }
      const baseColumn = CUSTOMS_STATEMENT_EXPORT_COLUMN_MAP.get(key);
      if (!baseColumn) return;
      normalized.push({
        ...baseColumn,
        label: String(column?.label || baseColumn.label || key).trim().slice(0, 40) || baseColumn.label
      });
      seen.add(key);
    });
  }
  const columnsWithSequence = [
    CUSTOMS_STATEMENT_EXPORT_COLUMN_MAP.get("__sequence"),
    ...(normalized.length ? normalized : CUSTOMS_STATEMENT_EXPORT_COLUMNS.filter((column) => column.key !== "__sequence"))
  ].filter(Boolean);
  return columnsWithSequence;
}

function customsStatementExportValue(row = {}, column = {}, index = 0) {
  if (column.key === "__sequence") return index + 1;
  if (column.custom) {
    const name = String(column.key || "").slice(7);
    const customField = normalizeCustomsBusinessCustomFields(row.customFields).find((field) => field.name === name);
    return customField ? Number(customField.value || 0) || "" : "";
  }
  const value = row[column.key];
  if (column.amount) return Number(value || 0) || "";
  return value ?? "";
}

function customsStatementExportRows(rows = [], columns = CUSTOMS_STATEMENT_EXPORT_COLUMNS) {
  return rows.map((row, index) =>
    columns.map((column) => customsStatementExportValue(row, column, index))
  );
}

function customsStatementTotalRow(rows = [], columns = CUSTOMS_STATEMENT_EXPORT_COLUMNS) {
  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  return columns.map((column, index) => {
    if (index === 0) return "合计";
    if (column.key === "total") return total || "";
    return "";
  });
}

async function loadCustomsStatementExportRows(company = "", period = "") {
  const targetCompany = customsStatementSafeCompany(company);
  const { start, end } = customsBusinessPeriodBounds({ period });
  const dateWhere = start && end ? "AND business_date >= ? AND business_date < ?" : "";
  const params = start && end ? [start, end] : [];
  const rows = await db.prepare(`
    SELECT * FROM customs_businesses
    WHERE deleted_at IS NULL
      ${dateWhere}
    ORDER BY business_date ASC, declaration_no ASC, six_sheet_no ASC, id ASC
  `).all(...params);
  return rows
    .map(mapCustomsBusiness)
    .filter((row) => customsStatementSafeCompany(row.company) === targetCompany);
}

function customsStatementExportContext(body = {}) {
  const company = customsStatementSafeCompany(body.company);
  const period = String(body.period || "").trim() || "all";
  const start = String(body.start || "").trim();
  const end = String(body.end || "").trim();
  const rangeLabel = start || end ? `${start || "全部"} 至 ${end || "全部"}` : "全部";
  const title = String(body.title || `${company}报关对账单`).trim() || `${company}报关对账单`;
  const columns = normalizeCustomsStatementExportColumns(body.columns);
  return { company, period, start, end, rangeLabel, title, columns };
}

const CUSTOMS_STATEMENT_OUTER_BORDER = { style: "medium", color: { argb: "FF000000" } };
const CUSTOMS_STATEMENT_INNER_BORDER = { style: "thin", color: { argb: "FF9CA3AF" } };
const CUSTOMS_STATEMENT_HEADER_BORDER = { style: "thin", color: { argb: "FF6B7280" } };

function customsStatementTableBorder(rowNumber, columnNumber, tableStartRow, tableEndRow, lastColumn, options = {}) {
  const isHeader = rowNumber === tableStartRow;
  const isTotal = Boolean(options.isTotal);
  const isFirstColumn = columnNumber === 1;
  const isLastColumn = columnNumber === lastColumn;
  if (isHeader) {
    return {
      top: CUSTOMS_STATEMENT_OUTER_BORDER,
      left: isFirstColumn ? CUSTOMS_STATEMENT_OUTER_BORDER : CUSTOMS_STATEMENT_HEADER_BORDER,
      right: isLastColumn ? CUSTOMS_STATEMENT_OUTER_BORDER : CUSTOMS_STATEMENT_HEADER_BORDER,
      bottom: CUSTOMS_STATEMENT_OUTER_BORDER
    };
  }
  return {
    top: isTotal ? CUSTOMS_STATEMENT_OUTER_BORDER : CUSTOMS_STATEMENT_INNER_BORDER,
    left: isFirstColumn ? CUSTOMS_STATEMENT_OUTER_BORDER : CUSTOMS_STATEMENT_INNER_BORDER,
    right: isLastColumn ? CUSTOMS_STATEMENT_OUTER_BORDER : CUSTOMS_STATEMENT_INNER_BORDER,
    bottom: isTotal || rowNumber === tableEndRow ? CUSTOMS_STATEMENT_OUTER_BORDER : CUSTOMS_STATEMENT_INNER_BORDER
  };
}

async function renderCustomsStatementXlsxBuffer(rows = [], context = {}) {
  const columns = Array.isArray(context.columns) && context.columns.length ? context.columns : CUSTOMS_STATEMENT_EXPORT_COLUMNS;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "汉业管理系统";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("报关对账");
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.25,
      right: 0.25,
      top: 0.35,
      bottom: 0.35,
      header: 0.1,
      footer: 0.1
    }
  };
  columns.forEach((column, index) => {
    worksheet.getColumn(index + 1).width = column.width;
  });
  const mergeEndColumn = columns.length;
  worksheet.mergeCells(1, 1, 1, mergeEndColumn);
  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = context.title || "报关对账单";
  titleCell.font = { name: "Microsoft YaHei", size: 16, bold: true, color: { argb: "FF17233C" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
  worksheet.getRow(1).height = 28;

  worksheet.mergeCells(2, 1, 2, mergeEndColumn);
  const metaCell = worksheet.getCell(2, 1);
  metaCell.value = `客户：${context.company || ""}    范围：${context.rangeLabel || "全部"}    记录：${rows.length} 条`;
  metaCell.font = { name: "Microsoft YaHei", size: 10, color: { argb: "FF475569" } };
  metaCell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
  worksheet.getRow(2).height = 22;

  const tableStartRow = 4;
  const bodyRows = [...customsStatementExportRows(rows, columns), customsStatementTotalRow(rows, columns)];
  const tableEndRow = tableStartRow + bodyRows.length;
  const headerRow = worksheet.getRow(tableStartRow);
  headerRow.values = columns.map((column) => column.label);
  headerRow.height = 36;
  for (let columnNumber = 1; columnNumber <= mergeEndColumn; columnNumber += 1) {
    const cell = headerRow.getCell(columnNumber);
    cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "FF1F2A44" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = customsStatementTableBorder(tableStartRow, columnNumber, tableStartRow, tableEndRow, mergeEndColumn);
  }

  bodyRows.forEach((values, rowIndex) => {
    const isTotalRow = rowIndex === bodyRows.length - 1;
    const rowNumber = tableStartRow + 1 + rowIndex;
    const row = worksheet.getRow(rowNumber);
    row.values = values.map(excelSingleLineValue);
    row.height = isTotalRow ? 26 : 24;
    for (let columnNumber = 1; columnNumber <= mergeEndColumn; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      const column = columns[columnNumber - 1] || {};
      if (column.amount && cell.value !== "") cell.numFmt = "#,##0";
      cell.font = { name: "Microsoft YaHei", size: 10, bold: isTotalRow, color: { argb: "FF17233C" } };
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: false
      };
      if (isTotalRow) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
      }
      cell.border = customsStatementTableBorder(rowNumber, columnNumber, tableStartRow, tableEndRow, mergeEndColumn, { isTotal: isTotalRow });
    }
  });
  worksheet.views = [{ state: "frozen", ySplit: tableStartRow }];
  return workbook.xlsx.writeBuffer();
}

function customsPdfText(doc, text, x, y, options = {}, bold = false) {
  doc.text(textValue(text), x, y, options);
  if (bold) doc.text(textValue(text), x + 0.15, y, options);
}

function drawCustomsPdfCell(doc, text, x, y, width, height, options = {}) {
  const fill = options.fill || "#ffffff";
  const stroke = options.stroke || "#d9e3f2";
  doc.save();
  doc.rect(x, y, width, height).fillAndStroke(fill, stroke);
  doc.restore();
  doc.fillColor(options.color || "#17233c").fontSize(options.fontSize || 6.2);
  customsPdfText(
    doc,
    text,
    x + 2,
    y + 4,
    {
      width: Math.max(4, width - 4),
      height: Math.max(4, height - 6),
      align: options.align || "left",
      ellipsis: true,
      lineGap: 0.5
    },
    Boolean(options.bold)
  );
}

function customsPdfRowHeight(doc, values = [], columns = CUSTOMS_STATEMENT_EXPORT_COLUMNS, fontSize = 6.2) {
  doc.fontSize(fontSize);
  return Math.min(54, Math.max(18, Math.ceil(values.reduce((height, value, index) => {
    const width = Number(columns[index]?.pdfWidth || 40) - 4;
    return Math.max(height, doc.heightOfString(textValue(value), { width, lineGap: 0.5 }) + 8);
  }, 0))));
}

function renderCustomsStatementPdf(res, rows = [], context = {}, filename = "") {
  const columns = Array.isArray(context.columns) && context.columns.length ? context.columns : CUSTOMS_STATEMENT_EXPORT_COLUMNS;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 18, bufferPages: true });
  const fontConfig = resolvePdfFontConfig();
  let fontUnavailable = false;
  function usePdfFont() {
    if (!fontConfig || fontUnavailable) return;
    try {
      if (fontConfig.family) doc.font(fontConfig.path, fontConfig.family);
      else doc.font(fontConfig.path);
    } catch (error) {
      fontUnavailable = true;
      console.warn(`PDF font unavailable: ${fontConfig.path}`, error.message);
    }
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", contentDispositionHeader("attachment", filename || "报关对账单.pdf"));
  doc.pipe(res);
  usePdfFont();

  const pageLeft = doc.page.margins.left;
  const pageTop = doc.page.margins.top;
  const pageBottom = doc.page.height - doc.page.margins.bottom;
  const tableWidth = columns.reduce((sum, column) => sum + Number(column.pdfWidth || 0), 0);
  const tableLeft = pageLeft + Math.max(0, (doc.page.width - pageLeft - doc.page.margins.right - tableWidth) / 2);
  let y = pageTop;

  function drawTitle() {
    usePdfFont();
    doc.fillColor("#17233c").fontSize(15);
    customsPdfText(doc, context.title || "报关对账单", tableLeft, y, { width: tableWidth, align: "center" }, true);
    y += 24;
    doc.fillColor("#64748b").fontSize(8);
    customsPdfText(
      doc,
      `客户：${context.company || ""}    范围：${context.rangeLabel || "全部"}    记录：${rows.length} 条`,
      tableLeft,
      y,
      { width: tableWidth, align: "center" }
    );
    y += 18;
  }

  function drawTableHeader() {
    let x = tableLeft;
    columns.forEach((column) => {
      drawCustomsPdfCell(doc, column.label, x, y, column.pdfWidth, 20, {
        fill: "#f1f5f9",
        bold: true,
        align: "center",
        fontSize: 6.5
      });
      x += column.pdfWidth;
    });
    y += 20;
  }

  function ensureRowSpace(height) {
    if (y + height <= pageBottom) return;
    doc.addPage({ size: "A4", layout: "landscape", margin: 18 });
    y = pageTop;
    drawTitle();
    drawTableHeader();
  }

  drawTitle();
  drawTableHeader();
  const bodyRows = [...customsStatementExportRows(rows, columns), customsStatementTotalRow(rows, columns)];
  bodyRows.forEach((values, rowIndex) => {
    const isTotalRow = rowIndex === bodyRows.length - 1;
    const height = customsPdfRowHeight(doc, values, columns);
    ensureRowSpace(height);
    let x = tableLeft;
    values.forEach((value, columnIndex) => {
      const column = columns[columnIndex] || {};
      const displayValue = column.amount && value !== "" ? formatExportAmount(value, false) : value;
      drawCustomsPdfCell(doc, displayValue, x, y, column.pdfWidth, height, {
        fill: isTotalRow ? "#f1f5f9" : "#ffffff",
        bold: isTotalRow,
        align: column.amount ? "right" : (column.align || "left"),
        fontSize: 6.2
      });
      x += column.pdfWidth;
    });
    y += height;
  });
  doc.end();
}

function numberField(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function integerField(value) {
  const number = numberField(value);
  if (number < 0) return 0;
  return Math.round(number);
}

function moneyNumberField(value) {
  const number = numberField(value);
  if (number < 0) return 0;
  return Number(number.toFixed(2));
}

function signedMoneyNumberField(value) {
  const number = numberField(value);
  return Number(number.toFixed(2));
}

function normalizeCustomsBusinessCustomFields(value = []) {
  const source = Array.isArray(value) ? value : parseJsonArrayText(value);
  const fieldsByName = new Map();
  source.forEach((field) => {
    const name = userTextValue(field?.name ?? field?.label ?? field?.key ?? "");
    if (!name) return;
    const amount = integerField(field?.value ?? field?.amount ?? field?.fee);
    fieldsByName.set(name, {
      name,
      value: integerField((fieldsByName.get(name)?.value || 0) + amount)
    });
  });
  return Array.from(fieldsByName.values()).slice(0, 40);
}

function normalizeOtherBusinessCustomFields(value = []) {
  const source = Array.isArray(value) ? value : parseJsonArrayText(value);
  const fieldsByName = new Map();
  source.forEach((field) => {
    const name = userTextValue(field?.name ?? field?.label ?? field?.key ?? "");
    if (!name) return;
    const existing = fieldsByName.get(name) || { name, income: 0, cost: 0 };
    existing.income = moneyNumberField(existing.income + moneyNumberField(field?.income ?? field?.revenue ?? field?.amount ?? field?.value));
    existing.cost = moneyNumberField(existing.cost + moneyNumberField(field?.cost ?? field?.expense));
    existing.profit = signedMoneyNumberField(existing.income - existing.cost);
    fieldsByName.set(name, existing);
  });
  return Array.from(fieldsByName.values()).slice(0, 40);
}

function customsBusinessCustomFieldsTotal(fields = []) {
  return normalizeCustomsBusinessCustomFields(fields).reduce((sum, field) => sum + integerField(field.value), 0);
}

function otherBusinessCustomFieldsBreakdown(fields = []) {
  return normalizeOtherBusinessCustomFields(fields).reduce((sum, field) => ({
    income: sum.income + moneyNumberField(field.income),
    cost: sum.cost + moneyNumberField(field.cost)
  }), { income: 0, cost: 0 });
}

function normalizeCustomsBusinessPayload(body = {}) {
  const direction = userTextValue(body.direction ?? "");
  const homeFee = 0;
  const customsFee = integerField(body.customsFee ?? body.customs_fee);
  const pageFee = integerField(body.pageFee ?? body.page_fee);
  const manifestFee = integerField(body.manifestFee ?? body.manifest_fee);
  const inspectionFee = integerField(body.inspectionFee ?? body.inspection_fee);
  const checkFee = integerField(body.checkFee ?? body.check_fee);
  const verificationFee = ["金二进口", "金二出口"].includes(direction)
    ? integerField(body.verificationFee ?? body.verification_fee)
    : 0;
  const otherFee = integerField(body.otherFee ?? body.other_fee);
  const customFields = normalizeCustomsBusinessCustomFields(body.customFields ?? body.custom_fields);
  const computedTotal = customsFee + pageFee + manifestFee + inspectionFee + checkFee + verificationFee
    + customsBusinessCustomFieldsTotal(customFields);
  return {
    date: normalizeCustomsBusinessDate(body.date ?? body.businessDate ?? body.business_date),
    declarationNo: userTextValue(body.declarationNo ?? body.declaration_no ?? ""),
    sixSheetNo: userTextValue(body.sixSheetNo ?? body.six_sheet_no ?? ""),
    company: userTextValue(body.company ?? ""),
    direction,
    itemCount: integerField(body.itemCount ?? body.item_count),
    pageCount: integerField(body.pageCount ?? body.page_count),
    homeFee,
    customsFee,
    pageFee,
    manifestFee,
    inspectionFee,
    checkFee,
    verificationFee,
    otherFee,
    customFields,
    customFieldsJson: JSON.stringify(customFields),
    total: computedTotal,
    remark: userTextValue(body.remark ?? "")
  };
}

function normalizeOtherBusinessPayload(body = {}) {
  const cost = moneyNumberField(body.cost ?? body.baseCost ?? body.base_cost);
  const income = moneyNumberField(body.income ?? body.revenue);
  const customFields = normalizeOtherBusinessCustomFields(body.customFields ?? body.custom_fields);
  const customBreakdown = otherBusinessCustomFieldsBreakdown(customFields);
  const totalCost = moneyNumberField(cost + customBreakdown.cost);
  const totalIncome = moneyNumberField(income + customBreakdown.income);
  return {
    date: normalizeCustomsBusinessDate(body.date ?? body.businessDate ?? body.business_date),
    title: userTextValue(body.title ?? ""),
    customer: userTextValue(body.customer ?? body.company ?? ""),
    cost,
    income,
    customFields,
    customFieldsJson: JSON.stringify(customFields),
    totalCost,
    totalIncome,
    profit: signedMoneyNumberField(totalIncome - totalCost),
    remark: userTextValue(body.remark ?? "")
  };
}

function templateContentType(content = "") {
  try {
    return JSON.parse(content || "{}")?.type || "";
  } catch {
    return "";
  }
}

function mapTemplate(row, options = {}) {
  const contentType = templateContentType(row.content);
  const includeContent = options.includeContent !== false;
  return {
    id: row.id,
    name: row.name,
    format: row.format,
    description: row.description,
    content: includeContent ? row.content : "",
    contentType,
    contentLoaded: includeContent,
    updatedAt: row.updated_at
  };
}

function isProtectedTemplateName(name = "") {
  return ["通用模板", "肯发专用"].includes(String(name || "").trim());
}

function mapRule(row) {
  return {
    id: row.id,
    ruleType: row.rule_type,
    name: row.name,
    content: row.content,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at
  };
}

function mapMasterData(row) {
  const isPort = String(row.type || "") === "口岸";
  return {
    id: row.id,
    type: row.type,
    name: isPort ? normalizePortText(row.name) : row.name,
    value: isPort ? normalizePortText(row.value || row.name) : row.value,
    sortOrder: row.sort_order
  };
}

function parseJsonObjectText(value = "", fallback = {}) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function mapAccount(row) {
  const role = normalizeAccountRole(row.role);
  return {
    id: row.id,
    username: row.username,
    displayName: userTextValue(row.display_name),
    name: userTextValue(row.display_name),
    role,
    roleLevel: roleLevelFor(role),
    status: row.status,
    hireDate: row.hire_date || "",
    phone: userTextValue(row.phone),
    email: userTextValue(row.email),
    note: userTextValue(row.note),
    permissions: accountPermissionsForAccount(row),
    allowedModules: allowedModulesForAccount(row),
    tablePreferences: parseJsonObjectText(row.table_preferences, {}),
    createdAt: row.created_at
  };
}

function mapAuditLog(row) {
  const actorName = row.actor || "admin";
  return {
    id: row.id,
    actor: actorName,
    actorName,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: row.detail,
    createdAt: row.created_at
  };
}

function auditFieldValue(record = {}, key = "") {
  const text = String(key || "").trim();
  if (!text) return undefined;
  const snake = text.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
  const camel = text.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  const candidates = [text, snake, camel].filter(Boolean);
  for (const candidate of candidates) {
    if (record && Object.prototype.hasOwnProperty.call(record, candidate)) {
      return record[candidate];
    }
  }
  const normalizedText = text.replace(/_/g, "").toLowerCase();
  const normalizedSnake = snake.replace(/_/g, "").toLowerCase();
  const matchedKey = Object.keys(record || {}).find((candidate) => {
    const normalizedCandidate = candidate.replace(/_/g, "").toLowerCase();
    return normalizedCandidate === normalizedText || normalizedCandidate === normalizedSnake;
  });
  if (matchedKey) return record[matchedKey];
  return undefined;
}

function auditDisplayValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) {
    return value.map((item) => auditDisplayValue(item)).filter((item) => item && item !== "-").join("、") || "-";
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  if (typeof value === "object") {
    return auditDisplayValue(value.name || value.displayName || value.text || value.value || value.label || value.id || "");
  }
  const text = String(value).trim();
  return text || "-";
}

function auditPreviewValue(value, maxLength = 24) {
  const text = auditDisplayValue(value);
  if (text === "-" || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function auditChangeSummary(before = {}, after = {}, fields = [], options = {}) {
  const changes = [];
  fields.forEach((field) => {
    const spec = typeof field === "string" ? { key: field } : (field || {});
    const beforeValue = typeof spec.before === "function" ? spec.before(before, after) : auditFieldValue(before, spec.key);
    const afterValue = typeof spec.after === "function" ? spec.after(before, after) : auditFieldValue(after, spec.key);
    const beforeText = auditDisplayValue(typeof spec.formatBefore === "function" ? spec.formatBefore(beforeValue, before, after) : beforeValue);
    const afterText = auditDisplayValue(typeof spec.formatAfter === "function" ? spec.formatAfter(afterValue, before, after) : afterValue);
    if (beforeText !== afterText) {
      changes.push(`${spec.label || spec.key}：${beforeText} → ${afterText}`);
    }
  });
  if (!changes.length) return options.fallback || "修改";
  const maxItems = Number(options.maxItems || 4);
  const prefix = options.prefix || "修改";
  const body = changes.slice(0, maxItems).join("；");
  return `${prefix}${options.entityLabel ? ` ${options.entityLabel}` : ""}：${body}${changes.length > maxItems ? "…" : ""}`;
}

async function loadCustomerShortNameMap(options = {}) {
  const category = String(options.category || "").trim();
  const rows = category
    ? await db.prepare(`
      SELECT id, name, short_name
      FROM customers
      WHERE deleted_at IS NULL AND type = '客户' AND customer_category = ?
      ORDER BY created_at DESC, id DESC
    `).all(category)
    : await db.prepare(`
      SELECT id, name, short_name
      FROM customers
      WHERE deleted_at IS NULL AND type = '客户'
      ORDER BY created_at DESC, id DESC
    `).all();
  const map = new Map();
  rows.forEach((row) => {
    const shortName = String(row.short_name || "").trim();
    const name = String(row.name || "").trim();
    if (!shortName || !name) return;
    map.set(String(row.id || "").trim(), shortName);
    if (!map.has(name)) map.set(name, shortName);
  });
  return map;
}

function shortNameFromMap(value = "", shortNameMap = new Map()) {
  const text = String(value || "").trim();
  return shortNameMap.get(text) || "";
}

async function latestDeleteOperatorName(entityType, entityIds = []) {
  const ids = [...new Set((Array.isArray(entityIds) ? entityIds : [entityIds])
    .map((item) => String(item || "").trim())
    .filter(Boolean))];
  if (!entityType || ids.length === 0) return "";
  const row = await db.prepare(`
    SELECT actor
    FROM audit_logs
    WHERE action = 'delete'
      AND entity_type = @entityType
      AND entity_id = ANY(@entityIds::text[])
    ORDER BY id DESC
    LIMIT 1
  `).get({ entityType, entityIds: ids });
  return String(row?.actor || "").trim() || "";
}

function mapFile(row) {
  const storageProvider = row.storage_provider || "";
  const hasOssObject = storageProvider === "oss" && Boolean(row.object_key);
  const previewUrl = hasOssObject ? signedOssUrl(row, "inline") : "";
  const downloadUrl = hasOssObject ? signedOssUrl(row, "attachment") : "";
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    category: row.category,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    storageProvider,
    previewUrl,
    downloadUrl,
    available: Boolean(previewUrl || downloadUrl),
    createdAt: row.created_at,
    deletedAt: row.deleted_at || ""
  };
}

async function hydrateOrderFees(orders) {
  if (orders.length === 0) return orders;
  const fees = await db.prepare(`
    SELECT * FROM order_fees
    WHERE order_no IN (${orders.map(() => "?").join(",")})
    ORDER BY id ASC
  `).all(...orders.map((item) => item.no));
  const feeMap = new Map();
  fees.forEach((fee) => {
    if (!feeMap.has(fee.order_no)) feeMap.set(fee.order_no, []);
    feeMap.get(fee.order_no).push(mapOrderFee(fee));
  });
  return orders.map((item) => ({ ...item, fees: feeMap.get(item.no) || [] }));
}

async function nextCustomerId(type) {
  const prefix = type === "供应商" ? "GY" : "KH";
  const row = await db.prepare(`
    SELECT id FROM customers
    WHERE id LIKE ?
    ORDER BY id DESC
    LIMIT 1
  `).get(`${prefix}%`);
  const next = row ? Number(row.id.slice(2)) + 1 : 21001;
  return `${prefix}${String(next).padStart(8, "0")}`;
}

function normalizeBusinessNoDate(value = todayInputValue()) {
  const text = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayInputValue();
}

function businessNoPrefix(prefix, date = todayInputValue()) {
  return `${prefix}${normalizeBusinessNoDate(date).replaceAll("-", "")}`;
}

function nextBusinessNoFromRows(prefix, rows = []) {
  let max = 0;
  rows.forEach((row) => {
    const value = String(row?.no || row?.dispatch_no || row?.dispatchNo || "").trim();
    if (!value.startsWith(prefix)) return;
    const sequence = Number(value.slice(prefix.length));
    if (Number.isFinite(sequence)) max = Math.max(max, sequence);
  });
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

async function nextOrderNo(date = todayInputValue()) {
  const prefix = businessNoPrefix("HY", date);
  const rows = await db.prepare(`
    SELECT no FROM orders
    WHERE no LIKE ?
    UNION ALL
    SELECT order_no AS no FROM dispatch_plan_recycle
    WHERE order_no LIKE ?
  `).all(`${prefix}%`, `${prefix}%`);
  return nextBusinessNoFromRows(prefix, rows);
}

async function nextDispatchNo(date = todayInputValue()) {
  const prefix = businessNoPrefix("PC", date);
  const orderRows = await db.prepare(`
    SELECT dispatch_no FROM orders
    WHERE dispatch_no LIKE ?
  `).all(`${prefix}%`);
  const recycleRows = await db.prepare(`
    SELECT dispatch_no FROM dispatch_plan_recycle
    WHERE dispatch_no LIKE ?
  `).all(`${prefix}%`);
  const plan = await db.prepare("SELECT rows_json FROM dispatch_plans WHERE plan_date = ?").get(normalizeBusinessNoDate(date));
  const planRows = parseDispatchPlanRowsJson(plan?.rows_json)
    .map((row) => ({ dispatch_no: row.dispatchNo }))
    .filter((row) => String(row.dispatch_no || "").startsWith(prefix));
  return nextBusinessNoFromRows(prefix, [...orderRows, ...recycleRows, ...planRows]);
}

app.get("/api/health", async (_req, res) => {
  res.json({
    ok: true,
    database: databaseInfo,
    fileStorage: fileStorageProvider,
    realtimeClients: realtimeHub?.getClientCount?.() || 0
  });
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) {
    res.status(400).json({ message: "请输入账号和密码" });
    return;
  }
  const row = await db.prepare("SELECT * FROM app_accounts WHERE lower(username) = lower(?) AND deleted_at IS NULL ORDER BY id ASC LIMIT 1").get(username);
  if (!row) {
    res.status(404).json({ message: "账号不存在" });
    return;
  }
  if (row.status !== "启用") {
    res.status(403).json({ message: "账号已停用" });
    return;
  }
  if (!verifyPassword(password, row.password_hash)) {
    res.status(401).json({ message: "密码错误" });
    return;
  }
  const role = normalizeAccountRole(row.role);
  if (role === "司机") {
    res.status(403).json({ message: "司机账号无系统登录权限" });
    return;
  }
  const permissions = JSON.stringify(accountPermissionsForAccount(row));
  await db.prepare(`
    UPDATE app_accounts
    SET role = @role,
        role_level = @roleLevel,
        permissions = @permissions,
        last_login_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: row.id,
    role,
    roleLevel: roleLevelFor(role),
    permissions
  });
  const account = mapAccount({ ...row, role, role_level: roleLevelFor(role), permissions });
  const authSession = createAuthToken(account);
  res.json({
    token: authSession.token,
    expiresAt: authSession.expiresAt,
    account,
    roles: ACCOUNT_ROLES
  });
});

async function authenticateApiRequest(req, res, next) {
  const payload = verifyAuthToken(bearerTokenFromRequest(req));
  if (!payload) {
    res.status(401).json({ message: "请先登录" });
    return;
  }
  const row = await db.prepare("SELECT * FROM app_accounts WHERE id = ? AND lower(username) = lower(?) AND deleted_at IS NULL").get(Number(payload.sub), payload.username);
  if (!row || row.status !== "启用") {
    res.status(401).json({ message: "登录状态已失效，请重新登录" });
    return;
  }
  if (normalizeAccountRole(row.role) === "司机") {
    res.status(401).json({ message: "司机账号无系统登录权限" });
    return;
  }
  req.account = mapAccount(row);
  next();
}

async function authenticateRealtimeToken(token = "") {
  const payload = verifyAuthToken(token);
  if (!payload) return null;
  const row = await db.prepare("SELECT * FROM app_accounts WHERE id = ? AND lower(username) = lower(?) AND deleted_at IS NULL").get(Number(payload.sub), payload.username);
  if (!row || row.status !== "启用") return null;
  if (normalizeAccountRole(row.role) === "司机") return null;
  return mapAccount(row);
}

function requiredModuleForRequest(req) {
  const path = req.path;
  if (path.startsWith("/accounts")) return "accounts";
  if (path.startsWith("/audit-logs")) return "security";
  if (path.startsWith("/customers")) return "customers";
  if (path.startsWith("/customer-contacts")) return "customers";
  if (path.startsWith("/orders")) return "orders";
  if (path.startsWith("/customs-businesses")) return "customsBusiness";
  if (path.startsWith("/other-businesses")) return "otherBusiness";
  if (path.startsWith("/dispatch-plans")) return "dispatchBoard";
  if (path.startsWith("/reminders")) return "vehicleDriver";
  if (path.startsWith("/vehicle-expenses")) return "vehicleDriver";
  if (path.startsWith("/vehicles")) return "vehicleDriver";
  if (path.startsWith("/drivers")) return "vehicleDriver";
  if (path.startsWith("/driver-wage-rules")) return "financeCostCenter";
  if (path.startsWith("/driver-adjustments")) return "vehicleDriver";
  if (path.startsWith("/driver-route-adjust-rules")) return "financeWages";
  if (path.startsWith("/cost-center-rates")) return "financeCostCenter";
  if (path.startsWith("/vehicle-profit-exchange-rates")) return "bossVehicleProfit";
  if (path.startsWith("/company-expenses")) return "bossCompanyExpenses";
  if (path.startsWith("/statement-downloads")) return "financeCosts";
  if (path.startsWith("/rules")) return "rules";
  if (path.startsWith("/templates") && req.method !== "GET") return "templates";
  if (path.startsWith("/master-data") && req.method !== "GET") return "master";
  if (path.startsWith("/freight-rates") && req.method !== "GET") return "freight";
  return "";
}

function canReadBossCenterData(account = null) {
  return BOSS_CENTER_READ_MODULES.some((moduleId) => canAccessModule(account, moduleId));
}

function authorizeApiRequest(req, res, next) {
  if (req.path.startsWith("/customers")) {
    const canAccessCustomers = req.method === "GET"
      ? canAccessModule(req.account, "customers") || canReadBossCenterData(req.account)
      : canAccessModule(req.account, "customers");
    if (!canAccessCustomers) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/customer-contacts")) {
    const canAccessCustomers = req.method === "GET"
      ? canAccessModule(req.account, "customers") || canReadBossCenterData(req.account)
      : canAccessModule(req.account, "customers");
    if (!canAccessCustomers) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/orders")) {
    const canAccessOrders = req.method === "GET"
      ? canAccessModule(req.account, "orders") || canReadBossCenterData(req.account)
      : canAccessModule(req.account, "orders");
    if (!canAccessOrders) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/customs-businesses")) {
    const canAccessCustomsBusiness = req.method === "GET"
      ? canAccessModule(req.account, "customsBusiness")
        || canAccessModule(req.account, "financeCustomsStatements")
        || canReadBossCenterData(req.account)
      : canAccessModule(req.account, "customsBusiness") || canAccessModule(req.account, "financeCustomsStatements");
    if (!canAccessCustomsBusiness) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/reminders") && req.method === "GET") {
    const canReadReminders = canAccessModule(req.account, "vehicleDriver")
      || canAccessModule(req.account, "dispatchBoard");
    if (!canReadReminders) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/vehicle-profit-exchange-rates")) {
    const canAccessExchangeRates = VEHICLE_PROFIT_EXCHANGE_RATE_MODULES.some((moduleId) => canAccessModule(req.account, moduleId));
    if (!canAccessExchangeRates) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/company-expenses")) {
    const canAccessCompanyExpenses = req.method === "GET"
      ? COMPANY_EXPENSE_MODULES.some((moduleId) => canAccessModule(req.account, moduleId))
      : canAccessModule(req.account, "bossCompanyExpenses");
    if (!canAccessCompanyExpenses) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/other-businesses")) {
    const canAccessOtherBusiness = req.method === "GET"
      ? canAccessModule(req.account, "otherBusiness")
        || COMPANY_EXPENSE_MODULES.some((moduleId) => canAccessModule(req.account, moduleId))
        || canReadBossCenterData(req.account)
      : canAccessModule(req.account, "otherBusiness");
    if (!canAccessOtherBusiness) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/statement-downloads")) {
    const canAccessStatements = req.method === "GET"
      ? ["financeCosts", "financeSupplierStatements", "financeCustomsStatements"].some((moduleId) => canAccessModule(req.account, moduleId))
        || canReadBossCenterData(req.account)
      : ["financeCosts", "financeSupplierStatements", "financeCustomsStatements"]
        .some((moduleId) => canAccessModule(req.account, moduleId));
    if (!canAccessStatements) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  const moduleId = requiredModuleForRequest(req);
  if (moduleId && !canAccessModule(req.account, moduleId)) {
    res.status(403).json({ message: "当前账号无权访问该功能" });
    return;
  }
  next();
}

app.use("/api", authenticateApiRequest, (req, res, next) => {
  auditActorContext.run(auditActorFromAccount(req.account), () => next());
}, authorizeApiRequest);

app.get("/api/auth/me", async (req, res) => {
  res.json({ account: req.account, roles: ACCOUNT_ROLES });
});

app.get("/api/auth/table-preferences", async (req, res) => {
  const row = await db.prepare("SELECT table_preferences FROM app_accounts WHERE id = ? AND deleted_at IS NULL").get(req.account.id);
  res.json(parseJsonObjectText(row?.table_preferences, {}));
});

app.patch("/api/auth/table-preferences", async (req, res) => {
  const preferences = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body
    : {};
  const text = JSON.stringify(preferences).slice(0, 20000);
  const result = await db.prepare(`
    UPDATE app_accounts
    SET table_preferences = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(text, req.account.id);
  if (result.changes === 0) {
    res.status(404).json({ message: "账号不存在或已删除" });
    return;
  }
  res.json(parseJsonObjectText(text, {}));
});

app.get("/api/reminders/expiry", async (req, res) => {
  res.json(await loadExpiryReminderRowsForAccount(req.account?.id));
});

app.post("/api/reminders/expiry/ack", async (req, res) => {
  const rawKeys = Array.isArray(req.body?.keys)
    ? req.body.keys
    : [req.body?.key].filter(Boolean);
  const keys = Array.from(new Set(
    rawKeys
      .map((key) => String(key || "").trim())
      .filter(Boolean)
  )).slice(0, 500);
  if (keys.length === 0) {
    res.status(400).json({ message: "请选择要确认的提醒" });
    return;
  }
  const accountId = Number(req.account?.id || 0);
  if (!accountId) {
    res.status(401).json({ message: "请先登录" });
    return;
  }
  const transaction = db.transaction(async () => {
    for (const key of keys) {
      await db.prepare(`
        INSERT INTO reminder_acknowledgements (account_id, reminder_key, acknowledged_at)
        VALUES (?, ?, CURRENT_TIMESTAMP::text)
        ON CONFLICT (account_id, reminder_key)
        DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at
      `).run(accountId, key);
    }
  });
  await transaction();
  res.json(await loadExpiryReminderRowsForAccount(accountId));
});

app.patch("/api/auth/password", async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || req.body?.current || "");
  const nextPassword = String(req.body?.nextPassword || req.body?.next || "");
  if (!currentPassword) {
    res.status(400).json({ message: "请输入原密码" });
    return;
  }
  if (nextPassword.length < 4) {
    res.status(400).json({ message: "新密码至少 4 位" });
    return;
  }
  if (currentPassword === nextPassword) {
    res.status(400).json({ message: "新密码不能和原密码相同" });
    return;
  }
  const row = await db.prepare("SELECT * FROM app_accounts WHERE id = ? AND deleted_at IS NULL").get(req.account.id);
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    res.status(400).json({ message: "原密码不正确" });
    return;
  }
  await db.prepare(`
    UPDATE app_accounts
    SET password_hash = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(hashPassword(nextPassword), req.account.id);
  await writeAudit("update", "account_password", String(req.account.id), req.account.username);
  res.json({ ok: true });
});

app.patch("/api/auth/profile", async (req, res) => {
  const current = await db.prepare("SELECT * FROM app_accounts WHERE id = ? AND deleted_at IS NULL").get(req.account.id);
  if (!current) {
    res.status(404).json({ message: "账号不存在或已删除" });
    return;
  }
  const item = {
    id: req.account.id,
    displayName: userTextValue(req.body?.displayName),
    phone: userTextValue(req.body?.phone),
    email: userTextValue(req.body?.email),
    note: userTextValue(req.body?.note)
  };
  const result = await db.prepare(`
    UPDATE app_accounts
    SET display_name = @displayName,
        phone = @phone,
        email = @email,
        note = @note,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  if (result.changes === 0) {
    res.status(404).json({ message: "账号不存在或已删除" });
    return;
  }
  await writeAudit(
    "update",
    "account_profile",
    String(req.account.id),
    auditChangeSummary(current, item, [
      { key: "displayName", label: "姓名" },
      { key: "phone", label: "电话" },
      { key: "email", label: "邮箱" },
      { key: "note", label: "备注" }
    ], { entityLabel: "个人资料" })
  );
  res.json(mapAccount(await db.prepare("SELECT * FROM app_accounts WHERE id = ?").get(req.account.id)));
});

app.get("/api/customs-businesses", async (req, res) => {
  const { start, end } = customsBusinessPeriodBounds(req.query);
  const dateWhere = start && end ? "AND business_date >= ? AND business_date < ?" : "";
  const params = start && end ? [start, end] : [];
  const rows = await db.prepare(`
    SELECT * FROM customs_businesses
    WHERE deleted_at IS NULL
      ${dateWhere}
    ORDER BY business_date DESC, id DESC
  `).all(...params);
  res.json(rows.map(mapCustomsBusiness));
});

app.get("/api/customs-businesses/recycle", async (_req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM customs_businesses
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC, business_date DESC, id DESC
  `).all();
  const customerShortNames = await loadCustomerShortNameMap();
  const mappedRows = await Promise.all(rows.map(async (row) => ({
    ...mapCustomsBusiness(row),
    customerShortName: shortNameFromMap(row.company, customerShortNames),
    operatorName: await latestDeleteOperatorName("customs_business", String(row.id))
  })));
  res.json(mappedRows);
});

app.post("/api/customs-businesses/export/excel", async (req, res) => {
  const context = customsStatementExportContext(req.body || {});
  const rows = await loadCustomsStatementExportRows(context.company, context.period);
  if (!rows.length) {
    res.status(400).type("text/plain").send("当前条件没有可导出的报关业务");
    return;
  }
  try {
    const filename = customsStatementFilename(context.company, context.start, context.end, "xlsx");
    const body = await renderCustomsStatementXlsxBuffer(rows, context);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDispositionHeader("attachment", filename));
    await writeAudit("export", "customs_business", context.company, `Excel ${rows.length} 条`);
    res.send(body);
  } catch (error) {
    console.error("Customs statement Excel export failed", error);
    res.status(500).type("text/plain").send("报关对账单 Excel 导出失败");
  }
});

app.post("/api/customs-businesses/export/pdf", async (req, res) => {
  const context = customsStatementExportContext(req.body || {});
  const rows = await loadCustomsStatementExportRows(context.company, context.period);
  if (!rows.length) {
    res.status(400).type("text/plain").send("当前条件没有可导出的报关业务");
    return;
  }
  try {
    const filename = customsStatementFilename(context.company, context.start, context.end, "pdf");
    await writeAudit("export", "customs_business", context.company, `PDF ${rows.length} 条`);
    renderCustomsStatementPdf(res, rows, context, filename);
  } catch (error) {
    console.error("Customs statement PDF export failed", error);
    if (!res.headersSent) res.status(500).type("text/plain").send("报关对账单 PDF 导出失败");
  }
});

app.post("/api/customs-businesses", async (req, res) => {
  const item = normalizeCustomsBusinessPayload(req.body || {});
  if (!item.company) {
    res.status(400).json({ message: "请选择客户" });
    return;
  }
  if (!item.declarationNo && !item.sixSheetNo) {
    res.status(400).json({ message: "请填写报关单号或六联单号" });
    return;
  }
  const hasHomeFee = await customsBusinessColumnExists("home_fee");
  const result = await db.prepare(`
    INSERT INTO customs_businesses
      (business_date, declaration_no, six_sheet_no, company, direction, item_count, page_count,
       ${hasHomeFee ? "home_fee, " : ""}customs_fee, page_fee, manifest_fee, inspection_fee, check_fee, verification_fee, other_fee, custom_fields, total, remark)
    VALUES
      (@date, @declarationNo, @sixSheetNo, @company, @direction, @itemCount, @pageCount,
       ${hasHomeFee ? "@homeFee, " : ""}@customsFee, @pageFee, @manifestFee, @inspectionFee, @checkFee, @verificationFee, @otherFee, @customFieldsJson, @total, @remark)
  `).run(item);
  await writeAudit("create", "customs_business", String(result.lastInsertId), `${item.date}/${item.company}/${item.declarationNo || item.sixSheetNo}`);
  const row = await db.prepare("SELECT * FROM customs_businesses WHERE id = ?").get(result.lastInsertId);
  res.status(201).json(mapCustomsBusiness(row));
});

app.put("/api/customs-businesses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const current = await db.prepare("SELECT * FROM customs_businesses WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "报关业务不存在或已删除" });
    return;
  }

  const item = normalizeCustomsBusinessPayload(req.body || {});
  if (!item.company) {
    res.status(400).json({ message: "请选择客户" });
    return;
  }
  if (!item.declarationNo && !item.sixSheetNo) {
    res.status(400).json({ message: "请填写报关单号或六联单号" });
    return;
  }

  const hasHomeFee = await customsBusinessColumnExists("home_fee");
  await db.prepare(`
    UPDATE customs_businesses
    SET business_date = @date,
        declaration_no = @declarationNo,
        six_sheet_no = @sixSheetNo,
        company = @company,
        direction = @direction,
        item_count = @itemCount,
        page_count = @pageCount,
        ${hasHomeFee ? "home_fee = @homeFee," : ""}
        customs_fee = @customsFee,
        page_fee = @pageFee,
        manifest_fee = @manifestFee,
        inspection_fee = @inspectionFee,
        check_fee = @checkFee,
        verification_fee = @verificationFee,
        other_fee = @otherFee,
        custom_fields = @customFieldsJson,
        total = @total,
        remark = @remark,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `).run({ ...item, id });
  await writeAudit(
    "update",
    "customs_business",
    String(id),
    auditChangeSummary(current, item, [
      { label: "日期", before: (before) => before.business_date, after: () => item.date },
      { key: "company", label: "公司" },
      { key: "direction", label: "进出口" },
      { key: "declarationNo", label: "报关单号" },
      { key: "sixSheetNo", label: "六联单号" },
      { key: "itemCount", label: "主页品名项" },
      { key: "pageCount", label: "续页" },
      { key: "customsFee", label: "报关费" },
      { key: "manifestFee", label: "舱单费" },
      { key: "pageFee", label: "续页费" },
      { key: "total", label: "合计" },
      { key: "remark", label: "备注" }
    ], { entityLabel: "报关业务", maxItems: 6 })
  );
  const row = await db.prepare("SELECT * FROM customs_businesses WHERE id = ?").get(id);
  res.json(mapCustomsBusiness(row));
});

app.delete("/api/customs-businesses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM customs_businesses WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "报关业务不存在或已删除" });
    return;
  }
  await db.prepare(`
    UPDATE customs_businesses
    SET deleted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(id);
  await writeAudit("delete", "customs_business", String(id), `${row.business_date}/${row.company}/${row.declaration_no || row.six_sheet_no}`);
  res.json({ ok: true });
});

app.post("/api/customs-businesses/:id/restore", async (req, res) => {
  const id = Number(req.params.id || 0);
  const result = await db.prepare(`
    UPDATE customs_businesses
    SET deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NOT NULL
  `).run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "回收站内找不到该报关业务" });
    return;
  }
  await writeAudit("restore", "customs_business", String(id), "从回收站恢复");
  const row = await db.prepare("SELECT * FROM customs_businesses WHERE id = ?").get(id);
  res.json(mapCustomsBusiness(row));
});

app.get("/api/other-businesses", async (req, res) => {
  const { start, end } = customsBusinessPeriodBounds(req.query);
  const dateWhere = start && end ? "AND business_date >= ? AND business_date < ?" : "";
  const params = start && end ? [start, end] : [];
  const rows = await db.prepare(`
    SELECT * FROM other_businesses
    WHERE deleted_at IS NULL
      ${dateWhere}
    ORDER BY business_date DESC, id DESC
  `).all(...params);
  res.json(rows.map(mapOtherBusiness));
});

app.get("/api/other-businesses/recycle", async (_req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM other_businesses
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC, business_date DESC, id DESC
  `).all();
  const customerShortNames = await loadCustomerShortNameMap();
  const mappedRows = await Promise.all(rows.map(async (row) => ({
    ...mapOtherBusiness(row),
    customerShortName: shortNameFromMap(row.customer, customerShortNames),
    operatorName: await latestDeleteOperatorName("other_business", String(row.id))
  })));
  res.json(mappedRows);
});

app.post("/api/other-businesses", async (req, res) => {
  const item = normalizeOtherBusinessPayload(req.body || {});
  if (!item.title) {
    res.status(400).json({ message: "请填写标题" });
    return;
  }
  if (!item.customer) {
    res.status(400).json({ message: "请选择或填写客户" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO other_businesses
      (business_date, title, customer, cost, income, custom_fields, total_cost, total_income, profit, remark)
    VALUES
      (@date, @title, @customer, @cost, @income, @customFieldsJson, @totalCost, @totalIncome, @profit, @remark)
  `).run(item);
  await writeAudit("create", "other_business", String(result.lastInsertId), `${item.date}/${item.customer}/${item.title}`);
  const row = await db.prepare("SELECT * FROM other_businesses WHERE id = ?").get(result.lastInsertId);
  res.status(201).json(mapOtherBusiness(row));
});

app.put("/api/other-businesses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const current = await db.prepare("SELECT * FROM other_businesses WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "其他业务不存在或已删除" });
    return;
  }

  const item = normalizeOtherBusinessPayload(req.body || {});
  if (!item.title) {
    res.status(400).json({ message: "请填写标题" });
    return;
  }
  if (!item.customer) {
    res.status(400).json({ message: "请选择或填写客户" });
    return;
  }

  await db.prepare(`
    UPDATE other_businesses
    SET business_date = @date,
        title = @title,
        customer = @customer,
        cost = @cost,
        income = @income,
        custom_fields = @customFieldsJson,
        total_cost = @totalCost,
        total_income = @totalIncome,
        profit = @profit,
        remark = @remark,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `).run({ ...item, id });
  await writeAudit(
    "update",
    "other_business",
    String(id),
    auditChangeSummary(current, item, [
      { label: "日期", before: (before) => before.business_date, after: () => item.date },
      { key: "title", label: "标题" },
      { key: "customer", label: "客户" },
      { key: "cost", label: "成本" },
      { key: "income", label: "收入" },
      { key: "totalCost", label: "总成本" },
      { key: "totalIncome", label: "总收入" },
      { key: "profit", label: "利润" },
      { key: "remark", label: "备注" }
    ], { entityLabel: "其他业务" })
  );
  const row = await db.prepare("SELECT * FROM other_businesses WHERE id = ?").get(id);
  res.json(mapOtherBusiness(row));
});

app.delete("/api/other-businesses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM other_businesses WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "其他业务不存在或已删除" });
    return;
  }
  await db.prepare(`
    UPDATE other_businesses
    SET deleted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(id);
  await writeAudit("delete", "other_business", String(id), `${row.business_date}/${row.customer}/${row.title}`);
  res.json({ ok: true });
});

app.post("/api/other-businesses/:id/restore", async (req, res) => {
  const id = Number(req.params.id || 0);
  const result = await db.prepare(`
    UPDATE other_businesses
    SET deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NOT NULL
  `).run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "回收站内找不到该其他业务" });
    return;
  }
  await writeAudit("restore", "other_business", String(id), "从回收站恢复");
  const row = await db.prepare("SELECT * FROM other_businesses WHERE id = ?").get(id);
  res.json(mapOtherBusiness(row));
});

app.get("/api/files", async (req, res) => {
  const entityType = String(req.query.entityType || "").trim();
  const entityId = String(req.query.entityId || "").trim();
  const includeOrderFiles = String(req.query.includeOrderFiles || "") === "1";
  const deletedOnly = String(req.query.deletedOnly || "") === "1";
  if (!entityType || !entityId) {
    res.status(400).json({ message: "缺少文件归属信息" });
    return;
  }
  if (includeOrderFiles && entityType === "customer") {
    const rows = await db.prepare(`
      SELECT f.*, '客户附件' AS source_label, '' AS order_no, '' AS order_date, '' AS order_business_type
      FROM files f
      WHERE f.deleted_at IS NULL
        AND f.entity_type = 'customer'
        AND f.entity_id = ?
      UNION ALL
      SELECT f.*, '订单附件' AS source_label, o.no AS order_no, o.order_date AS order_date, o.business_type AS order_business_type
      FROM files f
      JOIN orders o ON o.no = f.entity_id
      WHERE f.deleted_at IS NULL
        AND f.entity_type = 'order'
        AND o.deleted_at IS NULL
        AND o.customer_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(entityId, entityId);
    res.json(rows.map((row) => ({
      ...mapFile(row),
      sourceLabel: row.source_label || "",
      orderNo: row.order_no || "",
      orderDate: row.order_date || "",
      orderBusinessType: row.order_business_type || ""
    })));
    return;
  }
  const deletedClause = deletedOnly ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
  const rows = await db.prepare(`
    SELECT * FROM files
    WHERE ${deletedClause} AND entity_type = ? AND entity_id = ?
    ORDER BY ${deletedOnly ? "deleted_at" : "created_at"} DESC, id DESC
  `).all(entityType, entityId);
  res.json(rows.map(mapFile));
});

app.post("/api/files", async (req, res) => {
  const item = {
    entityType: String(req.body.entityType || "").trim(),
    entityId: String(req.body.entityId || "").trim(),
    category: String(req.body.category || "").trim(),
    filename: String(req.body.filename || "").trim(),
    mime: String(req.body.mime || "application/octet-stream").trim(),
    size: Number(req.body.size || 0),
    contentBase64: String(req.body.contentBase64 || "").trim()
  };

  if (!item.entityType || !item.entityId || !item.filename || !item.contentBase64) {
    res.status(400).json({ message: "文件名称、归属和内容不能为空" });
    return;
  }
  if (!ossClient) {
    await writeAudit("reject_upload", "file", `${item.entityType}/${item.entityId}`, `${item.filename}: OSS 未配置`);
    res.status(503).json({ message: "OSS 文件存储未配置，不能上传附件" });
    return;
  }
  const validated = validateStoredFilePayload(item);
  if (validated.error) {
    await writeAudit("reject_upload", "file", `${item.entityType}/${item.entityId}`, `${item.filename}: ${validated.error}`);
    res.status(400).json({ message: validated.error });
    return;
  }

  let storage;
  try {
    storage = await ossStorageForUpload(item, validated);
  } catch (error) {
    console.error("OSS upload failed", error);
    await writeAudit("reject_upload", "file", `${item.entityType}/${item.entityId}`, `${validated.filename}: OSS 上传失败`);
    res.status(502).json({ message: "OSS 上传失败，请检查 Bucket、Region、AccessKey 和服务器网络配置" });
    return;
  }
  let result;
  try {
    result = await db.prepare(`
      INSERT INTO files
        (entity_type, entity_id, category, filename, mime, size, content_base64, storage_provider, bucket, object_key, etag)
      VALUES
        (@entityType, @entityId, @category, @filename, @mime, @size, @contentBase64, @storageProvider, @bucket, @objectKey, @etag)
    `).run({ ...item, ...validated, ...storage });
  } catch (error) {
    if (storage.storageProvider === "oss") {
      await deleteOssObjectByKey(storage.objectKey).catch((deleteError) => {
        console.error("Failed to clean up OSS object after database insert error", deleteError);
      });
    }
    throw error;
  }
  await writeAudit("upload", "file", String(result.lastInsertId), `${item.entityType}/${item.entityId}/${validated.filename}`);
  const row = await db.prepare("SELECT * FROM files WHERE id = ?").get(result.lastInsertId);
  res.status(201).json(mapFile(row));
});

app.patch("/api/files/:id/move", async (req, res) => {
  const id = Number(req.params.id || 0);
  const entityType = String(req.body?.entityType || "").trim();
  const entityId = String(req.body?.entityId || "").trim();
  if (!id || !entityType || !entityId) {
    res.status(400).json({ message: "文件转移参数无效" });
    return;
  }
  const existing = await db.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!existing) {
    res.status(404).json({ message: "文件不存在" });
    return;
  }
  await db.prepare(`
    UPDATE files
    SET entity_type = ?,
        entity_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(entityType, entityId, id);
  await writeAudit(
    "update",
    "file",
    String(id),
    auditChangeSummary(existing, { ...existing, entityType, entityId }, [
      { key: "entityType", label: "归属类型" },
      { key: "entityId", label: "关联记录" }
    ], { entityLabel: "文件" })
  );
  const row = await db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  res.json(mapFile(row));
});

async function sendStoredFile(req, res, disposition) {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "文件不存在" });
    return;
  }
  const mime = normalizeMime(row.mime);
  const safeDisposition = disposition === "inline" && PREVIEW_MIMES.has(mime) ? "inline" : "attachment";
  if (row.storage_provider === "oss" && row.object_key) {
    if (!ossClient) {
      res.status(503).json({ message: "OSS 文件存储未配置，暂时无法读取该附件" });
      return;
    }
    const url = signedOssUrl(row, safeDisposition);
    if (!url) {
      res.status(503).json({ message: "OSS 签名地址生成失败，请检查 OSS 配置" });
      return;
    }
    await writeAudit(safeDisposition === "inline" ? "preview" : "download", "file", String(id), row.filename);
    res.redirect(302, url);
    return;
  }
  res.status(410).json({ message: "该附件尚未迁移到 OSS，请配置 OSS 并重启服务完成迁移" });
}

async function sendStoredFileContent(req, res) {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "文件不存在" });
    return;
  }
  if (row.storage_provider !== "oss" || !row.object_key) {
    res.status(410).json({ message: "该附件尚未迁移到 OSS，请配置 OSS 并重启服务完成迁移" });
    return;
  }
  if (!ossClient) {
    res.status(503).json({ message: "OSS 文件存储未配置，暂时无法读取该附件" });
    return;
  }
  try {
    const result = await ossClient.getStream(row.object_key);
    res.setHeader("Content-Type", normalizeMime(row.mime));
    res.setHeader("Content-Disposition", contentDispositionHeader("inline", row.filename));
    res.setHeader("Cache-Control", "private, max-age=300");
    await writeAudit("preview", "file", String(id), row.filename);
    result.stream.on("error", (error) => {
      console.error("OSS stream failed", error);
      if (!res.headersSent) res.status(502).json({ message: "OSS 文件读取失败" });
      else res.destroy(error);
    });
    result.stream.pipe(res);
  } catch (error) {
    console.error("OSS content fetch failed", error);
    res.status(502).json({ message: "OSS 文件读取失败" });
  }
}

app.get("/api/files/:id/preview", async (req, res) => sendStoredFile(req, res, "inline"));

app.get("/api/files/:id/content", sendStoredFileContent);

app.get("/api/files/:id/download", async (req, res) => sendStoredFile(req, res, "attachment"));

app.delete("/api/files/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "文件不存在" });
    return;
  }
  await db.prepare("UPDATE files SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  await writeAudit("delete", "file", String(id), row.filename);
  res.json({ ok: true });
});

app.post("/api/files/:id/restore", async (req, res) => {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM files WHERE id = ? AND deleted_at IS NOT NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "回收站内找不到该文件" });
    return;
  }
  await db.prepare("UPDATE files SET deleted_at = NULL WHERE id = ?").run(id);
  await writeAudit("restore", "file", String(id), row.filename);
  const restored = await db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  res.json(mapFile(restored));
});

app.delete("/api/files/:id/permanent", async (req, res) => {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM files WHERE id = ?").get(id);
  if (!row) {
    res.status(404).json({ message: "文件不存在" });
    return;
  }
  if (row.storage_provider === "oss" && row.object_key && !ossClient) {
    res.status(503).json({ message: "OSS 文件存储未配置，暂时无法彻底删除该附件" });
    return;
  }
  await deleteStoredOssObject(row);
  await db.prepare("DELETE FROM files WHERE id = ?").run(id);
  await writeAudit("purge", "file", String(id), row.filename);
  res.json({ ok: true });
});

app.get("/api/customers", async (req, res) => {
  await ensureCustomerCustomsCustomerTypeColumn();
  const type = req.query.type === "供应商" ? "供应商" : req.query.type === "客户" ? "客户" : null;
  const rows = type
    ? await db.prepare("SELECT * FROM customers WHERE deleted_at IS NULL AND type = ? ORDER BY created_at DESC, id DESC").all(type)
    : await db.prepare("SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC").all();
  res.json(rows.map(mapCustomer));
});

app.patch("/api/customers/:id", async (req, res) => {
  await ensureCustomerCustomsCustomerTypeColumn();
  const id = String(req.params.id || "").trim();
  const existing = await db.prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!existing) {
    res.status(404).json({ message: "客户不存在或已删除" });
    return;
  }
  const item = normalizeCustomerPayload(req.body, id);

  if (!item.name) {
    res.status(400).json({ message: "名称不能为空" });
    return;
  }

  const hasCustomsVerificationFee = await customerColumnExists("customs_verification_fee");
  const hasCustomsManifestFee = await customerColumnExists("customs_manifest_fee");
  const hasCustomsCustomFields = await customerColumnExists("customs_custom_fields");
  const result = await db.prepare(`
    UPDATE customers
    SET type = @type,
        customer_category = @customerCategory,
        name = @name,
        short_name = @shortName,
        customs_customer_type = @customsCustomerType,
        province = @province,
        city = @city,
        address = @address,
        term = @term,
        settlement_currency = @settlementCurrency,
        receivable_rmb = @receivableRMB,
        receivable_hkd = @receivableHKD,
        tax_no = @taxNo,
        contact = @contact,
        mobile = @mobile,
        driver_wage_adjust_hkd = @driverWageAdjustHKD,
        default_template_id = @defaultTemplateId,
        invoice_title = @invoiceTitle,
        invoice_tax_no = @invoiceTaxNo,
        invoice_bank = @invoiceBank,
        invoice_account = @invoiceAccount,
        invoice_address_phone = @invoiceAddressPhone,
        customs_home_item_count = @customsHomeItemCount,
        customs_page_item_count = @customsPageItemCount,
        customs_import_home_fee = @customsImportHomeFee,
        customs_export_home_fee = @customsExportHomeFee,
        customs_import_page_fee = @customsImportPageFee,
        customs_export_page_fee = @customsExportPageFee
        ${hasCustomsManifestFee ? ", customs_manifest_fee = @customsManifestFee" : ""}
        ${hasCustomsVerificationFee ? ", customs_verification_fee = @customsVerificationFee" : ""}
        ${hasCustomsCustomFields ? ", customs_custom_fields = @customsCustomFieldsJson" : ""}
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  if (result.changes === 0) {
    res.status(404).json({ message: "客户不存在或已删除" });
    return;
  }
  await writeAudit(
    "update",
    "customer",
    id,
    auditChangeSummary(existing, item, [
      { key: "name", label: "公司名称" },
      { key: "shortName", label: "简称" },
      { key: "customerCategory", label: "客户类别" },
      { key: "settlementCurrency", label: "结算币种" },
      { key: "contact", label: "联系人" },
      { key: "mobile", label: "电话" }
    ], { entityLabel: "客户" })
  );
  res.json(mapCustomer(await db.prepare("SELECT * FROM customers WHERE id = ?").get(id)));
});

app.post("/api/customers", async (req, res) => {
  await ensureCustomerCustomsCustomerTypeColumn();
  const item = normalizeCustomerPayload(req.body, req.body.id || (await nextCustomerId(req.body.type)));

  if (!item.name) {
    res.status(400).json({ message: "名称不能为空" });
    return;
  }

  const hasCustomsVerificationFee = await customerColumnExists("customs_verification_fee");
  const hasCustomsManifestFee = await customerColumnExists("customs_manifest_fee");
  const hasCustomsCustomFields = await customerColumnExists("customs_custom_fields");
  await db.prepare(`
    INSERT INTO customers
      (id, type, customer_category, name, short_name, customs_customer_type, province, city, address, term, settlement_currency, receivable_rmb, receivable_hkd, recent_order, created_at,
       tax_no, contact, mobile, driver_wage_adjust_hkd, default_template_id,
       invoice_title, invoice_tax_no, invoice_bank, invoice_account, invoice_address_phone,
       customs_home_item_count, customs_page_item_count, customs_import_home_fee, customs_export_home_fee,
       customs_import_page_fee, customs_export_page_fee${hasCustomsManifestFee ? ", customs_manifest_fee" : ""}${hasCustomsVerificationFee ? ", customs_verification_fee" : ""}${hasCustomsCustomFields ? ", customs_custom_fields" : ""})
    VALUES
      (@id, @type, @customerCategory, @name, @shortName, @customsCustomerType, @province, @city, @address, @term, @settlementCurrency, @receivableRMB, @receivableHKD, @recentOrder, @createdAt,
       @taxNo, @contact, @mobile, @driverWageAdjustHKD, @defaultTemplateId,
       @invoiceTitle, @invoiceTaxNo, @invoiceBank, @invoiceAccount, @invoiceAddressPhone,
       @customsHomeItemCount, @customsPageItemCount, @customsImportHomeFee, @customsExportHomeFee,
       @customsImportPageFee, @customsExportPageFee${hasCustomsManifestFee ? ", @customsManifestFee" : ""}${hasCustomsVerificationFee ? ", @customsVerificationFee" : ""}${hasCustomsCustomFields ? ", @customsCustomFieldsJson" : ""})
  `).run(item);
  await writeAudit("create", "customer", item.id, item.name);
  res.status(201).json(mapCustomer(await db.prepare("SELECT * FROM customers WHERE id = ?").get(item.id)));
});

app.delete("/api/customers/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const customer = await db.prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!customer) {
    res.status(404).json({ message: "客户或供应商不存在" });
    return;
  }
  const orderCount = (await db.prepare(`
    SELECT COUNT(*) AS count
    FROM orders
    WHERE deleted_at IS NULL
      AND (customer_id = ? OR customer = ? OR supplier = ?)
  `).get(id, customer.name, customer.name)).count;
  if (orderCount > 0) {
    res.status(409).json({ message: "已有订单记录，不允许删除" });
    return;
  }
  await db.prepare("UPDATE customers SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  await writeAudit("delete", "customer", id, customer.name);
  res.json({ ok: true });
});

app.get("/api/customer-contacts", async (req, res) => {
  const customerId = String(req.query.customerId || "").trim();
  const rows = customerId
    ? await db.prepare("SELECT * FROM customer_contacts WHERE deleted_at IS NULL AND customer_id = ? ORDER BY id DESC").all(customerId)
    : await db.prepare("SELECT * FROM customer_contacts WHERE deleted_at IS NULL ORDER BY id DESC").all();
  res.json(rows.map(mapCustomerContact));
});

app.post("/api/customer-contacts", async (req, res) => {
  const item = normalizeCustomerContactPayload(req.body);
  if (!item.customerId) {
    res.status(400).json({ message: "请选择客户" });
    return;
  }
  const customer = await db.prepare("SELECT id, name FROM customers WHERE id = ? AND deleted_at IS NULL").get(item.customerId);
  if (!customer) {
    res.status(404).json({ message: "客户不存在或已删除" });
    return;
  }
  if (!item.name) {
    res.status(400).json({ message: "联系人姓名不能为空" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO customer_contacts
      (customer_id, name, gender, title, mobile, phone, area, address, fax, email, wechat, qq, remark)
    VALUES
      (@customerId, @name, @gender, @title, @mobile, @phone, @area, @address, @fax, @email, @wechat, @qq, @remark)
  `).run(item);
  await writeAudit("create", "customer_contact", String(result.lastInsertId), `${customer.name} / ${item.name}`);
  res.status(201).json(mapCustomerContact(await db.prepare("SELECT * FROM customer_contacts WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/customer-contacts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.prepare("SELECT * FROM customer_contacts WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!existing) {
    res.status(404).json({ message: "联系人不存在或已删除" });
    return;
  }
  const item = normalizeCustomerContactPayload(req.body, existing);
  if (!item.name) {
    res.status(400).json({ message: "联系人姓名不能为空" });
    return;
  }
  await db.prepare(`
    UPDATE customer_contacts
    SET name = @name,
        gender = @gender,
        title = @title,
        mobile = @mobile,
        phone = @phone,
        area = @area,
        address = @address,
        fax = @fax,
        email = @email,
        wechat = @wechat,
        qq = @qq,
        remark = @remark,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id, ...item });
  await writeAudit(
    "update",
    "customer_contact",
    String(id),
    auditChangeSummary(existing, item, [
      { key: "name", label: "姓名" },
      { key: "mobile", label: "手机" },
      { key: "phone", label: "电话" },
      { key: "area", label: "片区" },
      { key: "address", label: "地址" },
      { key: "remark", label: "备注" }
    ], { entityLabel: "联系人" })
  );
  res.json(mapCustomerContact(await db.prepare("SELECT * FROM customer_contacts WHERE id = ?").get(id)));
});

app.delete("/api/customer-contacts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare("SELECT * FROM customer_contacts WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "联系人不存在或已删除" });
    return;
  }
  await db.prepare("UPDATE customer_contacts SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  await writeAudit("delete", "customer_contact", String(id), row.name);
  res.json({ ok: true });
});

app.get("/api/orders", async (_req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM orders
    WHERE deleted_at IS NULL
    ${ORDER_DEFAULT_SORT_SQL}
  `).all();
  res.json(await hydrateOrderRowsForApi(rows.map(mapOrder)));
});

function parseDispatchPlanRowsJson(rowsJson = "[]") {
  try {
    const parsed = JSON.parse(rowsJson || "[]");
    return Array.isArray(parsed)
      ? parsed.map((row) => ({
        ...row,
        vehicleSource: normalizeVehicleSource(row?.vehicleSource || row?.vehicle_source || "")
      }))
      : [];
  } catch {
    return [];
  }
}

function parseDispatchPlanRowJson(rowJson = "{}") {
  try {
    const parsed = JSON.parse(rowJson || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function dispatchRowLookupKeys(row = {}) {
  const id = String(row?.id || "").trim();
  const dispatchNo = String(row?.dispatchNo || row?.dispatch_no || "").trim();
  const orderNo = String(row?.orderNo || row?.order_no || "").trim();
  return [
    id && `id:${id}`,
    dispatchNo && `dispatch:${dispatchNo}`,
    orderNo && `order:${orderNo}`
  ].filter(Boolean);
}

function dispatchRowReferenceSet(row = {}) {
  return new Set(dispatchRowLookupKeys(row));
}

function dispatchRowMatchesRef(row = {}, ref = {}) {
  const refKeys = dispatchRowReferenceSet(ref);
  return refKeys.size > 0 && dispatchRowLookupKeys(row).some((key) => refKeys.has(key));
}

function dispatchRowLookup(rows = []) {
  const lookup = new Map();
  rows.forEach((row) => {
    dispatchRowLookupKeys(row).forEach((key) => {
      if (!lookup.has(key)) lookup.set(key, row);
    });
  });
  return lookup;
}

function findExistingDispatchRow(row = {}, lookup = new Map()) {
  for (const key of dispatchRowLookupKeys(row)) {
    const existing = lookup.get(key);
    if (existing) return existing;
  }
  return null;
}

function findDispatchRowIndex(row = {}, rows = []) {
  const keys = dispatchRowReferenceSet(row);
  if (!keys.size) return -1;
  return rows.findIndex((item) =>
    dispatchRowMatchesRef(item, row)
  );
}

function dispatchRowText(row = {}, key = "") {
  return String(row?.[key] ?? "").trim();
}

function dispatchRowFieldProvided(row = {}, camelKey = "", snakeKey = "") {
  if (!row || typeof row !== "object") return false;
  return Object.prototype.hasOwnProperty.call(row, camelKey)
    || (snakeKey ? Object.prototype.hasOwnProperty.call(row, snakeKey) : false);
}

function dispatchRowStringField(row = {}, existingRow = null, camelKey = "", snakeKey = "", fallback = "") {
  if (Object.prototype.hasOwnProperty.call(row, camelKey)) return userTextValue(row[camelKey]);
  if (snakeKey && Object.prototype.hasOwnProperty.call(row, snakeKey)) return userTextValue(row[snakeKey]);
  if (existingRow && Object.prototype.hasOwnProperty.call(existingRow, camelKey)) return userTextValue(existingRow[camelKey]);
  if (existingRow && snakeKey && Object.prototype.hasOwnProperty.call(existingRow, snakeKey)) return userTextValue(existingRow[snakeKey]);
  return userTextValue(fallback);
}

function dispatchRowArrayField(row = {}, existingRow = null, camelKey = "", snakeKey = "") {
  const source = Object.prototype.hasOwnProperty.call(row, camelKey)
    ? row[camelKey]
    : snakeKey && Object.prototype.hasOwnProperty.call(row, snakeKey)
      ? row[snakeKey]
      : existingRow && Object.prototype.hasOwnProperty.call(existingRow, camelKey)
        ? existingRow[camelKey]
        : existingRow && snakeKey && Object.prototype.hasOwnProperty.call(existingRow, snakeKey)
          ? existingRow[snakeKey]
          : [];
  let values = [];
  if (Array.isArray(source)) {
    values = source;
  } else {
    const text = String(source || "").trim();
    if (text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        values = Array.isArray(parsed) ? parsed : [];
      } catch {
        values = [];
      }
    } else {
      values = text ? text.split(/[\/／,，;；、]+/) : [];
    }
  }
  return Array.from(new Set(values.map((value) => userTextValue(value)).filter(Boolean)));
}

function dispatchRowBooleanField(row = {}, existingRow = null, camelKey = "", snakeKey = "", fallback = false) {
  if (Object.prototype.hasOwnProperty.call(row, camelKey)) return booleanFlag(row[camelKey], fallback);
  if (snakeKey && Object.prototype.hasOwnProperty.call(row, snakeKey)) return booleanFlag(row[snakeKey], fallback);
  if (existingRow && Object.prototype.hasOwnProperty.call(existingRow, camelKey)) return booleanFlag(existingRow[camelKey], fallback);
  if (existingRow && snakeKey && Object.prototype.hasOwnProperty.call(existingRow, snakeKey)) return booleanFlag(existingRow[snakeKey], fallback);
  return fallback;
}

function localTimestampInputValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeTimestampText(value = "") {
  const text = String(value || "").trim();
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!matched) return "";
  const date = parseInputDate(matched[1]) ? matched[1] : "";
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

function dispatchRowCreatedAt(row = {}, fallbackDate = "") {
  return normalizeTimestampText(row?.createdAt || row?.created_at)
    || dispatchRowTimestampFromId(row)
    || normalizeTimestampText(fallbackDate)
    || `${todayInputValue()} 00:00:00`;
}

function dispatchRowCreatedDate(row = {}, fallbackDate = "") {
  return dispatchRowCreatedAt(row, fallbackDate).slice(0, 10);
}

function dispatchRowBusinessDate(row = {}, fallbackDate = "") {
  const rowDate = String(row?.date || "").trim().slice(0, 10);
  const fallback = String(fallbackDate || "").trim().slice(0, 10);
  return (parseInputDate(rowDate) ? rowDate : "")
    || (parseInputDate(fallback) ? fallback : "");
}

function dispatchRowStatusRank(row = {}) {
  const status = normalizeDispatchPlanStatus(row?.status || row?.dispatch_status || "");
  if (status === "已签收") return 60;
  if (status === "异常滞留") return 55;
  if (status === "通关中") return 50;
  if (status === "已派车") return 40;
  if (status === DISPATCH_PLAN_DEFAULT_STATUS) return 30;
  return status ? 20 : 0;
}

function isPreferredDispatchDateCandidate(candidate, existing) {
  if (!existing) return true;
  if (candidate.priority !== existing.priority) return candidate.priority > existing.priority;
  if (candidate.statusRank !== existing.statusRank) return candidate.statusRank > existing.statusRank;
  if (candidate.date !== existing.date) return candidate.date > existing.date;
  return candidate.createdAt > existing.createdAt;
}

function dispatchRowHasReference(row = {}) {
  return dispatchRowLookupKeys(row).length > 0;
}

function dispatchRowReferenceValue(row = {}, camelKey = "", snakeKey = "") {
  return String(row?.[camelKey] ?? (snakeKey ? row?.[snakeKey] : "") ?? "").trim();
}

function dispatchRowOrderNo(row = {}) {
  return dispatchRowReferenceValue(row, "orderNo", "order_no");
}

function dispatchRowDispatchNo(row = {}) {
  return dispatchRowReferenceValue(row, "dispatchNo", "dispatch_no");
}

function dispatchRowLoadTime(row = {}) {
  return String(row?.loadTime ?? row?.load_time ?? "").trim();
}

async function orderDateFromLinkedDispatchRow(orderNo = "", dispatchNo = "", fallbackDate = "") {
  const normalizedOrderNo = String(orderNo || "").trim();
  const normalizedDispatchNo = String(dispatchNo || "").trim();
  if (!normalizedOrderNo && !normalizedDispatchNo) return String(fallbackDate || "").trim().slice(0, 10);

  let matched = null;
  const recordMatch = (row = {}, planDate = "", priority = 0) => {
    const matches = (normalizedOrderNo && dispatchRowOrderNo(row) === normalizedOrderNo)
      || (normalizedDispatchNo && dispatchRowDispatchNo(row) === normalizedDispatchNo);
    if (!matches) return;
    const createdAt = dispatchRowCreatedAt(row, planDate);
    const candidate = { date: dispatchRowBusinessDate(row, planDate), createdAt, priority, statusRank: dispatchRowStatusRank(row) };
    if (candidate.date && isPreferredDispatchDateCandidate(candidate, matched)) {
      matched = candidate;
    }
  };

  const plans = await db.prepare("SELECT plan_date, rows_json FROM dispatch_plans").all();
  for (const plan of plans) {
    const rows = parseDispatchPlanRowsJson(plan.rows_json);
    rows.forEach((row) => recordMatch(row, plan.plan_date, 2));
  }

  const recycleRows = await db.prepare(`
    SELECT plan_date, row_json
    FROM dispatch_plan_recycle
    WHERE (@orderNo <> '' AND order_no = @orderNo)
       OR (@dispatchNo <> '' AND dispatch_no = @dispatchNo)
    ORDER BY restored_at NULLS FIRST, deleted_at DESC, id DESC
  `).all({ orderNo: normalizedOrderNo, dispatchNo: normalizedDispatchNo });
  for (const recycle of recycleRows) {
    const row = parseDispatchPlanRowJson(recycle.row_json);
    if (dispatchRowHasReference(row)) recordMatch(row, recycle.plan_date, 1);
  }

  if (matched?.date) return matched.date;
  return String(fallbackDate || "").trim().slice(0, 10);
}

function recordOrderDispatchLoadInfoCandidate(lookup = new Map(), row = {}, planDate = "", priority = 0) {
  const date = dispatchRowBusinessDate(row, planDate);
  if (!date) return;
  const keys = [
    dispatchRowOrderNo(row) && `order:${dispatchRowOrderNo(row)}`,
    dispatchRowDispatchNo(row) && `dispatch:${dispatchRowDispatchNo(row)}`
  ].filter(Boolean);
  if (!keys.length) return;
  const candidate = {
    date,
    loadTime: dispatchRowLoadTime(row),
    createdAt: dispatchRowCreatedAt(row, planDate),
    priority,
    statusRank: dispatchRowStatusRank(row),
    driverText: [
      dispatchRowText(row, "driver"),
      dispatchRowText(row, "hkDriver"),
      dispatchRowText(row, "mainlandDriver")
    ]
      .flatMap((value) => String(value || "").split(/[\/／|｜、]+/))
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index)
      .join(" / ")
  };
  keys.forEach((key) => {
    const existing = lookup.get(key);
    if (isPreferredDispatchDateCandidate(candidate, existing)) lookup.set(key, candidate);
  });
}

async function orderDispatchLoadInfoLookup() {
  const lookup = new Map();
  const plans = await db.prepare("SELECT plan_date, rows_json FROM dispatch_plans").all();
  for (const plan of plans) {
    parseDispatchPlanRowsJson(plan.rows_json).forEach((row) =>
      recordOrderDispatchLoadInfoCandidate(lookup, row, plan.plan_date, 2)
    );
  }

  const recycleRows = await db.prepare(`
    SELECT plan_date, row_json
    FROM dispatch_plan_recycle
    ORDER BY restored_at NULLS FIRST, deleted_at DESC, id DESC
  `).all();
  for (const recycle of recycleRows) {
    const row = parseDispatchPlanRowJson(recycle.row_json);
    if (dispatchRowHasReference(row)) recordOrderDispatchLoadInfoCandidate(lookup, row, recycle.plan_date, 1);
  }
  return lookup;
}

async function hydrateOrderDispatchLoadInfo(orders = []) {
  if (!orders.length) return orders;
  const lookup = await orderDispatchLoadInfoLookup();
  return orders.map((order) => {
    const candidates = [
      order?.no && lookup.get(`order:${order.no}`),
      order?.dispatchNo && lookup.get(`dispatch:${order.dispatchNo}`)
    ].filter(Boolean);
    const matched = candidates.reduce((best, candidate) =>
      isPreferredDispatchDateCandidate(candidate, best) ? candidate : best
    , null);
    return {
      ...order,
      dispatchLoadDate: matched?.date || String(order?.date || "").trim().slice(0, 10),
      dispatchLoadTime: matched?.loadTime || "",
      dispatchDriver: matched?.driverText || ""
    };
  });
}

async function hydrateOrderRowsForApi(orders = []) {
  const rows = await hydrateOrderDispatchLoadInfo(await hydrateOrderFees(orders));
  const customerShortNames = await loadCustomerShortNameMap({ category: "运输客户" });
  return rows.map((row) => ({
    ...row,
    customerShortName: shortNameFromMap(row.customerId, customerShortNames)
      || shortNameFromMap(row.customer, customerShortNames)
      || row.customerShortName
      || ""
  }));
}

function dedupeDispatchPlanRows(rows = []) {
  const dedupedRows = [];
  const seenKeys = new Set();
  for (const row of rows) {
    const keys = dispatchRowLookupKeys(row);
    if (!keys.length) continue;
    if (keys.some((key) => seenKeys.has(key))) continue;
    dedupedRows.push(row);
    keys.forEach((key) => seenKeys.add(key));
  }
  return dedupedRows;
}

function normalizeDispatchPlanRow(row = {}, existingRow = null, requestCreator = {}, fallbackDate = "") {
  const item = row && typeof row === "object" ? row : {};
  const creator = dispatchRowCreatorFields(item, existingRow, requestCreator);
  const customerIds = dispatchRowArrayField(item, existingRow, "customerIds", "customer_ids");
  const customerNames = dispatchRowArrayField(item, existingRow, "customerNames", "customer_names");
  const primaryCustomerId = customerIds[0] || dispatchRowStringField(item, existingRow, "customerId", "customer_id");
  const customerDisplay = customerNames.length ? customerNames.join(" / ") : userTextValue(item.customer);
  const loadingLocations = normalizeLocationEntriesFromPayload(
    item,
    "loading",
    item.loading,
    existingRow?.loadingLocations || existingRow?.loading_locations || ""
  );
  const unloadingLocations = normalizeLocationEntriesFromPayload(
    item,
    "unloading",
    item.unloading,
    existingRow?.unloadingLocations || existingRow?.unloading_locations || ""
  );
  return {
    id: String(item.id || ""),
    createdAt: dispatchRowCreatedAt(item.createdAt || item.created_at ? item : (existingRow || item), item.date || existingRow?.date || fallbackDate),
    date: String(fallbackDate || item.date || ""),
    dispatchNo: String(item.dispatchNo || ""),
    orderNo: String(item.orderNo || ""),
    customerId: primaryCustomerId,
    customer: customerDisplay,
    customerIds,
    customerNames,
    businessType: dispatchRowStringField(item, existingRow, "businessType", "business_type"),
    currency: dispatchRowStringField(item, existingRow, "currency"),
    plate: normalizePlateText(item.plate),
    port: normalizePortText(item.port),
    needsWeighing: dispatchRowBooleanField(item, existingRow, "needsWeighing", "needs_weighing", false),
    direction: userTextValue(item.direction),
    tonnage: userTextValue(item.tonnage),
    quantity: userTextValue(item.quantity ?? ""),
    weight: userTextValue(item.weight),
    loading: composeLocationEntriesText(loadingLocations) || userRawMultilineTextValue(item.loading),
    loadingLocations,
    unloading: composeLocationEntriesText(unloadingLocations) || userRawMultilineTextValue(item.unloading),
    unloadingLocations,
    loadTime: userTextValue(item.loadTime || item.load_time),
    vehicleSource: normalizeVehicleSource(item.vehicleSource || item.vehicle_source),
    supplier: userTextValue(item.supplier),
    transportMode: userTextValue(item.transportMode || item.transport_mode),
    driver: userTextValue(item.driver),
    hkDriver: userTextValue(item.hkDriver || item.hk_driver),
    mainlandDriver: userTextValue(item.mainlandDriver || item.mainland_driver),
    status: userTextValue(item.status),
    previousStatus: userTextValue(item.previousStatus || item.previous_status),
    createdByAccountId: creator.createdByAccountId,
    createdByUsername: creator.createdByUsername,
    createdByName: creator.createdByName,
    note: userTextValue(item.note),
    tripNoEnabled: dispatchRowBooleanField(item, existingRow, "tripNoEnabled", "trip_no_enabled", false) ? 1 : 0,
    tripNo: dispatchRowStringField(item, existingRow, "tripNo", "trip_no"),
    sixSheetEnabled: dispatchRowBooleanField(item, existingRow, "sixSheetEnabled", "six_sheet_enabled", false) ? 1 : 0,
    sixSheetNo: dispatchRowStringField(item, existingRow, "sixSheetNo", "six_sheet_no")
  };
}

function dispatchExportNestedRow(row = {}) {
  return row && typeof row === "object" && !Array.isArray(row) ? row : {};
}

function dispatchExportText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function dispatchExportOptionalText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !["-", "—", "－"].includes(text)) return text;
  }
  return "";
}

function dispatchExportShortCustomer(row = {}, customerShortNames = new Map()) {
  const order = dispatchExportNestedRow(row.order);
  const customerIds = dispatchRowArrayField(row, order, "customerIds", "customer_ids");
  const customerNames = dispatchRowArrayField(row, order, "customerNames", "customer_names");
  const customerLabels = customerNames.map((name, index) => dispatchExportText(
    customerIds[index] ? customerShortNames.get(customerIds[index]) : "",
    name ? customerShortNames.get(name) : "",
    name
  )).filter(Boolean);
  if (customerLabels.length) return Array.from(new Set(customerLabels)).join(" / ");
  const customerId = dispatchExportText(order.customerId, row.customerId);
  const customerName = dispatchExportText(order.customer, row.customer);
  const candidate = dispatchExportText(
    customerId ? customerShortNames.get(customerId) : "",
    customerName ? customerShortNames.get(customerName) : "",
    order.customerShortName,
    order.shortName,
    row.customerShortName,
    row.shortName
  );
  return candidate || customerName;
}

function dispatchExportShortSupplier(row = {}, supplierShortNames = new Map()) {
  if (!dispatchExportIsOutsourced(row)) return OWN_VEHICLE_SOURCE;
  const order = dispatchExportNestedRow(row.order);
  const supplierId = dispatchExportText(order.supplierId, row.supplierId);
  const supplierName = dispatchExportOptionalText(order.supplier, row.supplier);
  const candidate = dispatchExportText(
    order.supplierShortName,
    row.supplierShortName,
    supplierId ? supplierShortNames.get(supplierId) : "",
    supplierName ? supplierShortNames.get(supplierName) : ""
  );
  return candidate || supplierName;
}

function dispatchExportFirstLocation(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .split(/[；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)[0] || "";
}

function dispatchExportShortLocation(value = "") {
  return dispatchExportLocationSummary(value);
}

function dispatchExportLocationEntries(row = {}, target = "") {
  const order = dispatchExportNestedRow(row.order);
  const orderLocations = order[`${target}Locations`] || order[`${target}_locations`];
  const rowLocations = row[`${target}Locations`] || row[`${target}_locations`];
  const text = dispatchExportText(row[target], order[target]);
  return normalizeLocationEntries(orderLocations && orderLocations.length ? orderLocations : rowLocations, text);
}

function dispatchExportLocationSummaryFromEntries(entries = []) {
  return normalizeLocationEntries(entries)
    .map((entry) => String(entry.district || entry.city || entry.detail || "").trim())
    .filter(Boolean)
    .join(" + ");
}

function dispatchExportRoute(row = {}) {
  const order = dispatchExportNestedRow(row.order);
  const loading = dispatchExportLocationSummaryFromEntries(dispatchExportLocationEntries(row, "loading"))
    || dispatchExportShortLocation(dispatchExportText(row.loading, order.loading));
  const unloading = dispatchExportLocationSummaryFromEntries(dispatchExportLocationEntries(row, "unloading"))
    || dispatchExportShortLocation(dispatchExportText(row.unloading, order.unloading));
  return [loading, unloading].filter(Boolean).join(" / ") || "-";
}

function dispatchExportTextWidth(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .reduce((max, line) => {
      const width = Array.from(line).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
      return Math.max(max, width);
    }, 0);
}

function dispatchExportWrappedLineCount(value = "", maxWidth = 34) {
  const lines = String(value || "").split(/\r?\n/);
  const wrappedLines = lines.map((line) => Math.max(1, Math.ceil(dispatchExportTextWidth(line) / maxWidth)));
  return Math.max(1, wrappedLines.reduce((sum, item) => sum + item, 0));
}

function dispatchExportCellDisplayText(value, columnNumber) {
  if (value instanceof Date) {
    if (columnNumber === 2) {
      return `${value.getMonth() + 1}月${value.getDate()}日`;
    }
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }
  return String(value ?? "");
}

function dispatchExportRowHeight(values = [], columnWidths = []) {
  const baseHeight = 20;
  const extraLineHeight = 16;
  const lineCounts = values.map((value, index) => {
    const width = Number(columnWidths[index] || 0);
    const effectiveWidth = Math.max(8, Math.floor(width * 1.1));
    return dispatchExportWrappedLineCount(dispatchExportCellDisplayText(value, index + 1), effectiveWidth);
  });
  const maxLines = Math.max(1, ...lineCounts);
  return Math.min(260, baseHeight + Math.max(0, maxLines - 1) * extraLineHeight);
}

function dispatchExportDateValue(value = "", fallback = "") {
  const text = dispatchExportText(value, fallback);
  const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (matched) return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), 12, 0, 0);
  return parseInputDate(text) || text;
}

function dispatchExportTimeValue(value = "") {
  const matched = String(value || "").trim().match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!matched) return String(value || "");
  return `${String(Number(matched[1])).padStart(2, "0")}:${matched[2]}`;
}

function dispatchExportPlateGroup(row = {}) {
  const order = dispatchExportNestedRow(row.order);
  return dispatchExportText(row.plate, order.plate);
}

function dispatchExportComparableDate(row = {}) {
  const order = dispatchExportNestedRow(row.order);
  const dateText = dispatchExportText(row.date, order.date);
  const date = parseInputDate(dateText);
  return date ? date.getTime() : Number.POSITIVE_INFINITY;
}

function dispatchExportDateGroupKey(row = {}, fallbackDate = "") {
  const order = dispatchExportNestedRow(row.order);
  const dateText = dispatchExportText(row.date, order.date, fallbackDate);
  const date = parseInputDate(dateText);
  if (!date) return String(dateText || fallbackDate || "").trim();
  return dateInputFromDate(date);
}

function dispatchExportComparableTime(row = {}) {
  const order = dispatchExportNestedRow(row.order);
  const timeText = dispatchExportText(row.loadTime, order.loadTime, order.loadingTime);
  const matched = String(timeText || "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return Number.POSITIVE_INFINITY;
  return Number(matched[1]) * 60 + Number(matched[2]);
}

function dispatchExportVehicleSourceRank(row = {}) {
  const order = dispatchExportNestedRow(row.order);
  const vehicleSource = normalizeVehicleSource(dispatchExportText(order.vehicleSource, row.vehicleSource));
  if (vehicleSource === "汉业物流") return 0;
  if (vehicleSource === "外派车辆") return 1;
  return 2;
}

function dispatchExportIsOutsourced(row = {}) {
  return dispatchExportVehicleSourceRank(row) === 1;
}

function dispatchExportSupplierGroup(row = {}) {
  if (!dispatchExportIsOutsourced(row)) return OWN_VEHICLE_SOURCE;
  const order = dispatchExportNestedRow(row.order);
  return dispatchExportText(order.supplier, row.supplier) || OWN_VEHICLE_SOURCE;
}

function compareDispatchExportRows(left = {}, right = {}) {
  const leftPlate = dispatchExportPlateGroup(left);
  const rightPlate = dispatchExportPlateGroup(right);
  const leftIsLastPlate = leftPlate === "粤ZEJ59港";
  const rightIsLastPlate = rightPlate === "粤ZEJ59港";
  if (leftIsLastPlate !== rightIsLastPlate) return leftIsLastPlate ? 1 : -1;
  const leftOutsourced = dispatchExportIsOutsourced(left);
  const rightOutsourced = dispatchExportIsOutsourced(right);
  if (leftOutsourced !== rightOutsourced) return leftOutsourced ? -1 : 1;

  const leftSupplier = dispatchExportSupplierGroup(left);
  const rightSupplier = dispatchExportSupplierGroup(right);

  if (leftOutsourced) {
    const supplierCompare = String(leftSupplier || "").localeCompare(String(rightSupplier || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    if (supplierCompare !== 0) return supplierCompare;

    const timeCompare = dispatchExportComparableTime(left) - dispatchExportComparableTime(right);
    if (timeCompare !== 0) return timeCompare;

    const dateCompare = dispatchExportComparableDate(left) - dispatchExportComparableDate(right);
    if (dateCompare !== 0) return dateCompare;
  } else {
    if (!leftPlate && rightPlate) return 1;
    if (!rightPlate && leftPlate) return -1;
    const plateCompare = String(leftPlate || "").localeCompare(String(rightPlate || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
    if (plateCompare !== 0) return plateCompare;

    const dateCompare = dispatchExportComparableDate(left) - dispatchExportComparableDate(right);
    if (dateCompare !== 0) return dateCompare;

    const timeCompare = dispatchExportComparableTime(left) - dispatchExportComparableTime(right);
    if (timeCompare !== 0) return timeCompare;
  }

  const noCompare = dispatchExportText(left.dispatchNo, left.order?.dispatchNo).localeCompare(
    dispatchExportText(right.dispatchNo, right.order?.dispatchNo),
    "zh-Hans-CN",
    { numeric: true, sensitivity: "base" }
  );
  if (noCompare !== 0) return noCompare;

  return (left.__exportIndex ?? 0) - (right.__exportIndex ?? 0);
}

function compareDispatchExportRowsByDate(left = {}, right = {}, fallbackDate = "") {
  const leftDate = dispatchExportDateGroupKey(left, fallbackDate);
  const rightDate = dispatchExportDateGroupKey(right, fallbackDate);
  const leftDateValue = parseInputDate(leftDate)?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightDateValue = parseInputDate(rightDate)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftDateValue !== rightDateValue) return leftDateValue - rightDateValue;
  const textCompare = String(leftDate || "").localeCompare(String(rightDate || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  if (textCompare !== 0) return textCompare;
  return compareDispatchExportRows(left, right);
}

function dispatchExportWorkbookTitle(rows = [], fallbackDate = todayInputValue()) {
  const first = rows.find((row) => dispatchExportText(row?.plate, row?.order?.plate) || dispatchExportText(row?.dispatchNo, row?.order?.dispatchNo)) || rows[0] || {};
  const order = dispatchExportNestedRow(first.order);
  const dateText = dispatchExportText(first.date, order.date, fallbackDate);
  const date = parseInputDate(dateText);
  if (!date) return `${dateText || fallbackDate}汉业公司跟单表`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日汉业公司跟单表`;
}

function dispatchExportRowsForWorkbook(rows = [], fallbackDate = "", customerShortNames = new Map(), supplierShortNames = new Map(), options = {}) {
  const dateGroupKeys = new Set(rows.map((row) => dispatchExportDateGroupKey(row, fallbackDate)).filter(Boolean));
  const multiDayExport = dateGroupKeys.size > 1;
  const sortedRows = [...rows]
    .map((row, index) => ({ ...row, __exportIndex: index }))
    .sort((left, right) => multiDayExport
      ? compareDispatchExportRowsByDate(left, right, fallbackDate)
      : compareDispatchExportRows(left, right)
    );
  const bodyRows = [];
  let previousGroupKey = "";
  let previousDateKey = "";
  let previousOutsourced = false;
  let serialNumber = 0;
  sortedRows.forEach((row) => {
    const dateKey = dispatchExportDateGroupKey(row, fallbackDate);
    const plate = dispatchExportPlateGroup(row);
    const outsourced = dispatchExportIsOutsourced(row);
    const supplierGroup = dispatchExportSupplierGroup(row);
    const groupKey = outsourced ? `outsourced:${supplierGroup}` : `own:${plate}`;
    if (bodyRows.length && (multiDayExport ? dateKey !== previousDateKey || groupKey !== previousGroupKey : groupKey !== previousGroupKey)) {
      const blankRowCount = multiDayExport && dateKey !== previousDateKey
        ? 2
        : (options.spacingMode === "day" || multiDayExport)
        ? (outsourced && previousOutsourced ? 0 : 1)
        : 2;
      for (let index = 0; index < blankRowCount; index += 1) {
        bodyRows.push(null);
      }
    }
    previousGroupKey = groupKey;
    previousDateKey = dateKey;
    previousOutsourced = outsourced;
    serialNumber += 1;
    const order = dispatchExportNestedRow(row.order);
    const vehicleSource = dispatchExportText(order.vehicleSource, row.vehicleSource);
    const supplier = dispatchExportText(order.supplier, row.supplier);
    const hkDriver = dispatchExportText(row.hkDriver, order.hkDriver, row.driver, order.driver);
    const mainlandDriver = dispatchExportText(row.mainlandDriver, order.mainlandDriver);
    const supplierDisplay = dispatchExportOptionalText(order.supplier, row.supplier);
    bodyRows.push([
      serialNumber,
      dispatchExportDateValue(dispatchExportText(row.date, order.date, fallbackDate), fallbackDate),
      dispatchExportShortCustomer(row, customerShortNames),
      dispatchExportText(row.plate, order.plate),
      dispatchExportRoute(row),
      dispatchExportText(order.tonnage, row.tonnage),
      dispatchExportText(order.quantity, row.quantity),
      hkDriver,
      mainlandDriver,
      dispatchExportText(normalizePortText(order.port), normalizePortText(row.port)),
      dispatchExportText(order.direction, row.direction),
      dispatchExportTimeValue(dispatchExportText(row.loadTime, order.loadTime, order.loadingTime)),
      dispatchExportShortSupplier(row, supplierShortNames),
      supplierDisplay ? "外派" : "",
      dispatchExportText(row.note, order.remark)
    ]);
  });
  return bodyRows;
}

async function renderDispatchPlanXlsxBuffer(rows = [], title = "", fallbackDate = "", options = {}) {
  const spacingMode = String(options.exportSpacing || "").trim() || "default";
  const customerShortNameRows = await db.prepare(`
    SELECT id, name, short_name
    FROM customers
    WHERE deleted_at IS NULL AND type = '客户' AND customer_category = '运输客户'
    ORDER BY created_at DESC, id DESC
  `).all();
  const customerShortNames = new Map();
  customerShortNameRows.forEach((row) => {
    const shortName = String(row.short_name || "").trim();
    const name = String(row.name || "").trim();
    if (shortName && name) {
      customerShortNames.set(String(row.id || "").trim(), shortName);
      if (!customerShortNames.has(name)) customerShortNames.set(name, shortName);
    }
  });
  const supplierShortNameRows = await db.prepare(`
    SELECT id, name, short_name
    FROM customers
    WHERE deleted_at IS NULL AND type = '供应商'
  `).all();
  const supplierShortNames = new Map();
  supplierShortNameRows.forEach((row) => {
    const shortName = String(row.short_name || "").trim();
    const name = String(row.name || "").trim();
    if (shortName && name) {
      supplierShortNames.set(name, shortName);
      supplierShortNames.set(String(row.id || "").trim(), shortName);
    }
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "汉业管理系统";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet("排车表");
  const headers = ["序号", "日期", "客户", "车牌", "装/卸", "吨位", "计重", "HK司机", "大陆司机", "口岸", "进/出", "订车时间", "供应商", "外派", "备注"];
  const columnWidths = [6.5, 12, 21, 15.5, 48, 8.5, 18, 12.5, 10.5, 13.5, 9, 10.5, 16, 10.5, 36];
  columnWidths.forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });
  worksheet.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.2, right: 0.2, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 }
  };
  worksheet.mergeCells("A1:K1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = title || dispatchExportWorkbookTitle(rows);
  titleCell.font = { name: "SimSun", size: 18 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
  titleCell.border = { bottom: { style: "medium", color: { argb: "FF000000" } } };
  worksheet.getRow(1).height = 22.5;

  const headerBorder = {
    top: { style: "medium", color: { argb: "FF000000" } },
    left: { style: "medium", color: { argb: "FF000000" } },
    bottom: { style: "medium", color: { argb: "FF000000" } },
    right: { style: "medium", color: { argb: "FF000000" } }
  };
  const bodyBorder = {
    top: { style: "thin", color: { argb: "FF000000" } },
    left: { style: "thin", color: { argb: "FF000000" } },
    bottom: { style: "thin", color: { argb: "FF000000" } },
    right: { style: "thin", color: { argb: "FF000000" } }
  };
  headers.forEach((header, index) => {
    const column = index + 1;
    worksheet.mergeCells(2, column, 3, column);
    const cell = worksheet.getCell(2, column);
    cell.value = header;
    cell.font = { name: "SimSun", size: 14 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: column !== 1 };
    cell.border = headerBorder;
    worksheet.getCell(3, column).border = headerBorder;
  });
  worksheet.getRow(2).height = 18;
  worksheet.getRow(3).height = 18;

  const bodyRows = dispatchExportRowsForWorkbook(rows, fallbackDate, customerShortNames, supplierShortNames, { spacingMode });
  bodyRows.forEach((values, rowIndex) => {
    const excelRow = worksheet.getRow(rowIndex + 4);
    if (!values) {
      excelRow.values = Array(15).fill(null);
      excelRow.height = 16;
      return;
    }
    excelRow.values = values;
    excelRow.height = dispatchExportRowHeight(values, columnWidths);
    excelRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: "SimSun", size: 14 };
      cell.alignment = {
        horizontal: columnNumber === 15 ? "left" : "center",
        vertical: "middle",
        wrapText: columnNumber === 5 || columnNumber === 15
      };
      cell.border = bodyBorder;
      if (columnNumber === 2 && cell.value instanceof Date) cell.numFmt = "m\"月\"d\"日\"";
      if (columnNumber === 12 && cell.value instanceof Date) cell.numFmt = "h:mm";
    });
  });

  worksheet.views = [{ state: "frozen", ySplit: 3 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function dispatchRowsEquivalent(left = {}, right = {}) {
  const comparableLocationJson = (row = {}, target = "") => {
    const camelKey = `${target}Locations`;
    const snakeKey = `${target}_locations`;
    const rawValue = Object.prototype.hasOwnProperty.call(row, camelKey)
      ? row[camelKey]
      : (Object.prototype.hasOwnProperty.call(row, snakeKey) ? row[snakeKey] : row?.[target]);
    return locationEntriesJson(normalizeLocationEntries(rawValue, row?.[target] || ""));
  };
  const keys = [
    "id",
    "dispatchNo",
    "orderNo",
    "customerId",
    "customer",
    "businessType",
    "currency",
    "plate",
    "port",
    "needsWeighing",
    "direction",
    "tonnage",
    "quantity",
    "weight",
    "loadTime",
    "vehicleSource",
    "supplier",
    "transportMode",
    "driver",
    "hkDriver",
    "mainlandDriver",
    "status",
    "previousStatus",
    "note",
    "tripNoEnabled",
    "tripNo",
    "sixSheetEnabled",
    "sixSheetNo"
  ];
  const scalarEquivalent = keys.every((key) => {
    if (["needsWeighing", "tripNoEnabled", "sixSheetEnabled"].includes(key)) {
      return booleanFlag(left?.[key], false) === booleanFlag(right?.[key], false);
    }
    return String(left?.[key] ?? "") === String(right?.[key] ?? "");
  });
  return scalarEquivalent
    && comparableLocationJson(left, "loading") === comparableLocationJson(right, "loading")
    && comparableLocationJson(left, "unloading") === comparableLocationJson(right, "unloading");
}

function createDispatchPlanConflictError(message, detail = "") {
  const error = new Error(message);
  error.statusCode = 409;
  error.detail = detail;
  return error;
}

function mergeDispatchPlanRows(existingRows = [], incomingRows = []) {
  const normalizedExistingRows = dedupeDispatchPlanRows(existingRows);
  const normalizedIncomingRows = dedupeDispatchPlanRows(incomingRows);
  const mergedRows = [];
  const seenExistingKeys = new Set();
  const stats = {
    added: 0,
    updated: 0,
    unchanged: 0,
    staleSkipped: 0,
    conflict: 0
  };

  const existingLookup = dispatchRowLookup(normalizedExistingRows);

  for (const row of normalizedIncomingRows) {
    const existingRow = findExistingDispatchRow(row, existingLookup);
    const rowKeys = dispatchRowLookupKeys(row);
    rowKeys.forEach((key) => seenExistingKeys.add(key));

    if (existingRow) {
      if (dispatchRowsEquivalent(existingRow, row)) {
        mergedRows.push(existingRow);
        stats.unchanged += 1;
      } else {
        mergedRows.push(row);
        stats.updated += 1;
      }
      continue;
    }

    mergedRows.push(row);
    stats.added += 1;
  }

  const protectedRows = normalizedExistingRows.filter((row) =>
    !dispatchRowLookupKeys(row).some((key) => seenExistingKeys.has(key))
  );
  const rows = dedupeDispatchPlanRows([...mergedRows, ...protectedRows]);
  stats.protected = protectedRows.length;
  return { rows, stats };
}

async function lockDispatchPlanDate(date) {
  await db.prepare("SELECT pg_advisory_xact_lock(524458, hashtext(?))").get(`dispatch_plan:${date}`);
}

function dispatchRowOrderSyncKey(row = {}) {
  return [
    "createdAt",
    "date",
    "orderNo",
    "dispatchNo",
    "plate",
    "vehicleSource",
    "supplier",
    "transportMode",
    "driver",
    "hkDriver",
	    "mainlandDriver",
	    "loading",
	    "unloading",
	    "loadingLocations",
	    "unloadingLocations",
	    "status",
	    "previousStatus"
	  ].map((key) => `${key}:${key.endsWith("Locations") ? locationEntriesJson(row[key]) : dispatchRowText(row, key)}`).join("|");
}

function dispatchRowNeedsOrderSync(row = {}, existingRow = null) {
  if (!dispatchRowText(row, "orderNo") && !dispatchRowText(row, "dispatchNo")) return false;
  if (!existingRow) return true;
  return dispatchRowOrderSyncKey(row) !== dispatchRowOrderSyncKey(existingRow);
}

function dispatchRowCreatorFields(row = {}, existingRow = null, requestCreator = {}) {
  if (existingRow) {
    const existingCreator = creatorFieldsFromRecord(existingRow);
    if (creatorFieldsHaveValue(existingCreator)) return existingCreator;
    return creatorFieldsFromRecord(row);
  }
  const incomingCreator = creatorFieldsFromRecord(row);
  return creatorFieldsHaveValue(incomingCreator) ? incomingCreator : requestCreator;
}

function mapDispatchPlanRecord(row = {}) {
  return {
    date: row.plan_date,
    rows: dedupeDispatchPlanRows(parseDispatchPlanRowsJson(row.rows_json).map((item) => normalizeDispatchPlanRow(item, null, {}, row.plan_date))),
    createdByAccountId: row.created_by_account_id || null,
    createdByUsername: row.created_by_username || "",
    createdByName: row.created_by_display_name || row.created_by_username || "",
    updatedAt: row.updated_at || "",
    version: row.updated_at || ""
  };
}

function normalizeDispatchRecycleRow(row = {}, planDate = todayInputValue()) {
  const item = row && typeof row === "object" ? row : {};
  const creator = creatorFieldsFromRecord(item);
  const customerIds = dispatchRowArrayField(item, null, "customerIds", "customer_ids");
  const customerNames = dispatchRowArrayField(item, null, "customerNames", "customer_names");
  const primaryCustomerId = customerIds[0] || String(item.customerId || item.customer_id || "");
  const customerDisplay = customerNames.length ? customerNames.join(" / ") : userTextValue(item.customer);
  const loadingLocations = normalizeLocationEntriesFromPayload(item, "loading", item.loading);
  const unloadingLocations = normalizeLocationEntriesFromPayload(item, "unloading", item.unloading);
  return {
    id: String(item.id || item.dispatchNo || item.dispatch_no || `dispatch-restored-${Date.now()}`),
    createdAt: dispatchRowCreatedAt(item, planDate),
    dispatchNo: String(item.dispatchNo || item.dispatch_no || ""),
    orderNo: String(item.orderNo || item.order_no || ""),
    customerId: primaryCustomerId,
    customer: customerDisplay,
    customerIds,
    customerNames,
    businessType: userTextValue(item.businessType || item.business_type),
    currency: userTextValue(item.currency),
    plate: normalizePlateText(item.plate),
    port: normalizePortText(item.port),
    needsWeighing: booleanFlag(item.needsWeighing ?? item.needs_weighing, false),
    direction: userTextValue(item.direction),
    tonnage: userTextValue(item.tonnage),
    quantity: userTextValue(item.quantity ?? ""),
    weight: userTextValue(item.weight),
    loading: composeLocationEntriesText(loadingLocations) || userRawMultilineTextValue(item.loading),
    loadingLocations,
    unloading: composeLocationEntriesText(unloadingLocations) || userRawMultilineTextValue(item.unloading),
    unloadingLocations,
    loadTime: userTextValue(item.loadTime || item.load_time),
    vehicleSource: normalizeVehicleSource(item.vehicleSource || item.vehicle_source),
    supplier: userTextValue(item.supplier),
    transportMode: userTextValue(item.transportMode || item.transport_mode),
    driver: userTextValue(item.driver),
    hkDriver: userTextValue(item.hkDriver || item.hk_driver),
    mainlandDriver: userTextValue(item.mainlandDriver || item.mainland_driver),
    status: userTextValue(item.status),
    previousStatus: userTextValue(item.previousStatus || item.previous_status),
    createdByAccountId: creator.createdByAccountId,
    createdByUsername: creator.createdByUsername,
    createdByName: creator.createdByName,
    note: userTextValue(item.note),
    tripNoEnabled: booleanFlag(item.tripNoEnabled ?? item.trip_no_enabled, false) ? 1 : 0,
    tripNo: String(item.tripNo || item.trip_no || ""),
    sixSheetEnabled: booleanFlag(item.sixSheetEnabled ?? item.six_sheet_enabled, false) ? 1 : 0,
    sixSheetNo: String(item.sixSheetNo || item.six_sheet_no || ""),
    date: String(item.date || planDate || "")
  };
}

function mapDispatchRecycleRecord(row = {}) {
  const planDate = row.plan_date || "";
  const payload = normalizeDispatchRecycleRow(parseDispatchPlanRowJson(row.row_json), planDate);
  return {
    id: row.id,
    date: planDate,
    planDate,
    dispatchNo: row.dispatch_no || payload.dispatchNo || "",
    orderNo: row.order_no || payload.orderNo || "",
    customer: row.customer || payload.customer || "",
    row: payload,
    deletedAt: row.deleted_at || "",
    restoredAt: row.restored_at || ""
  };
}

function dispatchRowMatchesRefs(row = {}, orderNo = "", dispatchNo = "") {
  const rowOrderNo = dispatchRowText(row, "orderNo");
  const rowDispatchNo = dispatchRowText(row, "dispatchNo");
  return Boolean((orderNo && rowOrderNo === orderNo) || (dispatchNo && rowDispatchNo === dispatchNo));
}

async function recycleDispatchPlanRows(planDate, rows = []) {
  const validRows = rows
    .map((row) => normalizeDispatchRecycleRow(row, planDate))
    .filter((row) => dispatchRowText(row, "dispatchNo") || dispatchRowText(row, "orderNo"));
  if (!validRows.length) return 0;

  const insert = await db.prepare(`
    INSERT INTO dispatch_plan_recycle
      (plan_date, dispatch_no, order_no, customer, row_json, deleted_at)
    VALUES
      (@planDate, @dispatchNo, @orderNo, @customer, @rowJson, CURRENT_TIMESTAMP)
  `);
  for (const row of validRows) {
    await insert.run({
      planDate,
      dispatchNo: row.dispatchNo,
      orderNo: row.orderNo,
      customer: row.customer,
      rowJson: JSON.stringify(row)
    });
  }
  return validRows.length;
}

async function restoreDispatchRecycleRecord(recycleId) {
  const recycleRow = await db.prepare("SELECT * FROM dispatch_plan_recycle WHERE id = ? AND restored_at IS NULL").get(recycleId);
  if (!recycleRow) return null;

  const planDate = recycleRow.plan_date;
  await lockDispatchPlanDate(planDate);
  const restoredRow = normalizeDispatchRecycleRow(parseDispatchPlanRowJson(recycleRow.row_json), planDate);
  const plan = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(planDate);
  const existingRows = parseDispatchPlanRowsJson(plan?.rows_json);
  const alreadyExists = existingRows.some((row) =>
    dispatchRowMatchesRefs(row, restoredRow.orderNo, restoredRow.dispatchNo)
  );
  const nextRows = alreadyExists ? existingRows : [...existingRows, restoredRow];
  const rowsJson = JSON.stringify(nextRows);
  if (plan) {
    await db.prepare(`
      UPDATE dispatch_plans
      SET rows_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE plan_date = ?
    `).run(rowsJson, planDate);
  } else {
    const creator = creatorFieldsFromRecord(restoredRow);
    await db.prepare(`
      INSERT INTO dispatch_plans
        (plan_date, rows_json, created_by_account_id, created_by_username, created_by_display_name, updated_at)
      VALUES
        (@planDate, @rowsJson, @createdByAccountId, @createdByUsername, @createdByName, CURRENT_TIMESTAMP)
    `).run({
      planDate,
      rowsJson,
      createdByAccountId: creator.createdByAccountId,
      createdByUsername: creator.createdByUsername,
      createdByName: creator.createdByName
    });
  }

  await db.prepare("UPDATE dispatch_plan_recycle SET restored_at = CURRENT_TIMESTAMP WHERE id = ?").run(recycleId);
  const updatedRecycleRow = await db.prepare("SELECT * FROM dispatch_plan_recycle WHERE id = ?").get(recycleId);
  return mapDispatchRecycleRecord(updatedRecycleRow);
}

async function restoreDispatchPlanRowsLinkedToOrder(orderRow = {}) {
  const orderNo = String(orderRow.no || "").trim();
  const dispatchNo = String(orderRow.dispatch_no || orderRow.dispatchNo || "").trim();
  if (!orderNo && !dispatchNo) return [];

  const rows = await db.prepare(`
    SELECT * FROM dispatch_plan_recycle
    WHERE restored_at IS NULL
      AND (
        (@orderNo <> '' AND order_no = @orderNo)
        OR (@dispatchNo <> '' AND dispatch_no = @dispatchNo)
      )
    ORDER BY deleted_at DESC, id DESC
  `).all({ orderNo, dispatchNo });

  const restored = [];
  for (const row of rows) {
    const item = await restoreDispatchRecycleRecord(row.id);
    if (item) restored.push(item);
  }
  if (restored.length === 0 && dispatchNo) {
    const restoredOrder = orderRow.deleted_at
      ? { ...orderRow, deleted_at: null }
      : await db.prepare("SELECT * FROM orders WHERE no = ?").get(orderNo);
    const synthetic = dispatchRecycleRowFromOrder(restoredOrder);
    await recycleDispatchPlanRows(synthetic.date, [synthetic]);
    const latest = await db.prepare(`
      SELECT id FROM dispatch_plan_recycle
      WHERE restored_at IS NULL
        AND order_no = @orderNo
        AND dispatch_no = @dispatchNo
      ORDER BY id DESC
      LIMIT 1
    `).get({ orderNo, dispatchNo });
    if (latest) {
      const item = await restoreDispatchRecycleRecord(latest.id);
      if (item) restored.push(item);
    }
  }
  return restored;
}

async function syncDispatchPlanRowsStatusForOrder(orderRow = {}, dispatchStatus = "") {
  const normalizedStatus = String(dispatchStatus || "").trim();
  if (!DISPATCH_STATUS_OPTIONS.includes(normalizedStatus)) return 0;
  const orderNo = String(orderRow.no || orderRow.order_no || "").trim();
  const dispatchNo = String(orderRow.dispatch_no || orderRow.dispatchNo || "").trim();
  if (!orderNo && !dispatchNo) return 0;

  const plans = await db.prepare("SELECT plan_date, rows_json FROM dispatch_plans").all();
  let changed = 0;
  for (const plan of plans) {
    await lockDispatchPlanDate(plan.plan_date);
    const rows = parseDispatchPlanRowsJson(plan.rows_json);
    let planChanged = false;
    const nextRows = rows.map((row) => {
      if (!dispatchRowMatchesRefs(row, orderNo, dispatchNo)) return row;
      const previousStatus = normalizeDispatchPlanStatus(row.status);
      if (previousStatus === normalizedStatus) return row;
      planChanged = true;
      changed += 1;
      return {
        ...row,
        status: normalizedStatus,
        previousStatus: previousStatus && previousStatus !== normalizedStatus ? previousStatus : row.previousStatus || ""
      };
    });
    if (!planChanged) continue;
    await db.prepare(`
      UPDATE dispatch_plans
      SET rows_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE plan_date = ?
    `).run(JSON.stringify(nextRows), plan.plan_date);
  }
  return changed;
}

function dispatchRecycleRowFromOrder(order = {}) {
  const mapped = mapOrder(order);
  const creator = creatorFieldsFromRecord(order);
  const dispatchStatus = ORDER_STATUS_TO_DISPATCH_STATUS[mapped.status] || "预排";
  return {
    id: `dispatch-restored-${mapped.no || mapped.dispatchNo || Date.now()}`,
    createdAt: mapped.date || todayInputValue(),
    dispatchNo: mapped.dispatchNo,
    orderNo: mapped.no,
    customer: mapped.customer || "",
    plate: mapped.plate || "",
    port: mapped.port || "",
    needsWeighing: booleanFlag(mapped.needsWeighing, false),
    direction: mapped.direction || "",
    tonnage: mapped.tonnage || "",
    quantity: mapped.quantity || "",
	    weight: mapped.weight || "",
	    loading: mapped.loading || "",
	    loadingLocations: mapped.loadingLocations || [],
	    unloading: mapped.unloading || "",
	    unloadingLocations: mapped.unloadingLocations || [],
    loadTime: "",
    vehicleSource: mapped.vehicleSource || "",
    supplier: mapped.supplier || "",
    transportMode: mapped.transportMode || "",
    driver: mapped.transportMode === "单司机" ? (mapped.driver || mapped.hkDriver || "") : "",
    hkDriver: mapped.hkDriver || "",
    mainlandDriver: mapped.mainlandDriver || "",
    status: dispatchStatus,
    previousStatus: "",
    createdByAccountId: creator.createdByAccountId,
    createdByUsername: creator.createdByUsername,
    createdByName: creator.createdByName,
    note: mapped.remark || "",
    date: mapped.date || todayInputValue()
  };
}

async function syncDispatchPlanRowsToOrders(planDate, rows = []) {
  const rowsToSync = rows.filter((row) => dispatchRowText(row, "orderNo") || dispatchRowText(row, "dispatchNo"));
  if (!rowsToSync.length) return 0;

  let synced = 0;
  const findOrder = await db.prepare(`
    SELECT * FROM orders
    WHERE deleted_at IS NULL
      AND (
        (@orderNo <> '' AND no = @orderNo)
        OR (@dispatchNo <> '' AND dispatch_no <> '' AND dispatch_no = @dispatchNo)
      )
    ORDER BY CASE WHEN no = @orderNo THEN 0 ELSE 1 END
    LIMIT 1
  `);
  const updateOrder = await db.prepare(`
    UPDATE orders
    SET dispatch_no = @dispatchNo,
        needs_weighing = @needsWeighing,
        vehicle_source = @vehicleSource,
        supplier = @supplier,
        plate = @plate,
	        driver = @driver,
	        hk_driver = @hkDriver,
	        mainland_driver = @mainlandDriver,
	        transport_mode = @transportMode,
	        loading = @loading,
	        loading_locations = @loadingLocationsJson,
	        unloading = @unloading,
	        unloading_locations = @unloadingLocationsJson,
	        status = @status,
	        order_date = @orderDate
    WHERE no = @no AND deleted_at IS NULL
  `);

  for (const row of rowsToSync) {
    const orderNo = dispatchRowText(row, "orderNo");
    const dispatchNo = dispatchRowText(row, "dispatchNo");
    const order = await findOrder.get({ orderNo, dispatchNo });
    if (!order) continue;
    if (order.status === "已审核") continue;

    const transportMode = normalizeTransportMode(row.transportMode || order.transport_mode || "") || order.transport_mode || "";
    const isSingleDriver = transportMode === "单司机";
    const rowDriver = dispatchRowText(row, "driver");
    const rowHkDriver = dispatchRowText(row, "hkDriver");
    const rowMainlandDriver = dispatchRowText(row, "mainlandDriver");
    const driver = isSingleDriver
      ? (rowDriver || rowHkDriver || order.driver || "")
      : [rowHkDriver || rowDriver, rowMainlandDriver].filter(Boolean).join(" / ");
    const mappedOrderStatus = DISPATCH_STATUS_TO_ORDER_STATUS[normalizeDispatchPlanStatus(row.status)] || order.status || "预排";
    const orderStatus = shouldPreventOrderStatusDowngrade(order.status, mappedOrderStatus)
      ? order.status
      : mappedOrderStatus;

    await updateOrder.run({
      no: order.no,
      dispatchNo: dispatchNo || order.dispatch_no || "",
      needsWeighing: booleanFlag(row.needsWeighing ?? order.needs_weighing, false) ? 1 : 0,
      vehicleSource: normalizeVehicleSource(dispatchRowText(row, "vehicleSource") || order.vehicle_source || ""),
      supplier: normalizeVehicleSource(dispatchRowText(row, "vehicleSource")) === "外派车辆" ? dispatchRowText(row, "supplier") : "",
      plate: dispatchRowText(row, "plate"),
      driver,
      hkDriver: isSingleDriver ? "" : (rowHkDriver || rowDriver),
	      mainlandDriver: isSingleDriver ? "" : rowMainlandDriver,
	      transportMode,
	      loading: dispatchRowText(row, "loading"),
	      loadingLocationsJson: locationEntriesJson(row.loadingLocations),
	      unloading: dispatchRowText(row, "unloading"),
	      unloadingLocationsJson: locationEntriesJson(row.unloadingLocations),
	      status: orderStatus,
      orderDate: dispatchRowBusinessDate(row, planDate || order.order_date)
    });
    synced += 1;
  }

  return synced;
}

async function orderStatusByDispatchReferences(rows = []) {
  const refs = rows
    .map((row) => ({
      orderNo: dispatchRowText(row, "orderNo"),
      dispatchNo: dispatchRowText(row, "dispatchNo")
    }))
    .filter((ref) => ref.orderNo || ref.dispatchNo);
  if (!refs.length) return new Map();
  const conditions = [];
  const params = {};
  refs.forEach((ref, index) => {
    if (ref.orderNo) {
      const key = `orderNo${index}`;
      params[key] = ref.orderNo;
      conditions.push(`no = @${key}`);
    }
    if (ref.dispatchNo) {
      const key = `dispatchNo${index}`;
      params[key] = ref.dispatchNo;
      conditions.push(`dispatch_no = @${key}`);
    }
  });
  if (!conditions.length) return new Map();
  const orders = await db.prepare(`
    SELECT no, dispatch_no, status
    FROM orders
    WHERE deleted_at IS NULL
      AND (${conditions.join(" OR ")})
  `).all(params);
  const map = new Map();
  orders.forEach((order) => {
    const status = normalizeOrderStatus(order.status, "");
    if (!status) return;
    [
      order.no && `order:${order.no}`,
      order.dispatch_no && `dispatch:${order.dispatch_no}`
    ].filter(Boolean).forEach((key) => map.set(key, status));
  });
  return map;
}

function dispatchStatusFromProtectedOrderStatus(orderStatus = "") {
  const status = normalizeOrderStatus(orderStatus, "");
  if (status === "已签收" || status === "已审核") return "已签收";
  if (status === "费用待确认" || status === "缺票据") return "异常滞留";
  if (status === "通关中") return "通关中";
  return "";
}

async function protectDispatchRowsFromOrderDowngrade(rows = [], existingRows = []) {
  const statusMap = await orderStatusByDispatchReferences(rows);
  if (!statusMap.size) return rows;
  const existingLookup = dispatchRowLookup(existingRows);
  return rows.map((row) => {
    const orderStatus = dispatchRowLookupKeys(row)
      .map((key) => statusMap.get(key))
      .filter(Boolean)
      .sort((left, right) => orderStatusRank(right) - orderStatusRank(left))[0] || "";
    const protectedDispatchStatus = dispatchStatusFromProtectedOrderStatus(orderStatus);
    if (!protectedDispatchStatus) return row;
    const currentStatus = normalizeDispatchPlanStatus(row.status);
    if (dispatchRowStatusRank({ status: protectedDispatchStatus }) <= dispatchRowStatusRank({ status: currentStatus })) {
      return row;
    }
    const existingRow = findExistingDispatchRow(row, existingLookup);
    const existingStatus = normalizeDispatchPlanStatus(existingRow?.status || "");
    const existingPreviousStatus = normalizeDispatchPlanStatus(existingRow?.previousStatus || "");
    return {
      ...row,
      status: protectedDispatchStatus,
      previousStatus: existingStatus === protectedDispatchStatus && existingPreviousStatus && existingPreviousStatus !== protectedDispatchStatus
        ? existingPreviousStatus
        : (currentStatus && currentStatus !== protectedDispatchStatus ? currentStatus : row.previousStatus || "")
    };
  });
}

async function removeDispatchPlanRowsLinkedToOrder(orderRow = {}) {
  const orderNo = String(orderRow.no || "").trim();
  const dispatchNo = String(orderRow.dispatch_no || orderRow.dispatchNo || "").trim();
  if (!orderNo && !dispatchNo) return 0;

  const plans = await db.prepare("SELECT plan_date, rows_json FROM dispatch_plans").all();
  let removed = 0;
  for (const plan of plans) {
    await lockDispatchPlanDate(plan.plan_date);
    const rows = parseDispatchPlanRowsJson(plan.rows_json);
    const rowsToRecycle = rows.filter((row) => dispatchRowMatchesRefs(row, orderNo, dispatchNo));
    const nextRows = rows.filter((row) => !dispatchRowMatchesRefs(row, orderNo, dispatchNo));
    if (nextRows.length === rows.length) continue;
    removed += rows.length - nextRows.length;
    await recycleDispatchPlanRows(plan.plan_date, rowsToRecycle);
    await db.prepare(`
      UPDATE dispatch_plans
      SET rows_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE plan_date = ?
    `).run(JSON.stringify(nextRows), plan.plan_date);
  }
  return removed;
}

app.get("/api/dispatch-plans", async (req, res) => {
  const { start, end } = dispatchPlanPeriodBounds(req.query);
  const dateWhere = start && end ? "WHERE plan_date >= ? AND plan_date < ?" : "";
  const params = start && end ? [start, end] : [];
  const records = await db.prepare(`
    SELECT * FROM dispatch_plans
    ${dateWhere}
    ORDER BY plan_date DESC
  `).all(...params);
  res.json(records.map(mapDispatchPlanRecord));
});

app.get("/api/dispatch-plans/recycle", async (_req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM dispatch_plan_recycle
    WHERE restored_at IS NULL
    ORDER BY deleted_at DESC, plan_date DESC, id DESC
  `).all();
  const customerShortNames = await loadCustomerShortNameMap({ category: "运输客户" });
  const mappedRows = await Promise.all(rows.map(async (row) => ({
    ...mapDispatchRecycleRecord(row),
    customerShortName: shortNameFromMap(row.customer || row.row?.customer || "", customerShortNames),
    operatorName: await latestDeleteOperatorName("dispatch_plan", [
      row.dispatch_no,
      row.order_no,
      row.plan_date
    ])
  })));
  res.json(mappedRows);
});

app.post("/api/dispatch-plans/recycle", async (req, res) => {
  const planDate = String(req.body?.date || req.body?.planDate || "").trim();
  const row = req.body?.row && typeof req.body.row === "object" ? req.body.row : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate) || !row) {
    res.status(400).json({ message: "排车单回收数据无效" });
    return;
  }
  if (!dispatchRowHasReference(row)) {
    res.status(400).json({ message: "排车单缺少排车单号或订单号，无法进入回收站" });
    return;
  }

  const result = await db.transaction(async () => {
    await lockDispatchPlanDate(planDate);
    const plan = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(planDate);
    const rows = parseDispatchPlanRowsJson(plan?.rows_json);
    const matchedRows = rows.filter((item) => dispatchRowMatchesRef(item, row));
    const rowsToRecycle = matchedRows.length ? matchedRows : [row];
    await recycleDispatchPlanRows(planDate, rowsToRecycle);
    if (matchedRows.length && plan) {
      const nextRows = rows.filter((item) => !dispatchRowMatchesRef(item, row));
      await db.prepare(`
        UPDATE dispatch_plans
        SET rows_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE plan_date = ?
      `).run(JSON.stringify(nextRows), planDate);
    }
    const latest = await db.prepare(`
      SELECT * FROM dispatch_plan_recycle
      WHERE plan_date = @planDate
        AND restored_at IS NULL
        AND (
          (@orderNo <> '' AND order_no = @orderNo)
          OR (@dispatchNo <> '' AND dispatch_no = @dispatchNo)
        )
      ORDER BY id DESC
      LIMIT 1
    `).get({
      planDate,
      orderNo: String(row.orderNo || row.order_no || "").trim(),
      dispatchNo: String(row.dispatchNo || row.dispatch_no || "").trim()
    });
    return { latest, removed: matchedRows.length };
  })();

  await writeAudit(
    "delete",
    "dispatch_plan",
    row.dispatchNo || row.orderNo || planDate,
    result.removed ? "移入回收站并删除排车行" : "移入回收站"
  );
  res.status(201).json(mapDispatchRecycleRecord(result.latest));
});

app.delete("/api/dispatch-plans/:date/rows", async (req, res) => {
  const date = String(req.params.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ message: "排车日期无效" });
    return;
  }

  const refs = Array.isArray(req.body?.refs) ? req.body.refs : [req.body?.row || req.body || {}];
  const normalizedRefs = refs
    .map((ref) => ({
      id: String(ref?.id || "").trim(),
      dispatchNo: String(ref?.dispatchNo || ref?.dispatch_no || "").trim(),
      orderNo: String(ref?.orderNo || ref?.order_no || "").trim()
    }))
    .filter(dispatchRowHasReference);
  if (!normalizedRefs.length) {
    res.status(400).json({ message: "缺少要删除的排车单号或订单号" });
    return;
  }

  const result = await db.transaction(async () => {
    await lockDispatchPlanDate(date);
    const plan = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(date);
    const rows = parseDispatchPlanRowsJson(plan?.rows_json);
    const rowsToRecycle = rows.filter((row) => normalizedRefs.some((ref) =>
      dispatchRowMatchesRef(row, ref)
    ));
    if (!rowsToRecycle.length) {
      return { removed: 0, saved: plan ? mapDispatchPlanRecord(plan) : { date, rows: [], updatedAt: "" } };
    }
    await recycleDispatchPlanRows(date, rowsToRecycle);
    const nextRows = rows.filter((row) => !rowsToRecycle.includes(row));
    const rowsJson = JSON.stringify(nextRows);
    if (plan) {
      await db.prepare(`
        UPDATE dispatch_plans
        SET rows_json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE plan_date = ?
      `).run(rowsJson, date);
    } else {
      await db.prepare(`
        INSERT INTO dispatch_plans (plan_date, rows_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `).run(date, rowsJson);
    }
    const saved = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(date);
    return { removed: rowsToRecycle.length, saved: mapDispatchPlanRecord(saved) };
  })();

  if (result.removed === 0) {
    res.status(404).json({ message: "找不到要删除的排车单" });
    return;
  }
  await writeAudit("delete", "dispatch_plan", date, `显式删除 ${result.removed} 条`);
  res.json({ ok: true, removed: result.removed, plan: result.saved });
});

app.post("/api/dispatch-plans/export/xlsx", async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) {
    res.status(400).type("text/plain").send("没有可导出的排车数据");
    return;
  }
  try {
    const title = String(req.body?.title || "").trim() || dispatchExportWorkbookTitle(rows, String(req.body?.date || ""));
    const buffer = await renderDispatchPlanXlsxBuffer(rows, title, String(req.body?.date || ""), {
      exportSpacing: req.body?.exportSpacing
    });
    const date = exportFilenamePart(String(req.body?.date || rows[0]?.order?.date || rows[0]?.date || todayInputValue()).replaceAll("-", ""));
    const scope = String(req.body?.scope || "全部").trim() || "全部";
    const filename = `排车表_${date}_${scope}${rows.length}单.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).type("text/plain").send("排车表 Excel 导出失败");
  }
});

app.post("/api/dispatch-plans/recycle/:id/restore", async (req, res) => {
  const id = Number(req.params.id || 0);
  const recycleRow = await db.prepare("SELECT * FROM dispatch_plan_recycle WHERE id = ? AND restored_at IS NULL").get(id);
  if (!recycleRow) {
    res.status(404).json({ message: "回收站内找不到该排车单" });
    return;
  }
  const restoredRecord = await db.transaction(async () => {
    let restoredOrder = null;
    if (recycleRow.order_no) {
      const updateOrder = await db.prepare("UPDATE orders SET deleted_at = NULL WHERE no = ? AND deleted_at IS NOT NULL").run(recycleRow.order_no);
      if (updateOrder.changes > 0) {
        const order = await db.prepare("SELECT * FROM orders WHERE no = ?").get(recycleRow.order_no);
        restoredOrder = (await hydrateOrderRowsForApi([mapOrder(order)]))[0];
      }
    }
    const restoredDispatch = await restoreDispatchRecycleRecord(id);
    return { dispatch: restoredDispatch, order: restoredOrder };
  })();
  await writeAudit("restore", "dispatch_plan", recycleRow.dispatch_no || String(id), "从回收站恢复");
  res.json(restoredRecord);
});

app.get("/api/dispatch-plans/:date", async (req, res) => {
  const date = String(req.params.date || "").trim();
  const row = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(date);
  if (!row) {
    res.json({ date, rows: [], updatedAt: "" });
    return;
  }
  res.json(mapDispatchPlanRecord(row));
});

app.put("/api/dispatch-plans/:date", async (req, res) => {
  const date = String(req.params.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ message: "排车日期无效" });
    return;
  }
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const requestCreator = creatorFieldsFromAccount(req.account);
  let result;
  try {
    result = await db.transaction(async () => {
      await lockDispatchPlanDate(date);
      const existingPlan = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(date);
      const existingRows = parseDispatchPlanRowsJson(existingPlan?.rows_json);
      const existingRowsLookup = dispatchRowLookup(existingRows);
      const rowsNeedingOrderSync = [];
      const cleanRows = rows
        .map((row) => {
          const existingRow = findExistingDispatchRow(row, existingRowsLookup);
          const cleanRow = normalizeDispatchPlanRow(row, existingRow, requestCreator, date);
          if (dispatchRowHasReference(cleanRow) && dispatchRowNeedsOrderSync(cleanRow, existingRow)) {
            rowsNeedingOrderSync.push(cleanRow);
          }
          return cleanRow;
        })
        .filter(dispatchRowHasReference);
      const merged = mergeDispatchPlanRows(existingRows, cleanRows);
      const protectedRows = await protectDispatchRowsFromOrderDowngrade(merged.rows, existingRows);
      const rowsJson = JSON.stringify(protectedRows);
      const planCreator = existingPlan && creatorFieldsHaveValue(creatorFieldsFromRecord(existingPlan))
        ? creatorFieldsFromRecord(existingPlan)
        : requestCreator;
      await db.prepare(`
        INSERT INTO dispatch_plans
          (plan_date, rows_json, created_by_account_id, created_by_username, created_by_display_name, updated_at)
        VALUES
          (@date, @rowsJson, @createdByAccountId, @createdByUsername, @createdByName, CURRENT_TIMESTAMP)
        ON CONFLICT(plan_date) DO UPDATE SET
          rows_json = excluded.rows_json,
          updated_at = CURRENT_TIMESTAMP
      `).run({
        date,
        rowsJson,
        createdByAccountId: planCreator.createdByAccountId,
        createdByUsername: planCreator.createdByUsername,
        createdByName: planCreator.createdByName
      });
      await syncDispatchPlanRowsToOrders(date, rowsNeedingOrderSync);
      const saved = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(date);
      return { saved, incomingCount: cleanRows.length, savedCount: protectedRows.length, stats: merged.stats };
    })();
  } catch (error) {
    if (error?.statusCode === 409) {
      const latest = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(date);
      res.status(409).json({
        message: error.message,
        detail: error.detail || "",
        latest: latest ? mapDispatchPlanRecord(latest) : { date, rows: [], updatedAt: "" }
      });
      return;
    }
    throw error;
  }
  await writeAudit(
    "update",
    "dispatch_plan",
    date,
    `修改排车计划：合并保存 ${result.incomingCount} 条，当前 ${result.savedCount} 条，保护 ${result.stats.protected} 条${result.stats.staleSkipped ? `，跳过旧快照 ${result.stats.staleSkipped} 条` : ""}`
  );
  res.json(mapDispatchPlanRecord(result.saved));
});

app.get("/api/orders/recycle", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM orders WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, order_date DESC").all();
  const mappedRows = await hydrateOrderRowsForApi(rows.map(mapOrder));
  const customerShortNames = await loadCustomerShortNameMap({ category: "运输客户" });
  const rowsWithOperator = await Promise.all(mappedRows.map(async (row) => ({
    ...row,
    customerShortName: shortNameFromMap(row.customerId, customerShortNames)
      || shortNameFromMap(row.customer, customerShortNames)
      || row.customerShortName
      || "",
    operatorName: await latestDeleteOperatorName("order", String(row.no))
  })));
  res.json(rowsWithOperator);
});

app.get("/api/orders/export/csv", async (req, res) => {
  const orderNos = String(req.query.orderNos || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const title = String(req.query.title || "订单导出").trim() || "订单导出";
  const template = await exportTemplateById(req.query.templateId);
  const exchange = normalizeExportExchange(req.query);
  const orders = await loadExportOrders(orderNos);
  if (orders.length === 0) {
    res.status(400).type("text/plain").send("没有可导出的订单");
    return;
  }
  const body = `\ufeff${renderOrdersCsv(orders, title, template, exchange)}`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(orderExportFilename(orders, "csv"))}`);
  await writeAudit("export", "order", orderNos.join(",") || "all", `CSV ${orders.length} 条`);
  res.send(body);
});

app.get("/api/orders/export/excel", async (req, res) => {
  const orderNos = String(req.query.orderNos || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const title = String(req.query.title || "订单导出").trim() || "订单导出";
  const template = await exportTemplateById(req.query.templateId);
  const exchange = normalizeExportExchange(req.query);
  const orders = await loadExportOrders(orderNos);
  if (orders.length === 0) {
    res.status(400).type("text/plain").send("没有可导出的订单");
    return;
  }
  try {
    const body = await renderOrdersXlsxBuffer(orders, title, template, exchange);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(orderExportFilename(orders, "xlsx"))}`);
    await writeAudit("export", "order", orderNos.join(",") || "all", `Excel ${orders.length} 条`);
    res.send(body);
  } catch (error) {
    console.error("Excel export failed", error);
    res.status(500).type("text/plain").send("Excel 导出失败");
  }
});

app.post("/api/orders/export/excel", async (req, res) => {
  const orderNos = Array.isArray(req.body.orderNos) ? req.body.orderNos.map(String).filter(Boolean) : [];
  const title = String(req.body.title || "订单导出").trim() || "订单导出";
  const templateMeta = await exportTemplateMetaById(req.body.templateId);
  let template = req.body.template && typeof req.body.template === "object" ? req.body.template : null;
  if (!template && templateMeta?.content) {
    try {
      template = JSON.parse(templateMeta.content);
    } catch {
      template = null;
    }
  }
  const visualTemplate = template?.type === "visual-export-template" ? template : null;
  const exchange = normalizeExportExchange(req.body.exchange);
  const orders = await loadExportOrdersFromRequest(req.body, orderNos);
  if (orders.length === 0) {
    res.status(400).type("text/plain").send("没有可导出的订单");
    return;
  }
  try {
    const useKenfaTemplate = req.body.templateKind === "kenfa"
      || templateMeta?.name === "肯发专用"
      || isKenfaExportTemplatePayload(template);
    const body = useKenfaTemplate
      ? await renderKenfaStatementXlsxBuffer(orders, title, exchange)
      : await renderOrdersXlsxBuffer(orders, title, visualTemplate, exchange, {
        includeReceiptSheet: Boolean(req.body.includeReceiptSheet)
      });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(orderExportFilename(orders, "xlsx"))}`);
    await writeAudit("export", "order", orderNos.join(",") || "snapshot", `Excel ${orders.length} 条`);
    res.send(body);
  } catch (error) {
    console.error("Excel export failed", error);
    res.status(500).type("text/plain").send("Excel 导出失败");
  }
});

app.post("/api/orders/export/pdf", async (req, res) => {
  const orderNos = Array.isArray(req.body.orderNos) ? req.body.orderNos.map(String).filter(Boolean) : [];
  const title = String(req.body.title || "订单导出").trim() || "订单导出";
  const template = req.body.template && typeof req.body.template === "object" ? req.body.template : null;
  const exchange = normalizeExportExchange(req.body.exchange);
  const orders = await loadExportOrdersFromRequest(req.body, orderNos);
  if (orders.length === 0) {
    res.status(400).json({ message: "没有可导出的订单" });
    return;
  }
  await writeAudit("export", "order", orderNos.join(",") || "all", `PDF ${orders.length} 条`);
  renderOrdersPdf(res, orders, title, template, orderExportFilename(orders, "pdf"), exchange);
});

app.post("/api/orders/audit", async (req, res) => {
  if (!requestCanManageOrderAudit(req)) {
    res.status(403).json({ message: "只有财务或管理员可以审核订单" });
    return;
  }
  const orderNos = Array.isArray(req.body.orderNos) ? [...new Set(req.body.orderNos.map(String).filter(Boolean))] : [];
  if (orderNos.length === 0) {
    res.status(400).json({ message: "请选择需要审核的订单" });
    return;
  }

  const select = await db.prepare("SELECT * FROM orders WHERE no = ? AND deleted_at IS NULL");
  const blockedRows = [];
  for (const no of orderNos) {
    const row = await select.get(no);
    if (!row) {
      blockedRows.push(`${no}：订单不存在`);
    } else if (row.status !== "已签收") {
      blockedRows.push(`${no}：${row.status || "无状态"}`);
    }
  }
  if (blockedRows.length > 0) {
    res.status(409).json({ message: `只有已签收订单才能审核：${blockedRows.slice(0, 5).join("、")}${blockedRows.length > 5 ? "等" : ""}` });
    return;
  }

  const update = await db.prepare("UPDATE orders SET status = '已审核' WHERE no = ? AND status = '已签收' AND deleted_at IS NULL");
  const updated = [];

  const transaction = db.transaction(async (nos) => {
    for (const no of nos) {
      await update.run(no);
      const row = await select.get(no);
      if (row) {
        await writeAudit("audit", "order", no, "批量审核通过");
        updated.push(mapOrder(row));
      }
    }
  });

  await transaction(orderNos);
  res.json(await hydrateOrderRowsForApi(updated));
});

function pickBody(body, camelKey, snakeKey, fallback) {
  if (Object.prototype.hasOwnProperty.call(body, camelKey)) return body[camelKey];
  if (snakeKey && Object.prototype.hasOwnProperty.call(body, snakeKey)) return body[snakeKey];
  return fallback;
}

async function readOrderPayload(body, existing = null) {
  const submittedDate = pickBody(body, "date", "order_date", existing?.order_date || todayInputValue());
  const dispatchNo = userTextValue(pickBody(body, "dispatchNo", "dispatch_no", existing?.dispatch_no || ""));
  const initialLinkedDate = await orderDateFromLinkedDispatchRow(existing?.no || body.no || "", dispatchNo, submittedDate);
  const dateForNewNumbers = initialLinkedDate || submittedDate;
  const no = existing?.no || body.no || (await nextOrderNo(dateForNewNumbers));
  const resolvedDispatchNo = dispatchNo || (existing ? "" : await nextDispatchNo(dateForNewNumbers));
  const dispatchDate = await orderDateFromLinkedDispatchRow(no, resolvedDispatchNo, dateForNewNumbers);
  const submittedStatus = normalizeOrderStatus(
    pickBody(body, "status", null, existing?.status || "待确认"),
    existing?.status || "待确认"
  );
  const status = existing && shouldPreventOrderStatusDowngrade(existing.status, submittedStatus)
    ? existing.status
    : submittedStatus;
  const vehicleSource = normalizeVehicleSource(pickBody(body, "vehicleSource", "vehicle_source", existing?.vehicle_source || ""));
  const currency = userTextValue(pickBody(body, "currency", null, existing?.currency || "港币")) || "港币";
  const transportModeInput = userTextValue(pickBody(body, "transportMode", "transport_mode", existing?.transport_mode || ""));
  const transportMode = normalizeTransportMode(transportModeInput || (vehicleSource === OWN_VEHICLE_SOURCE ? "单司机" : ""))
    || (vehicleSource === OWN_VEHICLE_SOURCE ? "单司机" : "");
  const loadingText = pickBody(body, "loading", "loading_place", existing?.loading || "");
  const unloadingText = pickBody(body, "unloading", "unloading_place", existing?.unloading || "");
  const loadingLocations = normalizeLocationEntriesFromPayload(body, "loading", loadingText, existing?.loading_locations || "");
  const unloadingLocations = normalizeLocationEntriesFromPayload(body, "unloading", unloadingText, existing?.unloading_locations || "");
  return {
    no,
    dispatchNo: resolvedDispatchNo,
    customerId: pickBody(body, "customerId", "customer_id", existing?.customer_id || null),
    customer: userTextValue(pickBody(body, "customer", "customer_name", existing?.customer || "")),
    businessType: userTextValue(pickBody(body, "businessType", "business_type", existing?.business_type || "运输") || "运输"),
    port: normalizePortText(pickBody(body, "port", null, existing?.port || "")),
    needsWeighing: booleanFlag(pickBody(body, "needsWeighing", "needs_weighing", existing?.needs_weighing || false), false) ? 1 : 0,
    direction: userTextValue(pickBody(body, "direction", null, existing?.direction || "")),
    tonnage: userTextValue(pickBody(body, "tonnage", null, existing?.tonnage || "")),
    currency,
    quantity: userTextValue(pickBody(body, "quantity", null, existing?.quantity || "")),
    weight: userTextValue(pickBody(body, "weight", null, existing?.weight || "")),
    vehicleSource,
    supplier: userTextValue(pickBody(body, "supplier", null, existing?.supplier || "-") || "-"),
    plate: normalizePlateText(pickBody(body, "plate", null, existing?.plate || "")),
    driver: userTextValue(pickBody(body, "driver", null, existing?.driver || "")),
    hkDriver: userTextValue(pickBody(body, "hkDriver", "hk_driver", existing?.hk_driver || "")),
    mainlandDriver: userTextValue(pickBody(body, "mainlandDriver", "mainland_driver", existing?.mainland_driver || "")),
    transportMode,
    loading: composeLocationEntriesText(loadingLocations) || userRawMultilineTextValue(loadingText),
    loadingLocations,
    loadingLocationsJson: locationEntriesJson(loadingLocations),
    unloading: composeLocationEntriesText(unloadingLocations) || userRawMultilineTextValue(unloadingText),
    unloadingLocations,
    unloadingLocationsJson: locationEntriesJson(unloadingLocations),
    date: dispatchDate || dateForNewNumbers,
    receivableHKD: Number(pickBody(body, "receivableHKD", "hkd_receivable", existing?.receivable_hkd || 0) || 0),
    receivableRMB: Number(pickBody(body, "receivableRMB", "rmb_receivable", existing?.receivable_rmb || 0) || 0),
    status,
    operatingUnit: userTextValue(pickBody(body, "operatingUnit", "operating_unit", existing?.operating_unit || "")),
    remark: userMultilineTextValue(pickBody(body, "remark", null, existing?.remark || "")),
    tripNoEnabled: pickBody(body, "tripNoEnabled", "trip_no_enabled", existing?.trip_no_enabled || 0) ? 1 : 0,
    tripNo: userTextValue(pickBody(body, "tripNo", "trip_no", existing?.trip_no || "")),
    sixSheetEnabled: pickBody(body, "sixSheetEnabled", "six_sheet_enabled", existing?.six_sheet_enabled || 0) ? 1 : 0,
    sixSheetNo: userTextValue(pickBody(body, "sixSheetNo", "six_sheet_no", existing?.six_sheet_no || "")),
    fees: Array.isArray(body.fees) ? body.fees : null
  };
}

async function assignOrderBusinessNumbers(item, requestedNo = "", requestedDispatchNo = "") {
  const no = String(requestedNo || "").trim();
  const dispatchNo = String(requestedDispatchNo || "").trim();
  const date = normalizeBusinessNoDate(item.date || todayInputValue());
  item.no = no || await nextOrderNo(date);
  item.dispatchNo = dispatchNo || await nextDispatchNo(date);
}

async function lockOrderCreation() {
  await db.prepare("SELECT pg_advisory_xact_lock(?)").get(ORDER_CREATE_LOCK_ID);
}

async function orderBusinessNumberConflict(no = "", dispatchNo = "") {
  const orderNo = String(no || "").trim();
  const dispatch = String(dispatchNo || "").trim();
  const existingOrder = await db.prepare(`
    SELECT no, dispatch_no, deleted_at
    FROM orders
    WHERE no = @orderNo
       OR (@dispatchNo <> '' AND dispatch_no = @dispatchNo)
    LIMIT 1
  `).get({ orderNo, dispatchNo: dispatch });
  if (existingOrder?.no === orderNo) return `订单号 ${orderNo} 已存在`;
  if (dispatch && existingOrder?.dispatch_no === dispatch) return `排车单号 ${dispatch} 已存在`;

  const recycleRow = await db.prepare(`
    SELECT order_no, dispatch_no
    FROM dispatch_plan_recycle
    WHERE (@orderNo <> '' AND order_no = @orderNo)
       OR (@dispatchNo <> '' AND dispatch_no = @dispatchNo)
    LIMIT 1
  `).get({ orderNo, dispatchNo: dispatch });
  if (recycleRow?.order_no === orderNo) return `订单号 ${orderNo} 已在回收站中`;
  if (dispatch && recycleRow?.dispatch_no === dispatch) return `排车单号 ${dispatch} 已在回收站中`;
  return "";
}

async function resolveOrderCustomer(item) {
  const customerId = String(item.customerId || "").trim();
  const customerName = String(item.customer || "").trim();
  let customer = null;

  if (customerId) {
    customer = await db.prepare(`
      SELECT id, name, short_name
      FROM customers
      WHERE id = ?
        AND deleted_at IS NULL
        AND type = '客户'
        AND customer_category = '运输客户'
    `).get(customerId);
  }

  if (!customer && customerName) {
    customer = await db.prepare(`
      SELECT id, name, short_name
      FROM customers
      WHERE deleted_at IS NULL
        AND type = '客户'
        AND customer_category = '运输客户'
        AND (name = ? OR short_name = ?)
      LIMIT 1
    `).get(customerName, customerName);
  }

  if (!customer) {
    return false;
  }

  item.customerId = customer.id;
  item.customer = customer.name;
  item._resolvedCustomer = customer;
  return true;
}

function validateOrderReadyForSignedStatus(item = {}, customer = item?._resolvedCustomer || {}) {
  if (normalizeOrderStatus(item.status, "") !== "已签收") return "";
  return orderSignRequiredMessage(missingOrderSignRequiredFieldLabels(item, customer));
}

app.post("/api/orders", async (req, res) => {
  const requestedNo = String(req.body?.no || "").trim();
  const requestedDispatchNo = String(req.body?.dispatchNo || req.body?.dispatch_no || "").trim();
  const skipSignValidation = booleanFlag(req.body?.skipSignValidation ?? req.body?.skip_sign_validation, false);
  const item = await readOrderPayload({ ...req.body, no: requestedNo || undefined, dispatchNo: requestedDispatchNo });
  Object.assign(item, creatorFieldsFromAccount(req.account));
  item.fees = item.fees || [];
  if (!(await resolveOrderCustomer(item))) {
    res.status(400).json({ message: "请选择有效客户" });
    return;
  }
  const signValidationMessage = skipSignValidation ? "" : validateOrderReadyForSignedStatus(item);
  if (signValidationMessage) {
    res.status(409).json({ message: signValidationMessage });
    return;
  }

  if (item.fees.length > 0) {
    Object.assign(item, calculateOrderReceivables(item.fees, item.currency));
  }

  const transaction = db.transaction(async () => {
    await lockOrderCreation();
    await assignOrderBusinessNumbers(item, requestedNo, requestedDispatchNo);
    const conflict = await orderBusinessNumberConflict(item.no, item.dispatchNo);
    if (conflict) {
      throw createDispatchPlanConflictError(conflict);
    }
    await db.prepare(`
	      INSERT INTO orders
	        (no, dispatch_no, customer_id, customer, business_type, port, direction, tonnage, currency, quantity,
	         needs_weighing, weight, vehicle_source, supplier, plate, driver, hk_driver, mainland_driver, transport_mode, loading, loading_locations, unloading, unloading_locations, order_date, receivable_hkd,
	         receivable_rmb, status, operating_unit, created_by_account_id, created_by_username, created_by_display_name, remark,
	         trip_no_enabled, trip_no, six_sheet_enabled, six_sheet_no)
	      VALUES
	        (@no, @dispatchNo, @customerId, @customer, @businessType, @port, @direction, @tonnage, @currency,
	         @quantity, @needsWeighing, @weight, @vehicleSource, @supplier, @plate, @driver, @hkDriver, @mainlandDriver, @transportMode, @loading, @loadingLocationsJson, @unloading, @unloadingLocationsJson, @date,
	         @receivableHKD, @receivableRMB, @status, @operatingUnit, @createdByAccountId, @createdByUsername, @createdByName, @remark, @tripNoEnabled, @tripNo,
	         @sixSheetEnabled, @sixSheetNo)
    `).run(item);
    await saveOrderFees(item.no, item.fees, item.currency);
  });
  try {
    await transaction();
  } catch (error) {
    if (error?.statusCode === 409) {
      res.status(409).json({ message: error.message });
      return;
    }
    throw error;
  }
  await writeAudit("create", "order", item.no, item.customer);
  const created = await db.prepare("SELECT * FROM orders WHERE no = ?").get(item.no);
  res.status(201).json((await hydrateOrderRowsForApi([mapOrder(created)]))[0]);
});

function normalizeOrderFee(fee, fallbackCurrency) {
  const driverRole = userTextValue(fee.driverRole || fee.driver_role);
  const clientKey = userTextValue(fee.clientKey || fee.client_key || fee._clientKey);
  const rawQuantity = Number(fee.quantity);
  const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
  const rawUnitPrice = Number(fee.unitPrice ?? fee.unit_price ?? 0);
  const unitPrice = Number.isFinite(rawUnitPrice) && rawUnitPrice >= 0 ? rawUnitPrice : 0;
  const unitPriceManual = booleanFlag(fee.unitPriceManual ?? fee.unit_price_manual ?? fee.manualUnitPrice ?? fee._manualUnitPrice, false);
  const amountManual = booleanFlag(fee.amountManual ?? fee.amount_manual ?? fee.manualAmount ?? fee._manualAmount, false);
  const rawAmount = Number(fee.amount ?? 0);
  const calculatedAmount = Number((quantity * unitPrice).toFixed(2));
  const amount = amountManual && Number.isFinite(rawAmount) && rawAmount >= 0
    ? rawAmount
    : calculatedAmount;
  const rawCost = fee.cost ?? fee.costValue ?? fee.cost_value ?? fee.costAmount ?? fee.cost_amount;
  const costCurrency = normalizeCostCenterCurrency(
    (fee.costCurrency ?? fee.cost_currency ?? fee._costCurrency ?? fee.currency ?? fallbackCurrency) || "港币",
    fallbackCurrency || "港币"
  );
  const rawCostManual = fee.costManual ?? fee.cost_manual ?? fee.manualCost ?? fee._manualCost;
  const costNumber = rawCost === undefined || rawCost === null || String(rawCost).trim() === ""
    ? null
    : Number(rawCost);
  const cost = Number.isFinite(costNumber) && costNumber >= 0 ? costNumber : null;
  const costParts = normalizeOrderFeeCostParts(fee.costParts ?? fee.cost_parts ?? fee.costPartsJson ?? fee.cost_parts_json);
  const rawCostHKD = fee.costHKD ?? fee.cost_hkd ?? fee._costHKD ?? fee._costHkd;
  const rawCostRMB = fee.costRMB ?? fee.cost_rmb ?? fee._costRMB ?? fee._costRmb;
  const costHKD = rawCostHKD === undefined || rawCostHKD === null || String(rawCostHKD).trim() === ""
    ? null
    : Number(rawCostHKD);
  const costRMB = rawCostRMB === undefined || rawCostRMB === null || String(rawCostRMB).trim() === ""
    ? null
    : Number(rawCostRMB);
  const normalizedCostHKD = Number.isFinite(costHKD) && costHKD >= 0 ? costHKD : null;
  const normalizedCostRMB = Number.isFinite(costRMB) && costRMB >= 0 ? costRMB : null;
  let finalCostHKD = normalizedCostHKD;
  let finalCostRMB = normalizedCostRMB;
  const hasSplitCostPayload = booleanFlag(fee.costSplit ?? fee.cost_split ?? fee._costSplit, false)
    || finalCostHKD !== null
    || finalCostRMB !== null
    || costParts.length > 0;
  let finalCost = cost;
  if (costParts.length > 0) {
    finalCostHKD = Number(costParts.reduce((sum, part) =>
      sum + (normalizeCostCenterCurrency(part.currency || "港币") === "港币" ? Number(part.amount || 0) : 0), 0).toFixed(2));
    finalCostRMB = Number(costParts.reduce((sum, part) =>
      sum + (normalizeCostCenterCurrency(part.currency || "港币") === "人民币" ? Number(part.amount || 0) : 0), 0).toFixed(2));
  }
  if (hasSplitCostPayload) {
    finalCost = Number((Number(finalCostHKD || 0) + Number(finalCostRMB || 0)).toFixed(2));
  }
  if (!hasSplitCostPayload && cost !== null) {
    if (costCurrency === "人民币" || costCurrency === "RMB") {
      finalCostRMB = cost;
    } else {
      finalCostHKD = cost;
    }
  }
  return {
    clientKey,
    category: normalizeOrderFeeCategory(fee.category),
    name: userTextValue(fee.name),
    quantity,
    unitPrice,
    unitPriceManual,
    currency: userTextValue(fee.currency || fallbackCurrency || "港币"),
    amount,
    amountManual,
    cost: finalCost,
    costCurrency: hasSplitCostPayload ? "港币" : costCurrency,
    costHKD: finalCostHKD,
    costRMB: finalCostRMB,
    costParts,
    costPartsJson: JSON.stringify(costParts),
    costManual: cost == null ? false : booleanFlag(rawCostManual, false),
    fxLinksJson: JSON.stringify(normalizeOrderFeeFxLinks(fee)),
    advanceAddress: userTextValue(fee.advanceAddress || fee.advance_address),
    remark: userTextValue(fee.remark),
    driverRole: ["香港司机", "大陆骑师", "跟随订单司机", "手动指定"].includes(driverRole) ? driverRole : "",
    driverName: userTextValue(fee.driverName || fee.driver_name)
  };
}

function normalizeOrderFeeFxLinks(fee = {}) {
  const raw = fee.fxLinks ?? fee.fx_links ?? fee.fx_links_json ?? {};
  const source = typeof raw === "string" ? parseJsonObjectText(raw, {}) : raw;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const normalizeFxCurrency = (value = "") => {
    const text = String(value || "").trim().toUpperCase();
    if (text === "RMB" || text === "人民币") return "人民币";
    if (text === "HKD" || text === "港币") return "港币";
    return "";
  };
  return ["unitPrice", "amount", "cost"].reduce((links, field) => {
    const link = source[field];
    if (!link || typeof link !== "object" || Array.isArray(link)) return links;
    const sourceValue = Number(link.sourceValue ?? link.source_value);
    const rate = Number(link.rateAtConversion ?? link.rate_at_conversion ?? link.rate);
    const sourceCurrency = normalizeFxCurrency(link.sourceCurrency ?? link.source_currency);
    const targetCurrency = normalizeFxCurrency(link.targetCurrency ?? link.target_currency);
    if (!Number.isFinite(sourceValue) || sourceValue < 0 || !sourceCurrency || !targetCurrency || sourceCurrency === targetCurrency) {
      return links;
    }
    links[field] = {
      field,
      sourceValue,
      sourceCurrency,
      targetCurrency,
      customerId: userTextValue(link.customerId ?? link.customer_id),
      customerName: userTextValue(link.customerName ?? link.customer_name),
      periodMonth: userTextValue(link.periodMonth ?? link.period_month),
      rateAtConversion: Number.isFinite(rate) && rate > 0 ? rate : null,
      convertedAt: userTextValue(link.convertedAt ?? link.converted_at)
    };
    return links;
  }, {});
}

function calculateOrderReceivables(fees, fallbackCurrency) {
  return fees
    .map((fee) => normalizeOrderFee(fee, fallbackCurrency))
    .filter((fee) => fee.name)
    .reduce((totals, fee) => {
      if (fee.currency === "人民币" || fee.currency === "RMB") {
        totals.receivableRMB += fee.amount;
      } else {
        totals.receivableHKD += fee.amount;
      }
      return totals;
    }, { receivableHKD: 0, receivableRMB: 0 });
}

async function saveOrderFees(orderNo, fees, fallbackCurrency) {
  await ensureOrderFeeCostCurrencyColumn();
  const support = await orderFeeInsertColumnSupport();
  const insertColumns = [
    "order_no",
    ...(support.clientKey ? ["client_key"] : []),
    "category",
    "name",
    "quantity",
    "unit_price",
    "unit_price_manual",
    "currency",
    "amount",
    "amount_manual",
    "cost",
    ...(support.costCurrency ? ["cost_currency"] : []),
    ...(support.costHKD ? ["cost_hkd"] : []),
    ...(support.costRMB ? ["cost_rmb"] : []),
    ...(support.costPartsJson ? ["cost_parts_json"] : []),
    "cost_manual",
    ...(support.fxLinksJson ? ["fx_links_json"] : []),
    ...(support.advanceAddress ? ["advance_address"] : []),
    "remark",
    "driver_role",
    "driver_name"
  ];
  const insertValues = [
    "@orderNo",
    ...(support.clientKey ? ["@clientKey"] : []),
    "@category",
    "@name",
    "@quantity",
    "@unitPrice",
    "@unitPriceManual",
    "@currency",
    "@amount",
    "@amountManual",
    "@cost",
    ...(support.costCurrency ? ["@costCurrency"] : []),
    ...(support.costHKD ? ["@costHKD"] : []),
    ...(support.costRMB ? ["@costRMB"] : []),
    ...(support.costPartsJson ? ["@costPartsJson"] : []),
    "@costManual",
    ...(support.fxLinksJson ? ["@fxLinksJson"] : []),
    ...(support.advanceAddress ? ["@advanceAddress"] : []),
    "@remark",
    "@driverRole",
    "@driverName"
  ];
  const insert = await db.prepare(`
    INSERT INTO order_fees (${insertColumns.join(", ")})
    VALUES (${insertValues.join(", ")})
  `);
  await db.prepare("DELETE FROM order_fees WHERE order_no = ?").run(orderNo);
  const normalizedFees = fees
    .map((fee) => normalizeOrderFee(fee, fallbackCurrency))
    .filter((fee) => fee.name);
  for (const fee of normalizedFees) {
    await insert.run({ orderNo, ...fee });
  }
}

app.patch("/api/orders/:no", async (req, res) => {
  const no = String(req.params.no || "").trim();
  const existing = await db.prepare("SELECT * FROM orders WHERE no = ? AND deleted_at IS NULL").get(no);
  if (!existing) {
    res.status(404).json({ message: "订单不存在或已删除" });
    return;
  }
  if (existing.status === "已审核") {
    res.status(409).json({ message: "已审核订单不可编辑，请先取消审核" });
    return;
  }

  const skipSignValidation = booleanFlag(req.body?.skipSignValidation ?? req.body?.skip_sign_validation, false);
  const item = await readOrderPayload(req.body, existing);
  item.no = no;
  item.fees = item.fees || (await hydrateOrderFees([mapOrder(existing)]))[0].fees;
  if (!(await resolveOrderCustomer(item))) {
    res.status(400).json({ message: "请选择有效客户" });
    return;
  }
  const signValidationMessage = skipSignValidation ? "" : validateOrderReadyForSignedStatus(item);
  if (signValidationMessage) {
    res.status(409).json({ message: signValidationMessage });
    return;
  }

  if (item.fees.length > 0) {
    Object.assign(item, calculateOrderReceivables(item.fees, item.currency));
  }

  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE orders
      SET dispatch_no = @dispatchNo,
          customer_id = @customerId, customer = @customer, business_type = @businessType,
          port = @port, needs_weighing = @needsWeighing, direction = @direction, tonnage = @tonnage, currency = @currency,
          quantity = @quantity, weight = @weight, vehicle_source = @vehicleSource,
          supplier = @supplier, plate = @plate, driver = @driver, hk_driver = @hkDriver,
          mainland_driver = @mainlandDriver, transport_mode = @transportMode,
	          loading = @loading, loading_locations = @loadingLocationsJson,
	          unloading = @unloading, unloading_locations = @unloadingLocationsJson,
          order_date = @date, receivable_hkd = @receivableHKD, receivable_rmb = @receivableRMB,
          status = @status, operating_unit = @operatingUnit, remark = @remark, trip_no_enabled = @tripNoEnabled,
          trip_no = @tripNo, six_sheet_enabled = @sixSheetEnabled, six_sheet_no = @sixSheetNo
      WHERE no = @no AND deleted_at IS NULL
    `).run(item);
    await saveOrderFees(no, item.fees, item.currency);
  });

  await transaction();
  await writeAudit(
    "update",
    "order",
    no,
    auditChangeSummary(existing, item, [
      { key: "customer", label: "客户" },
      { key: "dispatchNo", label: "排车单号" },
      { key: "status", label: "状态" },
      { key: "operatingUnit", label: "经营单位" },
      { key: "plate", label: "车牌" },
      { key: "driver", label: "司机" },
      { key: "supplier", label: "供应商" },
      { key: "loading", label: "装货地" },
      { key: "unloading", label: "卸货地" },
      { key: "remark", label: "备注" }
    ], { entityLabel: "订单" })
  );
  const updated = await db.prepare("SELECT * FROM orders WHERE no = ?").get(no);
  res.json((await hydrateOrderRowsForApi([mapOrder(updated)]))[0]);
});

app.patch("/api/orders/:no/status", async (req, res) => {
  const no = String(req.params.no || "").trim();
  const status = String(req.body.status || "").trim();
  const skipSignValidation = booleanFlag(req.body?.skipSignValidation ?? req.body?.skip_sign_validation, false);
  const allowedStatuses = new Set(["待确认", "预排", "正常", "通关中", "已签收", "已审核", "缺票据", "费用待确认"]);

  if (!allowedStatuses.has(status)) {
    res.status(400).json({ message: "订单状态无效" });
    return;
  }

  const current = await db.prepare(`
    SELECT orders.*, customers.short_name AS customer_short_name
    FROM orders
    LEFT JOIN customers ON customers.id = orders.customer_id
    WHERE orders.no = ? AND orders.deleted_at IS NULL
  `).get(no);
  if (!current) {
    res.status(404).json({ message: "订单不存在或已删除" });
    return;
  }
  if ((status === "已审核" || current.status === "已审核") && !requestCanManageOrderAudit(req)) {
    res.status(403).json({ message: "只有财务或管理员可以审核或取消审核订单" });
    return;
  }
  if (status === "已审核" && current.status !== "已签收") {
    res.status(409).json({ message: "只有已签收订单才能审核" });
    return;
  }
  if (current.status === "已审核" && status !== "已签收") {
    res.status(409).json({ message: "已审核订单只能先取消审核" });
    return;
  }
  if (!(current.status === "已审核" && status === "已签收") && shouldPreventOrderStatusDowngrade(current.status, status)) {
    res.status(409).json({ message: `${current.status}订单不能退回${status}` });
    return;
  }
  if (!skipSignValidation && status === "已签收" && current.status !== "已审核") {
    const labels = missingOrderSignRequiredFieldLabels(current, {
      id: current.customer_id,
      name: current.customer,
      short_name: current.customer_short_name
    });
    if (labels.length) {
      res.status(409).json({ message: orderSignRequiredMessage(labels) });
      return;
    }
  }

  const dispatchStatus = ORDER_STATUS_TO_DISPATCH_STATUS[status] || "";
  const transaction = db.transaction(async () => {
    const result = await db.prepare("UPDATE orders SET status = ? WHERE no = ? AND deleted_at IS NULL").run(status, no);
    if (result.changes === 0) return null;
    const row = await db.prepare("SELECT * FROM orders WHERE no = ?").get(no);
    if (dispatchStatus) {
      await syncDispatchPlanRowsStatusForOrder(row, dispatchStatus);
    }
    return row;
  });
  const row = await transaction();
  if (!row) {
    res.status(404).json({ message: "订单不存在或已删除" });
    return;
  }

  await writeAudit(status === "已审核" ? "audit" : "update_status", "order", no, `状态改为${status}`);
  res.json((await hydrateOrderRowsForApi([mapOrder(row)]))[0]);
});

app.patch("/api/orders/:no/charge", async (req, res) => {
  const no = String(req.params.no || "").trim();
  const current = await db.prepare("SELECT * FROM orders WHERE no = ? AND deleted_at IS NULL").get(no);
  if (!current) {
    res.status(404).json({ message: "订单不存在或已删除" });
    return;
  }
  if (String(current.status || "").trim() !== "已审核") {
    res.status(409).json({ message: "只有已审核订单才能标记收费状态" });
    return;
  }
  const chargedAt = normalizeOrderChargedAt(req.body?.chargedAt ?? req.body?.charged_at ?? "");
  const rawHasDate = userTextValue(req.body?.chargedAt ?? req.body?.charged_at ?? "");
  if (rawHasDate && !chargedAt) {
    res.status(400).json({ message: "收费日期格式应为 YYYY-MM-DD" });
    return;
  }
  await db.prepare("UPDATE orders SET charged_at = ? WHERE no = ? AND deleted_at IS NULL").run(chargedAt, no);
  await writeAudit(chargedAt ? "mark_charged" : "cancel_charged", "order", no, chargedAt ? `收费日期 ${chargedAt}` : "取消已收费");
  const row = await db.prepare("SELECT * FROM orders WHERE no = ?").get(no);
  res.json((await hydrateOrderRowsForApi([mapOrder(row)]))[0]);
});

app.delete("/api/orders/:no", async (req, res) => {
  const no = String(req.params.no || "").trim();
  const row = await db.prepare("SELECT no, dispatch_no, status FROM orders WHERE no = ? AND deleted_at IS NULL").get(no);
  if (!row) {
    res.status(404).json({ message: "订单不存在或已删除" });
    return;
  }
  if (row.status === "已审核") {
    res.status(409).json({ message: "已审核订单不可删除" });
    return;
  }
  if (ADMIN_ONLY_DELETE_ORDER_STATUSES.has(row.status) && !requestHasAdminOrderDeletePermission(req)) {
    res.status(403).json({ message: `${row.status}订单不可删除，请使用管理员账号操作` });
    return;
  }

  const transaction = db.transaction(async () => {
    await db.prepare("UPDATE orders SET deleted_at = CURRENT_TIMESTAMP WHERE no = ?").run(no);
    await removeDispatchPlanRowsLinkedToOrder(row);
  });
  await transaction();
  await writeAudit("delete", "order", no, "移入回收站");
  res.json({ ok: true });
});

app.post("/api/orders/:no/restore", async (req, res) => {
  const no = String(req.params.no || "").trim();
  const deletedOrder = await db.prepare("SELECT * FROM orders WHERE no = ? AND deleted_at IS NOT NULL").get(no);
  if (!deletedOrder) {
    res.status(404).json({ message: "回收站内找不到该订单" });
    return;
  }
  const restoredDispatchRows = [];
  const transaction = db.transaction(async () => {
    await db.prepare("UPDATE orders SET deleted_at = NULL WHERE no = ? AND deleted_at IS NOT NULL").run(no);
    restoredDispatchRows.push(...await restoreDispatchPlanRowsLinkedToOrder(deletedOrder));
  });
  await transaction();
  await writeAudit("restore", "order", no, "从回收站恢复");
  const restored = await db.prepare("SELECT * FROM orders WHERE no = ?").get(no);
  const restoredOrder = (await hydrateOrderRowsForApi([mapOrder(restored)]))[0];
  res.json({
    order: restoredOrder,
    dispatchRows: restoredDispatchRows,
    ...restoredOrder
  });
});

app.get("/api/vehicles", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM vehicles WHERE deleted_at IS NULL ORDER BY plate ASC").all();
  res.json(rows.map(mapVehicle));
});

app.post("/api/vehicles", async (req, res) => {
  const item = {
    plate: normalizePlateText(req.body.plate),
    brand: userTextValue(req.body.brand),
    model: userTextValue(req.body.model),
    type: userTextValue(req.body.type),
    purchaseDate: String(req.body.purchaseDate || "").trim(),
    factoryDate: String(req.body.factoryDate || "").trim(),
    mainlandReviewDate: String(req.body.mainlandReviewDate || "").trim(),
    hkReviewDate: String(req.body.hkReviewDate || "").trim(),
    mainlandInsuranceDate: String(req.body.mainlandInsuranceDate || "").trim(),
    hkInsuranceDate: String(req.body.hkInsuranceDate || "").trim(),
    insuranceReminder: userTextValue(req.body.insuranceReminder || "提前30天"),
    maintenanceReminder: userTextValue(req.body.maintenanceReminder),
    status: userTextValue(req.body.status || "正常"),
    monthlyCost: Number(req.body.monthlyCost || 0),
    note: userTextValue(req.body.note)
  };
  if (!item.plate) {
    res.status(400).json({ message: "车牌不能为空" });
    return;
  }
  const duplicate = await db.prepare("SELECT plate FROM vehicles WHERE plate = ?").get(item.plate);
  if (duplicate) {
    res.status(409).json({ message: "车牌已存在，不能重复" });
    return;
  }
  await db.prepare(`
    INSERT INTO vehicles
      (plate, brand, model, vehicle_type, purchase_date, factory_date, mainland_review_date,
       hk_review_date, mainland_insurance_date, hk_insurance_date, insurance_reminder,
       maintenance_reminder, status, monthly_cost, note)
    VALUES
      (@plate, @brand, @model, @type, @purchaseDate, @factoryDate, @mainlandReviewDate,
       @hkReviewDate, @mainlandInsuranceDate, @hkInsuranceDate, @insuranceReminder,
       @maintenanceReminder, @status, @monthlyCost, @note)
  `).run(item);
  await writeAudit("create", "vehicle", item.plate, item.note);
  res.status(201).json(mapVehicle(await db.prepare("SELECT * FROM vehicles WHERE plate = ?").get(item.plate)));
});

app.patch("/api/vehicles/:plate", async (req, res) => {
  const originalPlate = String(req.params.plate || "").trim();
  const current = await db.prepare("SELECT * FROM vehicles WHERE plate = ? AND deleted_at IS NULL").get(originalPlate);
  if (!current) {
    res.status(404).json({ message: "车辆不存在或已删除" });
    return;
  }
  const item = {
    originalPlate,
    plate: normalizePlateText(req.body.plate || originalPlate),
    brand: userTextValue(req.body.brand ?? current.brand ?? ""),
    model: userTextValue(req.body.model ?? current.model ?? ""),
    type: userTextValue(req.body.type ?? current.vehicle_type ?? ""),
    purchaseDate: String(req.body.purchaseDate ?? current.purchase_date ?? "").trim(),
    factoryDate: String(req.body.factoryDate ?? current.factory_date ?? "").trim(),
    mainlandReviewDate: String(req.body.mainlandReviewDate ?? current.mainland_review_date ?? "").trim(),
    hkReviewDate: String(req.body.hkReviewDate ?? current.hk_review_date ?? "").trim(),
    mainlandInsuranceDate: String(req.body.mainlandInsuranceDate ?? current.mainland_insurance_date ?? "").trim(),
    hkInsuranceDate: String(req.body.hkInsuranceDate ?? current.hk_insurance_date ?? "").trim(),
    insuranceReminder: userTextValue(req.body.insuranceReminder ?? current.insurance_reminder ?? "提前30天"),
    maintenanceReminder: userTextValue(req.body.maintenanceReminder ?? current.maintenance_reminder ?? ""),
    status: userTextValue(req.body.status ?? current.status ?? "正常"),
    monthlyCost: Number(req.body.monthlyCost ?? current.monthly_cost ?? 0),
    note: userTextValue(req.body.note ?? current.note ?? "")
  };
  if (!item.plate) {
    res.status(400).json({ message: "车牌不能为空" });
    return;
  }
  if (item.plate !== originalPlate) {
    const duplicate = await db.prepare("SELECT plate FROM vehicles WHERE plate = ? AND deleted_at IS NULL").get(item.plate);
    if (duplicate) {
      res.status(409).json({ message: "车牌已存在，不能重复" });
      return;
    }
  }
  const transaction = db.transaction(async () => {
    const result = await db.prepare(`
      UPDATE vehicles
      SET plate = @plate, brand = @brand, model = @model, vehicle_type = @type,
          purchase_date = @purchaseDate, factory_date = @factoryDate,
          mainland_review_date = @mainlandReviewDate, hk_review_date = @hkReviewDate,
          mainland_insurance_date = @mainlandInsuranceDate, hk_insurance_date = @hkInsuranceDate,
          insurance_reminder = @insuranceReminder, maintenance_reminder = @maintenanceReminder,
          status = @status, monthly_cost = @monthlyCost, note = @note
      WHERE plate = @originalPlate AND deleted_at IS NULL
    `).run(item);
    if (result.changes === 0) {
      throw new Error("车辆不存在或已删除");
    }
    if (item.plate !== originalPlate) {
      await db.prepare("UPDATE orders SET plate = ? WHERE plate = ? AND deleted_at IS NULL").run(item.plate, originalPlate);
      await db.prepare("UPDATE files SET entity_id = ? WHERE entity_type = 'vehicle' AND entity_id = ? AND deleted_at IS NULL").run(item.plate, originalPlate);
      await db.prepare("UPDATE vehicle_expenses SET plate = ?, updated_at = CURRENT_TIMESTAMP WHERE plate = ? AND deleted_at IS NULL").run(item.plate, originalPlate);
    }
  });
  try {
    await transaction();
  } catch (error) {
    res.status(404).json({ message: error.message });
    return;
  }
  await writeAudit(
    "update",
    "vehicle",
    item.plate,
    auditChangeSummary(current, item, [
      { key: "plate", label: "车牌" },
      { key: "brand", label: "品牌" },
      { key: "model", label: "型号" },
      { label: "类型", before: (before) => before.vehicle_type, after: () => item.type },
      { key: "status", label: "状态" },
      { key: "monthlyCost", label: "月成本" },
      { key: "maintenanceReminder", label: "保养提醒" },
      { key: "note", label: "备注" }
    ], { entityLabel: "车辆" })
  );
  res.json(mapVehicle(await db.prepare("SELECT * FROM vehicles WHERE plate = ?").get(item.plate)));
});

app.delete("/api/vehicles/:plate", async (req, res) => {
  const plate = String(req.params.plate || "").trim();
  const vehicle = await db.prepare("SELECT plate FROM vehicles WHERE plate = ? AND deleted_at IS NULL").get(plate);
  if (!vehicle) {
    res.status(404).json({ message: "车辆不存在或已删除" });
    return;
  }
  const orderCount = (await db.prepare("SELECT COUNT(*) AS count FROM orders WHERE plate = ? AND deleted_at IS NULL").get(plate)).count;
  if (orderCount > 0) {
    res.status(409).json({ message: "车辆已有订单记录，不允许删除" });
    return;
  }
  const expenseCount = (await db.prepare("SELECT COUNT(*) AS count FROM vehicle_expenses WHERE plate = ? AND deleted_at IS NULL").get(plate)).count;
  if (expenseCount > 0) {
    res.status(409).json({ message: "车辆已有费用记录，不允许删除" });
    return;
  }
  const result = await db.prepare("UPDATE vehicles SET deleted_at = CURRENT_TIMESTAMP WHERE plate = ? AND deleted_at IS NULL").run(plate);
  if (result.changes === 0) {
    res.status(404).json({ message: "车辆不存在或已删除" });
    return;
  }
  await writeAudit("delete", "vehicle", plate, "移入回收站");
  res.json({ ok: true });
});

app.get("/api/vehicle-expenses", async (req, res) => {
  const type = String(req.query.type || "").trim();
  const rows = VEHICLE_EXPENSE_TYPES.has(type)
    ? await db.prepare(`
      SELECT * FROM vehicle_expenses
      WHERE deleted_at IS NULL AND expense_type = ?
      ORDER BY COALESCE(NULLIF(start_date, ''), expense_date) DESC, id DESC
    `).all(type)
    : await db.prepare(`
      SELECT * FROM vehicle_expenses
      WHERE deleted_at IS NULL
      ORDER BY COALESCE(NULLIF(start_date, ''), expense_date) DESC, id DESC
    `).all();
  res.json(rows.map(mapVehicleExpense));
});

app.post("/api/vehicle-expenses", async (req, res) => {
  const item = normalizeVehicleExpensePayload(req.body || {});
  const hasMaintenanceNextKm = await vehicleExpenseHasMaintenanceNextKmColumn();
  if (!item.plate) {
    res.status(400).json({ message: "请选择车牌" });
    return;
  }
  const vehicle = await db.prepare("SELECT plate FROM vehicles WHERE plate = ? AND deleted_at IS NULL").get(item.plate);
  if (!vehicle) {
    res.status(404).json({ message: "车辆不存在或已删除" });
    return;
  }
  if (item.type === "other" && !item.name) {
    res.status(400).json({ message: "请填写支出名称" });
    return;
  }
  if (item.type === "repair" && (!Array.isArray(item.repairItems) || item.repairItems.length === 0)) {
    res.status(400).json({ message: "请至少填写一条维修项目" });
    return;
  }
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    res.status(400).json({ message: "请填写大于 0 的费用金额" });
    return;
  }
  if (item.type === "other" && !/^\d{4}-\d{2}$/.test(item.date)) {
    res.status(400).json({ message: "请填写正确的费用月份" });
    return;
  }
  if (!["annual", "other"].includes(item.type) && !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    res.status(400).json({ message: "请填写正确的费用日期" });
    return;
  }
  if (item.type === "annual") {
    if (!parseInputDate(item.startDate) || !parseInputDate(item.endDate)) {
      res.status(400).json({ message: "请填写正确的起止日期" });
      return;
    }
    if (item.startDate > item.endDate) {
      res.status(400).json({ message: "开始日期不能晚于到期日期" });
      return;
    }
  }
  const transaction = db.transaction(async () => {
    await lockVehicleExpenseCreation(item);
    const duplicate = await findRecentDuplicateVehicleExpense(item, hasMaintenanceNextKm);
    if (duplicate) {
      return { row: duplicate, created: false };
    }
    const result = await db.prepare(`
      INSERT INTO vehicle_expenses (expense_type, name, fuel_station, fuel_liters, fuel_price_per_liter, odometer_km, is_maintenance, maintenance_next_date${hasMaintenanceNextKm ? ", maintenance_next_km" : ""}, repair_items_json, plate, expense_date, start_date, end_date, expense_year, currency, amount, note)
      VALUES (@type, @name, @fuelStation, @fuelLiters, @fuelPricePerLiter, @odometerKm, @isMaintenance, @maintenanceNextDate${hasMaintenanceNextKm ? ", @maintenanceNextKm" : ""}, @repairItemsJson, @plate, @date, @startDate, @endDate, @year, @currency, @amount, @note)
    `).run(item);
    return {
      row: await db.prepare("SELECT * FROM vehicle_expenses WHERE id = ?").get(result.lastInsertId),
      created: true
    };
  });
  const saved = await transaction();
  if (item.type === "annual") {
    try {
      await syncVehicleAnnualExpenseReminderDates(item.plate);
    } catch (error) {
      console.warn("Failed to sync annual expense reminder dates", {
        plate: item.plate,
        error: error?.message || error
      });
    }
  }
  if (item.type === "repair") {
    try {
      await syncVehicleMaintenanceReminderDate(item.plate);
    } catch (error) {
      console.warn("Failed to sync maintenance reminder date", {
        plate: item.plate,
        error: error?.message || error
      });
    }
  }
  if (saved.created) {
    await writeAudit("create", "vehicle_expense", String(saved.row.id), `${item.plate}/${item.name}/${item.amount}`);
  }
  res.status(saved.created ? 201 : 200).json(mapVehicleExpense(saved.row));
});

app.patch("/api/vehicle-expenses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const current = await db.prepare("SELECT * FROM vehicle_expenses WHERE id = ? AND deleted_at IS NULL").get(id);
  const hasMaintenanceNextKm = await vehicleExpenseHasMaintenanceNextKmColumn();
  if (!current) {
    res.status(404).json({ message: "费用记录不存在或已删除" });
    return;
  }
  const item = normalizeVehicleExpensePayload(req.body || {}, current);
  if (!item.plate) {
    res.status(400).json({ message: "请选择车牌" });
    return;
  }
  const vehicle = await db.prepare("SELECT plate FROM vehicles WHERE plate = ? AND deleted_at IS NULL").get(item.plate);
  if (!vehicle) {
    res.status(404).json({ message: "车辆不存在或已删除" });
    return;
  }
  if (item.type === "other" && !item.name) {
    res.status(400).json({ message: "请填写支出名称" });
    return;
  }
  if (item.type === "repair" && (!Array.isArray(item.repairItems) || item.repairItems.length === 0)) {
    res.status(400).json({ message: "请至少填写一条维修项目" });
    return;
  }
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    res.status(400).json({ message: "请填写大于 0 的费用金额" });
    return;
  }
  if (item.type === "other" && !/^\d{4}-\d{2}$/.test(item.date)) {
    res.status(400).json({ message: "请填写正确的费用月份" });
    return;
  }
  if (!["annual", "other"].includes(item.type) && !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    res.status(400).json({ message: "请填写正确的费用日期" });
    return;
  }
  if (item.type === "annual") {
    if (!parseInputDate(item.startDate) || !parseInputDate(item.endDate)) {
      res.status(400).json({ message: "请填写正确的起止日期" });
      return;
    }
    if (item.startDate > item.endDate) {
      res.status(400).json({ message: "开始日期不能晚于到期日期" });
      return;
    }
  }
  await db.prepare(`
    UPDATE vehicle_expenses
    SET expense_type = @type,
        name = @name,
        fuel_station = @fuelStation,
        fuel_liters = @fuelLiters,
        fuel_price_per_liter = @fuelPricePerLiter,
        odometer_km = @odometerKm,
        is_maintenance = @isMaintenance,
        maintenance_next_date = @maintenanceNextDate,
        ${hasMaintenanceNextKm ? "maintenance_next_km = @maintenanceNextKm," : ""}
        repair_items_json = @repairItemsJson,
        plate = @plate,
        expense_date = @date,
        start_date = @startDate,
        end_date = @endDate,
        expense_year = @year,
        currency = @currency,
        amount = @amount,
        note = @note,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
    `).run({ id, ...item });
  if (current.expense_type === "annual" || item.type === "annual") {
    try {
      await syncVehicleAnnualExpenseReminderDates(current.plate);
      if (item.plate !== current.plate) {
        await syncVehicleAnnualExpenseReminderDates(item.plate);
      }
    } catch (error) {
      console.warn("Failed to sync annual expense reminder dates", {
        plate: item.plate,
        error: error?.message || error
      });
    }
  }
  if (current.expense_type === "repair" || item.type === "repair") {
    const syncPlates = new Set([current.plate, item.plate].filter(Boolean));
    for (const plate of syncPlates) {
      try {
        await syncVehicleMaintenanceReminderDate(plate);
      } catch (error) {
        console.warn("Failed to sync maintenance reminder date", {
          plate,
          error: error?.message || error
        });
      }
    }
  }
  await writeAudit(
    "update",
    "vehicle_expense",
    String(id),
    auditChangeSummary(current, item, [
      { label: "类型", before: (before) => before.expense_type, after: () => item.type },
      { key: "plate", label: "车牌" },
      { key: "name", label: "名称" },
      { label: "日期", before: (before) => before.expense_date, after: () => item.date },
      { key: "amount", label: "金额" },
      { key: "currency", label: "币种" },
      { key: "isMaintenance", label: "保养" },
      { key: "maintenanceNextDate", label: "下次保养时间" },
      { key: "maintenanceNextKm", label: "下次保养里程" },
      { key: "note", label: "备注" }
    ], { entityLabel: "车辆支出" })
  );
  res.json(mapVehicleExpense(await db.prepare("SELECT * FROM vehicle_expenses WHERE id = ?").get(id)));
});

app.delete("/api/vehicle-expenses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM vehicle_expenses WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "费用记录不存在或已删除" });
    return;
  }
  await db.prepare("UPDATE vehicle_expenses SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  if (row.expense_type === "annual") {
    try {
      await syncVehicleAnnualExpenseReminderDates(row.plate);
    } catch (error) {
      console.warn("Failed to sync annual expense reminder dates", {
        plate: row.plate,
        error: error?.message || error
      });
    }
  }
  if (row.expense_type === "repair") {
    try {
      await syncVehicleMaintenanceReminderDate(row.plate);
    } catch (error) {
      console.warn("Failed to sync maintenance reminder date", {
        plate: row.plate,
        error: error?.message || error
      });
    }
  }
  await writeAudit("delete", "vehicle_expense", String(id), `${row.plate}/${row.name}`);
  res.json({ ok: true });
});

app.get("/api/drivers", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM drivers WHERE deleted_at IS NULL ORDER BY id ASC").all();
  res.json(rows.map(mapDriver));
});

app.post("/api/drivers", async (req, res) => {
  const item = {
    type: userTextValue(req.body.type || "香港司机"),
    name: userTextValue(req.body.name),
    phone: userTextValue(req.body.phone),
    idNo: userTextValue(req.body.idNo),
    license: userTextValue(req.body.license),
    birthday: String(req.body.birthday || "").trim(),
    hireDate: String(req.body.hireDate || "").trim(),
    leaveDate: String(req.body.leaveDate || "").trim(),
    employmentStatus: ["在职", "离职"].includes(String(req.body.employmentStatus || "").trim())
      ? String(req.body.employmentStatus || "").trim()
      : "在职",
    expireAt: String(req.body.expireAt || "").trim(),
    status: userTextValue(req.body.status || "正常"),
    defaultWage: Number(req.body.defaultWage || 0),
    note: userTextValue(req.body.note)
  };
  if (!item.name) {
    res.status(400).json({ message: "司机姓名不能为空" });
    return;
  }
  const duplicate = await db.prepare("SELECT * FROM drivers WHERE name = ?").get(item.name);
  if (duplicate?.deleted_at) {
    await db.prepare(`
      UPDATE drivers
      SET type = @type, name = @name, phone = @phone, id_no = @idNo, license = @license,
          birthday = @birthday, hire_date = @hireDate, leave_date = @leaveDate,
          employment_status = @employmentStatus, expire_at = @expireAt,
          status = @status, default_wage = @defaultWage, note = @note,
          deleted_at = NULL
      WHERE id = @id
    `).run({ ...item, id: duplicate.id });
    await writeAudit("restore", "driver", String(duplicate.id), item.name);
    res.json({ ...mapDriver(await db.prepare("SELECT * FROM drivers WHERE id = ?").get(duplicate.id)), restored: true });
    return;
  }
  if (duplicate) {
    res.status(409).json({ message: "司机姓名已存在，不能重复" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO drivers (type, name, phone, id_no, license, birthday, hire_date, leave_date, employment_status, expire_at, status, default_wage, note)
    VALUES (@type, @name, @phone, @idNo, @license, @birthday, @hireDate, @leaveDate, @employmentStatus, @expireAt, @status, @defaultWage, @note)
  `).run(item);
  await writeAudit("create", "driver", String(result.lastInsertId), item.name);
  res.status(201).json(mapDriver(await db.prepare("SELECT * FROM drivers WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/drivers/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM drivers WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "司机不存在或已删除" });
    return;
  }
  const item = {
    id,
    type: userTextValue(req.body.type ?? current.type ?? "香港司机") || "香港司机",
    name: userTextValue(req.body.name ?? current.name ?? ""),
    phone: userTextValue(req.body.phone ?? current.phone ?? ""),
    idNo: userTextValue(req.body.idNo ?? current.id_no ?? ""),
    license: userTextValue(req.body.license ?? current.license ?? ""),
    birthday: String(req.body.birthday ?? current.birthday ?? "").trim(),
    hireDate: String(req.body.hireDate ?? current.hire_date ?? "").trim(),
    leaveDate: String(req.body.leaveDate ?? current.leave_date ?? "").trim(),
    employmentStatus: ["在职", "离职"].includes(String(req.body.employmentStatus ?? current.employment_status ?? "在职").trim())
      ? String(req.body.employmentStatus ?? current.employment_status ?? "在职").trim()
      : "在职",
    expireAt: String(req.body.expireAt ?? current.expire_at ?? "").trim(),
    status: userTextValue(req.body.status ?? current.status ?? "正常"),
    defaultWage: Number(req.body.defaultWage ?? current.default_wage ?? 0),
    note: userTextValue(req.body.note ?? current.note ?? "")
  };
  if (!item.name) {
    res.status(400).json({ message: "司机姓名不能为空" });
    return;
  }
  if (item.name !== current.name) {
    const duplicate = await db.prepare("SELECT id FROM drivers WHERE name = ? AND id <> ?").get(item.name, id);
    if (duplicate) {
      res.status(409).json({ message: "司机姓名已存在，不能重复" });
      return;
    }
  }
  const transaction = db.transaction(async () => {
    const result = await db.prepare(`
      UPDATE drivers
      SET type = @type, name = @name, phone = @phone, id_no = @idNo, license = @license,
          birthday = @birthday, hire_date = @hireDate, leave_date = @leaveDate, expire_at = @expireAt,
          employment_status = @employmentStatus, status = @status, default_wage = @defaultWage, note = @note
      WHERE id = @id AND deleted_at IS NULL
    `).run(item);
    if (result.changes === 0) {
      throw new Error("司机不存在或已删除");
    }
    if (item.name !== current.name) {
      await db.prepare("UPDATE orders SET driver = ? WHERE driver = ? AND deleted_at IS NULL").run(item.name, current.name);
    }
  });
  try {
    await transaction();
  } catch (error) {
    res.status(404).json({ message: error.message });
    return;
  }
  await writeAudit(
    "update",
    "driver",
    String(id),
    auditChangeSummary(current, item, [
      { key: "type", label: "类型" },
      { key: "name", label: "姓名" },
      { key: "phone", label: "电话" },
      { key: "idNo", label: "证件号" },
      { key: "license", label: "执照" },
      { key: "employmentStatus", label: "在职状态" },
      { key: "status", label: "状态" },
      { key: "defaultWage", label: "默认工资" },
      { key: "note", label: "备注" }
    ], { entityLabel: "司机" })
  );
  res.json(mapDriver(await db.prepare("SELECT * FROM drivers WHERE id = ?").get(id)));
});

app.delete("/api/drivers/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare("SELECT name FROM drivers WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "司机不存在或已删除" });
    return;
  }
  const orderCount = (await db.prepare("SELECT COUNT(*) AS count FROM orders WHERE driver = ? AND deleted_at IS NULL").get(row.name)).count;
  if (orderCount > 0) {
    res.status(409).json({ message: "司机已有订单记录，不允许删除" });
    return;
  }
  await db.prepare("UPDATE drivers SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  await writeAudit("delete", "driver", String(id), row.name);
  res.json({ ok: true });
});

function readDriverWageRulePayload(body, current = null) {
  const transportMode = String(body.transportMode ?? body.transport_mode ?? current?.transport_mode ?? "单司机").trim();
  const normalizedTransportMode = normalizeTransportMode(transportMode) || "单司机";
  const currentAdvanceFeeRates = (() => {
    try {
      return JSON.parse(current?.advance_fee_rates || "{}") || {};
    } catch {
      return {};
    }
  })();
  const advanceFeeRates = Object.fromEntries(
    Object.entries(body.advanceFeeRates ?? currentAdvanceFeeRates)
      .map(([key, value]) => [String(key), Number(value || 0)])
      .filter(([key]) => key)
  );
  return {
    driverId: body.driverId === undefined
      ? (current?.driver_id ?? null)
      : (body.driverId ? Number(body.driverId) : null),
    direction: String(body.direction ?? current?.direction ?? SHARED_DIRECTION).trim() || SHARED_DIRECTION,
    city: String(body.city ?? current?.city ?? "").trim(),
    transportMode: normalizedTransportMode,
    currency: String(body.currency ?? current?.currency ?? "港币").trim() || "港币",
    baseRMB: Number(body.baseRMB ?? current?.base_rmb ?? 0) || 0,
    baseHKD: Number(body.baseHKD ?? current?.base_hkd ?? 0) || 0,
    loadPerBoard: Number(body.loadPerBoard ?? current?.load_per_board ?? 0) || 0,
    unloadPerBoard: Number(body.unloadPerBoard ?? current?.unload_per_board ?? 0) || 0,
    crossSeaFee: Number(body.crossSeaFee ?? current?.cross_sea_fee ?? 0) || 0,
    addPointFee: Number(body.addPointFee ?? current?.add_point_fee ?? 0) || 0,
    waitingPerHour: Number(body.waitingPerHour ?? current?.waiting_per_hour ?? 0) || 0,
    advanceFeeRates: JSON.stringify(advanceFeeRates),
    note: String(body.note ?? current?.note ?? "").trim()
  };
}

app.get("/api/driver-wage-rules", async (req, res) => {
  const driverId = req.query.driverId ? Number(req.query.driverId) : null;
  const rows = driverId
    ? await db.prepare(`
        SELECT * FROM driver_wage_rules
        WHERE deleted_at IS NULL AND (driver_id = ? OR driver_id IS NULL)
        ORDER BY direction ASC, city ASC, transport_mode ASC, id ASC
      `).all(driverId)
    : await db.prepare(`
        SELECT * FROM driver_wage_rules
        WHERE deleted_at IS NULL
        ORDER BY direction ASC, city ASC, transport_mode ASC, id ASC
      `).all();
  res.json(rows.map(mapDriverWageRule));
});

app.post("/api/driver-wage-rules", async (req, res) => {
  const item = readDriverWageRulePayload(req.body);
  if (!item.city) {
    res.status(400).json({ message: "计价城市不能为空" });
    return;
  }
  const duplicate = await db.prepare(`
    SELECT id FROM driver_wage_rules
    WHERE deleted_at IS NULL
      AND COALESCE(driver_id, 0) = COALESCE(?, 0)
      AND direction = ? AND city = ? AND transport_mode = ?
  `).get(item.driverId, item.direction, item.city, item.transportMode);
  if (duplicate) {
    res.status(409).json({ message: "同司机、方向、城市、运输模式的司机费用规则已存在" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO driver_wage_rules
      (driver_id, direction, city, transport_mode, currency, base_rmb, base_hkd, load_per_board, unload_per_board,
       cross_sea_fee, add_point_fee, waiting_per_hour, advance_fee_rates, note)
    VALUES
      (@driverId, @direction, @city, @transportMode, @currency, @baseRMB, @baseHKD, @loadPerBoard, @unloadPerBoard,
       @crossSeaFee, @addPointFee, @waitingPerHour, @advanceFeeRates, @note)
  `).run(item);
  await writeAudit("create", "driver_wage_rule", String(result.lastInsertId), `${item.direction}/${item.city}`);
  res.status(201).json(mapDriverWageRule(await db.prepare("SELECT * FROM driver_wage_rules WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/driver-wage-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM driver_wage_rules WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "司机费用规则不存在或已删除" });
    return;
  }
  const item = { id, ...readDriverWageRulePayload(req.body, current) };
  if (!item.city) {
    res.status(400).json({ message: "计价城市不能为空" });
    return;
  }
  const duplicate = await db.prepare(`
    SELECT id FROM driver_wage_rules
    WHERE deleted_at IS NULL AND id <> ?
      AND COALESCE(driver_id, 0) = COALESCE(?, 0)
      AND direction = ? AND city = ? AND transport_mode = ?
  `).get(id, item.driverId, item.direction, item.city, item.transportMode);
  if (duplicate) {
    res.status(409).json({ message: "同司机、方向、城市、运输模式的司机费用规则已存在" });
    return;
  }
  await db.prepare(`
    UPDATE driver_wage_rules
    SET driver_id = @driverId, direction = @direction, city = @city, transport_mode = @transportMode, currency = @currency,
        base_rmb = @baseRMB, base_hkd = @baseHKD, load_per_board = @loadPerBoard,
        unload_per_board = @unloadPerBoard, cross_sea_fee = @crossSeaFee,
        add_point_fee = @addPointFee, waiting_per_hour = @waitingPerHour, advance_fee_rates = @advanceFeeRates, note = @note
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  await writeAudit(
    "update",
    "driver_wage_rule",
    String(id),
    auditChangeSummary(current, item, [
      { key: "driverId", label: "司机" },
      { key: "direction", label: "方向" },
      { key: "city", label: "城市" },
      { key: "transportMode", label: "运输模式" },
      { key: "currency", label: "币种" },
      { key: "baseRMB", label: "基础RMB" },
      { key: "baseHKD", label: "基础HKD" },
      { key: "loadPerBoard", label: "装货板费" },
      { key: "unloadPerBoard", label: "卸货板费" },
      { key: "crossSeaFee", label: "过海费" },
      { key: "addPointFee", label: "加点费" },
      { key: "waitingPerHour", label: "等候费" },
      { key: "note", label: "备注" }
    ], { entityLabel: "司机费用规则" })
  );
  res.json(mapDriverWageRule(await db.prepare("SELECT * FROM driver_wage_rules WHERE id = ?").get(id)));
});

app.delete("/api/driver-wage-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.prepare("UPDATE driver_wage_rules SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "司机费用规则不存在或已删除" });
    return;
  }
  await writeAudit("delete", "driver_wage_rule", String(id), "移入回收站");
  res.json({ ok: true });
});

app.get("/api/cost-center-rates", async (req, res) => {
  const source = normalizeCostCenterSource(req.query.source);
  const rows = source
    ? await db.prepare(`
        SELECT * FROM cost_center_rates
        WHERE deleted_at IS NULL AND source = ?
        ORDER BY origin ASC, destination ASC, tonnage ASC, entity_name ASC, effective_date DESC, id ASC
      `).all(source)
    : await db.prepare(`
        SELECT * FROM cost_center_rates
        WHERE deleted_at IS NULL
        ORDER BY source ASC, origin ASC, destination ASC, tonnage ASC, entity_name ASC, effective_date DESC, id ASC
      `).all();
  res.json(rows.map(mapCostCenterRate));
});

app.post("/api/cost-center-rates", async (req, res) => {
  const id = Number(req.body?.id || 0);
  const current = id
    ? await db.prepare("SELECT * FROM cost_center_rates WHERE id = ? AND deleted_at IS NULL").get(id)
    : null;
  if (id && !current) {
    res.status(404).json({ message: "成本规则不存在或已删除" });
    return;
  }
  const item = readCostCenterRatePayload(req.body, current);
  if (!item.source) {
    res.status(400).json({ message: "成本来源不能为空" });
    return;
  }
  if (!item.origin || !item.destination) {
    res.status(400).json({ message: "装货地和卸货地不能为空" });
    return;
  }
  if (item.source === "供应商" && !item.tonnage) {
    res.status(400).json({ message: "请填写吨位" });
    return;
  }
  const payload = {
    ...item,
    entityId: item.entityId || `cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  };
  if (id) {
    if (payload.effectiveDate !== (current.effective_date || "1970-01-01")) {
      const versionPayload = {
        ...payload,
        entityId: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      };
      const result = await db.prepare(`
        INSERT INTO cost_center_rates (source, entity_id, entity_name, origin, destination, tonnage, currency, cost_values, note, effective_date)
        VALUES (@source, @entityId, @entityName, @origin, @destination, @tonnage, @currency, @costValues, @note, @effectiveDate)
        RETURNING id
      `).run(versionPayload);
      const savedId = result.lastInsertId || result.rows?.[0]?.id;
      await writeAudit("create", "cost_center_rate", String(savedId || versionPayload.entityId), `${versionPayload.source}/${versionPayload.origin}-${versionPayload.destination}/${versionPayload.tonnage || "全部"}/${versionPayload.effectiveDate}`);
      res.json(mapCostCenterRate(await db.prepare("SELECT * FROM cost_center_rates WHERE id = ?").get(savedId)));
      return;
    }
    await db.prepare(`
      UPDATE cost_center_rates
      SET source = @source,
          entity_id = @entityId,
          entity_name = @entityName,
          origin = @origin,
          destination = @destination,
          tonnage = @tonnage,
          currency = @currency,
          cost_values = @costValues,
          note = @note,
          effective_date = @effectiveDate,
          updated_at = CURRENT_TIMESTAMP,
          deleted_at = NULL
      WHERE id = @id
        AND deleted_at IS NULL
    `).run({ ...payload, id });
    await writeAudit(
      "update",
      "cost_center_rate",
      String(id),
      auditChangeSummary(current, payload, [
        { key: "source", label: "来源" },
        { key: "entityName", label: "名称" },
        { key: "origin", label: "装货地" },
        { key: "destination", label: "卸货地" },
        { key: "tonnage", label: "吨位" },
        { key: "currency", label: "币种" },
        { key: "costValues", label: "成本值", formatBefore: (value) => auditPreviewValue(value, 18), formatAfter: (value) => auditPreviewValue(value, 18) },
        { key: "note", label: "备注" },
        { key: "effectiveDate", label: "修改日期" }
      ], { entityLabel: "成本中心" })
    );
    res.json(mapCostCenterRate(await db.prepare("SELECT * FROM cost_center_rates WHERE id = ?").get(id)));
    return;
  }
  const result = await db.prepare(`
    INSERT INTO cost_center_rates (source, entity_id, entity_name, origin, destination, tonnage, currency, cost_values, note, effective_date)
    VALUES (@source, @entityId, @entityName, @origin, @destination, @tonnage, @currency, @costValues, @note, @effectiveDate)
    RETURNING id
  `).run(payload);
  const savedId = result.lastInsertId || result.rows?.[0]?.id;
  await writeAudit("create", "cost_center_rate", String(savedId || payload.entityId), `${payload.source}/${payload.origin}-${payload.destination}/${payload.tonnage || "全部"}/${payload.effectiveDate}`);
  res.json(mapCostCenterRate(await db.prepare("SELECT * FROM cost_center_rates WHERE id = ?").get(savedId)));
});

app.delete("/api/cost-center-rates/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM cost_center_rates WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "成本行不存在或已删除" });
    return;
  }
  await db.prepare("UPDATE cost_center_rates SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  await writeAudit("delete", "cost_center_rate", String(id), `${current.source}/${current.entity_name}`);
  res.json({ ok: true });
});

app.get("/api/vehicle-profit-exchange-rates", async (_req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM vehicle_profit_exchange_rates
    WHERE deleted_at IS NULL
    ORDER BY period_month DESC
    LIMIT 240
  `).all();
  res.json(rows.map(mapVehicleProfitExchangeRate));
});

app.post("/api/vehicle-profit-exchange-rates", async (req, res) => {
  const periodMonth = normalizePeriodMonthKey(req.body?.periodMonth ?? req.body?.period_month ?? req.body?.month);
  const rate = normalizeVehicleProfitExchangeRate(req.body?.rate ?? req.body?.exchangeRate);
  if (!periodMonth) {
    res.status(400).json({ message: "请选择有效月份" });
    return;
  }
  if (!Number.isFinite(Number(req.body?.rate ?? req.body?.exchangeRate)) || Number(req.body?.rate ?? req.body?.exchangeRate) <= 0) {
    res.status(400).json({ message: "请填写有效汇率" });
    return;
  }
  const current = await db.prepare("SELECT * FROM vehicle_profit_exchange_rates WHERE period_month = ? AND deleted_at IS NULL").get(periodMonth);
  await db.prepare(`
    INSERT INTO vehicle_profit_exchange_rates (period_month, rate)
    VALUES (@periodMonth, @rate)
    ON CONFLICT (period_month)
    DO UPDATE SET
      rate = excluded.rate,
      updated_at = CURRENT_TIMESTAMP,
      deleted_at = NULL
  `).run({ periodMonth, rate });
  const row = await db.prepare("SELECT * FROM vehicle_profit_exchange_rates WHERE period_month = ?").get(periodMonth);
  await writeAudit(
    "update",
    "vehicle_profit_exchange_rate",
    periodMonth,
    auditChangeSummary({ periodMonth: current?.period_month, rate: current?.rate }, { periodMonth, rate }, [
      { key: "periodMonth", label: "月份" },
      { key: "rate", label: "汇率" }
    ], { entityLabel: "车辆利润汇率" })
  );
  res.json(mapVehicleProfitExchangeRate(row));
});

app.get("/api/company-expenses", async (_req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM company_expenses
    WHERE deleted_at IS NULL
    ORDER BY period_month DESC, id DESC
    LIMIT 1200
  `).all();
  res.json(rows.map(mapCompanyExpense));
});

app.post("/api/company-expenses", async (req, res) => {
  const item = readCompanyExpensePayload(req.body || {});
  const validationMessage = validateCompanyExpensePayload(item);
  if (validationMessage) {
    res.status(400).json({ message: validationMessage });
    return;
  }
  const row = await db.prepare(`
    INSERT INTO company_expenses (entry_type, period_month, category, employee_name, amount, note)
    VALUES (@entryType, @periodMonth, @category, @employeeName, @amount, @note)
    RETURNING *
  `).get(item);
  await writeAudit("create", "company_expense", String(row.id), `${item.entryType}/${item.periodMonth}/${item.category}${item.employeeName ? `/${item.employeeName}` : ""}/${item.amount}`);
  res.status(201).json(mapCompanyExpense(row));
});

app.post("/api/company-expenses/batch", async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) {
    res.status(400).json({ message: "请先填写工资明细" });
    return;
  }
  const normalizedItems = items.map((body) => readCompanyExpensePayload(body || {}));
  for (const item of normalizedItems) {
    const validationMessage = validateCompanyExpensePayload(item);
    if (validationMessage) {
      res.status(400).json({ message: validationMessage });
      return;
    }
  }
  const rows = [];
  const insert = await db.prepare(`
    INSERT INTO company_expenses (entry_type, period_month, category, employee_name, amount, note)
    VALUES (@entryType, @periodMonth, @category, @employeeName, @amount, @note)
    RETURNING *
  `);
  const transaction = db.transaction(async (batchItems) => {
    for (const item of batchItems) {
      const row = await insert.get(item);
      rows.push(row);
    }
  });
  await transaction(normalizedItems);
  for (const row of rows) {
    const item = mapCompanyExpense(row);
    await writeAudit("create", "company_expense", String(item.id), `${item.entryType}/${item.periodMonth}/${item.category}${item.employeeName ? `/${item.employeeName}` : ""}/${item.amount}`);
  }
  res.status(201).json(rows.map(mapCompanyExpense));
});

app.patch("/api/company-expenses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const current = await db.prepare("SELECT * FROM company_expenses WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "记录不存在或已删除" });
    return;
  }
  const item = readCompanyExpensePayload(req.body || {}, current);
  const validationMessage = validateCompanyExpensePayload(item);
  if (validationMessage) {
    res.status(400).json({ message: validationMessage });
    return;
  }
  await db.prepare(`
    UPDATE company_expenses
    SET entry_type = @entryType,
        period_month = @periodMonth,
        category = @category,
        employee_name = @employeeName,
        amount = @amount,
        note = @note,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `).run({ id, ...item });
  await writeAudit(
    "update",
    "company_expense",
    String(id),
    auditChangeSummary(current, item, [
      { key: "entryType", label: "类型" },
      { key: "periodMonth", label: "月份" },
      { key: "category", label: "类别" },
      { key: "employeeName", label: "员工" },
      { key: "amount", label: "金额" },
      { key: "note", label: "备注" }
    ], { entityLabel: "公司级支出" })
  );
  res.json(mapCompanyExpense(await db.prepare("SELECT * FROM company_expenses WHERE id = ?").get(id)));
});

app.delete("/api/company-expenses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const row = await db.prepare("SELECT * FROM company_expenses WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "记录不存在或已删除" });
    return;
  }
  await db.prepare("UPDATE company_expenses SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  await writeAudit("delete", "company_expense", String(id), `${row.period_month}/${row.category}`);
  res.json({ ok: true });
});

function readDriverAdjustmentPayload(body, current = null) {
  return {
    driverId: body.driverId === undefined ? Number(current?.driver_id || 0) : Number(body.driverId || 0),
    date: String(body.date ?? current?.date ?? "").trim(),
    type: String(body.type ?? current?.type ?? "预支款").trim() || "预支款",
    currency: String(body.currency ?? current?.currency ?? "港币").trim() || "港币",
    amount: Number(body.amount ?? current?.amount ?? 0) || 0,
    status: String(body.status ?? current?.status ?? "待工资结算").trim() || "待工资结算",
    note: String(body.note ?? current?.note ?? "").trim()
  };
}

app.get("/api/driver-adjustments", async (req, res) => {
  const driverId = req.query.driverId ? Number(req.query.driverId) : null;
  const rows = driverId
    ? await db.prepare(`
        SELECT * FROM driver_adjustments
        WHERE deleted_at IS NULL AND driver_id = ?
        ORDER BY date DESC, id DESC
      `).all(driverId)
    : await db.prepare(`
        SELECT * FROM driver_adjustments
        WHERE deleted_at IS NULL
        ORDER BY date DESC, id DESC
      `).all();
  res.json(rows.map(mapDriverAdjustment));
});

app.post("/api/driver-adjustments", async (req, res) => {
  const item = readDriverAdjustmentPayload(req.body);
  if (!item.driverId) {
    res.status(400).json({ message: "请选择司机" });
    return;
  }
  if (!item.date) {
    res.status(400).json({ message: "日期不能为空" });
    return;
  }
  const driver = await db.prepare("SELECT id, name FROM drivers WHERE id = ? AND deleted_at IS NULL").get(item.driverId);
  if (!driver) {
    res.status(404).json({ message: "司机不存在或已删除" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO driver_adjustments (driver_id, date, type, currency, amount, status, note)
    VALUES (@driverId, @date, @type, @currency, @amount, @status, @note)
  `).run(item);
  await writeAudit("create", "driver_adjustment", String(result.lastInsertId), `${driver.name}/${item.type}`);
  res.status(201).json(mapDriverAdjustment(await db.prepare("SELECT * FROM driver_adjustments WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/driver-adjustments/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM driver_adjustments WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "预支/报销记录不存在或已删除" });
    return;
  }
  const item = { id, ...readDriverAdjustmentPayload(req.body, current) };
  if (!item.driverId || !item.date) {
    res.status(400).json({ message: "司机和日期不能为空" });
    return;
  }
  await db.prepare(`
    UPDATE driver_adjustments
    SET driver_id = @driverId, date = @date, type = @type, currency = @currency,
        amount = @amount, status = @status, note = @note
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  await writeAudit(
    "update",
    "driver_adjustment",
    String(id),
    auditChangeSummary(current, item, [
      { key: "driverId", label: "司机" },
      { key: "date", label: "日期" },
      { key: "type", label: "类型" },
      { key: "currency", label: "币种" },
      { key: "amount", label: "金额" },
      { key: "status", label: "状态" },
      { key: "note", label: "备注" }
    ], { entityLabel: "司机预支/报销" })
  );
  res.json(mapDriverAdjustment(await db.prepare("SELECT * FROM driver_adjustments WHERE id = ?").get(id)));
});

app.delete("/api/driver-adjustments/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.prepare("UPDATE driver_adjustments SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "预支/报销记录不存在或已删除" });
    return;
  }
  await writeAudit("delete", "driver_adjustment", String(id), "移入回收站");
  res.json({ ok: true });
});

function readDriverRouteAdjustRulePayload(body, current = null) {
  const sourceKey = String(
    body.sourceKey ?? body.source_key ??
    (typeof body.id === "string" && !/^\d+$/.test(body.id) ? body.id : "") ??
    current?.source_key ?? ""
  ).trim();
  const rawDriverIds = Array.isArray(body.driverIds)
    ? body.driverIds
    : parseJsonArrayText(body.driver_ids ?? current?.driver_ids);
  const driverIds = rawDriverIds
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const rawDriverNames = Array.isArray(body.driverNames)
    ? body.driverNames
    : parseJsonArrayText(body.driver_names ?? current?.driver_names);
  const driverNames = rawDriverNames
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  const driverIdValue = body.driverId ?? body.driver_id ?? current?.driver_id ?? (driverIds.length === 1 ? driverIds[0] : null);
  const driverId = Number(driverIdValue || 0) || null;
  const driverName = String(
    body.driverName ?? body.driver_name ?? current?.driver_name ?? (driverNames.length === 1 ? driverNames[0] : "")
  ).trim();
  const transportMode = normalizeTransportMode(body.transportMode ?? body.transport_mode ?? current?.transport_mode ?? "");
  return {
    sourceKey,
    customerName: String(body.customerName ?? body.customer_name ?? current?.customer_name ?? "").trim(),
    driverIds: JSON.stringify(driverIds),
    driverNames: JSON.stringify(driverNames),
    driverId,
    driverName,
    transportMode,
    loading: String(body.loading ?? current?.loading ?? "").trim(),
    unloading: String(body.unloading ?? current?.unloading ?? "").trim(),
    amountHKD: Number(body.amountHKD ?? body.amount_hkd ?? current?.amount_hkd ?? 0) || 0,
    amountRMB: Number(body.amountRMB ?? body.amount_rmb ?? current?.amount_rmb ?? 0) || 0,
    note: String(body.note ?? current?.note ?? "").trim()
  };
}

function driverRouteAdjustRuleHasScope(item) {
  const driverIds = parseJsonArrayText(item.driverIds);
  return Boolean(item.customerName || item.loading || item.unloading || item.driverId || item.driverName || driverIds.length);
}

async function saveDriverRouteAdjustRule(item) {
  if (item.driverId) {
    const driver = await db.prepare("SELECT id FROM drivers WHERE id = ? AND deleted_at IS NULL").get(item.driverId);
    if (!driver) item = { ...item, driverId: null };
  }
  const sql = item.sourceKey ? `
    INSERT INTO driver_route_adjust_rules
      (source_key, customer_name, driver_ids, driver_names, driver_id, driver_name, transport_mode, loading, unloading, amount_hkd, amount_rmb, note)
    VALUES
      (@sourceKey, @customerName, @driverIds, @driverNames, @driverId, @driverName, @transportMode, @loading, @unloading, @amountHKD, @amountRMB, @note)
    ON CONFLICT (source_key) WHERE source_key <> ''
    DO UPDATE SET
      customer_name = excluded.customer_name,
      driver_ids = excluded.driver_ids,
      driver_names = excluded.driver_names,
      driver_id = excluded.driver_id,
      driver_name = excluded.driver_name,
      transport_mode = excluded.transport_mode,
      loading = excluded.loading,
      unloading = excluded.unloading,
      amount_hkd = excluded.amount_hkd,
      amount_rmb = excluded.amount_rmb,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP,
      deleted_at = NULL
  ` : `
    INSERT INTO driver_route_adjust_rules
      (source_key, customer_name, driver_ids, driver_names, driver_id, driver_name, transport_mode, loading, unloading, amount_hkd, amount_rmb, note)
    VALUES
      (@sourceKey, @customerName, @driverIds, @driverNames, @driverId, @driverName, @transportMode, @loading, @unloading, @amountHKD, @amountRMB, @note)
  `;
  const result = await db.prepare(sql).run(item);
  return db.prepare("SELECT * FROM driver_route_adjust_rules WHERE id = ?").get(result.lastInsertId);
}

app.get("/api/driver-route-adjust-rules", async (_req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM driver_route_adjust_rules
    WHERE deleted_at IS NULL
    ORDER BY updated_at DESC, id DESC
  `).all();
  res.json(rows.map(mapDriverRouteAdjustRule));
});

app.post("/api/driver-route-adjust-rules", async (req, res) => {
  const item = readDriverRouteAdjustRulePayload(req.body);
  if (!driverRouteAdjustRuleHasScope(item)) {
    res.status(400).json({ message: "请至少填写客户、路线或指定司机" });
    return;
  }
  const row = await saveDriverRouteAdjustRule(item);
  await writeAudit("create", "driver_route_adjust_rule", String(row.id), `${item.customerName || "全部客户"}/${item.loading || "*"}-${item.unloading || "*"}`);
  res.status(201).json(mapDriverRouteAdjustRule(row));
});

app.post("/api/driver-route-adjust-rules/sync", async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 1000) : [];
  const savedRows = [];
  for (const source of rows) {
    const item = readDriverRouteAdjustRulePayload(source || {});
    if (!driverRouteAdjustRuleHasScope(item)) continue;
    const row = await saveDriverRouteAdjustRule(item);
    savedRows.push(mapDriverRouteAdjustRule(row));
  }
  if (savedRows.length > 0) {
    await writeAudit("sync", "driver_route_adjust_rule", "legacy-localStorage", `同步 ${savedRows.length} 条`);
  }
  res.json(savedRows);
});

app.delete("/api/driver-route-adjust-rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.prepare(`
    UPDATE driver_route_adjust_rules
    SET deleted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "司机路线扣减规则不存在或已删除" });
    return;
  }
  await writeAudit("delete", "driver_route_adjust_rule", String(id), "移入回收站");
  res.json({ ok: true });
});

function normalizeStatementType(value = "") {
  return ["customer", "driver", "supplier", "customs"].includes(String(value || "")) ? String(value || "") : "customer";
}

const CUSTOMER_STATEMENT_STATUS_FLOW = ["未导出", "已导出", "已发送", "已开票", "已收款"];
const CUSTOMS_STATEMENT_STATUS_FLOW = CUSTOMER_STATEMENT_STATUS_FLOW;
const SUPPLIER_STATEMENT_STATUS_FLOW = ["未导出", "已导出", "已发送", "已开票", "已付款"];

function statementStatusFlowForType(type = "customer") {
  if (type === "supplier") return SUPPLIER_STATEMENT_STATUS_FLOW;
  if (type === "customs") return CUSTOMS_STATEMENT_STATUS_FLOW;
  return CUSTOMER_STATEMENT_STATUS_FLOW;
}

function statementFinalStatusForType(type = "customer") {
  const flow = statementStatusFlowForType(type);
  return flow[flow.length - 1] || "已收款";
}

function resolveStatementDownloadStatus(value = "", type = "customer", fallback = "") {
  const text = String(value || "").trim();
  const normalizedText = type === "supplier" && text === "已收款" ? "已付款" : text;
  return statementStatusFlowForType(type).includes(normalizedText) ? normalizedText : fallback;
}

function normalizeStatementDownloadStatus(value = "已导出", type = "customer") {
  return resolveStatementDownloadStatus(value, type, "已导出");
}

function isEditableStatementDownloadStatus(value = "", type = "customer") {
  return statementStatusFlowForType(type).slice(1).includes(resolveStatementDownloadStatus(value, type, ""));
}

function statementStatusIsSettled(status = "", type = "customer") {
  return resolveStatementDownloadStatus(status, type, "") === statementFinalStatusForType(type);
}

function normalizeStatementPaymentStatus(value = "未收款", type = "customer") {
  return statementStatusIsSettled(value, type) ? statementFinalStatusForType(type) : "未收款";
}

function normalizeStatementPaymentDate(value = "", status = "未收款", type = "customer") {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return normalizeStatementPaymentStatus(status, type) === statementFinalStatusForType(type) ? todayInputValue() : "";
}

function statementStatusTransitionIsAllowed(currentStatus = "未导出", nextStatus = "", type = "customer") {
  const flow = statementStatusFlowForType(type);
  const currentIndex = flow.indexOf(normalizeStatementDownloadStatus(currentStatus, type));
  const nextIndex = flow.indexOf(resolveStatementDownloadStatus(nextStatus, type, ""));
  if (nextIndex < 1 || currentIndex < 0) return false;
  return currentIndex === nextIndex || Math.abs(nextIndex - currentIndex) === 1;
}

function normalizeStatementPeriodMode(value = "") {
  const text = String(value || "").trim();
  return ["month", "range", "year", "all", "day"].includes(text) ? text : "";
}

function inferStatementPeriodMode(periodKey = "") {
  const key = String(periodKey || "").trim();
  if (/^\d{4}-\d{2}$/.test(key)) return "month";
  if (key === "all") return "all";
  if (key.startsWith("year:")) return "year";
  if (key.startsWith("range:")) return "range";
  if (key.startsWith("day:")) return "day";
  return "";
}

function inferStatementPeriodModeFromRange(start = "", end = "") {
  const startText = String(start || "").trim().slice(0, 10);
  const endText = String(end || "").trim().slice(0, 10);
  const matched = startText.match(/^(\d{4})-(\d{2})-01$/);
  if (!matched || !endText) return "";
  const lastDay = new Date(Number(matched[1]), Number(matched[2]), 0).getDate();
  return endText === `${matched[1]}-${matched[2]}-${String(lastDay).padStart(2, "0")}` ? "month" : "";
}

function statementDownloadKey(type, entityName, start, end) {
  return [type, entityName || "全部", start || "", end || ""].join("|");
}

function readStatementDownloadPayload(body, current = null) {
  const type = normalizeStatementType(body.type ?? body.statementType ?? body.statement_type ?? current?.statement_type ?? "customer");
  const entityName = String(body.entityName ?? body.entity_name ?? current?.entity_name ?? "全部").trim() || "全部";
  const start = String(body.start ?? body.startDate ?? body.start_date ?? current?.start_date ?? "").trim();
  const end = String(body.end ?? body.endDate ?? body.end_date ?? current?.end_date ?? "").trim();
  const periodKey = String(body.periodKey ?? body.period_key ?? current?.period_key ?? "").trim();
  const periodMode = normalizeStatementPeriodMode(body.periodMode ?? body.period_mode ?? current?.period_mode ?? "")
    || inferStatementPeriodMode(periodKey);
  const downloadKey = String(
    body.key ?? body.downloadKey ?? body.download_key ?? current?.download_key ?? statementDownloadKey(type, entityName, start, end)
  ).trim() || statementDownloadKey(type, entityName, start, end);
  const status = normalizeStatementDownloadStatus(body.status ?? body.statementStatus ?? body.statement_status ?? current?.status ?? "已导出", type);
  const paymentStatus = statementStatusIsSettled(status, type) ? statementFinalStatusForType(type) : "未收款";
  const amountHKD = Number(body.amountHKD ?? body.amount_hkd ?? current?.amount_hkd ?? 0);
  const amountRMB = Number(body.amountRMB ?? body.amount_rmb ?? current?.amount_rmb ?? 0);
  const recordCount = Number(body.recordCount ?? body.record_count ?? current?.record_count ?? 0);
  const snapshotReady = Boolean(
    body.snapshotReady ?? body.snapshot_ready ?? current?.snapshot_ready ?? (amountHKD || amountRMB || recordCount)
  );
  return {
    downloadKey,
    statementType: type,
    entityName,
    start,
    end,
    periodKey,
    periodMode,
    status,
    paymentStatus,
    paymentDate: normalizeStatementPaymentDate(body.paymentDate ?? body.payment_date ?? current?.payment_date ?? "", paymentStatus, type),
    amountHKD,
    amountRMB,
    recordCount,
    snapshotReady,
    downloadedAt: String(body.downloadedAt ?? body.downloaded_at ?? current?.downloaded_at ?? new Date().toISOString()).trim()
  };
}

async function saveStatementDownload(item) {
  const baseFields = [
    ["download_key", "downloadKey"],
    ["statement_type", "statementType"],
    ["entity_name", "entityName"],
    ["start_date", "start"],
    ["end_date", "end"],
    ["status", "status"],
    ["payment_status", "paymentStatus"],
    ["payment_date", "paymentDate"],
    ["downloaded_at", "downloadedAt"]
  ];
  const optionalFields = [
    ["period_key", "periodKey"],
    ["period_mode", "periodMode"],
    ["amount_hkd", "amountHKD"],
    ["amount_rmb", "amountRMB"],
    ["record_count", "recordCount"],
    ["snapshot_ready", "snapshotReady"]
  ];
  const availableOptionalFields = [];
  for (const field of optionalFields) {
    if (await tableColumnExists("statement_downloads", field[0])) {
      availableOptionalFields.push(field);
    }
  }
  const fields = [...baseFields, ...availableOptionalFields];
  const insertColumns = fields.map(([column]) => column).join(", ");
  const insertValues = fields.map(([, key]) => `@${key}`).join(", ");
  const updateSet = fields
    .filter(([column]) => column !== "download_key")
    .map(([column]) => `${column} = excluded.${column}`)
    .join(",\n      ");
  const result = await db.prepare(`
    INSERT INTO statement_downloads
      (${insertColumns})
    VALUES
      (${insertValues})
    ON CONFLICT (download_key)
    DO UPDATE SET
      ${updateSet},
      updated_at = CURRENT_TIMESTAMP,
      deleted_at = NULL
  `).run(item);
  return db.prepare("SELECT * FROM statement_downloads WHERE download_key = ? AND deleted_at IS NULL").get(item.downloadKey)
    || db.prepare("SELECT * FROM statement_downloads WHERE id = ?").get(result.lastInsertId);
}

app.get("/api/statement-downloads", async (_req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM statement_downloads
    WHERE deleted_at IS NULL
    ORDER BY downloaded_at DESC, id DESC
    LIMIT 300
  `).all();
  res.json(rows.map(mapStatementDownload));
});

app.post("/api/statement-downloads", async (req, res) => {
  const body = req.body || {};
  const incoming = readStatementDownloadPayload(body);
  const current = await db.prepare("SELECT * FROM statement_downloads WHERE download_key = ? AND deleted_at IS NULL").get(incoming.downloadKey);
  const item = readStatementDownloadPayload(body, current);
  const row = await saveStatementDownload(item);
  await writeAudit(
    "download",
    "statement",
    item.downloadKey,
    auditChangeSummary(current || {}, item, [
      { key: "statementType", label: "类型" },
      { key: "entityName", label: "对象" },
      { key: "status", label: "状态" },
      { key: "paymentStatus", label: "收款状态" },
      { key: "paymentDate", label: "收款日期" }
    ], { entityLabel: "对账单" })
  );
  res.status(201).json(mapStatementDownload(row));
});

app.post("/api/statement-downloads/payment", async (req, res) => {
  const body = req.body || {};
  const incoming = readStatementDownloadPayload(body);
  const current = await db.prepare("SELECT * FROM statement_downloads WHERE download_key = ? AND deleted_at IS NULL").get(incoming.downloadKey);
  const item = readStatementDownloadPayload({
    ...body,
    status: body.status ?? current?.status ?? "未导出",
    downloadedAt: body.downloadedAt ?? current?.downloaded_at ?? new Date().toISOString()
  }, current);
  if (current && !statementStatusTransitionIsAllowed(current.status, item.status, item.statementType)) {
    res.status(400).json({ message: "对账单状态只能按流程前进或返回一步" });
    return;
  }
  const row = await saveStatementDownload(item);
  await writeAudit(
    "update",
    "statement",
    item.downloadKey,
    auditChangeSummary(current || {}, item, [
      { key: "status", label: "状态" },
      { key: "paymentStatus", label: "收款状态" },
      { key: "paymentDate", label: "收款日期" }
    ], { entityLabel: "对账单" })
  );
  res.json(mapStatementDownload(row));
});

app.patch("/api/statement-downloads/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const requestedStatus = String(req.body.status ?? req.body.statementStatus ?? req.body.statement_status ?? "").trim();
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "对账单记录无效" });
    return;
  }
  const current = await db.prepare("SELECT * FROM statement_downloads WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "对账单下载记录不存在" });
    return;
  }
  const type = normalizeStatementType(current.statement_type);
  const status = resolveStatementDownloadStatus(requestedStatus, type, "");
  if (!isEditableStatementDownloadStatus(status, type)) {
    res.status(400).json({ message: "请选择有效对账单状态" });
    return;
  }
  if (!statementStatusTransitionIsAllowed(current.status, status, type)) {
    res.status(400).json({ message: "对账单状态只能按流程前进或返回一步" });
    return;
  }
  const paymentStatus = statementStatusIsSettled(status, type) ? statementFinalStatusForType(type) : "未收款";
  const paymentDate = statementStatusIsSettled(status, type)
    ? normalizeStatementPaymentDate(current.payment_date || "", paymentStatus, type)
    : "";
  await db.prepare(`
    UPDATE statement_downloads
    SET status = ?,
        payment_status = ?,
        payment_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(status, paymentStatus, paymentDate, id);
  const row = await db.prepare("SELECT * FROM statement_downloads WHERE id = ?").get(id);
  await writeAudit(
    "update",
    "statement",
    current.download_key || String(id),
    auditChangeSummary(current, { ...current, status, paymentStatus, paymentDate }, [
      { key: "status", label: "状态" },
      { key: "paymentStatus", label: "收款状态" },
      { key: "paymentDate", label: "收款日期" }
    ], { entityLabel: "对账单" })
  );
  res.json(mapStatementDownload(row));
});

app.post("/api/statement-downloads/sync", async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 1000) : [];
  const savedRows = [];
  for (const source of rows) {
    const item = readStatementDownloadPayload(source || {});
    const row = await saveStatementDownload(item);
    savedRows.push(mapStatementDownload(row));
  }
  if (savedRows.length > 0) {
    await writeAudit("sync", "statement", "legacy-localStorage", `同步 ${savedRows.length} 条下载记录`);
  }
  res.json(savedRows);
});

app.get("/api/fee-items", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM fee_items WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC").all();
  res.json(rows.map(mapFeeItem));
});

function normalizeDefaultDriverRole(value = "") {
  const text = String(value || "").trim();
  return ["香港司机", "大陆骑师", "跟随订单司机", "手动指定"].includes(text) ? text : "";
}

function requestHasFeeItemCostSource(body = {}) {
  return body.costSources !== undefined || body.costSource !== undefined || body.cost_source !== undefined;
}

function requestFeeItemCostSource(body = {}, fallback = "供应商") {
  if (body.costSources !== undefined) return feeItemCostSourceText(body.costSources);
  if (body.costSource !== undefined) return feeItemCostSourceText(body.costSource);
  if (body.cost_source !== undefined) return feeItemCostSourceText(body.cost_source);
  return feeItemCostSourceText(fallback);
}

app.post("/api/fee-items", async (req, res) => {
  const requestedSortOrder = Number(req.body.sortOrder);
  const nextSortOrder = (await db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS value
    FROM fee_items
    WHERE deleted_at IS NULL
  `).get()).value;
  const item = {
    category: normalizeFeeItemCategory(req.body.category),
    name: String(req.body.name || "").trim(),
    currency: String(req.body.currency || "港币").trim(),
    defaultAmount: Number(req.body.defaultAmount || 0),
    defaultDriverRole: normalizeDefaultDriverRole(req.body.defaultDriverRole || req.body.default_driver_role),
    costSource: feeItemCostSourceValue(requestFeeItemCostSource(req.body)),
    sortOrder: Number.isFinite(requestedSortOrder) && requestedSortOrder > 0 ? requestedSortOrder : nextSortOrder
  };
  if (!item.name) {
    res.status(400).json({ message: "收费项目名称不能为空" });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM fee_items WHERE name = ? AND deleted_at IS NULL").get(item.name);
  if (duplicate) {
    res.status(409).json({ message: "收费项目名称不能重复" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO fee_items (category, name, currency, default_amount, default_driver_role, cost_source, sort_order)
    VALUES (@category, @name, @currency, @defaultAmount, @defaultDriverRole, @costSource, @sortOrder)
  `).run(item);
  await writeAudit("create", "fee_item", String(result.lastInsertId), item.name);
  res.status(201).json(mapFeeItem(await db.prepare("SELECT * FROM fee_items WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/fee-items/order", async (req, res) => {
  const ids = Array.isArray(req.body.ids)
    ? req.body.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
    : [];
  if (ids.length === 0) {
    res.status(400).json({ message: "请选择需要排序的收费项目" });
    return;
  }
  const existingRows = await db.prepare(`
    SELECT id
    FROM fee_items
    WHERE deleted_at IS NULL
  `).all();
  const existingIds = new Set(existingRows.map((row) => row.id));
  const orderedIds = [];
  ids.forEach((id) => {
    if (existingIds.has(id) && !orderedIds.includes(id)) orderedIds.push(id);
  });
  existingRows.forEach((row) => {
    if (!orderedIds.includes(row.id)) orderedIds.push(row.id);
  });
  const updateSort = await db.prepare("UPDATE fee_items SET sort_order = ? WHERE id = ? AND deleted_at IS NULL");
  const updateOrder = db.transaction(async (orderIds) => {
    for (const [index, id] of orderIds.entries()) {
      await updateSort.run(index + 1, id);
    }
  });
  await updateOrder(orderedIds);
  await writeAudit("update", "fee_item_order", "all", `调整收费项目顺序 ${orderedIds.length} 项`);
  const rows = await db.prepare("SELECT * FROM fee_items WHERE deleted_at IS NULL ORDER BY sort_order ASC, id ASC").all();
  res.json(rows.map(mapFeeItem));
});

app.patch("/api/fee-items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM fee_items WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "收费项目不存在或已删除" });
    return;
  }
  const item = {
    id,
    category: req.body.category === undefined
      ? feeItemCategoryValue(current.category)
      : normalizeFeeItemCategory(req.body.category),
    name: req.body.name === undefined ? current.name : String(req.body.name || "").trim(),
    currency: req.body.currency === undefined ? current.currency : String(req.body.currency || "港币").trim(),
    defaultAmount: req.body.defaultAmount === undefined ? Number(current.default_amount || 0) : Number(req.body.defaultAmount || 0),
    defaultDriverRole: req.body.defaultDriverRole === undefined && req.body.default_driver_role === undefined
      ? (current.default_driver_role || "")
      : normalizeDefaultDriverRole(req.body.defaultDriverRole || req.body.default_driver_role),
    costSource: feeItemCostSourceValue(
      requestHasFeeItemCostSource(req.body)
        ? requestFeeItemCostSource(req.body, current.cost_source)
        : feeItemCostSourceText(current.cost_source)
    )
  };
  if (!item.name) {
    res.status(400).json({ message: "收费项目名称不能为空" });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM fee_items WHERE name = ? AND id <> ? AND deleted_at IS NULL").get(item.name, id);
  if (duplicate) {
    res.status(409).json({ message: "收费项目名称不能重复" });
    return;
  }
  const result = await db.prepare(`
    UPDATE fee_items
    SET category = @category, name = @name, currency = @currency, default_amount = @defaultAmount, default_driver_role = @defaultDriverRole, cost_source = @costSource
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  if (result.changes === 0) {
    res.status(404).json({ message: "收费项目不存在或已删除" });
    return;
  }
  await writeAudit(
    "update",
    "fee_item",
    String(id),
    auditChangeSummary(current, item, [
      { key: "category", label: "类别" },
      { key: "name", label: "名称" },
      { key: "currency", label: "币种" },
      { key: "defaultAmount", label: "默认金额" },
      { key: "defaultDriverRole", label: "默认归属" },
      { key: "costSource", label: "成本归属" }
    ], { entityLabel: "收费项目" })
  );
  res.json(mapFeeItem(await db.prepare("SELECT * FROM fee_items WHERE id = ?").get(id)));
});

app.delete("/api/fee-items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.prepare("UPDATE fee_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "收费项目不存在或已删除" });
    return;
  }
  await writeAudit("delete", "fee_item", String(id), "移入回收站");
  res.json({ ok: true });
});

function readFreightRatePayload(body, current = null) {
  const customerId = String(body.customerId ?? body.customer_id ?? current?.customer_id ?? "").trim();
  const customerName = String(body.customerName ?? body.customer_name ?? current?.customer_name ?? "").trim();
  const level1 = String(body.level1 ?? current?.level1 ?? current?.city ?? "").trim();
  const level2 = String(body.level2 ?? current?.level2 ?? "").trim();
  const level3 = String(body.level3 ?? current?.level3 ?? "").trim();
  const cityValue = body.city ?? current?.city ?? "";
  const city = String(cityValue).trim() || level3 || level2 || level1;
  const fallbackEffectiveDate = current?.effective_date || todayInputValue();
  return {
    customerId,
    customerName,
    direction: String(body.direction ?? current?.direction ?? "").trim(),
    level1,
    level2,
    level3,
    city,
    tonnage: String(body.tonnage ?? current?.tonnage ?? "").trim(),
    rmbAmount: Number(body.rmbAmount ?? current?.rmb_amount ?? 0) || 0,
    hkdAmount: Number(body.hkdAmount ?? current?.hkd_amount ?? 0) || 0,
    sortOrder: Number(body.sortOrder ?? current?.sort_order ?? 0) || 0,
    effectiveDate: normalizeEffectiveDate(
      body.effectiveDate ?? body.effective_date ?? body.modifiedDate ?? body.modified_date ?? current?.effective_date,
      fallbackEffectiveDate
    )
  };
}

app.get("/api/freight-rates", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM freight_rates WHERE deleted_at IS NULL ORDER BY sort_order ASC, effective_date DESC, id ASC").all();
  res.json(rows.map(mapFreightRate));
});

app.post("/api/freight-rates", async (req, res) => {
  const item = readFreightRatePayload(req.body);
  if (!item.direction || !item.level1 || !item.tonnage) {
    res.status(400).json({ message: "方向、一级目录、吨位不能为空" });
    return;
  }
  const duplicate = await db.prepare(`
    SELECT id FROM freight_rates
    WHERE deleted_at IS NULL
      AND customer_id = ?
      AND direction = ? AND level1 = ? AND level2 = ? AND level3 = ? AND tonnage = ?
      AND effective_date = ?
  `).get(item.customerId, item.direction, item.level1, item.level2, item.level3, item.tonnage, item.effectiveDate);
  if (duplicate) {
    res.status(409).json({ message: "同方向、目录、吨位、修改日期的运费模板已存在" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO freight_rates (customer_id, customer_name, direction, level1, level2, level3, city, tonnage, rmb_amount, hkd_amount, sort_order, effective_date)
    VALUES (@customerId, @customerName, @direction, @level1, @level2, @level3, @city, @tonnage, @rmbAmount, @hkdAmount, @sortOrder, @effectiveDate)
  `).run(item);
  await writeAudit("create", "freight_rate", String(result.lastInsertId), `${item.customerName || "公共模板"}/${item.direction}/${item.level1}/${item.level2}/${item.level3}/${item.tonnage}/${item.effectiveDate}`);
  res.status(201).json(mapFreightRate(await db.prepare("SELECT * FROM freight_rates WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/freight-rates/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM freight_rates WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "运费模板不存在或已删除" });
    return;
  }
  const item = { id, ...readFreightRatePayload(req.body, current) };
  if (!item.direction || !item.level1 || !item.tonnage) {
    res.status(400).json({ message: "方向、一级目录、吨位不能为空" });
    return;
  }
  const duplicate = await db.prepare(`
    SELECT id FROM freight_rates
    WHERE deleted_at IS NULL AND id <> ?
      AND customer_id = ?
      AND direction = ? AND level1 = ? AND level2 = ? AND level3 = ? AND tonnage = ?
      AND effective_date = ?
  `).get(id, item.customerId, item.direction, item.level1, item.level2, item.level3, item.tonnage, item.effectiveDate);
  if (duplicate) {
    res.status(409).json({ message: "同方向、目录、吨位、修改日期的运费模板已存在" });
    return;
  }
  if (item.effectiveDate !== (current.effective_date || "1970-01-01")) {
    const result = await db.prepare(`
      INSERT INTO freight_rates (customer_id, customer_name, direction, level1, level2, level3, city, tonnage, rmb_amount, hkd_amount, sort_order, effective_date)
      VALUES (@customerId, @customerName, @direction, @level1, @level2, @level3, @city, @tonnage, @rmbAmount, @hkdAmount, @sortOrder, @effectiveDate)
    `).run(item);
    await writeAudit("create", "freight_rate", String(result.lastInsertId), `${item.customerName || "公共模板"}/${item.direction}/${item.level1}/${item.level2}/${item.level3}/${item.tonnage}/${item.effectiveDate}`);
    res.json(mapFreightRate(await db.prepare("SELECT * FROM freight_rates WHERE id = ?").get(result.lastInsertId)));
    return;
  }
  await db.prepare(`
    UPDATE freight_rates
    SET customer_id = @customerId, customer_name = @customerName,
        direction = @direction, level1 = @level1, level2 = @level2, level3 = @level3,
        city = @city, tonnage = @tonnage,
        rmb_amount = @rmbAmount, hkd_amount = @hkdAmount, sort_order = @sortOrder,
        effective_date = @effectiveDate, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  await writeAudit(
    "update",
    "freight_rate",
    String(id),
    auditChangeSummary(current, item, [
      { key: "customerName", label: "客户" },
      { key: "direction", label: "方向" },
      { key: "level1", label: "一级目录" },
      { key: "level2", label: "二级目录" },
      { key: "level3", label: "三级目录" },
      { key: "tonnage", label: "吨位" },
      { key: "rmbAmount", label: "RMB" },
      { key: "hkdAmount", label: "HKD" },
      { key: "effectiveDate", label: "修改日期" }
    ], { entityLabel: "运费模板" })
  );
  res.json(mapFreightRate(await db.prepare("SELECT * FROM freight_rates WHERE id = ?").get(id)));
});

app.delete("/api/freight-rates/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.prepare("UPDATE freight_rates SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "运费模板不存在或已删除" });
    return;
  }
  await writeAudit("delete", "freight_rate", String(id), "移入回收站");
  res.json({ ok: true });
});

app.get("/api/templates", async (req, res) => {
  const includeContent = req.query.includeContent !== "0" && req.query.includeContent !== "false";
  let rows = await db.prepare("SELECT * FROM templates WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC").all();
  if (req.query.scope === "export") {
    rows = rows.filter((row) => !["order-freight-template", "outsourced-cost-rule"].includes(templateContentType(row.content)));
  }
  res.json(rows.map((row) => mapTemplate(row, { includeContent })));
});

app.get("/api/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare("SELECT * FROM templates WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "模板不存在或已删除" });
    return;
  }
  res.json(mapTemplate(row, { includeContent: true }));
});

app.post("/api/templates", async (req, res) => {
  const item = {
    name: String(req.body.name || "").trim(),
    format: String(req.body.format || "通用").trim() || "通用",
    description: String(req.body.description || "").trim(),
    content: String(req.body.content || "").trim()
  };
  if (!item.name) {
    res.status(400).json({ message: "模板名称不能为空" });
    return;
  }
  if (isProtectedTemplateName(item.name)) {
    res.status(400).json({ message: `${item.name}为系统保留模板，不能新建` });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM templates WHERE name = ? AND deleted_at IS NULL").get(item.name);
  if (duplicate) {
    res.status(409).json({ message: "模板名称已存在" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO templates (name, format, description, content, updated_at)
    VALUES (@name, @format, @description, @content, CURRENT_TIMESTAMP)
  `).run(item);
  await writeAudit("create", "template", String(result.lastInsertId), item.name);
  res.status(201).json(mapTemplate(await db.prepare("SELECT * FROM templates WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM templates WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "模板不存在或已删除" });
    return;
  }
  const item = {
    id,
    name: req.body.name === undefined ? current.name : String(req.body.name || "").trim(),
    format: "通用",
    description: req.body.description === undefined ? current.description : String(req.body.description || "").trim(),
    content: req.body.content === undefined ? current.content : String(req.body.content || "").trim()
  };
  if (!item.name) {
    res.status(400).json({ message: "模板名称不能为空" });
    return;
  }
  if (isProtectedTemplateName(item.name)) {
    res.status(400).json({ message: `${item.name}为系统保留模板，不能修改` });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM templates WHERE name = ? AND id != ? AND deleted_at IS NULL").get(item.name, id);
  if (duplicate) {
    res.status(409).json({ message: "模板名称已存在" });
    return;
  }
  const result = await db.prepare(`
    UPDATE templates
    SET name = @name, format = @format, description = @description,
        content = @content, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  if (result.changes === 0) {
    res.status(404).json({ message: "模板不存在或已删除" });
    return;
  }
  await writeAudit(
    "update",
    "template",
    String(id),
    auditChangeSummary(current, item, [
      { key: "name", label: "模板名称" },
      { key: "description", label: "说明" },
      { key: "content", label: "内容", formatBefore: (value) => auditPreviewValue(value, 18), formatAfter: (value) => auditPreviewValue(value, 18) }
    ], { entityLabel: "模板" })
  );
  res.json(mapTemplate(await db.prepare("SELECT * FROM templates WHERE id = ?").get(id)));
});

app.delete("/api/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT id, name FROM templates WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "模板不存在或已删除" });
    return;
  }
  if (isProtectedTemplateName(current.name)) {
    res.status(400).json({ message: `${current.name}为系统保留模板，不能删除` });
    return;
  }
  const result = await db.prepare("UPDATE templates SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "模板不存在或已删除" });
    return;
  }
  await writeAudit("delete", "template", String(id), "移入回收站");
  res.json({ ok: true });
});

app.get("/api/rules", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM rule_items WHERE deleted_at IS NULL ORDER BY id ASC").all();
  res.json(rows.map(mapRule));
});

app.post("/api/rules", async (req, res) => {
  const item = {
    ruleType: String(req.body.ruleType || "业务规则").trim(),
    name: String(req.body.name || "").trim(),
    content: String(req.body.content || "").trim(),
    enabled: req.body.enabled === false ? 0 : 1
  };
  if (!item.name) {
    res.status(400).json({ message: "规则名称不能为空" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO rule_items (rule_type, name, content, enabled)
    VALUES (@ruleType, @name, @content, @enabled)
  `).run(item);
  await writeAudit("create", "rule", String(result.lastInsertId), item.name);
  res.status(201).json(mapRule(await db.prepare("SELECT * FROM rule_items WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM rule_items WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "规则不存在或已删除" });
    return;
  }
  const item = {
    id,
    ruleType: req.body.ruleType === undefined ? current.rule_type : String(req.body.ruleType || "业务规则").trim(),
    name: req.body.name === undefined ? current.name : String(req.body.name || "").trim(),
    content: req.body.content === undefined ? current.content : String(req.body.content || "").trim(),
    enabled: req.body.enabled === undefined ? current.enabled : (req.body.enabled === false ? 0 : 1)
  };
  if (!item.name) {
    res.status(400).json({ message: "规则名称不能为空" });
    return;
  }
  const result = await db.prepare(`
    UPDATE rule_items
    SET rule_type = @ruleType, name = @name, content = @content, enabled = @enabled
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  if (result.changes === 0) {
    res.status(404).json({ message: "规则不存在或已删除" });
    return;
  }
  await writeAudit(
    "update",
    "rule",
    String(id),
    auditChangeSummary(current, item, [
      { key: "ruleType", label: "规则类型" },
      { key: "name", label: "名称" },
      { key: "content", label: "内容", formatBefore: (value) => auditPreviewValue(value, 18), formatAfter: (value) => auditPreviewValue(value, 18) },
      { key: "enabled", label: "启用" }
    ], { entityLabel: "规则" })
  );
  res.json(mapRule(await db.prepare("SELECT * FROM rule_items WHERE id = ?").get(id)));
});

app.delete("/api/rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.prepare("UPDATE rule_items SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "规则不存在或已删除" });
    return;
  }
  await writeAudit("delete", "rule", String(id), "移入回收站");
  res.json({ ok: true });
});

app.get("/api/master-data", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM master_data WHERE deleted_at IS NULL ORDER BY type ASC, sort_order ASC, id ASC").all();
  res.json(rows.map(mapMasterData));
});

app.post("/api/master-data", async (req, res) => {
  const item = {
    type: String(req.body.type || "").trim(),
    name: String(req.body.name || "").trim(),
    value: String(req.body.value || req.body.name || "").trim(),
    sortOrder: Number(req.body.sortOrder || 0)
  };
  if (item.type === "口岸") {
    item.name = normalizePortText(item.name);
    item.value = normalizePortText(item.value || item.name);
  }
  if (!item.type || !item.name) {
    res.status(400).json({ message: "类型和名称不能为空" });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM master_data WHERE type = ? AND name = ? AND deleted_at IS NULL").get(item.type, item.name);
  if (duplicate) {
    res.status(409).json({ message: "基础数据已存在" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO master_data (type, name, value, sort_order)
    VALUES (@type, @name, @value, @sortOrder)
  `).run(item);
  await writeAudit("create", "master_data", String(result.lastInsertId), `${item.type}/${item.name}`);
  res.status(201).json(mapMasterData(await db.prepare("SELECT * FROM master_data WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/master-data/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM master_data WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "基础数据不存在或已删除" });
    return;
  }
  const item = {
    id,
    type: req.body.type === undefined ? current.type : String(req.body.type || "").trim(),
    name: req.body.name === undefined ? current.name : String(req.body.name || "").trim(),
    value: req.body.value === undefined ? current.value : String(req.body.value || req.body.name || current.name || "").trim(),
    sortOrder: req.body.sortOrder === undefined ? Number(current.sort_order || 0) : Number(req.body.sortOrder || 0)
  };
  if (item.type === "口岸") {
    item.name = normalizePortText(item.name);
    item.value = normalizePortText(item.value || item.name);
  }
  if (!item.type || !item.name) {
    res.status(400).json({ message: "类型和名称不能为空" });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM master_data WHERE type = ? AND name = ? AND id != ? AND deleted_at IS NULL").get(item.type, item.name, id);
  if (duplicate) {
    res.status(409).json({ message: "基础数据已存在" });
    return;
  }
  const result = await db.prepare(`
    UPDATE master_data
    SET type = @type, name = @name, value = @value, sort_order = @sortOrder
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  if (result.changes === 0) {
    res.status(404).json({ message: "基础数据不存在或已删除" });
    return;
  }
  await writeAudit(
    "update",
    "master_data",
    String(id),
    auditChangeSummary(current, item, [
      { key: "type", label: "类型" },
      { key: "name", label: "名称" },
      { key: "value", label: "值" },
      { key: "sortOrder", label: "排序" }
    ], { entityLabel: "基础数据" })
  );
  res.json(mapMasterData(await db.prepare("SELECT * FROM master_data WHERE id = ?").get(id)));
});

app.delete("/api/master-data/:id", async (req, res) => {
  const id = Number(req.params.id);
  const result = await db.prepare("UPDATE master_data SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL").run(id);
  if (result.changes === 0) {
    res.status(404).json({ message: "基础数据不存在或已删除" });
    return;
  }
  await writeAudit("delete", "master_data", String(id), "移入回收站");
  res.json({ ok: true });
});

app.get("/api/accounts", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM app_accounts WHERE deleted_at IS NULL ORDER BY id ASC").all();
  res.json(rows.map(mapAccount));
});

app.post("/api/accounts", async (req, res) => {
  const role = normalizeAccountRole(req.body.role || "跟单员");
  const password = String(req.body.password || "");
  const item = {
    username: String(req.body.username || "").trim(),
    displayName: String(req.body.displayName || "").trim(),
    role,
    roleLevel: roleLevelFor(role),
    status: String(req.body.status || "启用").trim(),
    passwordHash: password ? hashPassword(password) : "",
    hireDate: String(req.body.hireDate || "").trim(),
    phone: String(req.body.phone || "").trim(),
    email: String(req.body.email || "").trim(),
    note: String(req.body.note || "").trim()
  };
  item.permissions = JSON.stringify(accountPermissionsForAccount(item));
  if (!item.username) {
    res.status(400).json({ message: "账号不能为空" });
    return;
  }
  if (password.length < 4) {
    res.status(400).json({ message: "登录密码至少 4 位" });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM app_accounts WHERE username = ? AND deleted_at IS NULL").get(item.username);
  if (duplicate) {
    res.status(409).json({ message: "账号已存在" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO app_accounts (username, display_name, role, role_level, status, password_hash, hire_date, phone, email, note, permissions)
    VALUES (@username, @displayName, @role, @roleLevel, @status, @passwordHash, @hireDate, @phone, @email, @note, @permissions)
  `).run(item);
  await writeAudit("create", "account", String(result.lastInsertId), item.username);
  res.status(201).json(mapAccount(await db.prepare("SELECT * FROM app_accounts WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/accounts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const current = await db.prepare("SELECT * FROM app_accounts WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "账号不存在或已删除" });
    return;
  }
  const role = req.body.role === undefined ? normalizeAccountRole(current.role) : normalizeAccountRole(req.body.role || "跟单员");
  const password = String(req.body.password || "");
  const item = {
    id,
    username: req.body.username === undefined ? current.username : String(req.body.username || "").trim(),
    displayName: req.body.displayName === undefined ? current.display_name : String(req.body.displayName || "").trim(),
    role,
    roleLevel: roleLevelFor(role),
    status: req.body.status === undefined ? current.status : String(req.body.status || "启用").trim(),
    passwordHash: password ? hashPassword(password) : null,
    hireDate: req.body.hireDate === undefined ? current.hire_date : String(req.body.hireDate || "").trim(),
    phone: req.body.phone === undefined ? current.phone : String(req.body.phone || "").trim(),
    email: req.body.email === undefined ? current.email : String(req.body.email || "").trim(),
    note: req.body.note === undefined ? current.note : String(req.body.note || "").trim()
  };
  item.permissions = JSON.stringify(accountPermissionsForAccount(item));
  if (!item.username) {
    res.status(400).json({ message: "账号不能为空" });
    return;
  }
  if (current.username === "admin" && item.username !== "admin") {
    res.status(409).json({ message: "默认管理员账号不可改名" });
    return;
  }
  if (password && password.length < 4) {
    res.status(400).json({ message: "登录密码至少 4 位" });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM app_accounts WHERE username = ? AND id != ? AND deleted_at IS NULL").get(item.username, id);
  if (duplicate) {
    res.status(409).json({ message: "账号已存在" });
    return;
  }
  const result = await db.prepare(`
    UPDATE app_accounts
    SET username = @username, display_name = @displayName, role = @role,
        role_level = @roleLevel, status = @status,
        password_hash = COALESCE(@passwordHash, password_hash),
        hire_date = @hireDate, phone = @phone, email = @email, note = @note,
        permissions = @permissions,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  if (result.changes === 0) {
    res.status(404).json({ message: "账号不存在或已删除" });
    return;
  }
  await writeAudit(
    "update",
    "account",
    String(id),
    auditChangeSummary(current, item, [
      { key: "username", label: "账号" },
      { key: "displayName", label: "姓名" },
      { key: "role", label: "部门" },
      { key: "status", label: "状态" },
      { key: "hireDate", label: "入职日期" },
      { key: "phone", label: "电话" },
      { key: "email", label: "邮箱" }
    ], { entityLabel: "账号" })
  );
  res.json(mapAccount(await db.prepare("SELECT * FROM app_accounts WHERE id = ?").get(id)));
});

app.delete("/api/accounts/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare("SELECT username FROM app_accounts WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "账号不存在或已删除" });
    return;
  }
  if (row.username === "admin") {
    res.status(409).json({ message: "默认管理员账号不可删除" });
    return;
  }
  await db.prepare("UPDATE app_accounts SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  await writeAudit("delete", "account", String(id), row.username);
  res.json({ ok: true });
});

app.get("/api/address-book", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM address_book WHERE deleted_at IS NULL ORDER BY id DESC").all();
  res.json(rows.map(mapAddressBook));
});

app.post("/api/address-book", async (req, res) => {
  const item = normalizeAddressBookPayload(req.body);
  if (!item.address) {
    res.status(400).json({ message: "请填写详细地址" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO address_book (area, contact, phone, address, note)
    VALUES (@area, @contact, @phone, @address, @note)
  `).run(item);
  await writeAudit("create", "address_book", String(result.lastInsertId), item.address);
  res.status(201).json(mapAddressBook(await db.prepare("SELECT * FROM address_book WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/address-book/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await db.prepare("SELECT * FROM address_book WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!existing) {
    res.status(404).json({ message: "地址不存在或已删除" });
    return;
  }
  const item = normalizeAddressBookPayload(req.body);
  if (!item.address) {
    res.status(400).json({ message: "请填写详细地址" });
    return;
  }
  await db.prepare(`
    UPDATE address_book
    SET area = @area,
        contact = @contact,
        phone = @phone,
        address = @address,
        note = @note,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id, ...item });
  await writeAudit(
    "update",
    "address_book",
    String(id),
    auditChangeSummary(existing, item, [
      { key: "area", label: "片区" },
      { key: "contact", label: "联系人" },
      { key: "phone", label: "电话" },
      { key: "address", label: "地址" },
      { key: "note", label: "备注" }
    ], { entityLabel: "地址" })
  );
  res.json(mapAddressBook(await db.prepare("SELECT * FROM address_book WHERE id = ?").get(id)));
});

app.delete("/api/address-book/:id", async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare("SELECT * FROM address_book WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) {
    res.status(404).json({ message: "地址不存在或已删除" });
    return;
  }
  await db.prepare("UPDATE address_book SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  await writeAudit("delete", "address_book", String(id), row.address);
  res.json({ ok: true });
});

app.post("/api/address-book/batch-delete", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (ids.length === 0) {
    res.status(400).json({ message: "请先勾选地址" });
    return;
  }
  const deleteOne = await db.prepare("UPDATE address_book SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL");
  const transaction = db.transaction(async (items) => {
    for (const id of items) {
      await deleteOne.run(id);
    }
  });
  await transaction(ids);
  await writeAudit("delete", "address_book", ids.join(","), `批量删除 ${ids.length} 条地址`);
  res.json({ ok: true, count: ids.length });
});

app.get("/api/address-history-hidden", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM hidden_history_addresses ORDER BY created_at DESC").all();
  res.json(rows.map((row) => ({
    key: row.address_key,
    address: row.address,
    createdAt: row.created_at
  })));
});

app.post("/api/address-history-hidden", async (req, res) => {
  const address = String(req.body.address || "").trim();
  const key = addressHistoryKey(req.body.key || address);
  if (!address || !key) {
    res.status(400).json({ message: "地址不能为空" });
    return;
  }
  await db.prepare(`
    INSERT INTO hidden_history_addresses (address_key, address)
    VALUES (@key, @address)
    ON CONFLICT(address_key) DO UPDATE SET address = excluded.address
  `).run({ key, address });
  await writeAudit("delete", "address_history", key, address);
  res.status(201).json({ key, address });
});

app.get("/api/audit-logs", async (req, res) => {
  const requestedPage = Number(req.query.page || 1);
  const requestedPageSize = Number(req.query.pageSize || 100);
  const pageSize = Math.min(1000, Math.max(1, Number.isFinite(requestedPageSize) ? Math.floor(requestedPageSize) : 100));
  const totalRow = await db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get();
  const total = Number(totalRow?.count || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1), totalPages);
  const offset = (page - 1) * pageSize;
  const rows = total > 0
    ? await db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?").all(pageSize, offset)
    : [];
  res.json({
    items: rows.map(mapAuditLog),
    page,
    pageSize,
    total,
    totalPages
  });
});

function normalizeLocationEntriesForBackfill(currentValue, fallbackText = "") {
  const currentEntries = normalizeLocationEntries(currentValue, "", { parseLegacy: false });
  if (currentEntries.length) return currentEntries;
  return splitLegacyLocationEntries(fallbackText);
}

function backfillDispatchRowLocation(row = {}, target = "") {
  const camelKey = `${target}Locations`;
  const snakeKey = `${target}_locations`;
  const currentValue = hasOwnValue(row, camelKey) ? row[camelKey] : row[snakeKey];
  const entries = normalizeLocationEntriesForBackfill(currentValue, row[target]);
  if (!entries.length) return { row, changed: false };
  const nextText = composeLocationEntriesText(entries) || userRawMultilineTextValue(row[target]);
  const next = {
    ...row,
    [target]: nextText,
    [camelKey]: entries
  };
  if (hasOwnValue(next, snakeKey)) delete next[snakeKey];
  const changed = JSON.stringify(row[camelKey] || []) !== JSON.stringify(entries)
    || String(row[target] || "") !== nextText
    || hasOwnValue(row, snakeKey);
  return { row: next, changed };
}

function backfillDispatchRowLocations(row = {}) {
  let changed = false;
  let next = row && typeof row === "object" && !Array.isArray(row) ? { ...row } : {};
  ["loading", "unloading"].forEach((target) => {
    const result = backfillDispatchRowLocation(next, target);
    next = result.row;
    changed = changed || result.changed;
  });
  return { row: next, changed };
}

async function backfillOrderLocationColumns() {
  const rows = await db.prepare(`
    SELECT no, loading, loading_locations, unloading, unloading_locations
    FROM orders
    WHERE deleted_at IS NULL
      AND (
        (COALESCE(loading, '') <> '' AND COALESCE(NULLIF(loading_locations, ''), '[]') = '[]')
        OR (COALESCE(unloading, '') <> '' AND COALESCE(NULLIF(unloading_locations, ''), '[]') = '[]')
      )
  `).all();
  if (!rows.length) return 0;

  const update = await db.prepare(`
    UPDATE orders
    SET loading = @loading,
        loading_locations = @loadingLocationsJson,
        unloading = @unloading,
        unloading_locations = @unloadingLocationsJson
    WHERE no = @no
  `);
  let changed = 0;
  const transaction = db.transaction(async (items) => {
    for (const row of items) {
      const loadingLocations = normalizeLocationEntriesForBackfill(row.loading_locations, row.loading);
      const unloadingLocations = normalizeLocationEntriesForBackfill(row.unloading_locations, row.unloading);
      const loading = composeLocationEntriesText(loadingLocations) || userRawMultilineTextValue(row.loading);
      const unloading = composeLocationEntriesText(unloadingLocations) || userRawMultilineTextValue(row.unloading);
      await update.run({
        no: row.no,
        loading,
        loadingLocationsJson: locationEntriesJson(loadingLocations),
        unloading,
        unloadingLocationsJson: locationEntriesJson(unloadingLocations)
      });
      changed += 1;
    }
  });
  await transaction(rows);
  return changed;
}

async function backfillDispatchPlanLocationRows() {
  const plans = await db.prepare("SELECT plan_date, rows_json FROM dispatch_plans").all();
  if (!plans.length) return 0;
  const update = await db.prepare(`
    UPDATE dispatch_plans
    SET rows_json = @rowsJson,
        updated_at = CURRENT_TIMESTAMP
    WHERE plan_date = @planDate
  `);
  let changed = 0;
  const transaction = db.transaction(async (items) => {
    for (const plan of items) {
      const rows = parseDispatchPlanRowsJson(plan.rows_json);
      let planChanged = false;
      const nextRows = rows.map((row) => {
        const result = backfillDispatchRowLocations(row);
        planChanged = planChanged || result.changed;
        return result.row;
      });
      if (!planChanged) continue;
      await update.run({
        planDate: plan.plan_date,
        rowsJson: JSON.stringify(nextRows)
      });
      changed += 1;
    }
  });
  await transaction(plans);
  return changed;
}

async function backfillStructuredLocationData() {
  const orderCount = await backfillOrderLocationColumns();
  const planCount = await backfillDispatchPlanLocationRows();
  if (orderCount || planCount) {
    console.log(`Backfilled structured loading/unloading locations: orders=${orderCount}, dispatch_plans=${planCount}`);
  }
}

if (startupDatabaseMaintenanceEnabled) {
  try {
    await backfillStructuredLocationData();
    await migrateDatabaseFilesToOss();
  } catch (error) {
    console.error("Startup database maintenance failed", error);
    process.exit(1);
  }
} else {
  console.log("Startup database maintenance is disabled; skipping database backfills and file OSS migration.");
}

const server = http.createServer(app);
realtimeHub = createRealtimeHub({
  server,
  authenticate: authenticateRealtimeToken
});
listenRealtimeEvents((event) => realtimeHub?.broadcast(event));

server.listen(port, () => {
  console.log(`Hanye API listening on http://127.0.0.1:${port}`);
  console.log(`PostgreSQL database: ${databaseInfo}`);
});
