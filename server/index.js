import cors from "cors";
import ExcelJS from "exceljs";
import express from "express";
import OSS from "ali-oss";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import {
  ACCOUNT_ROLES,
  accountPermissionsForRole,
  allowedModulesForRole,
  canAccessModule,
  hashPassword,
  normalizeAccountRole,
  roleLevelFor,
  verifyPassword
} from "./auth.js";
import PDFDocument from "pdfkit";
import { db, databaseInfo, withAdvisoryLock, writeAudit as writeAuditRecord } from "./db.js";

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
  { extensions: [".pdf"], mimes: ["application/pdf"] }
];
const PREVIEW_MIMES = new Set(SAFE_FILE_TYPES.flatMap((item) => item.mimes));
const AUTH_TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 7 * 24 * 60 * 60);
const VEHICLE_PROFIT_EXCHANGE_RATE_MODULES = ["bossVehicleProfit", "bossSupplierProfit", "bossDashboard", "bossCompanyProfit", "financeWages", "financeSupplierStatements", "financeCustomsStatements"];
const COMPANY_EXPENSE_MODULES = ["bossCompanyExpenses", "bossDashboard", "bossCompanyProfit"];
const AUTH_SECRET = process.env.HANYE_AUTH_SECRET || process.env.AUTH_SECRET || "hanye-system-local-dev-secret";
const VEHICLE_EXPENSE_TYPES = new Set(["fuel", "repair", "annual", "other"]);
const VEHICLE_ANNUAL_EXPENSE_NAMES = new Set(["保险费", "年审费", "牌头费"]);
const VEHICLE_PROFIT_DEFAULT_EXCHANGE_RATE = 0.88;
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

function auditActorFromAccount(account = {}) {
  return String(account.name || account.displayName || account.username || "").trim() || "admin";
}

async function writeAudit(action, entityType, entityId, detail = "") {
  await writeAuditRecord(action, entityType, entityId, detail, auditActorContext.getStore() || "admin");
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

function requestHasAdminOrderDeletePermission(req) {
  return normalizeAccountRole(req.account?.role) === "管理员";
}

function requestCanManageOrderAudit(req) {
  return normalizeAccountRole(req.account?.role) === "财务";
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
    customsExportPageFee: 30
  };
  return {
    id: row.id,
    type: row.type,
    customerCategory,
    name: row.name,
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

function normalizeCustomerPayload(body, id = "") {
  const invoice = body.invoice || {};
  const numericOrDefault = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const name = String(body.name || "").trim();
  const address = String(body.address || invoice.address || "").trim();
  const taxNo = String(body.taxNo || invoice.taxNo || "").trim();
  const type = body.type === "供应商" ? "供应商" : "客户";
  const customerCategory = type === "客户" && (body.customerCategory || body.customer_category) === "报关客户" ? "报关客户" : type === "客户" ? "运输客户" : "";
  const settlementCurrency = String(body.settlementCurrency || "").trim();
  return {
    id,
    type,
    customerCategory,
    name,
    province: String(body.province || "广东省").trim(),
    city: String(body.city || "深圳市").trim(),
    address,
    term: String(body.term || "月结30天").trim(),
    settlementCurrency: type === "客户" ? (settlementCurrency || "人民币结算") : "",
    taxNo,
    contact: String(body.contact || "").trim(),
    mobile: String(body.mobile || "").trim(),
    driverWageAdjustHKD: Number(body.driverWageAdjustHKD || 0),
    defaultTemplateId: String(body.defaultTemplateId || "").trim(),
    receivableRMB: Number(body.receivableRMB || 0),
    receivableHKD: Number(body.receivableHKD || 0),
    recentOrder: String(body.recentOrder || "-").trim(),
    customsHomeItemCount: numericOrDefault(body.customsHomeItemCount ?? body.customs_home_item_count, 6),
    customsPageItemCount: numericOrDefault(body.customsPageItemCount ?? body.customs_page_item_count, 14),
    customsImportHomeFee: numericOrDefault(body.customsImportHomeFee ?? body.customs_import_home_fee, 100),
    customsExportHomeFee: numericOrDefault(body.customsExportHomeFee ?? body.customs_export_home_fee, 150),
    customsImportPageFee: numericOrDefault(body.customsImportPageFee ?? body.customs_import_page_fee, 30),
    customsExportPageFee: numericOrDefault(body.customsExportPageFee ?? body.customs_export_page_fee, 30),
    createdAt: body.createdAt || todayInputValue(),
    invoiceTitle: String(body.invoiceTitle || invoice.title || name).trim(),
    invoiceTaxNo: String(body.invoiceTax || invoice.taxNo || taxNo).trim(),
    invoiceBank: String(body.invoiceBank || invoice.bank || "").trim(),
    invoiceAccount: String(body.invoiceAccount || invoice.account || "").trim(),
    invoiceAddressPhone: String(body.invoiceAddressPhone || invoice.addressPhone || address).trim()
  };
}

function mapOrder(row) {
  const createdByName = row.created_by_display_name || row.created_by_username || "";
  return {
    no: row.no,
    dispatchNo: row.dispatch_no || "",
    customerId: row.customer_id,
    customer: row.customer,
    businessType: row.business_type,
    port: row.port,
    direction: row.direction,
    tonnage: row.tonnage,
    currency: row.currency,
    quantity: row.quantity,
    weight: row.weight,
    vehicleSource: row.vehicle_source,
    supplier: row.supplier,
    plate: row.plate || "",
    driver: row.driver || "",
    hkDriver: row.hk_driver || "",
    mainlandDriver: row.mainland_driver || "",
    transportMode: normalizeTransportMode(row.transport_mode || ""),
    loading: row.loading,
    unloading: row.unloading,
    date: row.order_date,
    receivableHKD: row.receivable_hkd,
    receivableRMB: row.receivable_rmb,
    status: row.status,
    createdByAccountId: row.created_by_account_id || null,
    createdByUsername: row.created_by_username || "",
    createdByName,
    remark: row.remark || "",
    tripNoEnabled: Boolean(row.trip_no_enabled),
    tripNo: row.trip_no || "",
    sixSheetEnabled: Boolean(row.six_sheet_enabled),
    sixSheetNo: row.six_sheet_no || "",
    fees: []
  };
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

function normalizeExportTemplate(template = null) {
  if (!template || template.type !== "visual-export-template") return null;
  const fallbackColumns = ORDER_EXPORT_COLUMNS.map(([label, key, width]) => ({ label, key, width }));
  const columns = Array.isArray(template.columns) && template.columns.length
    ? template.columns
    : fallbackColumns;
  const headerTextColor = validHexColor(template.headerTextColor, "#17233c");
  const footerTextColor = validHexColor(template.footerTextColor, "#64748b");
  const headerTextItems = Array.isArray(template.headerTextItems) ? template.headerTextItems : [];
  const footerTextItems = Array.isArray(template.footerTextItems) && template.footerTextItems.length
    ? template.footerTextItems
    : (template.footer ? [{
      text: template.footer,
      x: 0,
      y: 0,
      fontSize: template.footerFontSize || 9,
      color: footerTextColor,
      bold: false
    }] : []);
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
    rule.extensions.includes(extension) && rule.mimes.includes(normalizedMime)
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
  if (!rule) return { error: "不支持的文件类型，请上传图片或 PDF 文件" };
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
  return ossClient.signatureUrl(row.object_key, {
    expires: OSS_SIGNED_URL_EXPIRES_SECONDS,
    response: {
      "content-disposition": contentDispositionHeader(disposition, row.filename)
    }
  });
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
  const parts = textValue(value)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 2 ? parts.slice(0, 2).join(" / ") : textValue(value);
}

function formatExportAmount(value, emptyZero = true) {
  const amount = Number(value || 0);
  if (!amount && emptyZero) return "";
  return amount ? amount.toLocaleString("zh-Hans-CN") : "0";
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

function feeDisplayForColumn(order, column) {
  const rows = feeRowsForColumn(order, column);
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
  const feeName = textValue(column?.feeName || column?.label).trim();
  const feeCurrency = exportFeeItemCurrencyForColumn(column);
  const normalizedColumnCurrency = normalizeFeeCurrency(feeCurrency);
  if (!feeItemId && !feeName) return [];
  return fees.filter((fee) => {
    const name = textValue(fee.name).trim();
    const itemId = textValue(fee.feeItemId || fee.fee_item_id).trim();
    const currencyMatches = !feeCurrency || normalizeFeeCurrency(fee.currency) === normalizedColumnCurrency;
    if (feeItemId && itemId) return itemId === feeItemId && currencyMatches;
    return name === feeName && currencyMatches;
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
    || /金额|应收|港币|人民币|运费|税金|过磅费|停车费|登记费|等候费|装货费|卸货费/.test(label);
}

function exportOrderColumnAmount(order, column) {
  const key = textValue(column?.key);
  if (key === "__sequence") return 0;
  if (key === "__hkdTotal") return Number(order?.receivableHKD || 0);
  if (key === "__rmbTotal") return Number(order?.receivableRMB || 0);
  if (key.startsWith("fee-item-")) return feeAmountForColumn(order, column);
  if (key === "receivableHKD" || key === "receivableRMB") return Number(order?.[key] || 0);
  return Number(order?.[key] || 0);
}

function exportOrderColumnValue(order, column, rowIndex = 0) {
  const key = textValue(column?.key);
  if (key === "__sequence") return rowIndex + 1;
  if (key === "__hkdTotal") return formatExportAmount(order?.receivableHKD);
  if (key === "__rmbTotal") return formatExportAmount(order?.receivableRMB);
  if (key === "loading" || key === "unloading") return shortLocationValue(order?.[key]);
  if (key.startsWith("fee-item-")) return feeDisplayForColumn(order, column);
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

function exportTotalAmountForColumn(orders, column, exchange = null) {
  const key = textValue(column?.key);
  const hkdTotal = orders.reduce((sum, order) => sum + Number(order?.receivableHKD || 0), 0);
  const rmbTotal = orders.reduce((sum, order) => sum + Number(order?.receivableRMB || 0), 0);
  if (exchange?.mode === "hkd-to-rmb" && (key === "__rmbTotal" || key === "receivableRMB")) {
    return rmbTotal + (hkdTotal * exchange.rate);
  }
  if (exchange?.mode === "rmb-to-hkd" && (key === "__hkdTotal" || key === "receivableHKD")) {
    return hkdTotal + (rmbTotal / exchange.rate);
  }
  return orders.reduce((sum, order) => sum + exportOrderColumnAmount(order, column), 0);
}

function exportTotalRow(orders, columns, exchangeInput = null) {
  const exchange = normalizeExportExchange(exchangeInput);
  return columns.map((column, index) => {
    if (index === 0) return "合计";
    if (!isExportAmountColumn(column)) return "";
    return formatExportAmount(exportTotalAmountForColumn(orders, column, exchange), false);
  });
}

function exportOrderNoForSort(order = {}) {
  return textValue(order?.no || order?.orderNo || order?.order_no).trim();
}

function sortOrdersForExport(orders = []) {
  return [...orders];
}

function exportTableRows(orders, columns, exchange = null) {
  const sortedOrders = sortOrdersForExport(orders);
  const rows = sortedOrders.map((order, rowIndex) => columns.map((column) => exportOrderColumnValue(order, column, rowIndex)));
  return [...rows, exportTotalRow(sortedOrders, columns, exchange)];
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

function exportColumnsForOrders(templatePayload = null, orders = []) {
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
  return [
    sequenceColumn || { ...ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN },
    ...mergeExportColumnsByTemplateOrder(
      templateBodyColumns,
      bodyColumns,
      dynamicColumns
    ),
    ...totalColumns
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
  const footerItems = template?.footerTextItems?.length
    ? template.footerTextItems
    : (template ? [{ text: template.footer || "制表人：{{user}}" }] : []);
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
  const columns = exportColumnsForOrders(templatePayload, orders);
  const headers = columns.map(exportColumnHeaderText);
  const rows = exportTableRows(orders, columns, exchange);
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
  if (key === "date") return 72;
  if (["direction", "currency", "tonnage"].includes(key)) return 50;
  if (["quantity", "weight", "status"].includes(key)) return 68;
  if (["plate", "driver", "hkDriver", "mainlandDriver"].includes(key)) return 82;
  if (["dispatchNo", "no", "sixSheetNo", "tripNo"].includes(key)) return 98;
  if (["customer", "supplier"].includes(key)) return 138;
  if (["loading", "unloading"].includes(key)) return 132;
  if (key === "__hkdTotal" || key === "__rmbTotal" || key === "receivableHKD" || key === "receivableRMB") return 76;
  if (isExportFeeItemColumn(column)) return 112;
  return 118;
}

function exportColumnFluidMaxWidth(column = {}) {
  const key = textValue(column.key);
  if (key === ORDER_EXPORT_SYSTEM_SEQUENCE_COLUMN.key) return 42;
  if (["direction", "currency", "tonnage"].includes(key)) return 56;
  if (key === "date") return 76;
  if (key === "customer" || key === "supplier") return 240;
  if (key === "loading" || key === "unloading") return 260;
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

function statementReceiptImageLabel(file = {}) {
  const category = String(file.category || "").trim();
  if (category.startsWith("收费项目-")) {
    const name = category.replace(/^收费项目-/, "").trim();
    if (name) return name;
  }
  return "订单附件";
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

function fitImageBox(imageWidth, imageHeight, maxWidth = 160, maxHeight = 140) {
  const width = Math.max(1, Number(imageWidth || 1));
  const height = Math.max(1, Number(imageHeight || 1));
  const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio)
  };
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
  const rows = await db.prepare(`
    SELECT *
    FROM files
    WHERE deleted_at IS NULL
      AND entity_type = 'order'
      AND entity_id IN (${placeholders})
    ORDER BY entity_id ASC, created_at ASC, id ASC
  `).all(...orderNos);
  return rows
    .map((row) => ({ ...row, extension: statementReceiptImageExtension(row), order: orderMeta.get(String(row.entity_id || "").trim()) || null }))
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
    return buffer;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function addStatementReceiptSheet(workbook, orders = []) {
  const receiptRows = await loadOrderReceiptImageRows(orders);
  const worksheet = workbook.addWorksheet("票据");
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
    { width: 26 },
    { width: 26 },
    { width: 26 }
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
        worksheet.getColumn(index).width = 26;
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
    files.forEach((file, itemIndex) => {
      const startColumn = 1 + itemIndex;
      const titleCell = worksheet.getCell(titleRowNumber, startColumn);
      titleCell.value = statementReceiptImageLabel(file);
      titleCell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: excelArgb("#334155") } };
      titleCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelArgb("#f8fafc") } };
      titleCell.border = { top: border, left: border, bottom: border, right: border };
    });
    for (let itemIndex = 0; itemIndex < files.length; itemIndex += 1) {
      const file = files[itemIndex];
      const startColumn = 1 + itemIndex;
      const imageBuffer = await fetchReceiptImageBuffer(file);
      if (!imageBuffer) {
        const imageCell = worksheet.getCell(imageRowNumber, startColumn);
        imageCell.value = "图片读取失败";
        imageCell.font = { name: "Microsoft YaHei", size: 10, color: { argb: excelArgb("#dc2626") } };
        imageCell.alignment = { vertical: "middle", horizontal: "center" };
        imageCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: excelArgb("#fff1f2") } };
        imageCell.border = { top: border, left: border, bottom: border, right: border };
        rowHeights.push(72);
        continue;
      }
      const dims = statementImageDimensions(imageBuffer, file.extension) || { width: 4, height: 3 };
      const box = fitImageBox(dims.width, dims.height, 180, 160);
      const imageId = workbook.addImage({
        buffer: imageBuffer,
        extension: file.extension
      });
      worksheet.addImage(imageId, {
        tl: { col: startColumn - 1 + 0.08, row: imageRowNumber - 1 + 0.12 },
        ext: { width: box.width, height: box.height },
        editAs: "oneCell"
      });
      rowHeights.push(box.height + 18);
    }
    worksheet.getRow(titleRowNumber).height = 22;
    worksheet.getRow(imageRowNumber).height = Math.max(88, ...rowHeights);
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
  const columns = exportColumnsForOrders(templatePayload, orders);
  const headers = columns.map(exportColumnHeaderText);
  const rows = exportTableRows(orders, columns, exchange);
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

  const sortedOrders = sortOrdersForExport(orders);
  rows.forEach((rowValues, rowIndex) => {
    const isTotalRow = rowIndex === rows.length - 1;
    const sourceOrder = sortedOrders[rowIndex] || null;
    const row = worksheet.getRow(tableStartRow + 1 + rowIndex);
    const excelRowValues = rowValues.map(excelSingleLineValue);
    row.values = excelRowValues;
    row.height = Math.max(22, tableFontSize * 1.9 + 12);
    row.eachCell((cell, columnNumber) => {
      const column = columns[columnNumber - 1] || {};
      if (isExportAmountColumn(column)) {
        const amount = isTotalRow
          ? exportTotalAmountForColumn(sortedOrders, column, exchange)
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
        bold: isTotalRow || Boolean(template?.tableBold),
        color: { argb: excelArgb(template?.tableTextColor || "#17233c") }
      };
      if (isTotalRow) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: excelArgb(template?.tableHeaderBgColor || "#f1f5f9") }
        };
      }
      cell.alignment = { vertical: "middle", horizontal: excelAlignment(template?.tableAlign), wrapText: false };
      if (!isTotalRow && sourceOrder) {
        const comment = exportOrderColumnComment(sourceOrder, column);
        if (comment) {
          cell.note = comment;
        }
      }
      cell.border = tableBorder;
    });
  });

  const footerItems = template?.footerTextItems?.length
    ? template.footerTextItems
    : (template ? [{ text: template.footer || "制表人：{{user}}", color: template.footerTextColor, fontSize: template.footerFontSize }] : []);
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

function renderOrdersExcelHtml(orders, title = "订单导出", templatePayload = null, exchange = null) {
  const template = normalizeExportTemplate(templatePayload);
  const columns = exportColumnsForOrders(templatePayload, orders);
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
  const footerItems = template?.footerTextItems?.length
    ? template.footerTextItems
    : (template ? [{ text: template.footer || "制表人：{{user}}", color: template.footerTextColor, fontSize: template.footerFontSize }] : []);
  const headerHtml = headerItems
    .filter((item) => item?.text)
    .map((item) => `<div class="header-line" style="color:${htmlEscape(item.color || template?.headerTextColor || "#17233c")};font-size:${Number(item.fontSize || template?.headerFontSize || 14)}px;font-weight:${item.bold ? 700 : 400};text-align:${htmlEscape(item.align || "left")};width:${Math.max(80, Math.min(520, Number(item.width || 260)))}px;">${htmlEscape(templateText(item.text, context)).replaceAll("\n", "<br>")}</div>`)
    .join("");
  const logoWidth = template ? Math.max(48, Math.min(180, Number(template.logoWidth || 92))) : 92;
  const logoHeight = template ? Math.max(28, Math.min(120, Number(template.logoHeight || 56))) : 56;
  const logoFit = template?.logoFit === "cover" ? "cover" : "contain";
  const logoHtml = template?.logo && dataUrlBuffer(template.logo)
    ? `<td class="header-logo-cell" style="width:${logoWidth + 16}px;"><img class="header-logo" src="${htmlEscape(template.logo)}" style="width:${logoWidth}px;height:${logoHeight}px;object-fit:${logoFit};" alt="logo"></td>`
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
  const tableRows = exportTableRows(orders, columns, exchange);
  const rowsHtml = tableRows.map((row, rowIndex) => `
    <tr${rowIndex === tableRows.length - 1 ? ' class="total-row"' : ""}>
      ${row.map((value) => `<td>${htmlEscape(value)}</td>`).join("")}
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

async function loadExportOrders(orderNos = []) {
  if (orderNos.length > 0) {
    const placeholders = orderNos.map(() => "?").join(",");
    const rows = await db.prepare(`
      SELECT * FROM orders
      WHERE deleted_at IS NULL AND no IN (${placeholders})
      ORDER BY order_date DESC, no DESC
    `).all(...orderNos);
    const orderIndex = new Map(orderNos.map((no, index) => [no, index]));
    const hydrated = await hydrateOrderFees(rows.map(mapOrder));
    return hydrated.sort((a, b) => (orderIndex.get(a.no) ?? 0) - (orderIndex.get(b.no) ?? 0));
  }
  const rows = await db.prepare("SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY order_date DESC, no DESC").all();
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
    category: String(fee.category || "正常").trim() || "正常",
    feeItemId: String(fee.feeItemId || fee.fee_item_id || "").trim(),
    driverRole: String(fee.driverRole || fee.driver_role || "").trim(),
    driverName: String(fee.driverName || fee.driver_name || "").trim(),
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
  snapshot.port = String(snapshot.port || order.port || "");
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
  const sourceColumns = exportColumnsForOrders(templatePayload, orders);
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
      const logoBuffer = dataUrlBuffer(template.logo);
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

  const sortedOrders = sortOrdersForExport(orders);
  const pdfRows = [
    ...sortedOrders.map((order, rowIndex) => ({ total: false, values: columns.map((column) => exportOrderColumnValue(order, column, rowIndex)) })),
    { total: true, values: exportTotalRow(sortedOrders, columns, exchange) }
  ];
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
      if (rowData.total) {
        doc.rect(x, y, column.width, currentRowHeight).fill(template?.tableHeaderBgColor || "#f1f5f9");
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
    category: row.category,
    name: row.name,
    quantity,
    unitPrice: row.unit_price || 0,
    unitPriceManual: Boolean(row.unit_price_manual),
    currency: row.currency,
    amount: row.amount,
    amountManual: Boolean(row.amount_manual),
    cost: row.cost == null ? null : Number(row.cost || 0),
    costManual: Boolean(row.cost_manual),
    remark: row.remark,
    driverRole: row.driver_role || "",
    driverName: row.driver_name || ""
  };
}

function mapAddressBook(row) {
  return {
    id: row.id,
    area: row.area || "",
    contact: row.contact || "",
    phone: row.phone || "",
    address: row.address || "",
    note: row.note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function mapCustomerContact(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    name: row.name || "",
    gender: row.gender || "",
    title: row.title || "",
    mobile: row.mobile || "",
    phone: row.phone || "",
    area: row.area || "",
    address: row.address || "",
    fax: row.fax || "",
    email: row.email || "",
    wechat: row.wechat || "",
    qq: row.qq || "",
    remark: row.remark || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function normalizeAddressBookPayload(body) {
  return {
    area: String(body.area || "").trim(),
    contact: String(body.contact || "").trim(),
    phone: String(body.phone || "").trim(),
    address: String(body.address || "").trim(),
    note: String(body.note || "").trim()
  };
}

function addressHistoryKey(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function normalizeCustomerContactPayload(body, existing = null) {
  return {
    customerId: String(body.customerId || body.customer_id || existing?.customer_id || "").trim(),
    name: String(body.name || existing?.name || "").trim(),
    gender: String(body.gender || existing?.gender || "").trim(),
    title: String(body.title || existing?.title || "").trim(),
    mobile: String(body.mobile || existing?.mobile || "").trim(),
    phone: String(body.phone || existing?.phone || "").trim(),
    area: String(body.area || existing?.area || "").trim(),
    address: String(body.address || existing?.address || "").trim(),
    fax: String(body.fax || existing?.fax || "").trim(),
    email: String(body.email || existing?.email || "").trim(),
    wechat: String(body.wechat || existing?.wechat || "").trim(),
    qq: String(body.qq || existing?.qq || "").trim(),
    remark: String(body.remark || existing?.remark || "").trim()
  };
}

function mapVehicle(row) {
  return {
    plate: row.plate,
    brand: row.brand,
    model: row.model,
    type: row.vehicle_type,
    purchaseDate: row.purchase_date,
    factoryDate: row.factory_date,
    mainlandReviewDate: row.mainland_review_date,
    hkReviewDate: row.hk_review_date,
    mainlandInsuranceDate: row.mainland_insurance_date,
    hkInsuranceDate: row.hk_insurance_date,
    insuranceReminder: row.insurance_reminder,
    maintenanceReminder: row.maintenance_reminder,
    status: row.status,
    monthlyCost: row.monthly_cost,
    note: row.note
  };
}

function mapVehicleExpense(row) {
  const year = row.expense_year || String(row.start_date || row.expense_date || "").slice(0, 4) || "";
  const startDate = row.start_date || "";
  const endDate = row.end_date || "";
  return {
    id: row.id,
    type: row.expense_type,
    name: row.name || "",
    fuelStation: row.fuel_station || "",
    fuelLiters: Number(row.fuel_liters || 0),
    odometerKm: Number(row.odometer_km || 0),
    plate: row.plate || "",
    date: row.expense_date || "",
    year,
    startDate,
    endDate,
    currency: row.currency || "人民币",
    amount: Number(row.amount || 0),
    note: row.note || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function normalizeVehicleExpenseCurrency(value = "") {
  const text = String(value || "").trim().toUpperCase();
  if (text === "HKD" || text === "港币") return "港币";
  return "人民币";
}

function normalizeVehicleExpensePayload(body = {}, current = null) {
  const type = VEHICLE_EXPENSE_TYPES.has(String(body.type || body.expenseType || current?.expense_type || "fuel"))
    ? String(body.type || body.expenseType || current?.expense_type || "fuel")
    : "fuel";
  const rawName = String(body.name ?? current?.name ?? "").trim();
  const currentYear = Number(current?.expense_year || String(current?.expense_date || "").slice(0, 4) || new Date().getFullYear());
  const yearValue = Number(body.year ?? body.expenseYear ?? current?.expense_year ?? currentYear);
  const year = Number.isInteger(yearValue) && yearValue >= 2000 && yearValue <= 2100 ? yearValue : currentYear || new Date().getFullYear();
  const rawDate = String(body.date || body.expenseDate || current?.expense_date || todayInputValue()).trim();
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
    : rawDate;
  const defaultNames = {
    fuel: "加油记录",
    repair: "维修费",
    annual: "保险费",
    other: ""
  };
  const name = type === "annual"
    ? (VEHICLE_ANNUAL_EXPENSE_NAMES.has(rawName) ? rawName : "保险费")
    : (rawName || defaultNames[type]);
  return {
    type,
    name,
    fuelStation: type === "fuel"
      ? String(body.fuelStation ?? body.fuel_station ?? current?.fuel_station ?? "").trim()
      : "",
    fuelLiters: type === "fuel"
      ? Number(body.fuelLiters ?? body.fuel_liters ?? current?.fuel_liters ?? 0)
      : 0,
    odometerKm: type === "fuel"
      ? Number(body.odometerKm ?? body.odometer_km ?? current?.odometer_km ?? 0)
      : 0,
    plate: String(body.plate ?? current?.plate ?? "").trim(),
    date,
    year: type === "annual" ? annualYear : null,
    startDate,
    endDate,
    currency: normalizeVehicleExpenseCurrency(body.currency ?? current?.currency ?? "人民币"),
    amount: Number(body.amount ?? current?.amount ?? 0),
    note: String(body.note ?? current?.note ?? "").trim()
  };
}

function mapDriver(row) {
  return {
    id: row.id,
    type: row.type || "香港司机",
    name: row.name,
    phone: row.phone,
    idNo: row.id_no,
    license: row.license,
    birthday: row.birthday,
    hireDate: row.hire_date,
    leaveDate: row.leave_date,
    expireAt: row.expire_at,
    status: row.status,
    defaultWage: row.default_wage,
    note: row.note
  };
}

const FEE_ITEM_CATEGORY_OPTIONS = ["正常", "代垫"];
const ORDER_FEE_CATEGORY_OPTIONS = ["正常", "代垫", "公司自费"];
const FEE_ITEM_COST_SOURCE_OPTIONS = ["供应商", "香港司机", "大陆骑师", "公司自费", "其他支出"];

function normalizeFeeItemCategory(value = "", fallback = "正常") {
  const category = String(value || "").trim();
  return FEE_ITEM_CATEGORY_OPTIONS.includes(category) ? category : fallback;
}

function normalizeOrderFeeCategory(value = "", fallback = "正常") {
  const category = String(value || "").trim();
  return ORDER_FEE_CATEGORY_OPTIONS.includes(category) ? category : fallback;
}

function normalizeFeeItemCostSourceToken(value = "") {
  const source = String(value || "").trim();
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
    name: row.name,
    currency: row.currency,
    defaultAmount: row.default_amount,
    defaultDriverRole: row.default_driver_role || "",
    costSource: costSources.join(","),
    costSources,
    sortOrder: row.sort_order
  };
}

function mapFreightRate(row) {
  return {
    id: row.id,
    customerId: row.customer_id || "",
    customerName: row.customer_name || "",
    direction: row.direction,
    level1: row.level1 || row.city || "",
    level2: row.level2 || "",
    level3: row.level3 || "",
    city: row.city,
    tonnage: row.tonnage,
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
    direction: row.direction,
    city: row.city,
    transportMode: normalizeTransportMode(row.transport_mode || "单司机") || "单司机",
    currency: row.currency,
    baseRMB: row.base_rmb,
    baseHKD: row.base_hkd,
    loadPerBoard: row.load_per_board,
    unloadPerBoard: row.unload_per_board,
    crossSeaFee: row.cross_sea_fee,
    addPointFee: row.add_point_fee,
    waitingPerHour: row.waiting_per_hour,
    advanceFeeRates,
    note: row.note
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
    entityName: row.entity_name || "",
    origin: row.origin || "",
    destination: row.destination || "",
    tonnage: row.tonnage || (source === "供应商" ? "3T" : ""),
    currency: row.currency || "港币",
    costValues: normalizeCostCenterValues(row.cost_values, row.currency || "港币"),
    note: row.note || "",
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
    category: String(body.category ?? current?.category ?? "").trim(),
    amount: Number(body.amount ?? current?.amount ?? 0),
    note: String(body.note ?? current?.note ?? "").trim()
  };
}

function readCostCenterRatePayload(body = {}, current = null) {
  const origin = String(body.origin ?? current?.origin ?? "").trim();
  const destination = String(body.destination ?? current?.destination ?? "").trim();
  const source = normalizeCostCenterSource(body.source ?? current?.source ?? "");
  const tonnage = String(body.tonnage ?? current?.tonnage ?? "").trim() || (source === "供应商" ? "3T" : "");
  const fallbackEffectiveDate = current?.effective_date || todayInputValue();
  const entityName = String(body.entityName ?? body.entity_name ?? current?.entity_name ?? "").trim()
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
    note: String(body.note ?? current?.note ?? "").trim(),
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
  return {
    id: row.id,
    key: row.download_key || "",
    downloadKey: row.download_key || "",
    type: row.statement_type || "customer",
    statementType: row.statement_type || "customer",
    entityName: row.entity_name || "全部",
    start: row.start_date || "",
    end: row.end_date || "",
    status: normalizeStatementDownloadStatus(row.status || "已导出"),
    paymentStatus: normalizeStatementPaymentStatus(row.payment_status || "未收款"),
    paymentDate: row.payment_date || "",
    downloadedAt: row.downloaded_at || row.updated_at || row.created_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function mapCustomsBusiness(row) {
  return {
    id: row.id,
    date: row.business_date || "",
    declarationNo: row.declaration_no || "",
    sixSheetNo: row.six_sheet_no || "",
    company: row.company || "",
    direction: row.direction || "",
    itemCount: Number(row.item_count || 0),
    pageCount: Number(row.page_count || 0),
    customsFee: Number(row.customs_fee || 0),
    pageFee: Number(row.page_fee || 0),
    manifestFee: Number(row.manifest_fee || 0),
    inspectionFee: Number(row.inspection_fee || 0),
    checkFee: Number(row.check_fee || 0),
    verificationFee: Number(row.verification_fee || 0),
    otherFee: Number(row.other_fee || 0),
    customFields: normalizeCustomsBusinessCustomFields(row.custom_fields),
    total: Number(row.total || 0),
    remark: row.remark || "",
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
  { field: "hk_insurance_date", camelField: "hkInsuranceDate", label: "香港保险", type: "hkInsurance" }
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
  { key: "company", label: "公司", width: 28, pdfWidth: 110 },
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
  return String(value || "").trim() || "未填写公司";
}

function customsStatementFilename(company = "公司", start = "", end = "", extension = "xlsx") {
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
const CUSTOMS_STATEMENT_INNER_BORDER = { style: "thin", color: { argb: "FFD1D5DB" } };
const CUSTOMS_STATEMENT_HEADER_BORDER = { style: "thin", color: { argb: "FF9CA3AF" } };

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
  const border = {
    bottom: isTotal || rowNumber === tableEndRow ? CUSTOMS_STATEMENT_OUTER_BORDER : CUSTOMS_STATEMENT_INNER_BORDER
  };
  if (isFirstColumn) border.left = CUSTOMS_STATEMENT_OUTER_BORDER;
  if (isLastColumn) border.right = CUSTOMS_STATEMENT_OUTER_BORDER;
  if (isTotal) border.top = CUSTOMS_STATEMENT_OUTER_BORDER;
  return border;
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
  titleCell.font = { name: "Microsoft YaHei", size: 15, bold: true, color: { argb: "FF17233C" } };
  titleCell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
  worksheet.getRow(1).height = 28;

  worksheet.mergeCells(2, 1, 2, mergeEndColumn);
  const metaCell = worksheet.getCell(2, 1);
  metaCell.value = `公司：${context.company || ""}    范围：${context.rangeLabel || "全部"}    记录：${rows.length} 条`;
  metaCell.font = { name: "Microsoft YaHei", size: 9, color: { argb: "FF64748B" } };
  metaCell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
  worksheet.getRow(2).height = 22;

  const tableStartRow = 4;
  const bodyRows = [...customsStatementExportRows(rows, columns), customsStatementTotalRow(rows, columns)];
  const tableEndRow = tableStartRow + bodyRows.length;
  const headerRow = worksheet.getRow(tableStartRow);
  headerRow.values = columns.map((column) => column.label);
  headerRow.height = 34;
  for (let columnNumber = 1; columnNumber <= mergeEndColumn; columnNumber += 1) {
    const cell = headerRow.getCell(columnNumber);
    cell.font = { name: "Microsoft YaHei", size: 8, bold: true, color: { argb: "FF1F2A44" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = customsStatementTableBorder(tableStartRow, columnNumber, tableStartRow, tableEndRow, mergeEndColumn);
  }

  bodyRows.forEach((values, rowIndex) => {
    const isTotalRow = rowIndex === bodyRows.length - 1;
    const rowNumber = tableStartRow + 1 + rowIndex;
    const row = worksheet.getRow(rowNumber);
    row.values = values.map(excelSingleLineValue);
    row.height = 22;
    for (let columnNumber = 1; columnNumber <= mergeEndColumn; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      const column = columns[columnNumber - 1] || {};
      if (column.amount && cell.value !== "") cell.numFmt = "#,##0.##";
      cell.font = { name: "Microsoft YaHei", size: 8, bold: isTotalRow, color: { argb: "FF17233C" } };
      cell.alignment = {
        vertical: "middle",
        horizontal: column.amount ? "right" : (column.align || "left"),
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
      `公司：${context.company || ""}    范围：${context.rangeLabel || "全部"}    记录：${rows.length} 条`,
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

function normalizeCustomsBusinessCustomFields(value = []) {
  const source = Array.isArray(value) ? value : parseJsonArrayText(value);
  const fieldsByName = new Map();
  source.forEach((field) => {
    const name = String(field?.name ?? field?.label ?? field?.key ?? "").trim();
    if (!name) return;
    const amount = numberField(field?.value ?? field?.amount ?? field?.fee);
    fieldsByName.set(name, {
      name,
      value: numberField((fieldsByName.get(name)?.value || 0) + amount)
    });
  });
  return Array.from(fieldsByName.values()).slice(0, 40);
}

function customsBusinessCustomFieldsTotal(fields = []) {
  return normalizeCustomsBusinessCustomFields(fields).reduce((sum, field) => sum + numberField(field.value), 0);
}

function normalizeCustomsBusinessPayload(body = {}) {
  const homeFee = numberField(body.homeFee ?? body.home_fee);
  const customsFee = numberField(body.customsFee ?? body.customs_fee);
  const pageFee = numberField(body.pageFee ?? body.page_fee);
  const manifestFee = numberField(body.manifestFee ?? body.manifest_fee);
  const inspectionFee = numberField(body.inspectionFee ?? body.inspection_fee);
  const checkFee = numberField(body.checkFee ?? body.check_fee);
  const verificationFee = numberField(body.verificationFee ?? body.verification_fee);
  const otherFee = numberField(body.otherFee ?? body.other_fee);
  const customFields = normalizeCustomsBusinessCustomFields(body.customFields ?? body.custom_fields);
  const computedTotal = homeFee + customsFee + pageFee + manifestFee + inspectionFee + checkFee + verificationFee
    + customsBusinessCustomFieldsTotal(customFields);
  return {
    date: normalizeCustomsBusinessDate(body.date ?? body.businessDate ?? body.business_date),
    declarationNo: String(body.declarationNo ?? body.declaration_no ?? "").trim(),
    sixSheetNo: String(body.sixSheetNo ?? body.six_sheet_no ?? "").trim(),
    company: String(body.company ?? "").trim(),
    direction: String(body.direction ?? "").trim(),
    itemCount: numberField(body.itemCount ?? body.item_count),
    pageCount: numberField(body.pageCount ?? body.page_count),
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
    remark: String(body.remark ?? "").trim()
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
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    value: row.value,
    sortOrder: row.sort_order
  };
}

function mapAccount(row) {
  const role = normalizeAccountRole(row.role);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    name: row.display_name,
    role,
    roleLevel: roleLevelFor(role),
    status: row.status,
    hireDate: row.hire_date || "",
    phone: row.phone || "",
    email: row.email || "",
    note: row.note || "",
    permissions: accountPermissionsForRole(role),
    allowedModules: allowedModulesForRole(role),
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
  `).all(`${prefix}%`);
  return nextBusinessNoFromRows(prefix, rows);
}

async function nextDispatchNo(date = todayInputValue()) {
  const prefix = businessNoPrefix("PC", date);
  const orderRows = await db.prepare(`
    SELECT dispatch_no FROM orders
    WHERE dispatch_no LIKE ?
  `).all(`${prefix}%`);
  const plan = await db.prepare("SELECT rows_json FROM dispatch_plans WHERE plan_date = ?").get(normalizeBusinessNoDate(date));
  const planRows = parseDispatchPlanRowsJson(plan?.rows_json)
    .map((row) => ({ dispatch_no: row.dispatchNo }))
    .filter((row) => String(row.dispatch_no || "").startsWith(prefix));
  return nextBusinessNoFromRows(prefix, [...orderRows, ...planRows]);
}

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true, database: databaseInfo, fileStorage: fileStorageProvider });
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
  const permissions = JSON.stringify(accountPermissionsForRole(role));
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

function requiredModuleForRequest(req) {
  const path = req.path;
  if (path.startsWith("/accounts")) return "accounts";
  if (path.startsWith("/audit-logs")) return "security";
  if (path.startsWith("/customers")) return "customers";
  if (path.startsWith("/customer-contacts")) return "customers";
  if (path.startsWith("/orders")) return "orders";
  if (path.startsWith("/customs-businesses")) return "customsBusiness";
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

function authorizeApiRequest(req, res, next) {
  if (req.path.startsWith("/reminders") && req.method === "GET") {
    const canReadReminders = canAccessModule(req.account?.role, "vehicleDriver")
      || canAccessModule(req.account?.role, "dispatchBoard");
    if (!canReadReminders) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/vehicle-profit-exchange-rates")) {
    const canAccessExchangeRates = VEHICLE_PROFIT_EXCHANGE_RATE_MODULES.some((moduleId) => canAccessModule(req.account?.role, moduleId));
    if (!canAccessExchangeRates) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  if (req.path.startsWith("/company-expenses")) {
    const canAccessCompanyExpenses = req.method === "GET"
      ? COMPANY_EXPENSE_MODULES.some((moduleId) => canAccessModule(req.account?.role, moduleId))
      : canAccessModule(req.account?.role, "bossCompanyExpenses");
    if (!canAccessCompanyExpenses) {
      res.status(403).json({ message: "当前账号无权访问该功能" });
      return;
    }
    next();
    return;
  }
  const moduleId = requiredModuleForRequest(req);
  if (moduleId && !canAccessModule(req.account?.role, moduleId)) {
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
  const item = {
    id: req.account.id,
    displayName: String(req.body?.displayName || "").trim(),
    phone: String(req.body?.phone || "").trim(),
    email: String(req.body?.email || "").trim(),
    note: String(req.body?.note || "").trim()
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
  await writeAudit("update", "account_profile", String(req.account.id), req.account.username);
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
  res.json(rows.map(mapCustomsBusiness));
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
    res.status(400).json({ message: "请填写公司名称" });
    return;
  }
  if (!item.declarationNo && !item.sixSheetNo) {
    res.status(400).json({ message: "请填写报关单号或六联单号" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO customs_businesses
      (business_date, declaration_no, six_sheet_no, company, direction, item_count, page_count,
       customs_fee, page_fee, manifest_fee, inspection_fee, check_fee, verification_fee, other_fee, custom_fields, total, remark)
    VALUES
      (@date, @declarationNo, @sixSheetNo, @company, @direction, @itemCount, @pageCount,
       @customsFee, @pageFee, @manifestFee, @inspectionFee, @checkFee, @verificationFee, @otherFee, @customFieldsJson, @total, @remark)
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
    res.status(400).json({ message: "请填写公司名称" });
    return;
  }
  if (!item.declarationNo && !item.sixSheetNo) {
    res.status(400).json({ message: "请填写报关单号或六联单号" });
    return;
  }

  await db.prepare(`
    UPDATE customs_businesses
    SET business_date = @date,
        declaration_no = @declarationNo,
        six_sheet_no = @sixSheetNo,
        company = @company,
        direction = @direction,
        item_count = @itemCount,
        page_count = @pageCount,
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
  await writeAudit("update", "customs_business", String(id), `${item.date}/${item.company}/${item.declarationNo || item.sixSheetNo}`);
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

app.get("/api/files/:id/preview", async (req, res) => sendStoredFile(req, res, "inline"));

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
  const type = req.query.type === "供应商" ? "供应商" : req.query.type === "客户" ? "客户" : null;
  const rows = type
    ? await db.prepare("SELECT * FROM customers WHERE deleted_at IS NULL AND type = ? ORDER BY created_at DESC, id DESC").all(type)
    : await db.prepare("SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC").all();
  res.json(rows.map(mapCustomer));
});

app.patch("/api/customers/:id", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const item = normalizeCustomerPayload(req.body, id);

  if (!item.name) {
    res.status(400).json({ message: "公司名称不能为空" });
    return;
  }

  const result = await db.prepare(`
    UPDATE customers
    SET type = @type,
        customer_category = @customerCategory,
        name = @name,
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
    WHERE id = @id AND deleted_at IS NULL
  `).run(item);
  if (result.changes === 0) {
    res.status(404).json({ message: "客户不存在或已删除" });
    return;
  }
  await writeAudit("update", "customer", id, item.name);
  res.json(mapCustomer(await db.prepare("SELECT * FROM customers WHERE id = ?").get(id)));
});

app.post("/api/customers", async (req, res) => {
  const item = normalizeCustomerPayload(req.body, req.body.id || (await nextCustomerId(req.body.type)));

  if (!item.name) {
    res.status(400).json({ message: "公司名称不能为空" });
    return;
  }

  await db.prepare(`
    INSERT INTO customers
      (id, type, customer_category, name, province, city, address, term, settlement_currency, receivable_rmb, receivable_hkd, recent_order, created_at,
       tax_no, contact, mobile, driver_wage_adjust_hkd, default_template_id,
       invoice_title, invoice_tax_no, invoice_bank, invoice_account, invoice_address_phone,
       customs_home_item_count, customs_page_item_count, customs_import_home_fee, customs_export_home_fee,
       customs_import_page_fee, customs_export_page_fee)
    VALUES
      (@id, @type, @customerCategory, @name, @province, @city, @address, @term, @settlementCurrency, @receivableRMB, @receivableHKD, @recentOrder, @createdAt,
       @taxNo, @contact, @mobile, @driverWageAdjustHKD, @defaultTemplateId,
       @invoiceTitle, @invoiceTaxNo, @invoiceBank, @invoiceAccount, @invoiceAddressPhone,
       @customsHomeItemCount, @customsPageItemCount, @customsImportHomeFee, @customsExportHomeFee,
       @customsImportPageFee, @customsExportPageFee)
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
  await writeAudit("update", "customer_contact", String(id), item.name);
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
  const rows = await db.prepare("SELECT * FROM orders WHERE deleted_at IS NULL ORDER BY order_date DESC, no DESC").all();
  res.json(await hydrateOrderFees(rows.map(mapOrder)));
});

function parseDispatchPlanRowsJson(rowsJson = "[]") {
  try {
    const parsed = JSON.parse(rowsJson || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dispatchRowLookupKeys(row = {}) {
  return [
    row.id && `id:${row.id}`,
    row.dispatchNo && `dispatch:${row.dispatchNo}`,
    row.orderNo && `order:${row.orderNo}`
  ].filter(Boolean);
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

function dispatchRowText(row = {}, key = "") {
  return String(row?.[key] ?? "").trim();
}

function dispatchRowOrderSyncKey(row = {}) {
  return [
    "orderNo",
    "dispatchNo",
    "plate",
    "vehicleSource",
    "supplier",
    "transportMode",
    "driver",
    "hkDriver",
    "mainlandDriver"
  ].map((key) => `${key}:${dispatchRowText(row, key)}`).join("|");
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
    rows: parseDispatchPlanRowsJson(row.rows_json),
    createdByAccountId: row.created_by_account_id || null,
    createdByUsername: row.created_by_username || "",
    createdByName: row.created_by_display_name || row.created_by_username || "",
    updatedAt: row.updated_at || ""
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
        vehicle_source = @vehicleSource,
        supplier = @supplier,
        plate = @plate,
        driver = @driver,
        hk_driver = @hkDriver,
        mainland_driver = @mainlandDriver,
        transport_mode = @transportMode,
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

    await updateOrder.run({
      no: order.no,
      dispatchNo: dispatchNo || order.dispatch_no || "",
      vehicleSource: dispatchRowText(row, "vehicleSource") || order.vehicle_source || "",
      supplier: dispatchRowText(row, "vehicleSource") === "外派车辆" ? dispatchRowText(row, "supplier") : "",
      plate: dispatchRowText(row, "plate"),
      driver,
      hkDriver: isSingleDriver ? "" : (rowHkDriver || rowDriver),
      mainlandDriver: isSingleDriver ? "" : rowMainlandDriver,
      transportMode,
      orderDate: /^\d{4}-\d{2}-\d{2}$/.test(planDate) ? planDate : order.order_date
    });
    synced += 1;
  }

  return synced;
}

async function removeDispatchPlanRowsLinkedToOrder(orderRow = {}) {
  const orderNo = String(orderRow.no || "").trim();
  const dispatchNo = String(orderRow.dispatch_no || orderRow.dispatchNo || "").trim();
  if (!orderNo && !dispatchNo) return 0;

  const plans = await db.prepare("SELECT plan_date, rows_json FROM dispatch_plans").all();
  let removed = 0;
  for (const plan of plans) {
    const rows = parseDispatchPlanRowsJson(plan.rows_json);
    const nextRows = rows.filter((row) => {
      const rowOrderNo = dispatchRowText(row, "orderNo");
      const rowDispatchNo = dispatchRowText(row, "dispatchNo");
      return !(orderNo && rowOrderNo === orderNo) && !(dispatchNo && rowDispatchNo === dispatchNo);
    });
    if (nextRows.length === rows.length) continue;
    removed += rows.length - nextRows.length;
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
  const existingPlan = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(date);
  const existingRowsLookup = dispatchRowLookup(parseDispatchPlanRowsJson(existingPlan?.rows_json));
  const requestCreator = creatorFieldsFromAccount(req.account);
  const rowsNeedingOrderSync = [];
  const cleanRows = rows.map((row) => {
    const item = row && typeof row === "object" ? row : {};
    const existingRow = findExistingDispatchRow(item, existingRowsLookup);
    const creator = dispatchRowCreatorFields(item, existingRow, requestCreator);
    const cleanRow = {
      id: String(item.id || ""),
      dispatchNo: String(item.dispatchNo || ""),
      orderNo: String(item.orderNo || ""),
      customer: String(item.customer || ""),
      plate: String(item.plate || ""),
      port: String(item.port || ""),
      needsWeighing: booleanFlag(item.needsWeighing ?? item.needs_weighing, false),
      direction: String(item.direction || ""),
      tonnage: String(item.tonnage || ""),
      quantity: item.quantity ?? "",
      weight: String(item.weight || ""),
      loading: String(item.loading || ""),
      unloading: String(item.unloading || ""),
      loadTime: String(item.loadTime || ""),
      vehicleSource: String(item.vehicleSource || ""),
      supplier: String(item.supplier || ""),
      transportMode: String(item.transportMode || ""),
      driver: String(item.driver || ""),
      hkDriver: String(item.hkDriver || ""),
      mainlandDriver: String(item.mainlandDriver || ""),
      status: String(item.status || ""),
      previousStatus: String(item.previousStatus || ""),
      createdByAccountId: creator.createdByAccountId,
      createdByUsername: creator.createdByUsername,
      createdByName: creator.createdByName,
      note: String(item.note || "")
    };
    if (dispatchRowNeedsOrderSync(cleanRow, existingRow)) rowsNeedingOrderSync.push(cleanRow);
    return cleanRow;
  });
  const rowsJson = JSON.stringify(cleanRows);
  const planCreator = existingPlan && creatorFieldsHaveValue(creatorFieldsFromRecord(existingPlan))
    ? creatorFieldsFromRecord(existingPlan)
    : requestCreator;
  const transaction = db.transaction(async () => {
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
  });
  await transaction();
  await writeAudit("update", "dispatch_plan", date, `保存 ${cleanRows.length} 条`);
  const saved = await db.prepare("SELECT * FROM dispatch_plans WHERE plan_date = ?").get(date);
  res.json(mapDispatchPlanRecord(saved));
});

app.get("/api/orders/recycle", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM orders WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, order_date DESC").all();
  res.json(await hydrateOrderFees(rows.map(mapOrder)));
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
  const template = req.body.template && typeof req.body.template === "object" ? req.body.template : await exportTemplateById(req.body.templateId);
  const exchange = normalizeExportExchange(req.body.exchange);
  const orders = await loadExportOrdersFromRequest(req.body, orderNos);
  if (orders.length === 0) {
    res.status(400).type("text/plain").send("没有可导出的订单");
    return;
  }
  try {
    const body = await renderOrdersXlsxBuffer(orders, title, template, exchange, {
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
    res.status(403).json({ message: "只有财务可以审核订单" });
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
  res.json(updated);
});

function pickBody(body, camelKey, snakeKey, fallback) {
  if (Object.prototype.hasOwnProperty.call(body, camelKey)) return body[camelKey];
  if (snakeKey && Object.prototype.hasOwnProperty.call(body, snakeKey)) return body[snakeKey];
  return fallback;
}

async function readOrderPayload(body, existing = null) {
  const date = pickBody(body, "date", "order_date", existing?.order_date || todayInputValue());
  const dispatchNo = String(pickBody(body, "dispatchNo", "dispatch_no", existing?.dispatch_no || "") || "").trim();
  return {
    no: existing?.no || body.no || (await nextOrderNo(date)),
    dispatchNo: dispatchNo || (existing ? "" : await nextDispatchNo(date)),
    customerId: pickBody(body, "customerId", "customer_id", existing?.customer_id || null),
    customer: String(pickBody(body, "customer", "customer_name", existing?.customer || "") || "").trim(),
    businessType: String(pickBody(body, "businessType", "business_type", existing?.business_type || "运输") || "运输").trim(),
    port: String(pickBody(body, "port", null, existing?.port || "") || "").trim(),
    direction: String(pickBody(body, "direction", null, existing?.direction || "") || "").trim(),
    tonnage: String(pickBody(body, "tonnage", null, existing?.tonnage || "") || "").trim(),
    currency: String(pickBody(body, "currency", null, existing?.currency || "") || "").trim(),
    quantity: String(pickBody(body, "quantity", null, existing?.quantity || "") || "").trim(),
    weight: String(pickBody(body, "weight", null, existing?.weight || "") || "").trim(),
    vehicleSource: String(pickBody(body, "vehicleSource", "vehicle_source", existing?.vehicle_source || "") || "").trim(),
    supplier: String(pickBody(body, "supplier", null, existing?.supplier || "-") || "-").trim(),
    plate: String(pickBody(body, "plate", null, existing?.plate || "") || "").trim(),
    driver: String(pickBody(body, "driver", null, existing?.driver || "") || "").trim(),
    hkDriver: String(pickBody(body, "hkDriver", "hk_driver", existing?.hk_driver || "") || "").trim(),
    mainlandDriver: String(pickBody(body, "mainlandDriver", "mainland_driver", existing?.mainland_driver || "") || "").trim(),
    transportMode: String(pickBody(body, "transportMode", "transport_mode", existing?.transport_mode || "") || "").trim(),
    loading: String(pickBody(body, "loading", "loading_place", existing?.loading || "") || "").trim(),
    unloading: String(pickBody(body, "unloading", "unloading_place", existing?.unloading || "") || "").trim(),
    date,
    receivableHKD: Number(pickBody(body, "receivableHKD", "hkd_receivable", existing?.receivable_hkd || 0) || 0),
    receivableRMB: Number(pickBody(body, "receivableRMB", "rmb_receivable", existing?.receivable_rmb || 0) || 0),
    status: String(pickBody(body, "status", null, existing?.status || "待确认") || "待确认").trim(),
    remark: String(pickBody(body, "remark", null, existing?.remark || "") || "").trim(),
    tripNoEnabled: pickBody(body, "tripNoEnabled", "trip_no_enabled", existing?.trip_no_enabled || 0) ? 1 : 0,
    tripNo: String(pickBody(body, "tripNo", "trip_no", existing?.trip_no || "") || "").trim(),
    sixSheetEnabled: pickBody(body, "sixSheetEnabled", "six_sheet_enabled", existing?.six_sheet_enabled || 0) ? 1 : 0,
    sixSheetNo: String(pickBody(body, "sixSheetNo", "six_sheet_no", existing?.six_sheet_no || "") || "").trim(),
    fees: Array.isArray(body.fees) ? body.fees : null
  };
}

async function resolveOrderCustomer(item) {
  const customerId = String(item.customerId || "").trim();
  const customerName = String(item.customer || "").trim();
  let customer = null;

  if (customerId) {
    customer = await db.prepare("SELECT id, name FROM customers WHERE id = ? AND deleted_at IS NULL").get(customerId);
  }

  if (!customer && customerName) {
    customer = await db.prepare("SELECT id, name FROM customers WHERE name = ? AND deleted_at IS NULL AND type = '客户'").get(customerName);
  }

  if (!customer) {
    return false;
  }

  item.customerId = customer.id;
  item.customer = customer.name;
  return true;
}

app.post("/api/orders", async (req, res) => {
  const item = await readOrderPayload(req.body);
  Object.assign(item, creatorFieldsFromAccount(req.account));
  item.fees = item.fees || [];
  if (!(await resolveOrderCustomer(item))) {
    res.status(400).json({ message: "请选择有效客户" });
    return;
  }

  if (item.fees.length > 0) {
    Object.assign(item, calculateOrderReceivables(item.fees, item.currency));
  }

  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO orders
        (no, dispatch_no, customer_id, customer, business_type, port, direction, tonnage, currency, quantity,
         weight, vehicle_source, supplier, plate, driver, hk_driver, mainland_driver, transport_mode, loading, unloading, order_date, receivable_hkd,
         receivable_rmb, status, created_by_account_id, created_by_username, created_by_display_name, remark,
         trip_no_enabled, trip_no, six_sheet_enabled, six_sheet_no)
      VALUES
        (@no, @dispatchNo, @customerId, @customer, @businessType, @port, @direction, @tonnage, @currency,
         @quantity, @weight, @vehicleSource, @supplier, @plate, @driver, @hkDriver, @mainlandDriver, @transportMode, @loading, @unloading, @date,
         @receivableHKD, @receivableRMB, @status, @createdByAccountId, @createdByUsername, @createdByName, @remark, @tripNoEnabled, @tripNo,
         @sixSheetEnabled, @sixSheetNo)
    `).run(item);
    await saveOrderFees(item.no, item.fees, item.currency);
  });

  await transaction();
  await writeAudit("create", "order", item.no, item.customer);
  const created = await db.prepare("SELECT * FROM orders WHERE no = ?").get(item.no);
  res.status(201).json((await hydrateOrderFees([mapOrder(created)]))[0]);
});

function normalizeOrderFee(fee, fallbackCurrency) {
  const driverRole = String(fee.driverRole || fee.driver_role || "").trim();
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
  const rawCostManual = fee.costManual ?? fee.cost_manual ?? fee.manualCost ?? fee._manualCost;
  const costNumber = rawCost === undefined || rawCost === null || String(rawCost).trim() === ""
    ? null
    : Number(rawCost);
  const cost = Number.isFinite(costNumber) && costNumber >= 0 ? costNumber : null;
  return {
    category: normalizeOrderFeeCategory(fee.category),
    name: String(fee.name || "").trim(),
    quantity,
    unitPrice,
    unitPriceManual,
    currency: String(fee.currency || fallbackCurrency || "港币").trim(),
    amount,
    amountManual,
    cost,
    costManual: cost == null ? false : booleanFlag(rawCostManual, false),
    remark: String(fee.remark || "").trim(),
    driverRole: ["香港司机", "大陆骑师", "跟随订单司机", "手动指定"].includes(driverRole) ? driverRole : "",
    driverName: String(fee.driverName || fee.driver_name || "").trim()
  };
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
  const insert = await db.prepare(`
    INSERT INTO order_fees (order_no, category, name, quantity, unit_price, unit_price_manual, currency, amount, amount_manual, cost, cost_manual, remark, driver_role, driver_name)
    VALUES (@orderNo, @category, @name, @quantity, @unitPrice, @unitPriceManual, @currency, @amount, @amountManual, @cost, @costManual, @remark, @driverRole, @driverName)
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

  const item = await readOrderPayload(req.body, existing);
  item.no = no;
  item.fees = item.fees || (await hydrateOrderFees([mapOrder(existing)]))[0].fees;
  if (!(await resolveOrderCustomer(item))) {
    res.status(400).json({ message: "请选择有效客户" });
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
          port = @port, direction = @direction, tonnage = @tonnage, currency = @currency,
          quantity = @quantity, weight = @weight, vehicle_source = @vehicleSource,
          supplier = @supplier, plate = @plate, driver = @driver, hk_driver = @hkDriver,
          mainland_driver = @mainlandDriver, transport_mode = @transportMode,
          loading = @loading, unloading = @unloading,
          order_date = @date, receivable_hkd = @receivableHKD, receivable_rmb = @receivableRMB,
          status = @status, remark = @remark, trip_no_enabled = @tripNoEnabled,
          trip_no = @tripNo, six_sheet_enabled = @sixSheetEnabled, six_sheet_no = @sixSheetNo
      WHERE no = @no AND deleted_at IS NULL
    `).run(item);
    await saveOrderFees(no, item.fees, item.currency);
  });

  await transaction();
  await writeAudit("update", "order", no, item.customer);
  const updated = await db.prepare("SELECT * FROM orders WHERE no = ?").get(no);
  res.json((await hydrateOrderFees([mapOrder(updated)]))[0]);
});

app.patch("/api/orders/:no/status", async (req, res) => {
  const no = String(req.params.no || "").trim();
  const status = String(req.body.status || "").trim();
  const allowedStatuses = new Set(["待确认", "预排", "正常", "通关中", "已签收", "已审核", "缺票据", "费用待确认"]);

  if (!allowedStatuses.has(status)) {
    res.status(400).json({ message: "订单状态无效" });
    return;
  }

  const current = await db.prepare("SELECT status FROM orders WHERE no = ? AND deleted_at IS NULL").get(no);
  if (!current) {
    res.status(404).json({ message: "订单不存在或已删除" });
    return;
  }
  if ((status === "已审核" || current.status === "已审核") && !requestCanManageOrderAudit(req)) {
    res.status(403).json({ message: "只有财务可以审核或取消审核订单" });
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

  const result = await db.prepare("UPDATE orders SET status = ? WHERE no = ? AND deleted_at IS NULL").run(status, no);
  if (result.changes === 0) {
    res.status(404).json({ message: "订单不存在或已删除" });
    return;
  }

  await writeAudit(status === "已审核" ? "audit" : "update_status", "order", no, `状态改为${status}`);
  const row = await db.prepare("SELECT * FROM orders WHERE no = ?").get(no);
  res.json((await hydrateOrderFees([mapOrder(row)]))[0]);
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
  const result = await db.prepare("UPDATE orders SET deleted_at = NULL WHERE no = ? AND deleted_at IS NOT NULL").run(no);
  if (result.changes === 0) {
    res.status(404).json({ message: "回收站内找不到该订单" });
    return;
  }
  await writeAudit("restore", "order", no, "从回收站恢复");
  const restored = await db.prepare("SELECT * FROM orders WHERE no = ?").get(no);
  res.json((await hydrateOrderFees([mapOrder(restored)]))[0]);
});

app.get("/api/vehicles", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM vehicles WHERE deleted_at IS NULL ORDER BY plate ASC").all();
  res.json(rows.map(mapVehicle));
});

app.post("/api/vehicles", async (req, res) => {
  const item = {
    plate: String(req.body.plate || "").trim(),
    brand: String(req.body.brand || "").trim(),
    model: String(req.body.model || "").trim(),
    type: String(req.body.type || "").trim(),
    purchaseDate: String(req.body.purchaseDate || "").trim(),
    factoryDate: String(req.body.factoryDate || "").trim(),
    mainlandReviewDate: String(req.body.mainlandReviewDate || "").trim(),
    hkReviewDate: String(req.body.hkReviewDate || "").trim(),
    mainlandInsuranceDate: String(req.body.mainlandInsuranceDate || "").trim(),
    hkInsuranceDate: String(req.body.hkInsuranceDate || "").trim(),
    insuranceReminder: String(req.body.insuranceReminder || "提前30天").trim(),
    maintenanceReminder: String(req.body.maintenanceReminder || "").trim(),
    status: String(req.body.status || "正常").trim(),
    monthlyCost: Number(req.body.monthlyCost || 0),
    note: String(req.body.note || "").trim()
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
    plate: String(req.body.plate || originalPlate).trim(),
    brand: String(req.body.brand ?? current.brand ?? "").trim(),
    model: String(req.body.model ?? current.model ?? "").trim(),
    type: String(req.body.type ?? current.vehicle_type ?? "").trim(),
    purchaseDate: String(req.body.purchaseDate ?? current.purchase_date ?? "").trim(),
    factoryDate: String(req.body.factoryDate ?? current.factory_date ?? "").trim(),
    mainlandReviewDate: String(req.body.mainlandReviewDate ?? current.mainland_review_date ?? "").trim(),
    hkReviewDate: String(req.body.hkReviewDate ?? current.hk_review_date ?? "").trim(),
    mainlandInsuranceDate: String(req.body.mainlandInsuranceDate ?? current.mainland_insurance_date ?? "").trim(),
    hkInsuranceDate: String(req.body.hkInsuranceDate ?? current.hk_insurance_date ?? "").trim(),
    insuranceReminder: String(req.body.insuranceReminder ?? current.insurance_reminder ?? "提前30天").trim(),
    maintenanceReminder: String(req.body.maintenanceReminder ?? current.maintenance_reminder ?? "").trim(),
    status: String(req.body.status ?? current.status ?? "正常").trim(),
    monthlyCost: Number(req.body.monthlyCost ?? current.monthly_cost ?? 0),
    note: String(req.body.note ?? current.note ?? "").trim()
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
  await writeAudit("update", "vehicle", item.plate, item.note);
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
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    res.status(400).json({ message: "请填写大于 0 的费用金额" });
    return;
  }
  if (item.type !== "annual" && !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
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
  const result = await db.prepare(`
    INSERT INTO vehicle_expenses (expense_type, name, fuel_station, fuel_liters, odometer_km, plate, expense_date, start_date, end_date, expense_year, currency, amount, note)
    VALUES (@type, @name, @fuelStation, @fuelLiters, @odometerKm, @plate, @date, @startDate, @endDate, @year, @currency, @amount, @note)
  `).run(item);
  await writeAudit("create", "vehicle_expense", String(result.lastInsertId), `${item.plate}/${item.name}/${item.amount}`);
  res.status(201).json(mapVehicleExpense(await db.prepare("SELECT * FROM vehicle_expenses WHERE id = ?").get(result.lastInsertId)));
});

app.patch("/api/vehicle-expenses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const current = await db.prepare("SELECT * FROM vehicle_expenses WHERE id = ? AND deleted_at IS NULL").get(id);
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
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    res.status(400).json({ message: "请填写大于 0 的费用金额" });
    return;
  }
  if (item.type !== "annual" && !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
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
        odometer_km = @odometerKm,
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
  await writeAudit("update", "vehicle_expense", String(id), `${item.plate}/${item.name}/${item.amount}`);
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
  await writeAudit("delete", "vehicle_expense", String(id), `${row.plate}/${row.name}`);
  res.json({ ok: true });
});

app.get("/api/drivers", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM drivers WHERE deleted_at IS NULL ORDER BY id ASC").all();
  res.json(rows.map(mapDriver));
});

app.post("/api/drivers", async (req, res) => {
  const item = {
    type: String(req.body.type || "香港司机").trim(),
    name: String(req.body.name || "").trim(),
    phone: String(req.body.phone || "").trim(),
    idNo: String(req.body.idNo || "").trim(),
    license: String(req.body.license || "").trim(),
    birthday: String(req.body.birthday || "").trim(),
    hireDate: String(req.body.hireDate || "").trim(),
    leaveDate: String(req.body.leaveDate || "").trim(),
    expireAt: String(req.body.expireAt || "").trim(),
    status: String(req.body.status || "正常").trim(),
    defaultWage: Number(req.body.defaultWage || 0),
    note: String(req.body.note || "").trim()
  };
  if (!item.name) {
    res.status(400).json({ message: "司机姓名不能为空" });
    return;
  }
  const duplicate = await db.prepare("SELECT id FROM drivers WHERE name = ?").get(item.name);
  if (duplicate) {
    res.status(409).json({ message: "司机姓名已存在，不能重复" });
    return;
  }
  const result = await db.prepare(`
    INSERT INTO drivers (type, name, phone, id_no, license, birthday, hire_date, leave_date, expire_at, status, default_wage, note)
    VALUES (@type, @name, @phone, @idNo, @license, @birthday, @hireDate, @leaveDate, @expireAt, @status, @defaultWage, @note)
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
    type: String(req.body.type ?? current.type ?? "香港司机").trim() || "香港司机",
    name: String(req.body.name ?? current.name ?? "").trim(),
    phone: String(req.body.phone ?? current.phone ?? "").trim(),
    idNo: String(req.body.idNo ?? current.id_no ?? "").trim(),
    license: String(req.body.license ?? current.license ?? "").trim(),
    birthday: String(req.body.birthday ?? current.birthday ?? "").trim(),
    hireDate: String(req.body.hireDate ?? current.hire_date ?? "").trim(),
    leaveDate: String(req.body.leaveDate ?? current.leave_date ?? "").trim(),
    expireAt: String(req.body.expireAt ?? current.expire_at ?? "").trim(),
    status: String(req.body.status ?? current.status ?? "正常").trim(),
    defaultWage: Number(req.body.defaultWage ?? current.default_wage ?? 0),
    note: String(req.body.note ?? current.note ?? "").trim()
  };
  if (!item.name) {
    res.status(400).json({ message: "司机姓名不能为空" });
    return;
  }
  const transaction = db.transaction(async () => {
    const result = await db.prepare(`
      UPDATE drivers
      SET type = @type, name = @name, phone = @phone, id_no = @idNo, license = @license,
          birthday = @birthday, hire_date = @hireDate, leave_date = @leaveDate, expire_at = @expireAt,
          status = @status, default_wage = @defaultWage, note = @note
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
  await writeAudit("update", "driver", String(id), item.name);
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
  await writeAudit("update", "driver_wage_rule", String(id), `${item.direction}/${item.city}`);
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
    await writeAudit("update", "cost_center_rate", String(id), `${payload.source}/${payload.origin}-${payload.destination}/${payload.tonnage || "全部"}/${payload.effectiveDate}`);
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
  await writeAudit("update", "vehicle_profit_exchange_rate", periodMonth, `汇率 ${rate}`);
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
  if (!item.periodMonth) {
    res.status(400).json({ message: "请选择有效月份" });
    return;
  }
  if (!item.category) {
    res.status(400).json({ message: "请填写项目名称" });
    return;
  }
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    res.status(400).json({ message: "请填写大于 0 的金额" });
    return;
  }
  const row = await db.prepare(`
    INSERT INTO company_expenses (entry_type, period_month, category, amount, note)
    VALUES (@entryType, @periodMonth, @category, @amount, @note)
    RETURNING *
  `).get(item);
  await writeAudit("create", "company_expense", String(row.id), `${item.entryType}/${item.periodMonth}/${item.category}/${item.amount}`);
  res.status(201).json(mapCompanyExpense(row));
});

app.patch("/api/company-expenses/:id", async (req, res) => {
  const id = Number(req.params.id || 0);
  const current = await db.prepare("SELECT * FROM company_expenses WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "记录不存在或已删除" });
    return;
  }
  const item = readCompanyExpensePayload(req.body || {}, current);
  if (!item.periodMonth) {
    res.status(400).json({ message: "请选择有效月份" });
    return;
  }
  if (!item.category) {
    res.status(400).json({ message: "请填写项目名称" });
    return;
  }
  if (!Number.isFinite(item.amount) || item.amount <= 0) {
    res.status(400).json({ message: "请填写大于 0 的金额" });
    return;
  }
  await db.prepare(`
    UPDATE company_expenses
    SET entry_type = @entryType,
        period_month = @periodMonth,
        category = @category,
        amount = @amount,
        note = @note,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id AND deleted_at IS NULL
  `).run({ id, ...item });
  await writeAudit("update", "company_expense", String(id), `${item.entryType}/${item.periodMonth}/${item.category}/${item.amount}`);
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
  await writeAudit("update", "driver_adjustment", String(id), item.type);
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

function normalizeStatementDownloadStatus(value = "已导出") {
  const text = String(value || "").trim();
  return ["未导出", "已导出", "已发送", "已开票", "已收款"].includes(text) ? text : "已导出";
}

function isEditableStatementDownloadStatus(value = "") {
  return ["已导出", "已发送", "已开票", "已收款"].includes(String(value || "").trim());
}

function normalizeStatementPaymentStatus(value = "未收款") {
  return String(value || "").trim() === "已收款" ? "已收款" : "未收款";
}

function normalizeStatementPaymentDate(value = "", status = "未收款") {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return normalizeStatementPaymentStatus(status) === "已收款" ? todayInputValue() : "";
}

function statementDownloadKey(type, entityName, start, end) {
  return [type, entityName || "全部", start || "", end || ""].join("|");
}

function readStatementDownloadPayload(body, current = null) {
  const type = normalizeStatementType(body.type ?? body.statementType ?? body.statement_type ?? current?.statement_type ?? "customer");
  const entityName = String(body.entityName ?? body.entity_name ?? current?.entity_name ?? "全部").trim() || "全部";
  const start = String(body.start ?? body.startDate ?? body.start_date ?? current?.start_date ?? "").trim();
  const end = String(body.end ?? body.endDate ?? body.end_date ?? current?.end_date ?? "").trim();
  const downloadKey = String(
    body.key ?? body.downloadKey ?? body.download_key ?? current?.download_key ?? statementDownloadKey(type, entityName, start, end)
  ).trim() || statementDownloadKey(type, entityName, start, end);
  const status = normalizeStatementDownloadStatus(body.status ?? body.statementStatus ?? body.statement_status ?? current?.status ?? "已导出");
  const paymentStatus = status === "已收款" ? "已收款" : "未收款";
  return {
    downloadKey,
    statementType: type,
    entityName,
    start,
    end,
    status,
    paymentStatus,
    paymentDate: normalizeStatementPaymentDate(body.paymentDate ?? body.payment_date ?? current?.payment_date ?? "", paymentStatus),
    downloadedAt: String(body.downloadedAt ?? body.downloaded_at ?? current?.downloaded_at ?? new Date().toISOString()).trim()
  };
}

async function saveStatementDownload(item) {
  const result = await db.prepare(`
    INSERT INTO statement_downloads
      (download_key, statement_type, entity_name, start_date, end_date, status, payment_status, payment_date, downloaded_at)
    VALUES
      (@downloadKey, @statementType, @entityName, @start, @end, @status, @paymentStatus, @paymentDate, @downloadedAt)
    ON CONFLICT (download_key)
    DO UPDATE SET
      statement_type = excluded.statement_type,
      entity_name = excluded.entity_name,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      status = excluded.status,
      payment_status = excluded.payment_status,
      payment_date = excluded.payment_date,
      downloaded_at = excluded.downloaded_at,
      updated_at = CURRENT_TIMESTAMP,
      deleted_at = NULL
  `).run(item);
  return db.prepare("SELECT * FROM statement_downloads WHERE id = ?").get(result.lastInsertId);
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
  await writeAudit("download", "statement", item.downloadKey, `${item.statementType}/${item.entityName}`);
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
  const row = await saveStatementDownload(item);
  await writeAudit("update", "statement", item.downloadKey, `收款状态${item.paymentStatus}${item.paymentDate ? `/${item.paymentDate}` : ""}`);
  res.json(mapStatementDownload(row));
});

app.patch("/api/statement-downloads/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status ?? req.body.statementStatus ?? req.body.statement_status ?? "").trim();
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "对账单记录无效" });
    return;
  }
  if (!isEditableStatementDownloadStatus(status)) {
    res.status(400).json({ message: "请选择有效对账单状态" });
    return;
  }
  const current = await db.prepare("SELECT * FROM statement_downloads WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!current) {
    res.status(404).json({ message: "对账单下载记录不存在" });
    return;
  }
  const paymentStatus = status === "已收款" ? "已收款" : "未收款";
  const paymentDate = status === "已收款" ? normalizeStatementPaymentDate(current.payment_date || "", paymentStatus) : "";
  await db.prepare(`
    UPDATE statement_downloads
    SET status = ?,
        payment_status = ?,
        payment_date = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(status, paymentStatus, paymentDate, id);
  const row = await db.prepare("SELECT * FROM statement_downloads WHERE id = ?").get(id);
  await writeAudit("update", "statement", current.download_key || String(id), `状态改为${status}`);
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
  await writeAudit("update", "fee_item", String(id), item.name);
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
  await writeAudit("update", "freight_rate", String(id), `${item.customerName || "公共模板"}/${item.direction}/${item.level1}/${item.level2}/${item.level3}/${item.tonnage}/${item.effectiveDate}`);
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
  await writeAudit("update", "template", String(id), item.name);
  res.json(mapTemplate(await db.prepare("SELECT * FROM templates WHERE id = ?").get(id)));
});

app.delete("/api/templates/:id", async (req, res) => {
  const id = Number(req.params.id);
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
  await writeAudit("update", "rule", String(id), item.name);
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
  await writeAudit("update", "master_data", String(id), `${item.type}/${item.name}`);
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
    note: String(req.body.note || "").trim(),
    permissions: JSON.stringify(accountPermissionsForRole(role))
  };
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
    note: req.body.note === undefined ? current.note : String(req.body.note || "").trim(),
    permissions: JSON.stringify(accountPermissionsForRole(role))
  };
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
  await writeAudit("update", "account", String(id), item.username);
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
  await writeAudit("update", "address_book", String(id), item.address);
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

app.get("/api/audit-logs", async (_req, res) => {
  const rows = await db.prepare("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200").all();
  res.json(rows.map(mapAuditLog));
});

try {
  await migrateDatabaseFilesToOss();
} catch (error) {
  console.error("Database file OSS migration failed", error);
  process.exit(1);
}

app.listen(port, () => {
  console.log(`Hanye API listening on http://127.0.0.1:${port}`);
  console.log(`PostgreSQL database: ${databaseInfo}`);
});
