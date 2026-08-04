<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";
import {
  API_BASE,
  apiDownloadErrorMessage,
  apiRequestHeaders,
  configureApiClient,
  accountsApi,
  authApi,
  customersApi,
  customsBusinessApi,
  dispatchApi,
  filesApi,
  financeApi,
  masterDataApi,
  ordersApi,
  securityApi,
  templatesApi,
  vehiclesApi
} from "./api/index.js";
import IconSvg from "./components/IconSvg.vue";
import FilePreviewModal from "./components/FilePreviewModal.vue";
import OrderAttachmentPanel from "./components/orders/OrderAttachmentPanel.vue";
import OrderDetailModal from "./components/orders/OrderDetailModal.vue";
import OrderModal from "./components/orders/OrderModal.vue";
import BossCenterPage from "./pages/BossCenterPage.vue";
import BusinessPage from "./pages/BusinessPage.vue";
import FinanceCenterPage from "./pages/FinanceCenterPage.vue";
import SystemConfigPage from "./pages/SystemConfigPage.vue";
import VehicleDriverPage from "./pages/VehicleDriverPage.vue";
import {
  ACCOUNT_ROLES,
  ACCOUNT_SESSION_TTL_MS,
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_RECORD_PREFIXES,
  BOSS_CENTER_MODULES,
  BUSINESS_MODULES,
  CUSTOMER_FREIGHT_QUOTE_TYPE,
  DEFAULT_DRIVER_TYPES,
  DIRECTION_OPTIONS,
  DISPATCH_LOAD_TIME_OPTIONS,
  DISPATCH_LOCKED_STATUS,
  DISPATCH_PLAN_DEFAULT_STATUS,
  DISPATCH_STATUS_OPTIONS,
  DISPATCH_STATUS_TO_ORDER_STATUS,
  DRIVER_ADJUSTMENT_STATUS_OPTIONS,
  DRIVER_ADJUSTMENT_TYPES,
  FEE_DRIVER_ROLE_LABELS,
  FEE_DRIVER_ROLE_OPTIONS,
  FEE_ITEM_COST_SOURCE_OPTIONS,
  FILE_UPLOAD_ACCEPT,
  FREIGHT_QUOTE_CUSTOMERS_VIEW,
  FREIGHT_QUOTE_MATRIX_VIEW,
  FREIGHT_QUOTE_ROOT_VIEW,
  FREIGHT_QUOTE_TAB,
  LEGACY_DRIVER_ROUTE_ADJUST_RULES_KEY,
  LEGACY_STATEMENT_DOWNLOAD_ROWS_KEY,
  MAX_UPLOAD_BYTES,
  MODULES,
  ORDER_DATE_FILTERS,
  ORDER_STATUS_OPTIONS,
  PERIOD_FILTER_MODES,
  PERIOD_MONTH_OPTIONS,
  PUBLIC_FREIGHT_QUOTE_TYPE,
  RELATED_ORDER_DATE_FILTERS,
  ROLE_ALLOWED_MODULES,
  ROLE_PERMISSION_LABELS,
  ROUTE_ALIASES,
  SAFE_UPLOAD_EXTENSIONS,
  SESSION_ACCOUNT_KEY,
  SESSION_EXPIRES_KEY,
  SESSION_LOGIN_KEY,
  SESSION_TOKEN_KEY,
  SESSION_USER_KEY,
  SHARED_DIRECTION,
  STATEMENT_CUSTOMER_EXCHANGE_RATES_KEY,
  STATEMENT_DEFAULT_EXCHANGE_RATE,
  SUPPLIER_COST_SHARED_DIRECTION,
  SYSTEM_CONFIG_MODULES,
  TONNAGE_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  UPLOAD_MIME_BY_EXTENSION,
  VEHICLE_ANNUAL_EXPENSE_NAMES,
  VEHICLE_DRIVER_MODULES,
  VEHICLE_EXPENSE_CONFIG_BY_MODULE,
  VEHICLE_EXPENSE_CONFIG_BY_TYPE,
  VEHICLE_EXPENSE_CONFIGS,
  VEHICLE_EXPENSE_MODULES
} from "./constants/appConstants.js";
import {
  CUSTOMER_ORDER_COLUMN_LOCKED_KEY,
  CUSTOMER_ORDER_COLUMN_ORDER_KEY,
  CUSTOMER_ORDER_COLUMN_STORAGE_KEY,
  CUSTOMER_ORDER_COLUMN_VISIBILITY_KEY,
  DATA_TABLE_DENSITY_OPTIONS,
  ORDER_COLUMN_LOCKED_KEY,
  ORDER_COLUMN_ORDER_KEY,
  ORDER_COLUMN_STORAGE_KEY,
  ORDER_COLUMN_VISIBILITY_KEY,
  ORDER_RIGHT_STICKY_KEYS,
  RELATED_DRIVER_ORDER_COLUMN_STORAGE_KEY,
  RELATED_VEHICLE_ORDER_COLUMN_STORAGE_KEY,
  createCustomerListDetailColumns,
  createCustomerOrderColumns,
  createDispatchTableColumns,
  createDriverListDetailColumns,
  createFinanceWageTableColumns,
  createOrderColumns,
  createRelatedDriverOrderColumns,
  createRelatedVehicleOrderColumns,
  createVehicleListDetailColumns
} from "./constants/tableColumns.js";
import {
  FONT_PRESETS,
  FREIGHT_DIRECTORY_LEVELS,
  NEW_CONTACT_ROW_ID,
  TEMPLATE_ORDER_BASE_COLUMNS,
  TEMPLATE_PREVIEW_SAMPLE_ORDERS,
  TEMPLATE_REMOVED_COLUMN_KEYS,
  TEMPLATE_SYSTEM_MANAGED_COLUMNS,
  TEMPLATE_SYSTEM_SEQUENCE_COLUMN,
  TEMPLATE_SYSTEM_TOTAL_COLUMNS,
  TEMPLATE_VARIABLES
} from "./constants/templateConstants.js";
import {
  BOSS_COMPANY_EXPENSE_ROWS,
  BOSS_COMPANY_PROFIT_ROWS
} from "./constants/mockData.js";

const DISPATCH_DATE_FILTERS = ORDER_DATE_FILTERS;

const getTemplateColumnOrderValue = (column, fallbackIndex = 0) => {
  const rawOrder = column?.order ?? column?.sortOrder ?? column?.displayOrder ?? column?.position ?? column?.sequence;
  const parsedOrder = Number(rawOrder);
  return Number.isFinite(parsedOrder) && parsedOrder > 0 ? parsedOrder : fallbackIndex + 1;
};

const normalizeTemplateColumnOrderValue = (column, fallbackIndex = 0) => {
  const order = getTemplateColumnOrderValue(column, fallbackIndex);
  return {
    ...column,
    order,
    sortOrder: order,
  };
};

const sortTemplateColumnsBySavedOrder = (columns = []) => {
  return (Array.isArray(columns) ? columns : [])
    .map((column, index) => ({ column: normalizeTemplateColumnOrderValue(column, index), index }))
    .sort((a, b) => getTemplateColumnOrderValue(a.column, a.index) - getTemplateColumnOrderValue(b.column, b.index) || a.index - b.index)
    .map(({ column }) => column);
};

const bossCompanyProfitRows = BOSS_COMPANY_PROFIT_ROWS;
const bossCompanyExpenseRows = BOSS_COMPANY_EXPENSE_ROWS;
const customerOrderColumns = reactive(createCustomerOrderColumns());
const orderColumns = reactive(createOrderColumns());
const relatedVehicleOrderColumns = createRelatedVehicleOrderColumns();
const relatedDriverOrderColumns = createRelatedDriverOrderColumns();
const financeWageTableColumns = createFinanceWageTableColumns();
const dispatchTableColumns = createDispatchTableColumns();
const customerListDetailColumns = reactive(createCustomerListDetailColumns());
const vehicleListDetailColumns = reactive(createVehicleListDetailColumns());
const driverListDetailColumns = reactive(createDriverListDetailColumns());
const dataTableDensityOptions = DATA_TABLE_DENSITY_OPTIONS;
applySavedColumnOrder(customerOrderColumns, CUSTOMER_ORDER_COLUMN_ORDER_KEY);
applySavedColumnOrder(orderColumns, ORDER_COLUMN_ORDER_KEY);
pinColumnAfter(customerOrderColumns, "date", "select", CUSTOMER_ORDER_COLUMN_ORDER_KEY);
pinColumnAfter(orderColumns, "date", "select", ORDER_COLUMN_ORDER_KEY);
pinColumnAfter(orderColumns, "plate", "customer", ORDER_COLUMN_ORDER_KEY);
pinColumnAfter(orderColumns, "driver", "plate", ORDER_COLUMN_ORDER_KEY);

function dataTableStorageKey(tableId, feature) {
  return `hanye_data_table_${tableId}_${feature}`;
}

function migrateSavedDataTableColumnAfter(saved, tableId, columnKey, anchorKey, migrationId) {
  const migrationKey = dataTableStorageKey(tableId, migrationId);
  if (localStorage.getItem(migrationKey) === "done") return saved;
  const columnIndex = saved.indexOf(columnKey);
  const anchorIndex = saved.indexOf(anchorKey);
  if (columnIndex < 0 || anchorIndex < 0 || columnIndex === anchorIndex + 1) {
    localStorage.setItem(migrationKey, "done");
    return saved;
  }
  const next = saved.filter((key) => key !== columnKey);
  const nextAnchorIndex = next.indexOf(anchorKey);
  next.splice(nextAnchorIndex + 1, 0, columnKey);
  localStorage.setItem(dataTableStorageKey(tableId, "order"), JSON.stringify(next));
  localStorage.setItem(migrationKey, "done");
  return next;
}

function applyDataTableColumnOrder(columns, tableId) {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(dataTableStorageKey(tableId, "order")) || "[]") || [];
  } catch {
    saved = [];
  }
  if (tableId === "dispatch_board" && saved.length) {
    saved = migrateSavedDataTableColumnAfter(saved, tableId, "status", "plate", "status_after_plate_migrated_v1");
    saved = migrateSavedDataTableColumnAfter(saved, tableId, "driver", "plate", "driver_after_plate_migrated_v1");
  }
  if (!saved.length) return;
  const indexMap = new Map(saved.map((key, index) => [key, index]));
  const lockedStart = columns.filter((column) => column.locked && column.key !== "actions");
  const lockedEnd = columns.filter((column) => column.locked && column.key === "actions");
  const movable = columns
    .filter((column) => !column.locked)
    .sort((left, right) => (indexMap.get(left.key) ?? 999) - (indexMap.get(right.key) ?? 999));
  columns.splice(0, columns.length, ...lockedStart, ...movable, ...lockedEnd);
}

function moveDataTableColumn(columns, tableId, draggedKey, targetKey) {
  if (!draggedKey || draggedKey === targetKey) return;
  const fromIndex = columns.findIndex((column) => column.key === draggedKey && !column.locked);
  const toIndex = columns.findIndex((column) => column.key === targetKey && !column.locked);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = columns.splice(fromIndex, 1);
  const targetIndex = columns.findIndex((column) => column.key === targetKey);
  columns.splice(targetIndex, 0, moved);
  localStorage.setItem(dataTableStorageKey(tableId, "order"), JSON.stringify(columns.filter((column) => !column.locked).map((column) => column.key)));
}

function moveDataTableColumnByOffset(columns, tableId, column, offset) {
  if (!column?.key || column.locked) return;
  const movableKeys = columns.filter((item) => !item.locked).map((item) => item.key);
  const movableIndex = movableKeys.indexOf(column.key);
  const targetMovableKey = movableKeys[movableIndex + offset];
  if (!targetMovableKey) return;
  const fromIndex = columns.findIndex((item) => item.key === column.key);
  const targetIndex = columns.findIndex((item) => item.key === targetMovableKey);
  if (fromIndex < 0 || targetIndex < 0) return;
  const [moved] = columns.splice(fromIndex, 1);
  const nextIndex = columns.findIndex((item) => item.key === targetMovableKey);
  columns.splice(offset > 0 ? nextIndex + 1 : nextIndex, 0, moved);
  localStorage.setItem(dataTableStorageKey(tableId, "order"), JSON.stringify(columns.filter((item) => !item.locked).map((item) => item.key)));
}

function resetDataTableColumnWidths(tableId, columns, widths) {
  localStorage.removeItem(dataTableStorageKey(tableId, "widths"));
  columns.forEach((column) => {
    widths[column.key] = column.width;
  });
  notify("已恢复自适应列宽");
}

function resetDataTableColumnOrder(columns, tableId) {
  localStorage.removeItem(dataTableStorageKey(tableId, "order"));
  const lockedStart = columns.filter((column) => column.locked && column.key !== "actions");
  const lockedEnd = columns.filter((column) => column.locked && column.key === "actions");
  const movable = columns.filter((column) => !column.locked).sort((left, right) =>
    (left.defaultIndex ?? 0) - (right.defaultIndex ?? 0)
  );
  columns.splice(0, columns.length, ...lockedStart, ...movable, ...lockedEnd);
  notify("已恢复默认列顺序");
}

function loadDataTableColumnWidths(tableId, columns) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(dataTableStorageKey(tableId, "widths")) || "{}") || {};
  } catch {
    saved = {};
  }
  return columns.reduce((widths, column) => {
    const savedWidth = Number(saved[column.key]);
    widths[column.key] = Number.isFinite(savedWidth) && savedWidth >= column.min ? savedWidth : column.width;
    return widths;
  }, {});
}

function loadDataTableSavedWidths(tableId) {
  try {
    return JSON.parse(localStorage.getItem(dataTableStorageKey(tableId, "widths")) || "{}") || {};
  } catch {
    return {};
  }
}

function loadDataTableColumnVisibility(tableId, columns) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(dataTableStorageKey(tableId, "visibility")) || "{}") || {};
  } catch {
    saved = {};
  }
  return columns.reduce((visibility, column) => {
    visibility[column.key] = column.locked ? true : saved[column.key] !== false;
    return visibility;
  }, {});
}

function loadRelatedOrderColumnWidths(columns, storageKey) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    saved = {};
  }
  return columns.reduce((widths, column) => {
    const savedWidth = Number(saved[column.key]);
    widths[column.key] = Number.isFinite(savedWidth) && savedWidth >= column.min ? savedWidth : column.width;
    return widths;
  }, {});
}

function loadCustomerOrderColumnWidths() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CUSTOMER_ORDER_COLUMN_STORAGE_KEY) || "{}") || {};
  } catch {
    saved = {};
  }
  return customerOrderColumns.reduce((widths, column) => {
    const savedWidth = Number(saved[column.key]);
    widths[column.key] = Number.isFinite(savedWidth) && savedWidth >= column.min ? savedWidth : column.width;
    return widths;
  }, {});
}

function saveCustomerOrderColumnWidths() {
  localStorage.setItem(CUSTOMER_ORDER_COLUMN_STORAGE_KEY, JSON.stringify({ ...customerOrderColumnWidths }));
}

function loadOrderColumnWidths() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(ORDER_COLUMN_STORAGE_KEY) || "{}") || {};
  } catch {
    saved = {};
  }
  return orderColumns.reduce((widths, column) => {
    const savedWidth = Number(saved[column.key]);
    widths[column.key] = Number.isFinite(savedWidth) && savedWidth >= column.min ? savedWidth : column.width;
    return widths;
  }, {});
}

function saveOrderColumnWidths() {
  localStorage.setItem(ORDER_COLUMN_STORAGE_KEY, JSON.stringify({ ...orderColumnWidths }));
}

function loadColumnVisibility(columns, storageKey) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    saved = {};
  }
  return columns.reduce((visibility, column) => {
    visibility[column.key] = column.locked ? true : saved[column.key] !== false;
    return visibility;
  }, {});
}

function applySavedColumnOrder(columns, storageKey) {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) || "[]") || [];
  } catch {
    saved = [];
  }
  if (!saved.length) return;
  const indexMap = new Map(saved.map((key, index) => [key, index]));
  const lockedStart = columns.filter((column) => column.locked && column.key === "select");
  const lockedEnd = columns
    .filter((column) => column.rightPinned || (column.locked && column.key !== "select"))
    .sort((left, right) => (left.defaultIndex ?? 0) - (right.defaultIndex ?? 0));
  const fixedKeys = new Set([...lockedStart, ...lockedEnd].map((column) => column.key));
  const unlocked = columns
    .filter((column) => !fixedKeys.has(column.key))
    .sort((a, b) => (indexMap.get(a.key) ?? 999) - (indexMap.get(b.key) ?? 999));
  columns.splice(0, columns.length, ...lockedStart, ...unlocked, ...lockedEnd);
}

function pinColumnAfter(columns, columnKey, afterKey, storageKey) {
  const fromIndex = columns.findIndex((column) => column.key === columnKey);
  const afterIndex = columns.findIndex((column) => column.key === afterKey);
  if (fromIndex < 0 || afterIndex < 0 || fromIndex === afterIndex + 1) return;
  const [column] = columns.splice(fromIndex, 1);
  const nextAfterIndex = columns.findIndex((item) => item.key === afterKey);
  columns.splice(nextAfterIndex + 1, 0, column);
  localStorage.setItem(storageKey, JSON.stringify(columns.filter((item) => !item.locked && !item.rightPinned).map((item) => item.key)));
}

function moduleIcon(moduleId) {
  const icons = {
    home: "database",
    customerList: "users",
    customers: "users",
    supplierList: "truck",
    orders: "list",
    vehicleDriver: "truck",
    vehicleManage: "car",
    driverManage: "users",
    vehicleFuelExpenses: "finance",
    vehicleRepairExpenses: "checklist",
    vehicleAnnualExpenses: "shield",
    vehicleOtherExpenses: "file",
    dispatchBoard: "truck",
    financeWages: "finance",
    financeCosts: "finance",
    financeCostCenter: "database",
    financeDaily: "finance",
    bossDashboard: "database",
    bossCompanyProfit: "finance",
    bossVehicleProfit: "truck",
    customsBusiness: "file",
    bossCompanyExpenses: "finance",
    freight: "file",
    templates: "copy",
    master: "database",
    security: "shield",
    accounts: "lock"
  };
  return icons[moduleId] || "list";
}

function normalizeFontPreset(value) {
  const text = String(value || "").trim();
  if (FONT_PRESETS.some((item) => item.value === text)) return text;
  if (["SimSun", "Songti SC", "宋体"].includes(text)) return "standard-serif-cn";
  if (["Times New Roman", "Georgia"].includes(text)) return "latin-serif";
  if (["Arial", "Helvetica"].includes(text)) return "latin-sans";
  return "standard-serif-cn";
}

function fontPresetStack(value) {
  return FONT_PRESETS.find((item) => item.value === normalizeFontPreset(value))?.stack || FONT_PRESETS[0].stack;
}

function normalizeRoute(route) {
  const cleanRoute = String(route || "").split("?")[0];
  return ROUTE_ALIASES[cleanRoute] || cleanRoute || "home";
}

function partnerTypeForCustomerRoute(route) {
  const cleanRoute = String(route || "").replace(/^#/, "").split("?")[0];
  if (["supplier", "supplierList", "suppliers"].includes(cleanRoute)) return "供应商";
  if (["customer", "customerList", "customers"].includes(cleanRoute)) return "客户";
  return "";
}

function customerRouteForPartnerType(type) {
  return type === "供应商" ? "supplierList" : "customerList";
}

function todayInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function loadStoredJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function offsetDateInputValue(offsetDays = 0) {
  const date = parseInputDate(todayInputValue()) || new Date();
  date.setDate(date.getDate() + offsetDays);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function parseInputDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function isSameDate(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function isSameMonth(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function isRelatedOrderDateMatch(dateValue, filterKey) {
  if (filterKey === "all") return true;
  const date = parseInputDate(dateValue);
  if (!date) return false;
  const today = parseInputDate(todayInputValue());
  if (!today) return false;
  const weekStart = new Date(today);
  const mondayOffset = (today.getDay() + 6) % 7;
  weekStart.setDate(today.getDate() - mondayOffset);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  if (filterKey === "today") return isSameDate(date, today);
  if (filterKey === "week") return date >= weekStart && date <= weekEnd;
  if (filterKey === "month") return isSameMonth(date, today);
  if (filterKey === "lastMonth") return isSameMonth(date, lastMonth);
  if (filterKey === "year") return date.getFullYear() === today.getFullYear();
  if (filterKey === "pastYears") return date.getFullYear() < today.getFullYear();
  return true;
}

function orderDateFilterBounds(filterKey = orderDateFilter.value) {
  const todayValue = todayInputValue();
  const today = parseInputDate(todayValue) || new Date();
  if (filterKey === "yesterday") {
    const value = offsetDateInputValue(-1);
    return { start: value, end: value };
  }
  if (filterKey === "today") {
    return { start: todayValue, end: todayValue };
  }
  if (filterKey === "tomorrow") {
    const value = offsetDateInputValue(1);
    return { start: value, end: value };
  }
  if (filterKey === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: dateInputFromDate(start), end: dateInputFromDate(end) };
  }
  if (filterKey === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: dateInputFromDate(start), end: dateInputFromDate(end) };
  }
  if (filterKey === "lastMonth") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: dateInputFromDate(start), end: dateInputFromDate(end) };
  }
  if (filterKey === "custom") {
    const start = orderCustomDateStart.value || orderCustomDateEnd.value || todayValue;
    const end = orderCustomDateEnd.value || orderCustomDateStart.value || todayValue;
    return { start, end };
  }
  return { start: "", end: "" };
}

function dateMatchesOrderDateFilter(dateValue, filterKey = orderDateFilter.value) {
  const date = parseInputDate(dateValue);
  if (!date) return false;
  const { start, end } = orderDateFilterBounds(filterKey);
  if (!start && !end) return true;
  const startDate = parseInputDate(start);
  const endDate = parseInputDate(end);
  if (!startDate && !endDate) return true;
  if (startDate && endDate) {
    const first = startDate <= endDate ? startDate : endDate;
    const last = startDate <= endDate ? endDate : startDate;
    return date >= first && date <= last;
  }
  return startDate ? isSameDate(date, startDate) : isSameDate(date, endDate);
}

function dispatchPeriodBounds(filterKey = dispatchPeriodFilter.value) {
  return dispatchDateFilterBounds(filterKey);
}

function datesBetweenInputValues(startValue, endValue) {
  const start = parseInputDate(startValue);
  const end = parseInputDate(endValue);
  if (!start || !end) return [dispatchDate.value || todayInputValue()];
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  const dates = [];
  const cursor = new Date(first);
  while (cursor <= last && dates.length < 370) {
    dates.push(dateInputFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function dateInputFromDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function formatAuditTime(value = "") {
  const text = String(value || "").trim();
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}:\d{2})/);
  if (matched) return `${matched[1]} ${matched[2]}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text || "-";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 19).replace("T", " ");
}

function auditActionText(action = "") {
  const key = String(action || "").trim();
  return AUDIT_ACTION_LABELS[key] || key || "-";
}

function auditEntityText(entityType = "") {
  const key = String(entityType || "").trim();
  return AUDIT_ENTITY_LABELS[key] || key || "-";
}

function auditRecordText(item = {}) {
  const id = String(item.entityId || "").trim();
  if (!id) return "-";
  const prefix = AUDIT_RECORD_PREFIXES[String(item.entityType || "").trim()] || "记录";
  if (id === "all") return `${prefix}：全部`;
  return `${prefix}：${id}`;
}

const SESSION_STORAGE_KEYS = [
  SESSION_LOGIN_KEY,
  SESSION_USER_KEY,
  SESSION_TOKEN_KEY,
  SESSION_ACCOUNT_KEY,
  SESSION_EXPIRES_KEY
];

function readStoredSessionItem(key) {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
}

function writeStoredSessionItem(key, value) {
  localStorage.setItem(key, String(value));
  sessionStorage.removeItem(key);
}

function clearStoredSession() {
  SESSION_STORAGE_KEYS.forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });
}

function tokenExpiresAtMs(token = "") {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded));
    const expiresAtSeconds = Number(parsed?.exp || 0);
    return expiresAtSeconds > 0 ? expiresAtSeconds * 1000 : 0;
  } catch {
    return 0;
  }
}

function normalizeSessionExpiresAt(value, token = "") {
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsedDate = Date.parse(String(value || ""));
  if (Number.isFinite(parsedDate)) return parsedDate;
  return tokenExpiresAtMs(token);
}

function readSessionAccount() {
  try {
    return JSON.parse(readStoredSessionItem(SESSION_ACCOUNT_KEY) || "null");
  } catch {
    return null;
  }
}

function readStoredLoginSession() {
  const token = readStoredSessionItem(SESSION_TOKEN_KEY);
  const logged = readStoredSessionItem(SESSION_LOGIN_KEY) === "1";
  const expiresAt = normalizeSessionExpiresAt(readStoredSessionItem(SESSION_EXPIRES_KEY), token);
  if (!token || !logged) {
    return { valid: false, token: "", account: null, username: "", expiresAt: 0 };
  }
  if (expiresAt && expiresAt <= Date.now()) {
    clearStoredSession();
    return { valid: false, token: "", account: null, username: "", expiresAt: 0 };
  }
  const account = readSessionAccount();
  const username = account?.username || readStoredSessionItem(SESSION_USER_KEY);
  const nextExpiresAt = expiresAt || Date.now() + ACCOUNT_SESSION_TTL_MS;
  writeStoredSessionItem(SESSION_LOGIN_KEY, "1");
  writeStoredSessionItem(SESSION_TOKEN_KEY, token);
  writeStoredSessionItem(SESSION_EXPIRES_KEY, String(nextExpiresAt));
  if (username) writeStoredSessionItem(SESSION_USER_KEY, username);
  if (account) writeStoredSessionItem(SESSION_ACCOUNT_KEY, JSON.stringify(account));
  return { valid: true, token, account, username, expiresAt: nextExpiresAt };
}

function normalizeAccountRole(value = "") {
  const text = String(value || "").trim();
  if (ACCOUNT_ROLES.includes(text)) return text;
  if (/管理员|老板|超级|高级/.test(text)) return "管理员";
  if (/财务|会计|出纳/.test(text)) return "财务";
  if (/司机|驾驶/.test(text)) return "司机";
  return "跟单员";
}

function allowedModulesForRole(role = "") {
  return [...(ROLE_ALLOWED_MODULES[normalizeAccountRole(role)] || ROLE_ALLOWED_MODULES["司机"])];
}

function permissionTextForRole(role = "") {
  return ROLE_PERMISSION_LABELS[normalizeAccountRole(role)] || ROLE_PERMISSION_LABELS["司机"];
}

const savedLoginSession = readStoredLoginSession();
const loginForm = reactive({ username: "", password: "" });
const authToken = ref(savedLoginSession.token);
const currentSessionAccount = ref(savedLoginSession.account);
const loggedIn = ref(savedLoginSession.valid);
const currentUsername = ref(savedLoginSession.account?.username || savedLoginSession.username || "");
const activeModule = ref(normalizeRoute(location.hash.replace("#", "")));
let syncedHash = "";
const activePartnerType = ref(partnerTypeForCustomerRoute(location.hash) || "客户");
const storedVehicleTab = localStorage.getItem("hanye_vehicle_tab");
const activeVehicleTab = ref(["车辆管理", "司机管理"].includes(storedVehicleTab) ? storedVehicleTab : "车辆管理");
const activeVehicleDetailTab = ref("车辆资料");
const activeDriverDetailTab = ref("司机资料");
const activeCustomerDetailTab = ref("订单管理");
const activeOrderDetailTab = ref("收费项目");
const orderDateFilter = ref("today");
const orderCustomDateStart = ref("");
const orderCustomDateEnd = ref("");
const financePeriodFilter = ref(normalizeLegacyPeriodFilter(localStorage.getItem("hanye_finance_period_filter") || localStorage.getItem("hanye_finance_date_filter")));
const statementMonthFilter = ref(todayInputValue().slice(0, 7));
const bossPeriodFilter = ref(currentPeriodMonthKey());
const BOSS_VEHICLE_DEFAULT_EXCHANGE_RATE = "0.88";
const bossVehicleExchangeRate = ref(BOSS_VEHICLE_DEFAULT_EXCHANGE_RATE);
const bossVehicleExchangeRateInputMonth = ref(currentPeriodMonthKey());
const bossVehicleExchangeRateSaving = ref(false);
const customsBusinessPeriodFilter = ref(currentPeriodMonthKey());
const vehicleExpensePeriodFilter = ref(normalizePeriodFilter(localStorage.getItem("hanye_vehicle_expense_period_filter") || currentPeriodMonthKey()));
const financeWageDetailDriverId = ref(null);
const selectedFinanceWageDetailOrderNo = ref("");
const activeFinanceWageCard = ref("wages");
const routeAdjustDriverPickerOpen = ref(false);
const statementExportType = ref(localStorage.getItem("hanye_statement_export_type") || "customer");
const statementExportEntity = ref("");
const statementExportStart = ref(localStorage.getItem("hanye_statement_export_start") || "");
const statementExportEnd = ref(localStorage.getItem("hanye_statement_export_end") || "");
const statementSettlementCurrency = ref(localStorage.getItem("hanye_statement_settlement_currency") || "人民币");
const statementExchangeRate = ref(localStorage.getItem("hanye_statement_exchange_rate") || STATEMENT_DEFAULT_EXCHANGE_RATE);
const statementDownloadRows = ref([]);
const STATEMENT_DOWNLOAD_STATUS_OPTIONS = ["已导出", "已发送", "已开票"];
const statementCustomerExchangeRates = reactive(loadStoredJson(STATEMENT_CUSTOMER_EXCHANGE_RATES_KEY, {}));
const customsBusinessRows = ref([]);
const driverRouteAdjustRules = ref([]);
const driverRouteAdjustForm = reactive({
  customerName: "",
  driverIds: [],
  transportMode: "",
  loading: "",
  unloading: "",
  currency: "港币",
  amountHKD: -50,
  amountRMB: 0,
  note: ""
});
const supplierCostRuleFormOpen = ref(false);
const supplierCostBatchOpen = ref(false);
const activeSupplierCostCard = ref("base");
const editingSupplierCostRuleKey = ref("");
const editingSupplierCostGroupKey = ref("");
const editingSupplierCostExtraKey = ref("");
const expandedSupplierCostGroupKeys = ref([]);
const supplierCostGroupDraft = reactive({});
const supplierCostExtraDraft = reactive({});
const vehicleRelatedOrderDateFilter = ref("all");
const driverRelatedOrderDateFilter = ref("all");
const storedDispatchDate = localStorage.getItem("hanye_dispatch_date") || todayInputValue();
const dispatchPeriodFilter = ref(normalizeDispatchDateFilterKey(localStorage.getItem("hanye_dispatch_period_filter") || localStorage.getItem("hanye_dispatch_date_filter")));
const dispatchCustomDateStart = ref(localStorage.getItem("hanye_dispatch_custom_date_start") || storedDispatchDate);
const dispatchCustomDateEnd = ref(localStorage.getItem("hanye_dispatch_custom_date_end") || dispatchCustomDateStart.value);
const periodFilterRefs = {
  finance: financePeriodFilter,
  statement: statementMonthFilter,
  boss: bossPeriodFilter,
  customsBusiness: customsBusinessPeriodFilter,
  vehicleExpenses: vehicleExpensePeriodFilter
};
const initialDispatchDate = dispatchQuickDateValue(dispatchPeriodFilter.value) || storedDispatchDate;
const dispatchDate = ref(initialDispatchDate);
const activeDispatchStatusPool = ref(DISPATCH_PLAN_DEFAULT_STATUS);
const dispatchPlanRows = ref([]);
const dispatchLoadedDates = ref([dispatchDate.value]);
const selectedDispatchPlanIds = ref([]);
const dispatchModalOpen = ref(false);
const dispatchDuplicateModalOpen = ref(false);
const dispatchDuplicateDraftRows = ref([]);
const editingDispatchRowId = ref("");
const copyingDispatchRowId = ref("");
const dispatchCustomerPickerOpen = ref(false);
const dispatchCustomerKeyword = ref("");
const orderStatusFilter = ref("");
const partnerSearch = ref("");
const orderCustomerFilter = ref("");
const orderBusinessFilter = ref("");
const vehicleDriverSearch = ref("");

const customerRows = ref([]);
const customerContactRows = ref([]);
const orderRows = ref([]);
const vehicleRows = ref([]);
const vehicleExpenseRows = ref([]);
const driverRows = ref([]);
const driverWageRuleRows = ref([]);
const costCenterRateRows = ref([]);
const bossVehicleExchangeRateRows = ref([]);
const driverAdjustmentRows = ref([]);
const recycleRows = ref([]);
const feeItemRows = ref([]);
const freightRateRows = ref([]);
const templateRows = ref([]);
const templateRowsLoaded = ref(false);
const ruleRows = ref([]);
const masterRows = ref([]);
const accountRows = ref([]);
const auditRows = ref([]);
const orderAttachmentRows = ref([]);
const orderAttachmentUploading = ref(false);
const orderAttachmentUploadStatus = ref("");
const orderAttachmentUploadTone = ref("busy");
const customerFileRows = ref([]);
const attachmentRecycleRows = ref([]);
const vehicleFileRows = ref([]);
const driverFileRows = ref([]);

const selectedCustomerId = ref(customerRows.value[0]?.id || "");
const selectedVehiclePlate = ref(vehicleRows.value[0]?.plate || "");
const selectedDriverId = ref(driverRows.value[0]?.id || null);
const selectedCustomerIds = ref([]);
const selectedOrderNos = ref([]);
const selectedOrderRowNo = ref("");
const selectedVehiclePlates = ref([]);
const selectedDriverIds = ref([]);
const selectedDriverWageRuleId = ref(null);
const selectedSupplierCostRuleKeys = ref([]);
const activeCostCenterSource = ref(FEE_ITEM_COST_SOURCE_OPTIONS[0]);
const costCenterRuleModalOpen = ref(false);
const costCenterRuleSaving = ref(false);
const costCenterRuleForm = reactive({
  id: null,
  source: FEE_ITEM_COST_SOURCE_OPTIONS[0],
  entityId: "",
  entityRefId: "",
  entityName: "",
  origin: "",
  originLevel1: "",
  originLevel2: "",
  destination: "",
  destinationLevel1: "",
  destinationLevel2: "",
  costValues: {},
  note: ""
});
const costCenterRoutePicker = reactive({
  open: false,
  kind: ""
});
const addressBookRows = ref([]);
const hiddenAddressHistoryRows = ref([]);
const selectedAddressBookIds = ref([]);
const editingAddressBookId = ref("");
const addressBookFormOpen = ref(false);
const tableSortState = reactive({});

const loading = ref(false);
const apiStatus = ref("本地数据库连接中");
const notice = ref("");
let noticeTimer;
let orderAttachmentUploadStatusTimer;
let bossVehicleExchangeRateSaveTimer = null;
let bossVehicleExchangeRateSaveRequestId = 0;
let customerOrderResizeState = null;
let orderResizeState = null;
let relatedVehicleOrderResizeState = null;
let relatedDriverOrderResizeState = null;
let dataTableResizeState = null;
let draggedCustomerOrderColumnKey = "";
let draggedOrderColumnKey = "";
let draggedDispatchTableColumnKey = "";

const customerModalOpen = ref(false);
const contactModalOpen = ref(false);
const customerModalTab = ref("客户资料");
const orderModalOpen = ref(false);
const orderDetailNo = ref("");
const orderListDetailOpen = ref(false);
const orderListDetailScope = ref("orders");
const customerListDetailOpen = ref(false);
const dispatchListDetailOpen = ref(false);
const vehicleDriverListDetailOpen = ref(false);
const dispatchDetailId = ref("");
const feeItemManagerOpen = ref(false);
const saveFreightTemplateModalOpen = ref(false);
const recycleModalOpen = ref(false);
const attachmentRecycleModalOpen = ref(false);
const vehicleModalOpen = ref(false);
const vehicleExpenseModalOpen = ref(false);
const driverModalOpen = ref(false);
const filePreviewOpen = ref(false);
const orderCustomerPickerOpen = ref(false);
const customerOrderExportMenuOpen = ref(false);
const orderExportMenuOpen = ref(false);
const statementExportMenuOpen = ref(false);
const statementExportMenuCustomerKey = ref("");
const customerOrderColumnMenuOpen = ref(false);
const orderColumnMenuOpen = ref(false);
const dispatchColumnMenuOpen = ref(false);
const accountPasswordModalOpen = ref(false);
const accountProfileModalOpen = ref(false);
const accountCreateModalOpen = ref(false);
const accountEditModalOpen = ref(false);
const customsBusinessModalOpen = ref(false);
const accountPasswordSaving = ref(false);
const accountProfileSaving = ref(false);
const accountCreateSaving = ref(false);
const accountEditSaving = ref(false);
const customsBusinessSaving = ref(false);
const vehicleExpenseSaving = ref(false);
const orderExportExchangeMode = ref("");
const orderExportExchangeRate = ref("");
const orderCustomerKeyword = ref("");
const previewFile = ref(null);

const editingCustomerId = ref("");
const editingContactId = ref(null);
const editingContactRowId = ref(null);
const newContactRowActive = ref(false);
const editingOrderNo = ref("");
const editingVehiclePlate = ref("");
const editingVehicleExpenseId = ref(null);
const editingDriverId = ref(null);
const feeItemFormOpen = ref(false);
const editingFeeItemRowId = ref(null);

function blankCustomsBusinessForm() {
  return {
    date: todayInputValue(),
    declarationNo: "",
    sixSheetNo: "",
    company: "",
    direction: "",
    itemCount: 0,
    pageCount: 0,
    customsFee: 0,
    pageFee: 0,
    manifestFee: 0,
    inspectionFee: 0,
    checkFee: 0,
    otherFee: 0,
    remark: ""
  };
}

const customsBusinessForm = reactive(blankCustomsBusinessForm());

const customerForm = reactive({
  type: "客户",
  name: "",
  province: "",
  city: "",
  address: "",
  term: "",
  settlementCurrency: "人民币结算",
  taxNo: "",
  contact: "",
  mobile: "",
  defaultTemplateId: "",
  invoiceTitle: "",
  invoiceTax: "",
  invoiceBank: "",
  invoiceAccount: "",
  invoiceAddressPhone: "",
  invoicePasteText: ""
});

const contactForm = reactive({
  customerId: "",
  name: "",
  gender: "",
  title: "",
  mobile: "",
  phone: "",
  area: "",
  address: "",
  fax: "",
  email: "",
  wechat: "",
  qq: "",
  remark: ""
});

const accountPasswordForm = reactive({
  current: "",
  next: "",
  confirm: ""
});

const accountProfileForm = reactive({
  displayName: "",
  phone: "",
  email: "",
  note: ""
});

const contactRowDraft = reactive({
  name: "",
  gender: "",
  title: "",
  mobile: "",
  phone: "",
  area: "",
  address: "",
  fax: "",
  email: "",
  wechat: "",
  qq: "",
  remark: ""
});

const dispatchForm = reactive({
  date: "",
  customerId: "",
  customer: "",
  plate: "",
  port: "",
  direction: "",
  tonnage: "",
  quantity: "",
  weight: "",
  loading: "",
  unloading: "",
  loadTime: "",
  vehicleSource: "",
  supplier: "",
  note: ""
});

const chinaProvinceCities = {
  "北京市": ["北京市"],
  "天津市": ["天津市"],
  "河北省": ["石家庄市", "唐山市", "秦皇岛市", "邯郸市", "邢台市", "保定市", "张家口市", "承德市", "沧州市", "廊坊市", "衡水市"],
  "山西省": ["太原市", "大同市", "阳泉市", "长治市", "晋城市", "朔州市", "晋中市", "运城市", "忻州市", "临汾市", "吕梁市"],
  "内蒙古自治区": ["呼和浩特市", "包头市", "乌海市", "赤峰市", "通辽市", "鄂尔多斯市", "呼伦贝尔市", "巴彦淖尔市", "乌兰察布市", "兴安盟", "锡林郭勒盟", "阿拉善盟"],
  "辽宁省": ["沈阳市", "大连市", "鞍山市", "抚顺市", "本溪市", "丹东市", "锦州市", "营口市", "阜新市", "辽阳市", "盘锦市", "铁岭市", "朝阳市", "葫芦岛市"],
  "吉林省": ["长春市", "吉林市", "四平市", "辽源市", "通化市", "白山市", "松原市", "白城市", "延边朝鲜族自治州"],
  "黑龙江省": ["哈尔滨市", "齐齐哈尔市", "鸡西市", "鹤岗市", "双鸭山市", "大庆市", "伊春市", "佳木斯市", "七台河市", "牡丹江市", "黑河市", "绥化市", "大兴安岭地区"],
  "上海市": ["上海市"],
  "江苏省": ["南京市", "无锡市", "徐州市", "常州市", "苏州市", "南通市", "连云港市", "淮安市", "盐城市", "扬州市", "镇江市", "泰州市", "宿迁市"],
  "浙江省": ["杭州市", "宁波市", "温州市", "嘉兴市", "湖州市", "绍兴市", "金华市", "衢州市", "舟山市", "台州市", "丽水市"],
  "安徽省": ["合肥市", "芜湖市", "蚌埠市", "淮南市", "马鞍山市", "淮北市", "铜陵市", "安庆市", "黄山市", "滁州市", "阜阳市", "宿州市", "六安市", "亳州市", "池州市", "宣城市"],
  "福建省": ["福州市", "厦门市", "莆田市", "三明市", "泉州市", "漳州市", "南平市", "龙岩市", "宁德市"],
  "江西省": ["南昌市", "景德镇市", "萍乡市", "九江市", "新余市", "鹰潭市", "赣州市", "吉安市", "宜春市", "抚州市", "上饶市"],
  "山东省": ["济南市", "青岛市", "淄博市", "枣庄市", "东营市", "烟台市", "潍坊市", "济宁市", "泰安市", "威海市", "日照市", "临沂市", "德州市", "聊城市", "滨州市", "菏泽市"],
  "河南省": ["郑州市", "开封市", "洛阳市", "平顶山市", "安阳市", "鹤壁市", "新乡市", "焦作市", "濮阳市", "许昌市", "漯河市", "三门峡市", "南阳市", "商丘市", "信阳市", "周口市", "驻马店市", "济源市"],
  "湖北省": ["武汉市", "黄石市", "十堰市", "宜昌市", "襄阳市", "鄂州市", "荆门市", "孝感市", "荆州市", "黄冈市", "咸宁市", "随州市", "恩施土家族苗族自治州", "仙桃市", "潜江市", "天门市", "神农架林区"],
  "湖南省": ["长沙市", "株洲市", "湘潭市", "衡阳市", "邵阳市", "岳阳市", "常德市", "张家界市", "益阳市", "郴州市", "永州市", "怀化市", "娄底市", "湘西土家族苗族自治州"],
  "广东省": ["广州市", "韶关市", "深圳市", "珠海市", "汕头市", "佛山市", "江门市", "湛江市", "茂名市", "肇庆市", "惠州市", "梅州市", "汕尾市", "河源市", "阳江市", "清远市", "东莞市", "中山市", "潮州市", "揭阳市", "云浮市"],
  "广西壮族自治区": ["南宁市", "柳州市", "桂林市", "梧州市", "北海市", "防城港市", "钦州市", "贵港市", "玉林市", "百色市", "贺州市", "河池市", "来宾市", "崇左市"],
  "海南省": ["海口市", "三亚市", "三沙市", "儋州市", "五指山市", "琼海市", "文昌市", "万宁市", "东方市"],
  "重庆市": ["重庆市"],
  "四川省": ["成都市", "自贡市", "攀枝花市", "泸州市", "德阳市", "绵阳市", "广元市", "遂宁市", "内江市", "乐山市", "南充市", "眉山市", "宜宾市", "广安市", "达州市", "雅安市", "巴中市", "资阳市", "阿坝藏族羌族自治州", "甘孜藏族自治州", "凉山彝族自治州"],
  "贵州省": ["贵阳市", "六盘水市", "遵义市", "安顺市", "毕节市", "铜仁市", "黔西南布依族苗族自治州", "黔东南苗族侗族自治州", "黔南布依族苗族自治州"],
  "云南省": ["昆明市", "曲靖市", "玉溪市", "保山市", "昭通市", "丽江市", "普洱市", "临沧市", "楚雄彝族自治州", "红河哈尼族彝族自治州", "文山壮族苗族自治州", "西双版纳傣族自治州", "大理白族自治州", "德宏傣族景颇族自治州", "怒江傈僳族自治州", "迪庆藏族自治州"],
  "西藏自治区": ["拉萨市", "日喀则市", "昌都市", "林芝市", "山南市", "那曲市", "阿里地区"],
  "陕西省": ["西安市", "铜川市", "宝鸡市", "咸阳市", "渭南市", "延安市", "汉中市", "榆林市", "安康市", "商洛市"],
  "甘肃省": ["兰州市", "嘉峪关市", "金昌市", "白银市", "天水市", "武威市", "张掖市", "平凉市", "酒泉市", "庆阳市", "定西市", "陇南市", "临夏回族自治州", "甘南藏族自治州"],
  "青海省": ["西宁市", "海东市", "海北藏族自治州", "黄南藏族自治州", "海南藏族自治州", "果洛藏族自治州", "玉树藏族自治州", "海西蒙古族藏族自治州"],
  "宁夏回族自治区": ["银川市", "石嘴山市", "吴忠市", "固原市", "中卫市"],
  "新疆维吾尔自治区": ["乌鲁木齐市", "克拉玛依市", "吐鲁番市", "哈密市", "昌吉回族自治州", "博尔塔拉蒙古自治州", "巴音郭楞蒙古自治州", "阿克苏地区", "克孜勒苏柯尔克孜自治州", "喀什地区", "和田地区", "伊犁哈萨克自治州", "塔城地区", "阿勒泰地区"],
  "香港特别行政区": ["香港特别行政区"],
  "澳门特别行政区": ["澳门特别行政区"],
  "台湾省": ["台北市", "新北市", "桃园市", "台中市", "台南市", "高雄市", "基隆市", "新竹市", "嘉义市"]
};

const provinceOptions = Object.keys(chinaProvinceCities);

const orderForm = reactive({
  dispatchNo: "",
  customerId: "",
  customer: "",
  businessType: "",
  port: "",
  direction: "",
  tonnage: "",
  currency: "",
  quantity: "",
  weight: "",
  vehicleSource: "",
  supplier: "",
  plate: "",
  driver: "",
  hkDriver: "",
  mainlandDriver: "",
  transportMode: "",
  loading: "",
  loadingContact: "",
  loadingPhone: "",
  unloading: "",
  unloadingContact: "",
  unloadingPhone: "",
  date: "",
  receivableHKD: 0,
  receivableRMB: 0,
  status: "",
  remark: "",
  tripNoEnabled: false,
  tripNo: "",
  sixSheetEnabled: false,
  sixSheetNo: "",
  customsNo: "",
  customsUnit: "",
  customsItemCount: "",
  customsPageCount: ""
});
const orderFees = ref([]);
const selectedFeeItemId = ref(null);
const feeItemManagerTargetIndex = ref(null);
const draggedFeeItemId = ref(null);
const selectedFreightRateId = ref(null);
const selectedFreightGroupKeys = ref([]);
const freightDirectionFilter = ref(SHARED_DIRECTION);
const freightPanelTab = ref(FREIGHT_QUOTE_TAB);
const freightQuoteView = ref(FREIGHT_QUOTE_ROOT_VIEW);
const activeFreightQuoteType = ref(PUBLIC_FREIGHT_QUOTE_TYPE);
const selectedFreightCustomerId = ref("");
const freightDirectoryLevel = ref("level1");
const freightParentLevel1 = ref("");
const freightParentLevel2 = ref("");
const selectedTemplateId = ref(null);
const templateModalOpen = ref(false);
const templateEditorLoading = ref(false);
const selectedRuleId = ref(null);
const selectedMasterId = ref(null);
const selectedAccountId = ref(null);
const dispatchMessageOpen = ref(false);
const pendingDispatchBindId = ref("");
const loadFeeTemplateMenuOpen = ref(false);
const locationPicker = reactive({
  open: false,
  owner: "order",
  mode: "template",
  target: "loading",
  keyword: "",
  detail: "",
  level1: "",
  level2: "",
  level3: ""
});
const routeTreeDropdown = reactive({
  open: false,
  target: "loading",
  level1: "",
  level2: "",
  level3: ""
});
const addressBookAreaTree = reactive({
  open: false,
  level1: "",
  level2: "",
  level3: ""
});
const contactAreaTree = reactive({
  open: false,
  level1: "",
  level2: "",
  level3: ""
});
const feeItemNameInput = ref(null);
const customerSplitPercent = ref(Number(localStorage.getItem("hanye_customer_split_percent") || 58));
const vehicleSplitPercent = ref(Number(localStorage.getItem("hanye_vehicle_split_percent") || 46));
const customerOrderColumnWidths = reactive(loadCustomerOrderColumnWidths());
const orderColumnWidths = reactive(loadOrderColumnWidths());
const relatedVehicleOrderColumnWidths = reactive(loadRelatedOrderColumnWidths(relatedVehicleOrderColumns, RELATED_VEHICLE_ORDER_COLUMN_STORAGE_KEY));
const relatedDriverOrderColumnWidths = reactive(loadRelatedOrderColumnWidths(relatedDriverOrderColumns, RELATED_DRIVER_ORDER_COLUMN_STORAGE_KEY));
const financeWageTableColumnWidths = reactive(loadDataTableColumnWidths("finance_wages", financeWageTableColumns));
const financeWageDetailColumnWidths = reactive({});
const financeWageTableColumnVisibility = reactive(loadDataTableColumnVisibility("finance_wages", financeWageTableColumns));
const financeWageDetailColumnVisibility = reactive(loadStoredJson(dataTableStorageKey("finance_wage_detail", "visibility"), {}));
const financeWageDetailColumnOrder = ref(loadStoredJson(dataTableStorageKey("finance_wage_detail", "order"), []));
const financeWageDetailLockedColumns = ref(loadStoredJson(dataTableStorageKey("finance_wage_detail", "locked"), ["no"]));
const dispatchTableColumnWidths = reactive(loadDataTableColumnWidths("dispatch_board", dispatchTableColumns));
const dispatchTableColumnVisibility = reactive(loadDataTableColumnVisibility("dispatch_board", dispatchTableColumns));
applyDataTableColumnOrder(dispatchTableColumns, "dispatch_board");
const customerListDetailColumnWidths = reactive(loadDataTableColumnWidths("customer_list_detail", customerListDetailColumns));
const customerListDetailColumnVisibility = reactive(loadDataTableColumnVisibility("customer_list_detail", customerListDetailColumns));
applyDataTableColumnOrder(customerListDetailColumns, "customer_list_detail");
const vehicleListDetailColumnWidths = reactive(loadDataTableColumnWidths("vehicle_list_detail", vehicleListDetailColumns));
const vehicleListDetailColumnVisibility = reactive(loadDataTableColumnVisibility("vehicle_list_detail", vehicleListDetailColumns));
applyDataTableColumnOrder(vehicleListDetailColumns, "vehicle_list_detail");
const driverListDetailColumnWidths = reactive(loadDataTableColumnWidths("driver_list_detail", driverListDetailColumns));
const driverListDetailColumnVisibility = reactive(loadDataTableColumnVisibility("driver_list_detail", driverListDetailColumns));
applyDataTableColumnOrder(driverListDetailColumns, "driver_list_detail");
const customerOrderColumnVisibility = reactive(loadColumnVisibility(customerOrderColumns, CUSTOMER_ORDER_COLUMN_VISIBILITY_KEY));
const orderColumnVisibility = reactive(loadColumnVisibility(orderColumns, ORDER_COLUMN_VISIBILITY_KEY));
const customerOrderLockedColumns = ref(loadStoredJson(CUSTOMER_ORDER_COLUMN_LOCKED_KEY, []));
const orderLockedColumns = ref(loadStoredJson(ORDER_COLUMN_LOCKED_KEY, []));
const dataTableDensity = ref(localStorage.getItem("hanye_data_table_density") || "compact");

const addressBookForm = reactive({
  area: "",
  contact: "",
  phone: "",
  address: "",
  note: ""
});

const vehicleForm = reactive({
  plate: "",
  brand: "",
  model: "",
  type: "3T",
  purchaseDate: "",
  factoryDate: "",
  mainlandReviewDate: "",
  hkReviewDate: "",
  mainlandInsuranceDate: "",
  hkInsuranceDate: "",
  insuranceReminder: "提前30天",
  maintenanceReminder: "",
  status: "正常",
  monthlyCost: 0,
  note: ""
});

const vehicleExpenseForm = reactive({
  type: "fuel",
  name: "",
  plate: "",
  date: todayInputValue(),
  year: Number(currentPeriodMonthKey().slice(0, 4)),
  currency: "人民币",
  amount: "",
  note: ""
});

const driverForm = reactive({
  id: null,
  type: "香港司机",
  name: "",
  phone: "",
  idNo: "",
  license: "",
  birthday: "",
  hireDate: "",
  leaveDate: "",
  expireAt: "",
  status: "正常",
  note: ""
});

const driverWageRuleForm = reactive({
  id: null,
  driverId: null,
  direction: SHARED_DIRECTION,
  city: "",
  transportMode: "单司机",
  currency: "港币",
  baseRMB: 0,
  baseHKD: 0,
  loadPerBoard: 0,
  unloadPerBoard: 0,
  crossSeaFee: 0,
  addPointFee: 0,
  waitingPerHour: 0,
  advanceFeeRates: {},
  note: ""
});

const supplierCostRuleForm = reactive({
  id: null,
  supplierId: "",
  supplier: "",
  direction: SHARED_DIRECTION,
  city: "",
  tonnage: "3T",
  currency: "港币",
  baseRMB: 0,
  baseHKD: 0,
  loadPerBoard: 0,
  unloadPerBoard: 0,
  crossSeaFee: 0,
  addPointFee: 0,
  waitingPerHour: 0,
  advanceFeeRates: {},
  note: ""
});

const supplierCostRuleBatchForm = reactive({
  tonnage: "",
  baseRMB: "",
  baseHKD: "",
  loadPerBoard: "",
  unloadPerBoard: "",
  crossSeaFee: "",
  addPointFee: "",
  waitingPerHour: "",
  note: ""
});

const driverAdjustmentForm = reactive({
  id: null,
  driverId: null,
  date: todayInputValue(),
  type: "预支款",
  currency: "港币",
  amount: 0,
  status: "待工资结算",
  note: ""
});

const feeItemForm = reactive({
  id: null,
  category: "正常",
  name: "",
  currency: "港币",
  defaultAmount: 0,
  defaultDriverRole: "",
  costSources: ["供应商"]
});

const feeItemRowDraft = reactive({
  category: "正常",
  name: "",
  currency: "港币",
  defaultAmount: 0,
  defaultDriverRole: "",
  costSources: ["供应商"]
});

const freightRateForm = reactive({
  id: null,
  customerId: "",
  customerName: "",
  direction: "出口",
  level1: "",
  level2: "",
  level3: "",
  city: "深圳",
  tonnage: "3T",
  rmbAmount: 0,
  hkdAmount: 0
});

const showFreightBatchPanel = ref(false)
const freightBatchForm = reactive({
  tonnage: "3T",
  rmbAmount: "",
  hkdAmount: ""
});
const freightRowEditor = reactive({
  key: "",
  group: null,
  drafts: {}
});
const freightDirectoryCreator = reactive({
  open: false,
  level: "level1",
  name: "",
  drafts: {}
});

const templateForm = reactive({
  id: null,
  name: "",
  format: "通用",
  description: "",
  content: ""
});
let templateAutosaveTimer = null;
let templateAutosaveApplying = false;
let templateLastSavedSnapshot = "";
const templateDesigner = reactive({
  orientation: "portrait",
  header: "公司名称 / 导出标题\n日期：{{date}}",
  headerX: 18,
  headerY: 18,
  headerTextItems: [],
  footerTextItems: [],
  logo: "",
  logoName: "",
  logoWidth: 92,
  logoHeight: 56,
  logoFit: "contain",
  logoX: 18,
  logoY: 12,
  footer: "制表人：{{user}}    第 {{page}} 页 / 共 {{pages}} 页",
  headerHeight: 92,
  footerHeight: 70,
  headerFontFamily: "standard-serif-cn",
  headerFontSize: 14,
  headerTextColor: "#17233c",
  tableFontFamily: "standard-serif-cn",
  tableFontSize: 11,
  tableTextColor: "#1f2937",
  tableHeaderTextColor: "#164e8f",
  tableHeaderBgColor: "#eef6ff",
  tableBorderColor: "#dbeafe",
  tableBorderWidth: 1,
  tableHeaderBold: true,
  tableBold: false,
  tableAlign: "left",
  footerFontFamily: "standard-serif-cn",
  footerFontSize: 12,
  footerTextColor: "#64748b",
  previewZoom: "fit",
  columns: [
    { key: "no", label: "订单号", visible: true, fontSize: 11 },
    { key: "customer", label: "客户", visible: true, fontSize: 11 },
    { key: "date", label: "日期", visible: true, fontSize: 11 },
    { key: "businessType", label: "业务类型", visible: true, fontSize: 11 },
    { key: "loading", label: "装货地", visible: true, fontSize: 11 },
    { key: "unloading", label: "卸货地", visible: true, fontSize: 11 },
    { key: "status", label: "状态", visible: true, fontSize: 11 }
  ]
});
const activeTemplateVariableTarget = reactive({
  type: "header",
  id: ""
});
const templateTextToolbarOpen = ref(false);
const templateTableToolbarOpen = ref(false);
const activeTemplateColumnKey = ref("");
const activeTemplateTableSelection = reactive({
  type: "table",
  rowIndex: null
});
const freightTemplateNameForm = reactive({
  name: ""
});
const templateLogoDrag = reactive({
  active: false,
  target: "",
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0
});
const editingTemplateTextKey = ref("");
const templateTextResize = reactive({
  active: false,
  type: "",
  id: "",
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0
});
const templateColumnResize = reactive({
  active: false,
  key: "",
  startX: 0,
  startWidth: 0
});

const ruleForm = reactive({
  id: null,
  ruleType: "业务规则",
  name: "",
  content: "",
  enabled: true
});

const masterForm = reactive({
  id: null,
  type: "口岸",
  name: "",
  value: "",
  sortOrder: 0
});

function blankAccountForm() {
  return {
    id: null,
    username: "",
    displayName: "",
    role: "跟单员",
    status: "启用",
    hireDate: "",
    phone: "",
    email: "",
    note: "",
    password: "",
    passwordConfirm: "",
    permissionsText: permissionTextForRole("跟单员")
  };
}

const accountForm = reactive(blankAccountForm());
const accountCreateForm = reactive(blankAccountForm());

const currentAllowedModuleIds = computed(() => {
  const roleModules = allowedModulesForRole(currentAccount.value?.role);
  const accountModules = currentAccount.value?.allowedModules;
  return Array.isArray(accountModules) && accountModules.length
    ? roleModules.filter((moduleId) => accountModules.includes(moduleId))
    : roleModules;
});

const visibleModules = computed(() =>
  MODULES.filter((item) => currentAllowedModuleIds.value.includes(normalizeRoute(item.id)))
);

const firstAccessibleModule = computed(() => normalizeRoute(visibleModules.value[0]?.id || "vehicleDriver"));

function canAccessModule(id) {
  return currentAllowedModuleIds.value.includes(normalizeRoute(id));
}

function navItemActive(item) {
  const normalized = normalizeRoute(item?.id);
  if (normalized !== activeModule.value) return false;
  if (normalized === "customers") {
    const partnerType = partnerTypeForCustomerRoute(item?.id);
    return !partnerType || partnerType === activePartnerType.value;
  }
  if (normalized === "vehicleDriver") {
    if (item.id === "driverManage") return activeVehicleTab.value === "司机管理";
    if (item.id === "vehicleManage" || item.id === "vehicle") return activeVehicleTab.value === "车辆管理";
  }
  return true;
}

const groupedModules = computed(() =>
  visibleModules.value.reduce((groups, item) => {
    groups[item.group] ||= [];
    groups[item.group].push(item);
    return groups;
  }, {})
);

const visibleCustomers = computed(() => {
  const keyword = partnerSearch.value.trim().toLowerCase();
  const rows = customerRows.value.filter((item) => {
    if (item.type !== activePartnerType.value) return false;
    if (!keyword) return true;
    return [item.id, item.name, item.city, item.term, partnerRecentOrderDate(item)]
      .some((value) => String(value || "").toLowerCase().includes(keyword));
  });
  return sortRowsByTable(rows, "customers");
});

const homeTodayOrders = computed(() =>
  orderRows.value.filter((order) => order.date === todayInputValue() && !order.deletedAt)
);

const homePendingOrders = computed(() =>
  orderRows.value.filter((order) => ["待确认", "已签收", "费用待确认", "缺票据"].includes(order.status))
);

const homeMonthlyNewCustomers = computed(() =>
  customerRows.value.filter((customer) =>
    customer.type === "客户" && isRelatedOrderDateMatch(customer.createdAt, "month")
  )
);

const homeDispatchOwnVehicleCount = computed(() =>
  dispatchPlanRows.value.filter((row) => row.vehicleSource === "本公司车辆").length
);

const homeDispatchOutsourceCount = computed(() =>
  dispatchPlanRows.value.filter((row) => row.vehicleSource === "外派车辆").length
);

const homeRecentCustomers = computed(() =>
  customerRows.value
    .filter((customer) => customer.type === "客户")
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 6)
);

const homeRecentDispatchRows = computed(() => dispatchPlanDisplayRows.value.slice(0, 6));

const dispatchModalNo = computed(() => {
  const editingRow = dispatchPlanRows.value.find((row) => row.id === editingDispatchRowId.value);
  return editingRow?.dispatchNo || generateDispatchNo(dispatchForm.date || dispatchDate.value);
});

const customerModalTitleId = computed(() => editingCustomerId.value || "KH00021053");
const availableCustomerCities = computed(() => chinaProvinceCities[customerForm.province] || []);
const orderModalTitleNo = computed(() => editingOrderNo.value || `HY${new Date().toISOString().slice(2, 10).replace(/-/g, "")}0001`);

const selectedVehicleDriverCount = computed(() =>
  activeVehicleTab.value === "车辆管理" ? selectedVehiclePlates.value.length : selectedDriverIds.value.length
);

const vehicleDriverListDetailRows = computed(() => {
  if (activeVehicleTab.value === "车辆管理") {
    return selectedVehiclePlates.value.length
      ? visibleVehicles.value.filter((item) => selectedVehiclePlates.value.includes(item.plate))
      : visibleVehicles.value;
  }
  return selectedDriverIds.value.length
    ? visibleDrivers.value.filter((item) => selectedDriverIds.value.includes(item.id))
    : visibleDrivers.value;
});

function firstCustomerIdForActiveType(rows = customerRows.value) {
  return rows.find((item) => item.type === activePartnerType.value)?.id || rows[0]?.id || "";
}

const selectedCustomer = computed(() =>
  visibleCustomers.value.find((item) => item.id === selectedCustomerId.value) || visibleCustomers.value[0] || null
);

const selectedVehicle = computed(() =>
  vehicleRows.value.find((item) => item.plate === selectedVehiclePlate.value) || vehicleRows.value[0]
);

const selectedDriver = computed(() =>
  driverRows.value.find((item) => item.id === selectedDriverId.value) || driverRows.value[0]
);
const selectedDriverIsMainlandRider = computed(() => selectedDriver.value?.type === "大陆骑师");
const driverTypeOptions = computed(() => {
  const customTypes = driverRows.value
    .map((driver) => String(driver.type || "").trim())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_DRIVER_TYPES, ...customTypes]));
});
const hongKongDriverOptions = computed(() => driverRows.value.filter((driver) => (driver.type || "香港司机") === "香港司机"));
const mainlandDriverOptions = computed(() => driverRows.value.filter((driver) => driver.type === "大陆骑师"));
const generalDriverOptions = computed(() => {
  const preferred = driverRows.value.filter((driver) => !["大陆骑师"].includes(driver.type || "香港司机"));
  return preferred.length ? preferred : driverRows.value;
});
const orderIsCustomsOnly = computed(() => orderForm.businessType === "报关");
const orderHasTransportFields = computed(() => orderForm.businessType !== "报关");
const orderHasCustomsFields = computed(() => ["报关", "运输+报关"].includes(orderForm.businessType));
const orderUsesOwnVehicle = computed(() => orderForm.vehicleSource === "本公司车辆");
const orderUsesOutsourcedVehicle = computed(() => orderForm.vehicleSource === "外派车辆");
const orderUsesDomesticTransfer = computed(() => orderUsesOwnVehicle.value && isDomesticTransferMode(orderForm.transportMode));
const orderUsesRelayDrivers = computed(() => orderUsesOwnVehicle.value && ["双司机", "口岸转国内车"].includes(normalizeTransportMode(orderForm.transportMode)));
const CUSTOMS_REMARK_PREFIX = "报关信息：";

function orderHasTransportFieldsForOrder(order = {}) {
  return order.businessType !== "报关";
}

const selectedDriverWageRules = computed(() => {
  const driverId = selectedDriver.value?.id || null;
  const rows = driverWageRuleRows.value.filter((item) =>
    (item.driverId === driverId || item.driverId === null)
    && driverWageTransportModeOptions.value.includes(normalizeTransportMode(item.transportMode || "单司机"))
  );
  const uniqueRows = new Map();
  rows.forEach((item) => {
    const key = [
      item.driverId || "",
      item.direction || SHARED_DIRECTION,
      driverWageCityValue(item.city),
      normalizeTransportMode(item.transportMode || "单司机"),
      item.currency || "港币"
    ].join("|");
    if (!uniqueRows.has(key) || item.direction === SHARED_DIRECTION) uniqueRows.set(key, item);
  });
  return Array.from(uniqueRows.values());
});
const driverWageTransportModeOptions = computed(() =>
  selectedDriverIsMainlandRider.value ? ["双司机"] : TRANSPORT_MODE_OPTIONS
);

function driverWageCityValue(value) {
  return normalizeFreightLabel(String(value || "").split(/[\/｜|>]+/)[0] || "");
}

function supplierCostRuleCityValue(value) {
  return driverWageCityValue(value);
}

function supplierCostRuleAreaValue(value) {
  const parts = String(value || "")
    .split(/[\/｜|>]+/)
    .map((item) => normalizeFreightLabel(item))
    .filter(Boolean);
  return parts.slice(0, 2).join("/") || supplierCostRuleCityValue(value);
}

function relatedOrderLocationText(value) {
  const parts = String(value || "")
    .split(/[\/｜|>]+/)
    .map((item) => normalizeFreightLabel(item))
    .filter(Boolean);
  return parts.slice(0, 2).join(" / ") || "-";
}

function relatedOrderRouteText(order) {
  return `${relatedOrderLocationText(order?.loading)} → ${relatedOrderLocationText(order?.unloading)}`;
}

function supplierCostRuleLevelParts(value) {
  const parts = String(value || "")
    .split(/[\/｜|>]+/)
    .map((item) => normalizeFreightLabel(item))
    .filter(Boolean);
  return {
    level1: parts[0] || "",
    level2: parts[1] || "",
    label: parts.slice(0, 2).join("/") || parts[0] || ""
  };
}

function supplierCostGroupKey(direction, level1) {
  return [direction || "", level1 || ""].join("|");
}

function supplierCostRuleAreaMatches(ruleArea, orderArea) {
  const normalizedRuleArea = supplierCostRuleAreaValue(ruleArea);
  const normalizedOrderArea = supplierCostRuleAreaValue(orderArea);
  if (!normalizedRuleArea || !normalizedOrderArea) return false;
  return normalizedRuleArea === normalizedOrderArea
    || normalizedOrderArea.startsWith(`${normalizedRuleArea}/`)
    || normalizedRuleArea.startsWith(`${normalizedOrderArea}/`);
}

const driverWageAreaOptions = computed(() => {
  return uniqueSorted(freightRateGroups.value
    .map((group) => driverWageCityValue(group.level1))
    .filter(Boolean));
});

const supplierCostCityOptions = computed(() => {
  return supplierCostRuleAreasForDirection(supplierCostRuleForm.direction);
});

function supplierCostRuleAreasForDirection(direction = "") {
  const areas = [];
  freightRateGroups.value
    .filter((group) => supplierCostRuleDirection(direction) === SUPPLIER_COST_SHARED_DIRECTION || !direction || group.direction === direction)
    .forEach((group) => {
      const level1 = supplierCostRuleAreaValue(group.level1);
      const level2 = supplierCostRuleAreaValue([group.level1, group.level2].filter(Boolean).join("/"));
      if (level1) areas.push(level1);
      if (level2 && level2 !== level1) areas.push(level2);
    });
  return uniqueSorted(areas);
}

function parseSupplierCostRuleTemplate(item) {
  try {
    const content = JSON.parse(item?.content || "{}");
    if (content?.type === "outsourced-cost-rule") return content;
    if (String(item?.name || "").startsWith("外派费用规则-") && content?.city && content?.tonnage) {
      return {
        type: "outsourced-cost-rule",
        supplierId: content.supplierId || "",
        supplier: content.supplier && content.supplier !== "供应商" ? content.supplier : "",
        ...content
      };
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeSupplierCostRuleAmounts(content = {}) {
  const legacyAmount = Number(content.amount || 0);
  return {
    baseRMB: Number(content.baseRMB ?? (content.currency === "人民币" ? legacyAmount : 0) ?? 0),
    baseHKD: Number(content.baseHKD ?? (content.currency !== "人民币" ? legacyAmount : 0) ?? 0),
    loadPerBoard: Number(content.loadPerBoard || 0),
    unloadPerBoard: Number(content.unloadPerBoard || 0),
    crossSeaFee: Number(content.crossSeaFee || 0),
    addPointFee: Number(content.addPointFee || 0),
    waitingPerHour: Number(content.waitingPerHour || 0)
  };
}

function normalizeAdvanceFeeRates(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {})
      .map(([key, amount]) => [String(key), Number(amount || 0)])
      .filter(([key]) => key)
  );
}

function orderHasFeeItem(order, item = {}) {
  const key = advanceFeeRateKey(item);
  const name = String(item.name || "").trim();
  return (Array.isArray(order?.fees) ? order.fees : []).some((fee) => {
    if (!isAdvanceFee(fee)) return false;
    if (Number(fee?.amount || 0) === 0) return false;
    const feeItemId = String(fee?.feeItemId || fee?.fee_item_id || "").trim();
    if (key && feeItemId && feeItemId === key) return true;
    return name && String(fee?.name || "").trim() === name;
  });
}

function advanceFeeRateTotalForOrder(order, rates = {}) {
  return advanceFeeItemRows.value.reduce((sum, item) => {
    if (!orderHasFeeItem(order, item)) return sum;
    return sum + advanceFeeRateValue(rates, item);
  }, 0);
}

function supplierCostRuleAmount(rule, order = orderForm) {
  if (!rule) return 0;
  const base = order?.currency === "人民币" ? Number(rule.baseRMB || 0) : Number(rule.baseHKD || 0);
  const dynamicExtraTotal = advanceFeeRateTotalForOrder(order, rule.advanceFeeRates);
  const extraTotal = ["loadPerBoard", "unloadPerBoard", "crossSeaFee", "addPointFee", "waitingPerHour"]
    .reduce((sum, field) => {
      if (!orderHasActualDriverExtraFee(order, field)) return sum;
      const amount = Number(rule[field] || 0);
      return sum + (["loadPerBoard", "unloadPerBoard"].includes(field) ? orderDriverExtraQuantity(order, field) * amount : amount);
    }, 0);
  return base + extraTotal + dynamicExtraTotal;
}

function supplierCostRuleCurrency(rule, order = orderForm) {
  if (!rule) return "";
  return order?.currency === "人民币" ? "人民币" : "港币";
}

function supplierCostRuleDirection(value = "") {
  return String(value || "").trim() || SUPPLIER_COST_SHARED_DIRECTION;
}

function supplierCostRuleDirectionMatches(ruleDirection = "", orderDirection = "") {
  const direction = supplierCostRuleDirection(ruleDirection);
  return direction === SUPPLIER_COST_SHARED_DIRECTION || direction === orderDirection;
}

const supplierCostRuleRows = computed(() =>
  templateRows.value
    .map((item) => ({ item, content: parseSupplierCostRuleTemplate(item) }))
    .filter(({ content }) => content)
    .map(({ item, content }) => {
      const amounts = normalizeSupplierCostRuleAmounts(content);
      return {
        id: item.id,
        name: item.name,
        supplierId: content.supplierId || "",
        supplier: content.supplier || "",
        direction: supplierCostRuleDirection(content.direction),
        city: supplierCostRuleAreaValue(content.city || ""),
        tonnage: content.tonnage || "",
        currency: content.currency || "港币",
        ...amounts,
        advanceFeeRates: normalizeAdvanceFeeRates(content.advanceFeeRates),
        note: content.note || "",
        updatedAt: item.updatedAt
      };
    })
);

const supplierCostRuleSyncedRows = computed(() => {
  const supplier = selectedCustomer.value;
  if (!supplier || supplier.type !== "供应商") return [];
  const savedRules = supplierCostRuleRows.value.filter((item) =>
    (supplier.id && item.supplierId === supplier.id)
    || (supplier.name && item.supplier === supplier.name)
  );
  const savedByKey = new Map();
  savedRules.forEach((rule) => {
    const key = [
      rule.direction || "",
      supplierCostRuleAreaValue(rule.city || ""),
      rule.tonnage || "",
      rule.currency || "港币"
    ].join("|");
    if (!savedByKey.has(key)) savedByKey.set(key, rule);
  });
  const rows = [];
  const areas = supplierCostRuleAreasForDirection(SUPPLIER_COST_SHARED_DIRECTION);
  areas.forEach((area) => {
    TONNAGE_OPTIONS.forEach((tonnage) => {
      const key = [SUPPLIER_COST_SHARED_DIRECTION, area, tonnage, "港币"].join("|");
      const saved = savedByKey.get(key)
        || savedByKey.get(["出口", area, tonnage, "港币"].join("|"))
        || savedByKey.get(["进口", area, tonnage, "港币"].join("|"));
      rows.push(saved ? {
        ...saved,
        key,
        direction: SUPPLIER_COST_SHARED_DIRECTION
      } : {
        id: null,
        key,
        supplierId: supplier.id,
        supplier: supplier.name,
        direction: SUPPLIER_COST_SHARED_DIRECTION,
        city: area,
        tonnage,
        currency: "港币",
        baseRMB: "",
        baseHKD: "",
        loadPerBoard: "",
        unloadPerBoard: "",
        crossSeaFee: "",
        addPointFee: "",
        waitingPerHour: "",
        advanceFeeRates: {},
        note: ""
      });
    });
  });
  savedRules.forEach((rule) => {
    if ([SUPPLIER_COST_SHARED_DIRECTION, ...DIRECTION_OPTIONS].includes(supplierCostRuleDirection(rule.direction))) return;
    const key = [
      rule.direction || "",
      supplierCostRuleAreaValue(rule.city || ""),
      rule.tonnage || "",
      rule.currency || "港币"
    ].join("|");
    if (!rows.some((row) => row.id === rule.id || row.key === key)) rows.push(rule);
  });
  return rows.map((row) => ({
    key: row.key || row.id || [row.direction, row.city, row.tonnage, row.currency].join("|"),
    ...row
  }));
});

const selectedSupplierCostRules = computed(() => {
  return supplierCostRuleSyncedRows.value;
});

const supplierCostRuleGroupedRows = computed(() => {
  const groups = new Map();
  selectedSupplierCostRules.value.forEach((rule) => {
    const parts = supplierCostRuleLevelParts(rule.city || "");
    const level1 = parts.level1 || rule.city || "";
    if (!level1) return;
    const parentKey = supplierCostGroupKey(rule.direction, level1);
    if (!groups.has(parentKey)) {
      groups.set(parentKey, {
        key: parentKey,
        direction: rule.direction || "",
        level: 1,
        level1,
        level2: "",
        label: level1,
        tonnageRules: {},
        children: new Map()
      });
    }
    const parent = groups.get(parentKey);
    const normalizedTonnage = rule.tonnage || "";
    if (!parts.level2) {
      parent.tonnageRules[normalizedTonnage] = rule;
      return;
    }
    const childKey = [parentKey, parts.level2].join("|");
    if (!parent.children.has(childKey)) {
      parent.children.set(childKey, {
        key: childKey,
        parentKey,
        direction: rule.direction || "",
        level: 2,
        level1,
        level2: parts.level2,
        label: parts.label,
        city: parts.label,
        tonnageRules: {}
      });
    }
    parent.children.get(childKey).tonnageRules[normalizedTonnage] = rule;
  });

  const rows = [];
  Array.from(groups.values())
    .sort((a, b) => `${a.direction}${a.level1}`.localeCompare(`${b.direction}${b.level1}`, "zh-Hans-CN"))
    .forEach((group) => {
      const children = Array.from(group.children.values())
        .sort((a, b) => a.level2.localeCompare(b.level2, "zh-Hans-CN"));
      rows.push({
        ...group,
        children,
        hasChildren: children.length > 0,
        expanded: expandedSupplierCostGroupKeys.value.includes(group.key)
      });
      if (expandedSupplierCostGroupKeys.value.includes(group.key)) rows.push(...children);
  });
  return rows;
});

const supplierCostExtraRows = computed(() => {
  const groups = new Map();
  selectedSupplierCostRules.value.forEach((rule) => {
    const direction = rule.direction || "";
    if (!direction) return;
    if (!groups.has(direction)) {
      groups.set(direction, {
        key: `extra-${direction}`,
        direction,
        rules: []
      });
    }
    groups.get(direction).rules.push(rule);
  });
  return Array.from(groups.values())
    .sort((a, b) => a.direction.localeCompare(b.direction, "zh-Hans-CN"));
});

const selectedSupplierCostRuleSet = computed(() => new Set(selectedSupplierCostRuleKeys.value));
const selectedSupplierCostRuleRows = computed(() =>
  selectedSupplierCostRules.value.filter((rule) => selectedSupplierCostRuleSet.value.has(rule.key))
);
const selectedSupplierCostBatchScopeSet = computed(() =>
  new Set(selectedSupplierCostRuleRows.value.map(supplierCostRuleBatchScopeKey))
);

function supplierCostRuleBatchScopeKey(rule) {
  return [
    rule?.supplierId || selectedCustomer.value?.id || rule?.supplier || "",
    supplierCostRuleDirection(rule?.direction || ""),
    supplierCostRuleAreaValue(rule?.city || "")
  ].join("|");
}

const supplierCostBatchTargetRows = computed(() => {
  const tonnage = String(supplierCostRuleBatchForm.tonnage || "").trim();
  if (!tonnage) return selectedSupplierCostRuleRows.value;
  const selectedScopes = new Set(selectedSupplierCostRuleRows.value.map(supplierCostRuleBatchScopeKey));
  return selectedSupplierCostRules.value.filter((rule) =>
    rule.tonnage === tonnage && selectedScopes.has(supplierCostRuleBatchScopeKey(rule))
  );
});
const allSupplierCostRulesSelected = computed(() =>
  selectedSupplierCostRules.value.length > 0
  && selectedSupplierCostRules.value.every((rule) => selectedSupplierCostRuleSet.value.has(rule.key))
);

const matchedOutsourcedCostRule = computed(() => {
  if (!orderUsesOutsourcedVehicle.value || !orderForm.supplier) return null;
  const area = supplierCostRuleAreaValue(
    orderForm.direction === "进口" ? orderForm.unloading : orderForm.loading
  );
  const candidates = supplierCostRuleRows.value.filter((item) =>
    item.supplier === orderForm.supplier
    && supplierCostRuleDirectionMatches(item.direction, orderForm.direction)
    && (!item.city || supplierCostRuleAreaMatches(item.city, area))
    && (!item.tonnage || item.tonnage === orderForm.tonnage)
    && (!item.currency || item.currency === orderForm.currency)
  );
  return candidates.find((item) => supplierCostRuleDirection(item.direction) === orderForm.direction)
    || candidates.find((item) => supplierCostRuleDirection(item.direction) === SUPPLIER_COST_SHARED_DIRECTION)
    || null;
});

const selectedDriverAdjustments = computed(() => {
  const driverId = selectedDriver.value?.id || null;
  if (!driverId) return [];
  return driverAdjustmentRows.value.filter((item) => item.driverId === driverId);
});

const visibleVehicles = computed(() => {
  const keyword = vehicleDriverSearch.value.trim().toLowerCase();
  const rows = !keyword ? vehicleRows.value : vehicleRows.value.filter((item) =>
    [item.plate, item.brand, item.model, item.type, item.status, item.note]
      .some((value) => String(value || "").toLowerCase().includes(keyword))
  );
  return sortRowsByTable(rows, "vehicles");
});

const visibleDrivers = computed(() => {
  const keyword = vehicleDriverSearch.value.trim().toLowerCase();
  const rows = !keyword ? driverRows.value : driverRows.value.filter((item) =>
    [item.name, item.phone, item.license, item.expireAt, item.status, item.note]
      .some((value) => String(value || "").toLowerCase().includes(keyword))
  );
  return sortRowsByTable(rows, "drivers");
});

function isVehicleExpenseModule(moduleId = activeModule.value) {
  return Boolean(VEHICLE_EXPENSE_CONFIG_BY_MODULE[moduleId]);
}

const activeVehicleExpenseConfig = computed(() =>
  VEHICLE_EXPENSE_CONFIG_BY_MODULE[activeModule.value] || VEHICLE_EXPENSE_CONFIGS[0]
);

const visibleVehicleExpenses = computed(() => {
  const config = activeVehicleExpenseConfig.value;
  const keyword = vehicleDriverSearch.value.trim().toLowerCase();
  const rows = vehicleExpenseRows.value.filter((item) => item.type === config.type);
  const periodRows = config.type === "annual"
    ? rows
    : rows.filter((item) => dateMatchesPeriodFilter(item.date, periodFilterValue("vehicleExpenses")));
  const searchedRows = !keyword ? periodRows : periodRows.filter((item) =>
    [item.name, item.plate, item.date, item.year, item.currency, item.amount, item.note]
      .some((value) => String(value || "").toLowerCase().includes(keyword))
  );
  return sortRowsByTable(searchedRows, "vehicleExpenses");
});

const selectedVehicleExpenses = computed(() => {
  const plate = selectedVehicle.value?.plate;
  if (!plate) return [];
  return sortRowsByTable(
    vehicleExpenseRows.value.filter((item) => item.plate === plate),
    "vehicleDetailExpenses"
  );
});

const selectedVehicleExpenseTotal = computed(() =>
  selectedVehicleExpenses.value.reduce((sum, item) => {
    if (item.currency === "港币") {
      sum.hkd += Number(item.amount || 0);
    } else {
      sum.rmb += Number(item.amount || 0);
    }
    return sum;
  }, { hkd: 0, rmb: 0 })
);

function vehicleExpenseTypeLabel(type) {
  return VEHICLE_EXPENSE_CONFIG_BY_TYPE[type]?.title || "车辆支出";
}

function vehicleExpenseDateText(item = {}) {
  return item.type === "annual" ? `${item.year || String(item.date || "").slice(0, 4) || "-"}年` : (item.date || "-");
}

function vehicleExpenseAllocationText(item = {}) {
  if (item.type !== "annual") return "计入费用日期所在月份";
  const monthlyAmount = Number(item.amount || 0) / 12;
  return `按年录入，每月计入 ${item.currency || "人民币"} ${money(monthlyAmount)}`;
}

function vehicleExpenseYearOptions() {
  const currentYear = Number(currentPeriodMonthKey().slice(0, 4));
  const years = new Set([currentYear]);
  vehicleExpenseRows.value.forEach((item) => {
    if (item.year) years.add(Number(item.year));
    const dateYear = Number(String(item.date || "").slice(0, 4));
    if (dateYear) years.add(dateYear);
  });
  for (let offset = -5; offset <= 2; offset += 1) {
    years.add(currentYear + offset);
  }
  return Array.from(years).filter(Number.isFinite).sort((left, right) => right - left);
}

const selectedVehicleOrders = computed(() => {
  if (!selectedVehicle.value) return [];
  return sortRowsByTable(orderRows.value.filter((item) =>
    item.plate === selectedVehicle.value.plate
    && isRelatedOrderDateMatch(item.date, vehicleRelatedOrderDateFilter.value)
  ), "relatedVehicleOrders");
});

const selectedDriverOrders = computed(() => {
  if (!selectedDriver.value) return [];
  return sortRowsByTable(orderRows.value.filter(
    (item) =>
      (orderIncludesDriver(item, selectedDriver.value) || item.plate === selectedDriver.value.boundPlate)
      && isRelatedOrderDateMatch(item.date, driverRelatedOrderDateFilter.value)
  ), "relatedDriverOrders");
});

const selectedDriverMonthOrders = computed(() => {
  if (!selectedDriver.value) return [];
  return orderRows.value.filter(
    (item) =>
      (orderIncludesDriver(item, selectedDriver.value) || item.plate === selectedDriver.value.boundPlate)
      && isRelatedOrderDateMatch(item.date, "month")
  );
});

const dispatchWorkDateOrders = computed(() =>
  orderRows.value.filter((order) =>
    order.date === dispatchDate.value
    && !order.deletedAt
    && orderHasTransportFieldsForOrder(order)
  )
);

const dispatchPlannedOrderNos = computed(() =>
  new Set(dispatchPlanRows.value.map((row) => row.orderNo).filter(Boolean))
);

const dispatchUnplannedOrders = computed(() =>
  dispatchWorkDateOrders.value.filter((order) => !dispatchPlannedOrderNos.value.has(order.no))
);

const dispatchStatusPoolItems = computed(() =>
  DISPATCH_STATUS_OPTIONS.map((status) => ({
    status,
    count: dispatchPlanRows.value.filter((row) => (row.status || DISPATCH_PLAN_DEFAULT_STATUS) === status).length
  }))
);

const dispatchPlanDisplayRows = computed(() =>
  dispatchPlanRows.value
    .map((row, index) => {
      const order = orderRows.value.find((item) => item.no === row.orderNo) || null;
      return {
        ...row,
        index,
        order: order || {
          no: row.orderNo || "",
          customer: row.customer || "",
          date: row.date || dispatchDate.value,
          port: row.port || "",
          direction: row.direction || "",
          tonnage: row.tonnage || "",
          quantity: row.quantity || "",
          weight: row.weight || "",
          loading: row.loading || "",
          unloading: row.unloading || "",
          vehicleSource: row.vehicleSource || "",
          supplier: row.supplier || ""
        },
        vehicle: vehicleRows.value.find((vehicle) => vehicle.plate === row.plate) || null,
        hkDriverRow: driverRows.value.find((driver) => driver.name === row.hkDriver || driver.name === row.driver) || null,
        mainlandDriverRow: driverRows.value.find((driver) => driver.name === row.mainlandDriver) || null
      };
    })
    .sort(compareDispatchPlanRowsForAutoSort)
    .map((row, displayIndex) => ({ ...row, displayIndex }))
);

const selectedDispatchPlanRows = computed(() => {
  const selected = new Set(selectedDispatchPlanIds.value);
  return dispatchPlanDisplayRows.value.filter((row) => selected.has(row.id));
});

const dispatchStatusPoolRows = computed(() => {
  return dispatchPlanDisplayRows.value.filter((row) => (row.status || DISPATCH_PLAN_DEFAULT_STATUS) === activeDispatchStatusPool.value);
});

const allDispatchPlanRowsSelected = computed(() =>
  searchedDispatchPlanRows.value.length > 0 &&
  searchedDispatchPlanRows.value.every((row) => selectedDispatchPlanIds.value.includes(row.id))
);

const dispatchListDetailRows = computed(() =>
  selectedDispatchPlanRows.value.length ? selectedDispatchPlanRows.value : searchedDispatchPlanRows.value
);

const dispatchPlanWarnings = computed(() => {
  const warnings = [];
  const plateCounts = new Map();
  const driverCounts = new Map();
  dispatchPlanDisplayRows.value.forEach((row) => {
    if (row.plate) plateCounts.set(row.plate, (plateCounts.get(row.plate) || 0) + 1);
    [row.driver, row.hkDriver, row.mainlandDriver].filter(Boolean).forEach((name) => {
      driverCounts.set(name, (driverCounts.get(name) || 0) + 1);
    });
  });
  plateCounts.forEach((count, plate) => {
    if (count > 1) warnings.push(`车牌 ${plate} 在当天安排了 ${count} 次`);
  });
  driverCounts.forEach((count, name) => {
    if (count > 1) warnings.push(`司机 ${name} 在当天安排了 ${count} 次`);
  });
  dispatchPlanDisplayRows.value.forEach((row) => {
    if (row.orderNo && !orderRows.value.some((order) => order.no === row.orderNo)) {
      warnings.push(`${row.dispatchNo || "未编号排车单"} 关联订单 ${row.orderNo} 不存在或已删除`);
    }
    if (row.vehicle && row.vehicle.status !== "正常") warnings.push(`${row.plate} 车辆状态：${row.vehicle.status}`);
    if (row.vehicle?.mainlandInsuranceDate && parseInputDate(row.vehicle.mainlandInsuranceDate) < parseInputDate(dispatchDate.value)) warnings.push(`${row.plate} 大陆保险已过期`);
    if (row.vehicle?.hkInsuranceDate && parseInputDate(row.vehicle.hkInsuranceDate) < parseInputDate(dispatchDate.value)) warnings.push(`${row.plate} 香港保险已过期`);
    [row.hkDriverRow, row.mainlandDriverRow].filter(Boolean).forEach((driver) => {
      if (driver.status !== "正常") warnings.push(`${driver.name} 司机状态：${driver.status}`);
      if (driver.expireAt && parseInputDate(driver.expireAt) < parseInputDate(dispatchDate.value)) warnings.push(`${driver.name} 证件已过期`);
    });
  });
  return warnings;
});

function normalizeDispatchPlanStatus(status, row = {}) {
  if (status === "待预排" || status === "已预排") return DISPATCH_PLAN_DEFAULT_STATUS;
  if (status === "完成结算") return "已签收";
  return DISPATCH_STATUS_OPTIONS.includes(status) ? status : DISPATCH_PLAN_DEFAULT_STATUS;
}

function normalizeDispatchPlanRows(rows = [], date = dispatchDate.value) {
  const normalizedRows = [];
  rows.forEach((row) => {
    normalizedRows.push({
      ...row,
      date: row.date || date,
      dispatchNo: row.dispatchNo || generateDispatchNo(date, normalizedRows),
      driver: row.driver || "",
      loadTime: row.loadTime || "",
      status: normalizeDispatchPlanStatus(row.status, row)
    });
  });
  return normalizedRows;
}

function applyDispatchPlanRows(rows = [], date = dispatchDate.value, loadedDates = [date]) {
  const normalizedRows = normalizeDispatchPlanRows(rows, date);
  dispatchPlanRows.value = normalizedRows;
  dispatchLoadedDates.value = loadedDates.length ? loadedDates : [date];
  selectedDispatchPlanIds.value = selectedDispatchPlanIds.value.filter((id) =>
    normalizedRows.some((row) => row.id === id)
  );
}

async function persistDispatchPlanRows(date = dispatchDate.value, rows = dispatchPlanRows.value) {
  return dispatchApi.saveDispatchPlan(date, rows);
}

async function readDispatchPlanRowsForDate(date = dispatchDate.value) {
  const result = await dispatchApi.getDispatchPlan(date);
  return Array.isArray(result.rows) ? result.rows : [];
}

async function appendDispatchPlanRowsToDate(date, rowsToAppend = []) {
  const rows = await readDispatchPlanRowsForDate(date);
  const nextRows = normalizeDispatchPlanRows([...rows, ...rowsToAppend], date);
  await persistDispatchPlanRows(date, nextRows);
  return nextRows;
}

async function loadDispatchPlan(date = dispatchDate.value) {
  if (!loggedIn.value || !canAccessModule("dispatchBoard")) {
    applyDispatchPlanRows([], date, [date]);
    return;
  }
  try {
    const result = await dispatchApi.getDispatchPlan(date);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    applyDispatchPlanRows(rows, date, [date]);
  } catch (error) {
    if (dispatchPlanRows.value.length === 0) selectedDispatchPlanIds.value = [];
    notify(error.message || "读取排车计划失败，请检查网络或服务器");
  }
}

async function loadDispatchPlansForCurrentFilter() {
  const period = normalizeDispatchDateFilterKey(dispatchPeriodFilter.value);
  const { start, end } = dispatchPeriodBounds(period);
  dispatchDate.value = dispatchDateFilterDateValue(period);
  if (!loggedIn.value || !canAccessModule("dispatchBoard")) {
    applyDispatchPlanRows([], dispatchDate.value, start && end ? datesBetweenInputValues(start, end) : []);
    return;
  }
  try {
    const rowsByDate = await apiFetchListFrom(
      () => dispatchApi.listDispatchPlans({ period, start, end }),
      "排车计划"
    );
    const rows = rowsByDate.flatMap(({ date, rows }) =>
      normalizeDispatchPlanRows(rows, date)
    );
    const loadedDates = rowsByDate.map((item) => item.date).filter(Boolean);
    applyDispatchPlanRows(rows, dispatchDate.value, loadedDates);
  } catch (error) {
    notify(error.message || "读取排车计划失败");
  }
}

function dispatchPlanRowOrder(row = {}) {
  return row.order || orderRows.value.find((item) => item.no === row.orderNo) || {};
}

function dispatchPlanVehicleSource(row = {}) {
  const order = dispatchPlanRowOrder(row);
  return row.vehicleSource || order.vehicleSource || "";
}

function dispatchPlanSupplierGroup(row = {}) {
  const order = dispatchPlanRowOrder(row);
  return String(row.supplier || order.supplier || "未指定供应商").trim();
}

function dispatchPlanPlateGroup(row = {}) {
  const order = dispatchPlanRowOrder(row);
  return String(row.plate || order.plate || "未定车牌").trim();
}

function dispatchPlanTimeRank(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 24 * 60 + 1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeDispatchLoadTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  const total = Math.min(23 * 60 + 45, Math.round((hour * 60 + minute) / 15) * 15);
  const nextHour = Math.floor(total / 60);
  const nextMinute = total % 60;
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

function handleDispatchRowLoadTimeChange(row) {
  const target = dispatchPlanRows.value[row.index];
  if (!target) return;
  target.loadTime = normalizeDispatchLoadTime(target.loadTime);
  saveDispatchPlan({ silent: true });
}

function handleDispatchPlateInput(row) {
  const target = dispatchPlanRows.value[row.index];
  if (!target) return;
  target.status = normalizeDispatchPlanStatus(target.status, target);
  saveDispatchPlan({ silent: true });
}

function handleDispatchFormLoadTimeChange() {
  dispatchForm.loadTime = normalizeDispatchLoadTime(dispatchForm.loadTime);
}

function dispatchPlanSourceRank(row = {}) {
  const source = dispatchPlanVehicleSource(row);
  if (source === "本公司车辆") return 0;
  if (source === "外派车辆") return 1;
  return 2;
}

function dispatchPlanGroupKey(row = {}) {
  return dispatchPlanSourceRank(row) === 1
    ? dispatchPlanSupplierGroup(row)
    : dispatchPlanPlateGroup(row);
}

function compareDispatchPlanRowsForAutoSort(left = {}, right = {}) {
  const dateCompare = String(dispatchPlanDate(left) || "").localeCompare(String(dispatchPlanDate(right) || ""));
  if (dateCompare !== 0) return dateCompare;

  const leftSourceRank = dispatchPlanSourceRank(left);
  const rightSourceRank = dispatchPlanSourceRank(right);
  if (leftSourceRank !== rightSourceRank) return leftSourceRank - rightSourceRank;

  const leftGroup = dispatchPlanGroupKey(left);
  const rightGroup = dispatchPlanGroupKey(right);
  const groupCompare = leftGroup.localeCompare(rightGroup, "zh-Hans-CN", { numeric: true });
  if (groupCompare !== 0) return groupCompare;

  const timeCompare = dispatchPlanTimeRank(left.loadTime) - dispatchPlanTimeRank(right.loadTime);
  if (timeCompare !== 0) return timeCompare;

  const noCompare = String(left.dispatchNo || "").localeCompare(String(right.dispatchNo || ""), "zh-Hans-CN", { numeric: true });
  if (noCompare !== 0) return noCompare;
  return (left.index ?? 0) - (right.index ?? 0);
}

function sortDispatchPlanRowsForDisplay() {
  dispatchPlanRows.value = [...dispatchPlanRows.value]
    .map((row, index) => ({ ...row, index }))
    .sort(compareDispatchPlanRowsForAutoSort)
    .map(({ index, ...row }) => row);
}

function dispatchPlanDate(row = {}) {
  return row.date || row.order?.date || orderRows.value.find((item) => item.no === row.orderNo)?.date || dispatchDate.value;
}

async function saveDispatchPlan({ silent = false, throwOnError = false } = {}) {
  if (!canAccessModule("dispatchBoard")) {
    if (!silent) notify("当前账号无权保存排车计划");
    return false;
  }
  sortDispatchPlanRowsForDisplay();
  localStorage.setItem("hanye_dispatch_date", dispatchDate.value);
  const dates = new Set([...(dispatchLoadedDates.value || []), ...dispatchPlanRows.value.map(dispatchPlanDate)]);
  const saveJobs = Array.from(dates).map((date) => {
    const rows = dispatchPlanRows.value.filter((row) => dispatchPlanDate(row) === date);
    return persistDispatchPlanRows(date, rows);
  });
  try {
    await Promise.all(saveJobs);
    if (!silent) notify("排车计划已保存");
    return true;
  } catch (error) {
    if (!silent) notify(error.message || "排车计划保存到服务器失败");
    if (throwOnError) throw error;
    return false;
  }
}

function dispatchStatusOptionsForRow(row) {
  const currentStatus = row?.status || DISPATCH_PLAN_DEFAULT_STATUS;
  const options = DISPATCH_STATUS_OPTIONS;
  if (currentStatus === DISPATCH_LOCKED_STATUS) {
    return options.filter((item) => item !== "已派车");
  }
  if (currentStatus === "已签收") {
    return options.filter((item) => !["已派车", "通关中"].includes(item));
  }
  return options;
}

function dispatchStatusClass(status) {
  const normalizedStatus = normalizeDispatchPlanStatus(status);
  return {
    "dispatch-status-planned": normalizedStatus === "预排",
    "dispatch-status-dispatched": normalizedStatus === "已派车",
    "dispatch-status-crossing": normalizedStatus === "通关中",
    "dispatch-status-signed": normalizedStatus === "已签收",
    "dispatch-status-exception": normalizedStatus === "异常滞留"
  };
}

async function syncDispatchRowOrderStatus(row, status) {
  const orderNo = row?.orderNo || row?.order?.no || "";
  const orderStatus = DISPATCH_STATUS_TO_ORDER_STATUS[status];
  if (!orderNo || !orderStatus) return;
  const currentOrder = orderRows.value.find((order) => order.no === orderNo);
  if (!currentOrder) {
    throw new Error(`排车单关联订单 ${orderNo} 不存在或已删除，请移除该排车单或重新生成订单`);
  }
  if (currentOrder?.status === orderStatus) return;
  const item = await ordersApi.updateOrderStatus(orderNo, orderStatus);
  orderRows.value = orderRows.value.map((order) => order.no === item.no ? item : order);
}

async function syncDispatchDriverToOrder(row, driverName) {
  const orderNo = row?.orderNo || row?.order?.no || "";
  if (!orderNo || !driverName) return;
  const currentOrder = orderRows.value.find((order) => order.no === orderNo);
  if (!currentOrder) {
    throw new Error(`排车单关联订单 ${orderNo} 不存在或已删除，请移除该排车单或重新生成订单`);
  }
  const item = await ordersApi.updateOrder(orderNo, {
    transportMode: "单司机",
    vehicleSource: currentOrder.vehicleSource || row.vehicleSource || "本公司车辆",
    driver: driverName,
    hkDriver: "",
    mainlandDriver: ""
  });
  orderRows.value = orderRows.value.map((order) => order.no === item.no ? item : order);
}

async function handleDispatchDriverChange(row) {
  const target = dispatchPlanRows.value[row.index];
  if (!target) return;
  const previous = {
    driver: row.driver || "",
    hkDriver: row.hkDriver || "",
    mainlandDriver: row.mainlandDriver || "",
    transportMode: row.transportMode || ""
  };
  const driverName = String(target.driver || "").trim();
  target.driver = driverName;
  if (driverName) {
    target.transportMode = "单司机";
    target.hkDriver = driverName;
    target.mainlandDriver = "";
  } else {
    target.hkDriver = "";
    target.mainlandDriver = "";
  }
  try {
    await syncDispatchDriverToOrder(target, driverName);
    await saveDispatchPlan({ silent: true, throwOnError: true });
    if (driverName && target.orderNo) notify("已同步订单运输模式和香港司机");
  } catch (error) {
    Object.assign(target, previous);
    await saveDispatchPlan({ silent: true });
    notify(error.message || "同步订单司机失败");
  }
}

async function handleDispatchStatusChange(row) {
  const target = dispatchPlanRows.value[row.index];
  if (!target) return;
  const previousStatus = row.status || DISPATCH_PLAN_DEFAULT_STATUS;
  if (previousStatus === DISPATCH_LOCKED_STATUS && target.status === "已派车") {
    target.status = DISPATCH_LOCKED_STATUS;
    notify("通关中的订单不能退回已派车");
    saveDispatchPlan({ silent: true });
    return;
  }
  if (previousStatus === "已签收" && ["已派车", "通关中"].includes(target.status)) {
    target.status = "已签收";
    notify("已签收的订单不能退回已派车或通关中");
    saveDispatchPlan({ silent: true });
    return;
  }
  try {
    await syncDispatchRowOrderStatus(target, target.status || DISPATCH_PLAN_DEFAULT_STATUS);
    saveDispatchPlan({ silent: true });
  } catch (error) {
    target.status = previousStatus;
    notify(error.message || "同步订单状态失败");
  }
}

function closeDispatchModal(options = {}) {
  if (loading.value && !options.force) return;
  dispatchModalOpen.value = false;
  editingDispatchRowId.value = "";
  copyingDispatchRowId.value = "";
}

function resetDispatchForm() {
  Object.assign(dispatchForm, {
    date: dispatchDate.value || offsetDateInputValue(1),
    customerId: "",
    customer: "",
    plate: "",
    port: "",
    direction: "",
    tonnage: "",
    quantity: "",
    weight: "",
    loading: "",
    unloading: "",
    loadTime: "",
    vehicleSource: "本公司车辆",
    supplier: "",
    note: ""
  });
  editingDispatchRowId.value = "";
  copyingDispatchRowId.value = "";
  dispatchCustomerKeyword.value = "";
  dispatchCustomerPickerOpen.value = false;
}

async function openDispatchModal() {
  await ensureReferenceDataLoaded();
  resetDispatchForm();
  dispatchModalOpen.value = true;
}

function fillDispatchFormFromPlanRow(row, fallbackDate = dispatchDate.value || offsetDateInputValue(1)) {
  const order = row.order || {};
  const customerName = order.customer || row.customer || "";
  const customer = customerRows.value.find((item) => item.type === "客户" && item.name === customerName);
  Object.assign(dispatchForm, {
    date: fallbackDate || dispatchDate.value || offsetDateInputValue(1),
    customerId: order.customerId || row.customerId || customer?.id || "",
    customer: customerName,
    plate: row.plate || order.plate || "",
    port: order.port || row.port || "",
    direction: order.direction || row.direction || "",
    tonnage: order.tonnage || row.tonnage || "",
    quantity: order.quantity || row.quantity || "",
    weight: order.weight || row.weight || "",
    loading: order.loading || row.loading || "",
    unloading: order.unloading || row.unloading || "",
    loadTime: row.loadTime || order.loadTime || "",
    vehicleSource: order.vehicleSource || row.vehicleSource || "本公司车辆",
    supplier: order.supplier || row.supplier || "",
    note: row.note || order.remark || ""
  });
  dispatchCustomerKeyword.value = customerName;
  dispatchCustomerPickerOpen.value = false;
}

async function openEditDispatchPlanRow(row) {
  if (!row?.id) return;
  await ensureReferenceDataLoaded();
  fillDispatchFormFromPlanRow(row);
  editingDispatchRowId.value = row.id;
  copyingDispatchRowId.value = "";
  dispatchModalOpen.value = true;
}

async function openCopyDispatchPlanRow(row) {
  if (!row?.id) return;
  await ensureReferenceDataLoaded();
  fillDispatchFormFromPlanRow(row);
  editingDispatchRowId.value = "";
  copyingDispatchRowId.value = row.id;
  dispatchModalOpen.value = true;
}

function generateDispatchNo(date = dispatchDate.value, extraRows = []) {
  const year = String(date || todayInputValue()).slice(0, 4) || String(new Date().getFullYear());
  const prefix = `PC${year}`;
  let max = 0;
  [...dispatchPlanRows.value, ...extraRows].forEach((row) => {
    const no = String(row.dispatchNo || "");
    if (no.startsWith(prefix)) max = Math.max(max, Number(no.slice(prefix.length)) || 0);
  });
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function createManualDispatchPlanRow() {
  const isOutsourced = dispatchForm.vehicleSource === "外派车辆";
  const planDate = dispatchForm.date || dispatchDate.value;
  return {
    id: `dispatch-manual-${Date.now()}`,
    dispatchNo: generateDispatchNo(planDate),
    orderNo: "",
    customer: dispatchForm.customer,
    plate: dispatchForm.plate,
    port: dispatchForm.port,
    direction: dispatchForm.direction,
    tonnage: dispatchForm.tonnage,
    quantity: dispatchForm.quantity,
    weight: dispatchForm.weight,
    loading: dispatchForm.loading,
    unloading: dispatchForm.unloading,
    loadTime: dispatchForm.loadTime,
    vehicleSource: dispatchForm.vehicleSource,
    supplier: isOutsourced ? dispatchForm.supplier : "",
    transportMode: "",
    driver: "",
    hkDriver: "",
    mainlandDriver: "",
    status: DISPATCH_PLAN_DEFAULT_STATUS,
    note: dispatchForm.note
  };
}

async function saveEditedDispatchPlanRow() {
  const targetIndex = dispatchPlanRows.value.findIndex((row) => row.id === editingDispatchRowId.value);
  if (targetIndex < 0) {
    notify("找不到要编辑的排车单");
    return;
  }
  if (!dispatchForm.customer.trim()) {
    notify("请选择或输入经营单位");
    return;
  }
  const matchedCustomer = customerRows.value.find(
    (item) => item.type === "客户" && (item.id === dispatchForm.customerId || item.name === dispatchForm.customer.trim())
  );
  if (!matchedCustomer) {
    notify("请选择客户资料中的有效客户");
    return;
  }

  const originalRow = dispatchPlanRows.value[targetIndex];
  const planDate = dispatchForm.date || dispatchDate.value;
  const isOutsourced = dispatchForm.vehicleSource === "外派车辆";
  const updatedRow = {
    ...originalRow,
    customer: matchedCustomer.name,
    plate: dispatchForm.plate,
    port: dispatchForm.port,
    direction: dispatchForm.direction,
    tonnage: dispatchForm.tonnage,
    quantity: dispatchForm.quantity,
    weight: dispatchForm.weight,
    loading: dispatchForm.loading,
    unloading: dispatchForm.unloading,
    loadTime: dispatchForm.loadTime,
    vehicleSource: dispatchForm.vehicleSource,
    supplier: isOutsourced ? dispatchForm.supplier : "",
    note: dispatchForm.note
  };

  try {
    loading.value = true;
    if (updatedRow.orderNo) {
      const currentOrder = orderRows.value.find((order) => order.no === updatedRow.orderNo);
      if (currentOrder) {
        const item = await ordersApi.updateOrder(updatedRow.orderNo, {
          ...currentOrder,
          customerId: matchedCustomer.id,
          customer: matchedCustomer.name,
          port: updatedRow.port,
          direction: updatedRow.direction,
          tonnage: updatedRow.tonnage,
          quantity: updatedRow.quantity,
          weight: updatedRow.weight,
          vehicleSource: updatedRow.vehicleSource,
          supplier: updatedRow.supplier,
          plate: updatedRow.plate,
          loading: updatedRow.loading,
          unloading: updatedRow.unloading,
          date: planDate,
          remark: updatedRow.note
        });
        orderRows.value = orderRows.value.map((order) => order.no === item.no ? item : order);
        updatedRow.customer = item.customer || updatedRow.customer;
      }
    }

    dispatchPlanRows.value.splice(targetIndex, 1);
    if (planDate !== dispatchDate.value) {
      await saveDispatchPlan({ silent: true, throwOnError: true });
      await appendDispatchPlanRowsToDate(planDate, [updatedRow]);
      dispatchDate.value = planDate;
      await loadDispatchPlan(planDate);
    } else {
      dispatchPlanRows.value.splice(targetIndex, 0, updatedRow);
      await saveDispatchPlan({ silent: true, throwOnError: true });
    }
    selectedDispatchPlanIds.value = [updatedRow.id];
    closeDispatchModal({ force: true });
    notify("排车单已更新");
  } catch (error) {
    notify(error.message || "保存排车单失败");
  } finally {
    loading.value = false;
  }
}

async function saveManualDispatchPlanRow() {
  if (editingDispatchRowId.value) {
    await saveEditedDispatchPlanRow();
    return;
  }
  if (!dispatchForm.customer.trim()) {
    notify("请选择或输入经营单位");
    return;
  }
  const matchedCustomer = customerRows.value.find(
    (item) => item.type === "客户" && (item.id === dispatchForm.customerId || item.name === dispatchForm.customer.trim())
  );
  if (!matchedCustomer) {
    notify("请选择客户资料中的有效客户");
    return;
  }
  dispatchForm.customerId = matchedCustomer.id;
  dispatchForm.customer = matchedCustomer.name;
  const planDate = dispatchForm.date || dispatchDate.value;
  const row = createManualDispatchPlanRow();
  const isCopyingDispatch = Boolean(copyingDispatchRowId.value);
  try {
    loading.value = true;
    const item = await ordersApi.createOrder({
      dispatchNo: row.dispatchNo,
      customerId: matchedCustomer.id,
      customer: matchedCustomer.name,
      businessType: "运输",
      port: row.port,
      direction: row.direction,
      tonnage: row.tonnage,
      currency: "",
      quantity: row.quantity,
      weight: row.weight,
      vehicleSource: row.vehicleSource,
      supplier: row.supplier,
      plate: row.plate,
      loading: row.loading,
      unloading: row.unloading,
      date: planDate,
      status: DISPATCH_STATUS_TO_ORDER_STATUS[row.status] || "预排",
      remark: row.note,
      fees: []
    });
    row.orderNo = item.no;
    row.customer = item.customer || row.customer;
    row.dispatchNo = item.dispatchNo || row.dispatchNo;
    orderRows.value = [item, ...orderRows.value.filter((order) => order.no !== item.no)];
    selectedCustomerId.value = item.customerId || matchedCustomer.id;
    activePartnerType.value = "客户";
    activeCustomerDetailTab.value = "订单管理";
    if (planDate !== dispatchDate.value) {
      await appendDispatchPlanRowsToDate(planDate, [row]);
      dispatchDate.value = planDate;
      await loadDispatchPlan(planDate);
    } else {
      dispatchPlanRows.value.push(row);
      await saveDispatchPlan({ silent: true, throwOnError: true });
    }
    closeDispatchModal({ force: true });
    notify(isCopyingDispatch ? `排车单已复制，并生成预排订单：${item.no}` : `排车单已创建，并生成预排订单：${item.no}`);
  } catch (error) {
    notify(error.message || "创建排车单失败");
  } finally {
    loading.value = false;
  }
}

function createDispatchPlanRow(order) {
  const mode = normalizeTransportMode(order.transportMode || "单司机") || "单司机";
  return {
    id: `dispatch-${order.no}-${Date.now()}`,
    dispatchNo: order.dispatchNo || generateDispatchNo(order.date),
    orderNo: order.no,
    customer: order.customer || "",
    plate: order.plate || "",
    port: order.port || "",
    direction: order.direction || "",
    tonnage: order.tonnage || "",
    quantity: order.quantity || "",
    weight: order.weight || "",
    loading: order.loading || "",
    unloading: order.unloading || "",
    vehicleSource: order.vehicleSource || "",
    supplier: order.supplier || "",
    transportMode: mode,
    driver: "",
    hkDriver: order.hkDriver || (mode === "单司机" ? order.driver || "" : ""),
    mainlandDriver: order.mainlandDriver || "",
    loadTime: order.loadTime || "",
    status: DISPATCH_PLAN_DEFAULT_STATUS,
    note: ""
  };
}

function addOrderToDispatchPlan(order) {
  if (!order?.no || dispatchPlannedOrderNos.value.has(order.no)) return;
  const row = createDispatchPlanRow(order);
  dispatchPlanRows.value.push(row);
  activeDispatchStatusPool.value = row.status || DISPATCH_PLAN_DEFAULT_STATUS;
  saveDispatchPlan({ silent: true });
}

function createDispatchDuplicateDraftRow(sourceRow, index) {
  const sourceOrder = sourceRow.order || {};
  const customerName = String(sourceOrder.customer || sourceRow.customer || "").trim();
  return {
    id: `dispatch-copy-draft-${Date.now()}-${index}`,
    sourceRow,
    sourceOrder,
    sourceDispatchNo: sourceRow.dispatchNo || "",
    sourceOrderNo: sourceOrder.no || sourceRow.orderNo || "",
    customer: customerName,
    plate: sourceRow.plate || sourceOrder.plate || "",
    loadTime: sourceRow.loadTime || "",
    port: sourceOrder.port || sourceRow.port || "",
    direction: sourceOrder.direction || sourceRow.direction || "",
    tonnage: sourceOrder.tonnage || sourceRow.tonnage || "",
    quantity: sourceOrder.quantity || sourceRow.quantity || "",
    weight: sourceOrder.weight || sourceRow.weight || "",
    loading: sourceOrder.loading || sourceRow.loading || "",
    unloading: sourceOrder.unloading || sourceRow.unloading || "",
    vehicleSource: sourceOrder.vehicleSource || sourceRow.vehicleSource || "",
    supplier: sourceOrder.supplier || sourceRow.supplier || "",
    status: DISPATCH_PLAN_DEFAULT_STATUS,
    note: sourceRow.note || ""
  };
}

async function duplicateSelectedDispatchRows() {
  const rows = selectedDispatchPlanRows.value;
  if (!rows.length) {
    notify("请先勾选要复制的排车单");
    return;
  }
  if (rows.length > 1) {
    notify("一次只能复制一张排车单，请只勾选一张");
    return;
  }
  await openCopyDispatchPlanRow(rows[0]);
}

function closeDispatchDuplicateModal() {
  if (loading.value) return;
  dispatchDuplicateModalOpen.value = false;
  dispatchDuplicateDraftRows.value = [];
}

function handleDispatchDuplicateLoadTimeChange(row) {
  row.loadTime = normalizeDispatchLoadTime(row.loadTime);
}

async function saveDuplicateDispatchRows() {
  const rows = dispatchDuplicateDraftRows.value;
  if (!rows.length) {
    notify("没有可复制的排车单");
    return;
  }

  try {
    loading.value = true;
    const duplicatedRows = [];
    for (const draft of rows) {
      const sourceRow = draft.sourceRow || {};
      const sourceOrder = draft.sourceOrder || sourceRow.order || {};
      const customerName = String(draft.customer || sourceOrder.customer || sourceRow.customer || "").trim();
      const matchedCustomer = customerRows.value.find((item) =>
        item.type === "客户" && (item.id === sourceOrder.customerId || item.name === customerName)
      );
      if (!matchedCustomer) {
        notify(`找不到客户：${customerName || "未填写"}`);
        return;
      }

      const dispatchNo = generateDispatchNo(dispatchDate.value, duplicatedRows);
      const note = String(draft.note || "").trim() || String(sourceRow.note || "").trim();
      const item = await ordersApi.createOrder({
        dispatchNo,
        customerId: matchedCustomer.id,
        customer: matchedCustomer.name,
        businessType: sourceOrder.businessType || "运输",
        port: draft.port || sourceOrder.port || sourceRow.port || "",
        direction: draft.direction || sourceOrder.direction || sourceRow.direction || "",
        tonnage: draft.tonnage || sourceOrder.tonnage || sourceRow.tonnage || "",
        currency: sourceOrder.currency || "",
        quantity: draft.quantity || sourceOrder.quantity || sourceRow.quantity || "",
        weight: draft.weight || sourceOrder.weight || sourceRow.weight || "",
        vehicleSource: draft.vehicleSource || sourceOrder.vehicleSource || sourceRow.vehicleSource || "",
        supplier: draft.supplier || sourceOrder.supplier || sourceRow.supplier || "",
        plate: draft.plate || sourceRow.plate || sourceOrder.plate || "",
        loading: draft.loading || sourceOrder.loading || sourceRow.loading || "",
        unloading: draft.unloading || sourceOrder.unloading || sourceRow.unloading || "",
        loadTime: draft.loadTime || sourceRow.loadTime || sourceOrder.loadTime || "",
        date: dispatchDate.value,
        status: "预排",
        remark: note,
        tripNoEnabled: sourceOrder.tripNoEnabled || 0,
        tripNo: sourceOrder.tripNo || "",
        sixSheetEnabled: sourceOrder.sixSheetEnabled || 0,
        sixSheetNo: sourceOrder.sixSheetNo || "",
        fees: []
      });

      const duplicatedRow = {
        ...sourceRow,
        id: `dispatch-copy-${Date.now()}-${duplicatedRows.length}`,
        dispatchNo: item.dispatchNo || dispatchNo,
        orderNo: item.no,
        customer: item.customer || matchedCustomer.name,
        plate: draft.plate || sourceRow.plate || "",
        loadTime: draft.loadTime || sourceRow.loadTime || "",
        status: DISPATCH_PLAN_DEFAULT_STATUS,
        note
      };
      delete duplicatedRow.index;
      delete duplicatedRow.order;
      delete duplicatedRow.vehicle;
      delete duplicatedRow.hkDriverRow;
      delete duplicatedRow.mainlandDriverRow;
      duplicatedRows.push(duplicatedRow);
      orderRows.value = [item, ...orderRows.value.filter((order) => order.no !== item.no)];
    }

    dispatchPlanRows.value.push(...duplicatedRows);
    selectedDispatchPlanIds.value = duplicatedRows.map((row) => row.id);
    saveDispatchPlan({ silent: true });
    dispatchDuplicateModalOpen.value = false;
    dispatchDuplicateDraftRows.value = [];
    notify(`已复制 ${duplicatedRows.length} 张排车单`);
  } catch (error) {
    notify(error.message || "复制排车单失败");
  } finally {
    loading.value = false;
  }
}

function bindableDispatchRowsForCustomer(customerName = "") {
  const normalizedName = String(customerName || "").trim();
  if (!normalizedName) return [];
  return dispatchPlanRows.value.filter(
    (row) => !row.orderNo && String(row.customer || "").trim() === normalizedName
  );
}

function applyDispatchRowToOrderForm(row) {
  if (!row) return;
  Object.assign(orderForm, {
    dispatchNo: row.dispatchNo || orderForm.dispatchNo,
    customer: row.customer || orderForm.customer,
    businessType: orderForm.businessType || "运输",
    port: row.port || "",
    direction: row.direction || "",
    tonnage: row.tonnage || "",
    quantity: row.quantity || "",
    weight: row.weight || "",
    vehicleSource: row.vehicleSource || "",
    supplier: row.supplier || "",
    plate: row.plate || "",
    loading: row.loading || "",
    unloading: row.unloading || "",
    date: dispatchDate.value || orderForm.date,
    remark: [orderForm.remark, row.note ? `排车备注：${row.note}` : ""].filter(Boolean).join("\n")
  });
  if (row.vehicleSource === "本公司车辆") {
    orderForm.supplier = "";
  }
  if (row.vehicleSource === "外派车辆") {
    orderForm.plate = "";
  }
  pendingDispatchBindId.value = row.id;
}

function removeDispatchPlanRow(index) {
  dispatchPlanRows.value.splice(index, 1);
  selectedDispatchPlanIds.value = selectedDispatchPlanIds.value.filter((id) =>
    dispatchPlanRows.value.some((row) => row.id === id)
  );
  saveDispatchPlan({ silent: true });
}

function moveDispatchPlanRow(index, offset) {
  const target = index + offset;
  if (target < 0 || target >= dispatchPlanRows.value.length) return;
  const [row] = dispatchPlanRows.value.splice(index, 1);
  dispatchPlanRows.value.splice(target, 0, row);
  saveDispatchPlan({ silent: true });
}

function toggleDispatchPlanSelection(id, checked) {
  if (!id) return;
  selectedDispatchPlanIds.value = checked
    ? [...new Set([...selectedDispatchPlanIds.value, id])]
    : selectedDispatchPlanIds.value.filter((item) => item !== id);
}

function toggleAllDispatchPlanSelection(checked) {
  selectedDispatchPlanIds.value = checked
    ? searchedDispatchPlanRows.value.map((row) => row.id)
    : [];
}

function dispatchShortLocation(value = "") {
  const parts = String(value || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.slice(0, 2).join(" / ");
}

function dispatchOrderRouteText(order) {
  const loading = dispatchShortLocation(order?.loading);
  const unloading = dispatchShortLocation(order?.unloading);
  return [loading, unloading].filter(Boolean).join(" → ") || "-";
}

function dispatchVehicleSourceText(row) {
  const order = row?.order || {};
  if (order.vehicleSource === "外派车辆") return order.supplier || "外派供应商";
  if (order.vehicleSource === "本公司车辆") return "本公司";
  return order.vehicleSource || "-";
}

function dispatchLocationLinesForRecord(record = {}, target) {
  const location = String(record[target] || "").trim();
  const contact = String(record[`${target}Contact`] || "").trim();
  const phone = String(record[`${target}Phone`] || "").trim();
  const matched = findAddressBookContactForLocation(location);
  return [
    location || "-",
    contact || matched?.contact ? `联系人：${contact || matched?.contact}` : "",
    phone || matched?.phone ? `电话：${phone || matched?.phone}` : ""
  ].filter(Boolean);
}

function dispatchLocationBlock(label, record = {}, target) {
  const [location = "-", ...contactLines] = dispatchLocationLinesForRecord(record, target);
  return [`${label}：${location}`, ...contactLines].join("\n");
}

function dispatchMessageText(rows = dispatchPlanDisplayRows.value) {
  if (!rows.length) return "";
  return rows.map((row) => {
    const order = row.order || {};
    const record = { ...order, loading: order.loading || row.loading, unloading: order.unloading || row.unloading };
    const date = order.date || row.date || dispatchDate.value || "-";
    const time = row.loadTime || order.loadingTime || "-";
    return [
      `装货时间：${date}   ${time}  口岸：${order.port || row.port || "-"}`,
      `车牌：${row.plate || order.plate || "-"} 吨位：${order.tonnage || row.tonnage || "-"}    板数：${order.quantity || row.quantity || "-"}`,
      "",
      dispatchLocationBlock("装货地", record, "loading"),
      "",
      dispatchLocationBlock("卸货地", record, "unloading"),
      "",
      `备注：${row.note || order.remark || "-"}`
    ].filter((line) => line !== null && line !== undefined).join("\n");
  }).join("\n\n");
}

async function copyDispatchPlanText() {
  const selectedRows = selectedDispatchPlanRows.value;
  const rows = selectedRows.length ? selectedRows : dispatchPlanDisplayRows.value;
  const text = dispatchMessageText(rows);
  if (!text) {
    notify("暂无排车内容");
    return;
  }
  const copied = await copyTextToClipboard(text);
  notify(copied
    ? (selectedRows.length ? `已复制 ${selectedRows.length} 单派车信息` : "排车信息已复制")
    : "复制失败，请手动选中文本复制"
  );
}

function exportDispatchPlanRows() {
  const selectedRows = selectedDispatchPlanRows.value;
  const rows = selectedRows.length ? selectedRows : dispatchPlanDisplayRows.value;
  if (!rows.length) {
    notify("暂无可导出的排车数据");
    return;
  }
  const headers = [
    "序号",
    "装车时间",
    "排车单号",
    "订单号",
    "经营单位",
    "车牌",
    "司机",
    "口岸",
    "进出口",
    "吨位",
    "件数/板数",
    "重量",
    "装卸",
    "车辆来源",
    "排车状态",
    "备注"
  ];
  const exportRows = rows.map((row, index) => {
    const order = row.order || {};
    return [
      index + 1,
      row.loadTime || "",
      row.dispatchNo || "",
      order.no || row.orderNo || "",
      order.customer || row.customer || "",
      row.plate || "",
      row.driver || "",
      order.port || row.port || "",
      order.direction || row.direction || "",
      order.tonnage || row.tonnage || "",
      order.quantity || row.quantity || "",
      order.weight || row.weight || "",
      dispatchOrderRouteText(order),
      dispatchVehicleSourceText(row),
      row.status || DISPATCH_PLAN_DEFAULT_STATUS,
      row.note || ""
    ];
  });
  exportCsv(`排车表_${dispatchDate.value}_${selectedRows.length ? "已选" : "全部"}${rows.length}单.csv`, headers, exportRows);
  notify(selectedRows.length ? `已导出已选 ${rows.length} 单` : `已导出当天 ${rows.length} 单`);
}

async function applyDispatchPlanToOrders() {
  if (!dispatchPlanRows.value.length) {
    notify("暂无可同步的排车计划");
    return;
  }
  try {
    loading.value = true;
    for (const row of dispatchPlanRows.value) {
      const order = orderRows.value.find((item) => item.no === row.orderNo);
      if (!order) continue;
      const normalizedMode = normalizeTransportMode(row.transportMode || order.transportMode || "单司机") || "单司机";
      const nextVehicleSource = order.vehicleSource || (row.plate ? "本公司车辆" : "");
      const nextOrder = {
        ...order,
        vehicleSource: nextVehicleSource,
        plate: row.plate || order.plate || "",
        transportMode: normalizedMode,
        driver: normalizedMode === "单司机"
          ? (row.driver || row.hkDriver || order.driver || "")
          : [row.hkDriver || row.driver || "", row.mainlandDriver || ""].filter(Boolean).join(" / "),
        hkDriver: normalizedMode === "单司机" ? "" : (row.hkDriver || row.driver || ""),
        mainlandDriver: normalizedMode === "单司机" ? "" : (row.mainlandDriver || "")
      };
      const item = await ordersApi.updateOrder(order.no, nextOrder);
      orderRows.value = orderRows.value.map((current) => current.no === item.no ? item : current);
    }
    saveDispatchPlan({ silent: true });
    notify("排车计划已同步到订单");
  } catch (error) {
    notify(error.message || "同步排车计划失败");
  } finally {
    loading.value = false;
  }
}

function orderIncludesDriver(order, driver) {
  if (!order || !driver?.name) return false;
  const driverNames = [
    order.driver,
    order.hkDriver,
    order.mainlandDriver,
    ...String(order.driver || "").split("/")
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return driverNames.includes(driver.name);
}

function orderCustomerForDriverPay(order) {
  return customerRows.value.find((item) =>
    (order.customerId && item.id === order.customerId)
    || (order.customer && item.name === order.customer)
  ) || null;
}

function orderDriverWageCity(order, driver = null) {
  const location = order?.direction === "进口" ? order?.unloading : order?.loading;
  return driverWageCityValue(location);
}

function orderDriverWageRule(order, driver = selectedDriver.value) {
  if (!order || !driver) return null;
  const city = orderDriverWageCity(order, driver);
  const mode = normalizeTransportMode(order.transportMode || "单司机") || "单司机";
  const exactDriverRules = driverWageRuleRows.value.filter((rule) => rule.driverId === driver.id);
  const sharedRules = driverWageRuleRows.value.filter((rule) => !rule.driverId);
  const matches = (rule) =>
    (!rule.city || driverWageCityValue(rule.city) === city)
    && (!rule.transportMode || normalizeTransportMode(rule.transportMode) === mode);
  const direction = String(order.direction || "").trim();
  const matchesDirection = (rule) => matches(rule) && rule.direction === direction;
  const matchesSharedDirection = (rule) => matches(rule) && (!rule.direction || rule.direction === SHARED_DIRECTION);
  return exactDriverRules.find(matchesDirection)
    || exactDriverRules.find(matchesSharedDirection)
    || sharedRules.find(matchesDirection)
    || sharedRules.find(matchesSharedDirection)
    || exactDriverRules.find(matches)
    || sharedRules.find(matches)
    || null;
}

function driverBaseTripFeeBreakdown(order, driver = selectedDriver.value) {
  const rule = orderDriverWageRule(order, driver);
  if (!rule) return { hkd: 0, rmb: 0 };
  return {
    hkd: Number(rule.baseHKD || 0),
    rmb: Number(rule.baseRMB || 0)
  };
}

function driverBaseTripFee(order, driver = selectedDriver.value) {
  return driverBaseTripFeeBreakdown(order, driver).hkd;
}

function driverRouteAdjustMatches(order, rule, driver = selectedDriver.value) {
  if (!order || !rule || order.vehicleSource !== "本公司车辆") return false;
  const ruleDriverIds = Array.isArray(rule.driverIds)
    ? rule.driverIds.map((id) => Number(id)).filter(Boolean)
    : [];
  if (ruleDriverIds.length && !ruleDriverIds.includes(Number(driver?.id || 0))) return false;
  const ruleDriverId = Number(rule.driverId || 0);
  if (!ruleDriverIds.length && ruleDriverId && Number(driver?.id || 0) !== ruleDriverId) return false;
  const ruleDriverName = String(rule.driverName || "").trim();
  if (!ruleDriverIds.length && !ruleDriverId && ruleDriverName && ruleDriverName !== String(driver?.name || "").trim()) return false;
  const ruleMode = normalizeTransportMode(rule.transportMode || "");
  if (ruleMode && ruleMode !== normalizeTransportMode(order.transportMode || "单司机")) return false;
  const customerName = String(rule.customerName || "").trim();
  if (customerName && customerName !== String(order.customer || "").trim()) return false;
  const orderLoading = supplierCostRuleAreaValue(order.loading);
  const orderUnloading = supplierCostRuleAreaValue(order.unloading);
  const ruleLoading = supplierCostRuleAreaValue(rule.loading);
  const ruleUnloading = supplierCostRuleAreaValue(rule.unloading);
  if (ruleLoading && ruleLoading !== orderLoading) return false;
  if (ruleUnloading && ruleUnloading !== orderUnloading) return false;
  return true;
}

function driverRouteAdjustBreakdown(order, driver = selectedDriver.value) {
  return driverRouteAdjustRules.value
    .filter((rule) => driverRouteAdjustMatches(order, rule, driver))
    .reduce((sum, rule) => ({
      hkd: sum.hkd + Number(rule.amountHKD || 0),
      rmb: sum.rmb + Number(rule.amountRMB || 0)
    }), { hkd: 0, rmb: 0 });
}

function driverCustomerTripAdjustBreakdown(order, driver = selectedDriver.value) {
  const routeAdjust = driverRouteAdjustBreakdown(order, driver);
  return {
    hkd: routeAdjust.hkd,
    rmb: routeAdjust.rmb
  };
}

function driverCustomerTripAdjust(order, driver = selectedDriver.value) {
  return driverCustomerTripAdjustBreakdown(order, driver).hkd;
}

const DRIVER_EXTRA_FEE_KEYWORDS = {
  loadPerBoard: ["装货"],
  unloadPerBoard: ["卸货"],
  crossSeaFee: ["过海"],
  addPointFee: ["加点"],
  waitingPerHour: ["等候"]
};

const DRIVER_EXTRA_FIELD_LABELS = {
  loadPerBoard: "装货费",
  unloadPerBoard: "卸货费",
  crossSeaFee: "过海费",
  addPointFee: "加点费",
  waitingPerHour: "装货等候费"
};

const DRIVER_EXTRA_RULE_FIELDS = Object.keys(DRIVER_EXTRA_FIELD_LABELS);
const DRIVER_QUANTITY_EXTRA_FIELDS = ["loadPerBoard", "unloadPerBoard"];
const DRIVER_FIXED_EXTRA_FIELDS = ["crossSeaFee", "addPointFee", "waitingPerHour"];

function orderHasActualDriverExtraFee(order, field) {
  const keywords = DRIVER_EXTRA_FEE_KEYWORDS[field] || [];
  if (!keywords.length) return false;
  const fees = Array.isArray(order?.fees) ? order.fees : [];
  return fees.some((fee) => {
    if (isAdvanceFee(fee)) return false;
    const name = String(fee?.name || "");
    const amount = Number(fee?.amount || 0);
    return amount !== 0 && keywords.some((keyword) => name.includes(keyword));
  });
}

function orderDriverExtraQuantity(order, field) {
  const keywords = DRIVER_EXTRA_FEE_KEYWORDS[field] || [];
  const fees = Array.isArray(order?.fees) ? order.fees : [];
  const matchedFee = fees.find((fee) => {
    if (isAdvanceFee(fee)) return false;
    const name = String(fee?.name || "");
    return Number(fee?.amount || 0) !== 0 && keywords.some((keyword) => name.includes(keyword));
  });
  const feeQuantity = quantityNumber(matchedFee?.quantity);
  if (feeQuantity > 0) return feeQuantity;
  return 0;
}

function driverRuleAmountForField(order, field, driver = selectedDriver.value) {
  const rule = orderDriverWageRule(order, driver);
  return Number(rule?.[field] || 0);
}

function driverExtraTripFeeApplies(order, field, driver = selectedDriver.value) {
  const amount = driverRuleAmountForField(order, field, driver);
  if (!amount) return false;
  if (!orderHasActualDriverExtraFee(order, field)) return false;
  if (DRIVER_QUANTITY_EXTRA_FIELDS.includes(field)) return orderDriverExtraQuantity(order, field) > 0;
  return DRIVER_FIXED_EXTRA_FIELDS.includes(field) || orderHasActualDriverExtraFee(order, field);
}

function driverExtraTripFee(order, field, driver = selectedDriver.value) {
  const rule = orderDriverWageRule(order, driver);
  if (!rule) return 0;
  const amount = Number(rule[field] || 0);
  if (!driverExtraTripFeeApplies(order, field, driver)) return 0;
  if (DRIVER_QUANTITY_EXTRA_FIELDS.includes(field)) {
    return orderDriverExtraQuantity(order, field) * amount;
  }
  return amount;
}

function driverExtraTripFeeTotal(order, driver = selectedDriver.value) {
  const rule = orderDriverWageRule(order, driver);
  const dynamicTotal = advanceFeeRateTotalForOrder(order, rule?.advanceFeeRates);
  const fixedTotal = DRIVER_EXTRA_RULE_FIELDS
    .reduce((sum, field) => sum + driverExtraTripFee(order, field, driver), 0);
  return fixedTotal + dynamicTotal;
}

function driverPayableTripFee(order, driver = selectedDriver.value) {
  return driverBaseTripFee(order, driver) + driverExtraTripFeeTotal(order, driver) + driverCustomerTripAdjust(order, driver);
}

function driverPayableTripFeeBreakdown(order, driver = selectedDriver.value) {
  const base = driverBaseTripFeeBreakdown(order, driver);
  const adjust = driverCustomerTripAdjustBreakdown(order, driver);
  return {
    hkd: base.hkd + driverExtraTripFeeTotal(order, driver) + adjust.hkd,
    rmb: base.rmb + adjust.rmb
  };
}

function driverByName(name = "") {
  const target = String(name || "").trim();
  return driverRows.value.find((driver) => driver.name === target) || null;
}

const orderDriverWagePreviewRows = computed(() => {
  if (!orderHasTransportFields.value || !orderUsesOwnVehicle.value) return [];
  const order = { ...orderForm, transportMode: normalizeTransportMode(orderForm.transportMode || "单司机") || "单司机" };
  const roleRows = orderUsesRelayDrivers.value
    ? (isDomesticTransferMode(order.transportMode) ? [
      { role: "香港司机", name: orderForm.hkDriver }
    ] : [
      { role: "香港司机", name: orderForm.hkDriver },
      { role: "大陆骑师", name: orderForm.mainlandDriver }
    ])
    : [{ role: "香港司机", name: orderForm.driver }];
  return roleRows.map((row) => {
    const driver = driverByName(row.name);
    const rule = driver ? orderDriverWageRule(order, driver) : null;
    const baseFee = driver && rule ? driverBaseTripFee(order, driver) : 0;
    const extraFee = driver && rule ? driverExtraTripFeeTotal(order, driver) : 0;
    const adjust = driver ? driverCustomerTripAdjust(order, driver) : 0;
    return {
      ...row,
      driver,
      city: orderDriverWageCity(order, driver) || "-",
      rule,
      baseFee,
      extraFee,
      adjust,
      payable: driver && rule ? baseFee + extraFee + adjust : 0
    };
  });
});

const selectedDriverTripFeeTotal = computed(() =>
  selectedDriverOrders.value.reduce((sum, order) => sum + driverPayableTripFee(order), 0)
);

const selectedDriverMonthTripFeeTotal = computed(() =>
  selectedDriverMonthOrders.value.reduce((sum, order) => sum + driverPayableTripFee(order), 0)
);

function outsourcedCostRuleForOrder(order) {
  if (!order || order.vehicleSource !== "外派车辆" || !order.supplier) return null;
  const area = supplierCostRuleAreaValue(order.direction === "进口" ? order.unloading : order.loading);
  const candidates = supplierCostRuleRows.value.filter((item) =>
    item.supplier === order.supplier
    && supplierCostRuleDirectionMatches(item.direction, order.direction)
    && (!item.city || supplierCostRuleAreaMatches(item.city, area))
    && (!item.tonnage || item.tonnage === order.tonnage)
    && (!item.currency || item.currency === order.currency)
  );
  return candidates.find((item) => supplierCostRuleDirection(item.direction) === order.direction)
    || candidates.find((item) => supplierCostRuleDirection(item.direction) === SUPPLIER_COST_SHARED_DIRECTION)
    || null;
}

function outsourcedCostAmountForOrder(order) {
  return supplierCostRuleAmount(outsourcedCostRuleForOrder(order), order);
}

function isAdvanceFee(fee = {}) {
  const category = String(fee.category || "").trim();
  if (category) return category === "代垫";
  return feeItemForFee(fee)?.category === "代垫";
}

function feeCategoryLabel(fee = {}) {
  return feeItemForFee(fee)?.category || fee.category || "正常";
}

function feeAmountHKD(fee = {}) {
  const currency = String(fee.currency || "港币").toUpperCase();
  if (currency === "人民币" || currency === "RMB") return 0;
  return Number(fee.amount || 0);
}

function feeAmountRMB(fee = {}) {
  const currency = String(fee.currency || "港币").toUpperCase();
  if (currency === "人民币" || currency === "RMB") return Number(fee.amount || 0);
  return 0;
}

function feeItemForFee(fee = {}) {
  const feeItemId = String(fee.feeItemId || fee.fee_item_id || "").trim();
  return feeItemRows.value.find((item) => String(item.id) === feeItemId)
    || feeItemRows.value.find((item) => item.name === fee.name)
    || null;
}

function orderDriverNameByRole(order, role = "") {
  const normalizedRole = String(role || "").trim();
  if (normalizedRole === "香港司机") return String(order?.hkDriver || order?.driver || "").trim();
  if (normalizedRole === "大陆骑师") return String(order?.mainlandDriver || "").trim();
  if (normalizedRole === "跟随订单司机") return String(order?.driver || order?.hkDriver || order?.mainlandDriver || "").trim();
  return "";
}

function feeAssignedDriverName(order, fee = {}) {
  if (!order || !fee) return "";
  if (fee.driverName) return String(fee.driverName || "").trim();
  const explicitRole = String(fee.driverRole || fee.driver_role || "").trim();
  if (explicitRole && explicitRole !== "手动指定") return orderDriverNameByRole(order, explicitRole);
  const defaultRole = feeItemForFee(fee)?.defaultDriverRole || "";
  if (defaultRole && defaultRole !== "手动指定") return orderDriverNameByRole(order, defaultRole);
  if (normalizeTransportMode(order.transportMode || "单司机") === "单司机") {
    return String(order.driver || order.hkDriver || order.mainlandDriver || "").trim();
  }
  return "";
}

function orderFeeDriverOptions() {
  const names = [
    orderForm.hkDriver,
    orderForm.mainlandDriver,
    orderForm.driver
  ].map((value) => String(value || "").trim()).filter(Boolean);
  return Array.from(new Set(names));
}

function advanceFeesForOrder(order, driver = null) {
  return (Array.isArray(order?.fees) ? order.fees : [])
    .filter(isAdvanceFee)
    .filter((fee) => !driver || feeAssignedDriverName(order, fee) === driver.name);
}

function orderAdvanceFeeBreakdown(order, driver = null) {
  return advanceFeesForOrder(order, driver)
    .reduce((sum, fee) => ({
      hkd: sum.hkd + feeAmountHKD(fee),
      rmb: sum.rmb + feeAmountRMB(fee)
    }), { hkd: 0, rmb: 0 });
}

function orderAdvanceFeeDetailBreakdown(order) {
  return orderAdvanceFeeBreakdown(order);
}

function orderAdvanceFeeHKD(order) {
  return orderAdvanceFeeBreakdown(order).hkd;
}

function orderAdvanceFeeRMB(order) {
  return orderAdvanceFeeBreakdown(order).rmb;
}

function orderAdvanceFeeBelongsToDriver(order) {
  return order?.vehicleSource === "本公司车辆";
}

function orderAdvanceFeeBelongsToDriverRow(order, driver) {
  return orderAdvanceFeeBelongsToDriver(order) && Boolean(driver) && advanceFeesForOrder(order, driver).length > 0;
}

function orderAdvanceFeeBelongsToSupplier(order) {
  return order?.vehicleSource === "外派车辆";
}

function isFinanceDateMatch(dateValue) {
  return dateMatchesPeriodFilter(dateValue, financePeriodFilter.value);
}

const financeOrderRows = computed(() =>
  orderRows.value.filter((order) =>
    isOrderVisibleInOrderManagement(order) &&
    isFinanceDateMatch(order.date)
  )
);

const financeAdjustmentRows = computed(() =>
  driverAdjustmentRows.value.filter((item) => isFinanceDateMatch(item.date))
);

const customsBusinessFormTotal = computed(() =>
  [
    customsBusinessForm.customsFee,
    customsBusinessForm.pageFee,
    customsBusinessForm.manifestFee,
    customsBusinessForm.inspectionFee,
    customsBusinessForm.checkFee,
    customsBusinessForm.otherFee
  ].reduce((sum, value) => sum + Number(value || 0), 0)
);

const customsBusinessSummary = computed(() => {
  const rows = customsBusinessRows.value;
  return {
    count: rows.length,
    declarationCount: rows.filter((row) => row.declarationNo || row.sixSheetNo).length,
    revenue: rows.reduce((sum, row) => sum + Number(row.total || 0), 0),
    inspectionFee: rows.reduce((sum, row) => sum + Number(row.inspectionFee || 0), 0)
  };
});

function inputMonthKey(value) {
  const matched = String(value || "").match(/^(\d{4})-(\d{2})/);
  return matched ? `${matched[1]}-${matched[2]}` : "";
}

function currentPeriodMonthKey() {
  return todayInputValue().slice(0, 7);
}

const STATEMENT_PERIOD_MODES = PERIOD_FILTER_MODES;
const statementMonthOptions = PERIOD_MONTH_OPTIONS;

function previousMonthKey(monthKey = currentPeriodMonthKey()) {
  const [year, month] = String(monthKey || currentPeriodMonthKey()).split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function normalizePeriodYear(year, fallbackYear = currentPeriodMonthKey().slice(0, 4)) {
  const text = String(year || "").trim().slice(0, 4);
  return /^\d{4}$/.test(text) ? text : fallbackYear;
}

function normalizePeriodMonth(month, fallbackMonth = currentPeriodMonthKey().slice(5, 7)) {
  const number = Number(month || fallbackMonth);
  return String(Math.min(12, Math.max(1, number || Number(fallbackMonth)))).padStart(2, "0");
}

function normalizePeriodFilter(value, fallbackMonthKey = currentPeriodMonthKey()) {
  const fallback = /^\d{4}-\d{2}$/.test(fallbackMonthKey) ? fallbackMonthKey : currentPeriodMonthKey();
  const [fallbackYear, fallbackMonth] = fallback.split("-");
  const text = String(value || "").trim();
  if (text === "all") return "all";
  const yearMatched = text.match(/^year:(\d{4})$/);
  if (yearMatched) return `year:${normalizePeriodYear(yearMatched[1], fallbackYear)}`;
  const monthMatched = text.match(/^(\d{4})-(\d{2})$/);
  if (monthMatched) {
    return `${normalizePeriodYear(monthMatched[1], fallbackYear)}-${normalizePeriodMonth(monthMatched[2], fallbackMonth)}`;
  }
  return fallback;
}

function normalizeLegacyPeriodFilter(value) {
  const text = String(value || "").trim();
  if (text === "all") return "all";
  if (text === "year") return `year:${currentPeriodMonthKey().slice(0, 4)}`;
  if (text === "lastMonth") return previousMonthKey();
  if (/^year:\d{4}$/.test(text) || /^\d{4}-\d{2}$/.test(text)) return normalizePeriodFilter(text);
  return currentPeriodMonthKey();
}

function normalizeDispatchDateFilterKey(value) {
  const text = String(value || "").trim();
  return DISPATCH_DATE_FILTERS.some((item) => item.key === text) ? text : "today";
}

function dispatchQuickDateValue(filterKey = dispatchPeriodFilter.value) {
  const matched = DISPATCH_DATE_FILTERS.find((item) => item.key === filterKey && Number.isFinite(item.offset));
  return matched ? offsetDateInputValue(matched.offset) : todayInputValue();
}

function dispatchDateFilterBounds(filterKey = dispatchPeriodFilter.value) {
  const today = parseInputDate(todayInputValue()) || new Date();
  const quickDate = DISPATCH_DATE_FILTERS.find((item) => item.key === filterKey && Number.isFinite(item.offset));
  if (quickDate) {
    const value = offsetDateInputValue(quickDate.offset);
    return { start: value, end: value };
  }
  if (filterKey === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: dateInputFromDate(start), end: dateInputFromDate(end) };
  }
  if (filterKey === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start: dateInputFromDate(start), end: dateInputFromDate(end) };
  }
  if (filterKey === "lastMonth") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: dateInputFromDate(start), end: dateInputFromDate(end) };
  }
  if (filterKey === "custom") {
    const start = dispatchCustomDateStart.value || dispatchDate.value || todayInputValue();
    const end = dispatchCustomDateEnd.value || start;
    return { start, end };
  }
  const value = todayInputValue();
  return { start: value, end: value };
}

function dispatchDateFilterDateValue(filterKey = dispatchPeriodFilter.value) {
  if (filterKey === "custom") return dispatchCustomDateStart.value || dispatchDate.value || todayInputValue();
  if (["week", "month"].includes(filterKey)) return todayInputValue();
  return dispatchDateFilterBounds(filterKey).start || todayInputValue();
}

function dispatchDateFilterLabel(filterKey = dispatchPeriodFilter.value) {
  const filter = DISPATCH_DATE_FILTERS.find((item) => item.key === filterKey);
  const { start, end } = dispatchDateFilterBounds(filterKey);
  if (filterKey === "custom") {
    return start === end ? `自定义：${start || "-"}` : `自定义：${start || "-"} 至 ${end || "-"}`;
  }
  if (start && end && start !== end) return `${filter?.label || "排车"}：${start} 至 ${end}`;
  return `${filter?.label || "排车"}：${start || "-"}`;
}

function setDispatchDateFilter(filterKey) {
  dispatchPeriodFilter.value = normalizeDispatchDateFilterKey(filterKey);
  dispatchDate.value = dispatchDateFilterDateValue(dispatchPeriodFilter.value);
  localStorage.setItem("hanye_dispatch_period_filter", dispatchPeriodFilter.value);
  localStorage.setItem("hanye_dispatch_date", dispatchDate.value);
}

function setDispatchCustomDateStart(value) {
  dispatchCustomDateStart.value = String(value || "").trim() || todayInputValue();
  if (!dispatchCustomDateEnd.value) dispatchCustomDateEnd.value = dispatchCustomDateStart.value;
  setDispatchDateFilter("custom");
  localStorage.setItem("hanye_dispatch_custom_date_start", dispatchCustomDateStart.value);
  loadDispatchPlansForCurrentFilter();
}

function setDispatchCustomDateEnd(value) {
  dispatchCustomDateEnd.value = String(value || "").trim() || dispatchCustomDateStart.value || todayInputValue();
  setDispatchDateFilter("custom");
  localStorage.setItem("hanye_dispatch_custom_date_end", dispatchCustomDateEnd.value);
  loadDispatchPlansForCurrentFilter();
}

function periodFilterParts(filterKey = currentPeriodMonthKey()) {
  const currentMonthKey = currentPeriodMonthKey();
  const [currentYear, currentMonth] = currentMonthKey.split("-");
  const normalized = normalizePeriodFilter(filterKey, currentMonthKey);
  if (normalized === "all") return { mode: "all", year: currentYear, month: currentMonth };
  const yearMatched = normalized.match(/^year:(\d{4})$/);
  if (yearMatched) return { mode: "year", year: yearMatched[1], month: currentMonth };
  const [year, month] = normalized.split("-");
  return { mode: "month", year, month };
}

function periodFilterValue(scope) {
  return normalizePeriodFilter(periodFilterRefs[scope]?.value);
}

function periodFilterMode(scope) {
  return periodFilterParts(periodFilterValue(scope)).mode;
}

function periodFilterYear(scope) {
  return periodFilterParts(periodFilterValue(scope)).year;
}

function periodFilterMonth(scope) {
  return periodFilterParts(periodFilterValue(scope)).month;
}

function periodFilterLabel(filterKey) {
  const { mode, year, month } = periodFilterParts(filterKey);
  if (mode === "all") return "全部";
  if (mode === "year") return `${year}年`;
  return `${year}年${Number(month)}月`;
}

function periodFilterLabelByScope(scope) {
  return periodFilterLabel(periodFilterValue(scope));
}

function periodFilterBounds(filterKey = currentPeriodMonthKey()) {
  const { mode, year, month } = periodFilterParts(filterKey);
  if (mode === "all") return { start: "", end: "" };
  if (mode === "year") return { start: `${year}-01-01`, end: `${year}-12-31` };
  const first = new Date(Number(year), Number(month) - 1, 1);
  const last = new Date(Number(year), Number(month), 0);
  return { start: dateInputFromDate(first), end: dateInputFromDate(last) };
}

function dateMatchesPeriodFilter(dateValue, filterKey) {
  const { mode, year, month } = periodFilterParts(filterKey);
  if (mode === "all") return true;
  const monthKey = inputMonthKey(dateValue);
  return mode === "year" ? monthKey.startsWith(`${year}-`) : monthKey === `${year}-${month}`;
}

function periodFilterDateValue(filterKey) {
  const { mode, year, month } = periodFilterParts(filterKey);
  if (mode === "month") {
    const monthKey = `${year}-${month}`;
    return monthKey === currentPeriodMonthKey() ? todayInputValue() : `${monthKey}-01`;
  }
  if (mode === "year") {
    return year === currentPeriodMonthKey().slice(0, 4) ? todayInputValue() : `${year}-01-01`;
  }
  return todayInputValue();
}

function periodSourceDates(scope) {
  if (scope === "orders") return orderRows.value.map((item) => item.date);
  if (scope === "finance") return [
    ...orderRows.value.map((item) => item.date),
    ...driverAdjustmentRows.value.map((item) => item.date)
  ];
  if (scope === "statement") return orderRows.value.map((item) => item.date);
  if (scope === "boss") return [
    ...orderRows.value.map((item) => item.date),
    ...driverAdjustmentRows.value.map((item) => item.date),
    ...vehicleExpenseRows.value.map((item) => item.type === "annual" ? `${item.year || currentPeriodMonthKey().slice(0, 4)}-01-01` : item.date),
    ...bossCompanyProfitRows.map((item) => `${item.period}-01`),
    ...bossCompanyExpenseRows.map((item) => `${item.date}-01`)
  ];
  if (scope === "customsBusiness") return customsBusinessRows.value.map((item) => item.date);
  if (scope === "vehicleExpenses") return vehicleExpenseRows.value.map((item) =>
    item.type === "annual" ? `${item.year || currentPeriodMonthKey().slice(0, 4)}-01-01` : item.date
  );
  if (scope === "dispatch") return [
    ...dispatchPlanRows.value.map((item) => dispatchPlanDate(item)),
    ...orderRows.value.map((item) => item.date)
  ];
  return [];
}

function periodYearOptions(scope) {
  const currentYear = currentPeriodMonthKey().slice(0, 4);
  const selectedYear = periodFilterYear(scope);
  const years = new Set([currentYear, selectedYear]);
  const baseYear = Number(currentYear);
  if (Number.isFinite(baseYear)) {
    Array.from({ length: 7 }, (_, index) => String(baseYear - index)).forEach((year) => years.add(year));
  }
  periodSourceDates(scope).forEach((dateValue) => {
    const year = inputMonthKey(dateValue).slice(0, 4);
    if (year) years.add(year);
  });
  return Array.from(years).sort((left, right) => right.localeCompare(left));
}

function setPeriodFilterValue(scope, value) {
  const target = periodFilterRefs[scope];
  if (!target) return;
  target.value = normalizePeriodFilter(value);
  if (scope === "finance") {
    localStorage.setItem("hanye_finance_period_filter", target.value);
  }
  if (scope === "vehicleExpenses") {
    localStorage.setItem("hanye_vehicle_expense_period_filter", target.value);
  }
  if (scope === "dispatch") {
    dispatchDate.value = periodFilterDateValue(target.value);
    localStorage.setItem("hanye_dispatch_period_filter", target.value);
    localStorage.setItem("hanye_dispatch_date", dispatchDate.value);
  }
}

function setPeriodFilterMode(scope, mode) {
  const { year, month } = periodFilterParts(periodFilterValue(scope));
  if (mode === "all") {
    setPeriodFilterValue(scope, "all");
  } else if (mode === "year") {
    setPeriodFilterValue(scope, `year:${year}`);
  } else {
    setPeriodFilterValue(scope, `${year}-${month}`);
  }
}

function setPeriodFilterYear(scope, year) {
  const { mode, month } = periodFilterParts(periodFilterValue(scope));
  const nextYear = normalizePeriodYear(year);
  setPeriodFilterValue(scope, mode === "year" ? `year:${nextYear}` : `${nextYear}-${month}`);
}

function setPeriodFilterMonth(scope, month) {
  const { year } = periodFilterParts(periodFilterValue(scope));
  setPeriodFilterValue(scope, `${year}-${normalizePeriodMonth(month)}`);
}

function resetPeriodFiltersForModuleNavigation() {
  const currentMonth = currentPeriodMonthKey();
  financePeriodFilter.value = currentMonth;
  statementMonthFilter.value = currentMonth;
  bossPeriodFilter.value = currentMonth;
  customsBusinessPeriodFilter.value = currentMonth;
  vehicleExpensePeriodFilter.value = currentMonth;
  localStorage.setItem("hanye_finance_period_filter", currentMonth);
  localStorage.setItem("hanye_vehicle_expense_period_filter", currentMonth);
}

const statementYearOptions = computed(() => {
  return periodYearOptions("statement");
});

const activeStatementMonthFilter = computed(() => {
  return normalizePeriodFilter(statementMonthFilter.value);
});

function statementSelectedParts(filterKey = activeStatementMonthFilter.value) {
  return periodFilterParts(filterKey);
}

const statementPeriodMode = computed(() => statementSelectedParts().mode);

const statementSelectedYear = computed({
  get: () => statementSelectedParts().year,
  set: (year) => {
    const { mode, month } = statementSelectedParts();
    if (mode === "year") {
      setStatementYearFilter(year);
      return;
    }
    setStatementYearMonthFilter(year, month);
  }
});

const statementSelectedMonth = computed({
  get: () => statementSelectedParts().month,
  set: (month) => setStatementYearMonthFilter(statementSelectedParts().year, month)
});

function statementDateRangeBounds(filterKey = activeStatementMonthFilter.value) {
  return periodFilterBounds(filterKey);
}

function isStatementDateMatch(dateValue) {
  return dateMatchesPeriodFilter(dateValue, activeStatementMonthFilter.value);
}

const statementOrderRows = computed(() =>
  orderRows.value.filter((order) => isStatementDateMatch(order.date))
);

const statementAdjustmentRows = computed(() =>
  driverAdjustmentRows.value.filter((item) => isStatementDateMatch(item.date))
);

function syncStatementExportRange(filterKey = activeStatementMonthFilter.value) {
  const { start, end } = statementDateRangeBounds(filterKey);
  statementExportStart.value = start;
  statementExportEnd.value = end;
  saveStatementExportSettings();
}

function setStatementYearMonthFilter(year, month) {
  setPeriodFilterValue("statement", `${normalizePeriodYear(year)}-${normalizePeriodMonth(month)}`);
}

function setStatementYearFilter(year) {
  setPeriodFilterValue("statement", `year:${normalizePeriodYear(year)}`);
}

function setStatementAllFilter() {
  setPeriodFilterValue("statement", "all");
}

function setStatementPeriodMode(mode) {
  const { year, month } = statementSelectedParts();
  if (mode === "year") {
    setStatementYearFilter(year);
  } else if (mode === "all") {
    setStatementAllFilter();
  } else {
    setStatementYearMonthFilter(year, month);
  }
}

function statementMonthRangeLabel() {
  return periodFilterLabel(activeStatementMonthFilter.value);
}

watch(activeStatementMonthFilter, (filterKey) => {
  syncStatementExportRange(filterKey);
}, { immediate: true });

function financeDateRangeLabel() {
  return periodFilterLabel(financePeriodFilter.value);
}

const activeFinanceWageDetailRow = computed(() =>
  financeWageRows.value.find((row) => row.driver.id === financeWageDetailDriverId.value) || null
);

function openFinanceWageDetail(row) {
  financeWageDetailDriverId.value = row?.driver?.id || null;
  selectedFinanceWageDetailOrderNo.value = "";
  if (row) syncFinanceWageDetailColumnWidths(row);
}

function closeFinanceWageDetail() {
  financeWageDetailDriverId.value = null;
  selectedFinanceWageDetailOrderNo.value = "";
}

function openFinanceWageDetailOrderEdit(order) {
  if (!order?.no) return;
  closeFinanceWageDetail();
  openOrderModal(null, order);
}

function orderAdvanceFeeDetailText(order, driver = null) {
  const fees = advanceFeesForOrder(order, driver);
  if (!fees.length) return "-";
  return fees
    .map((fee) => `${fee.name || "费用"} ${currencyCodeDisplay(fee.currency || "港币")} ${money(fee.amount)}`)
    .join("；");
}

function orderFeeDetailText(order) {
  const fees = Array.isArray(order?.fees) ? order.fees : [];
  if (!fees.length) return "-";
  return fees
    .filter((fee) => Number(fee?.amount || 0) !== 0)
    .map((fee) => {
      const parts = [
        fee.name || "费用",
        currencyCodeDisplay(fee.currency || "港币"),
        money(fee.amount)
      ];
      const remark = String(fee.remark || "").trim();
      const suffix = [remark].filter(Boolean).join("，");
      return suffix ? `${parts.join(" ")}（${suffix}）` : parts.join(" ");
    })
    .join("；") || "-";
}

function orderFeeCellText(order, feeName) {
  const name = String(feeName || "").trim();
  const fees = (Array.isArray(order?.fees) ? order.fees : [])
    .filter((fee) => String(fee?.name || "").trim() === name && Number(fee?.amount || 0) !== 0);
  if (!fees.length) return "-";
  return fees.map((fee) => {
    const amount = `${currencyCodeDisplay(fee.currency || "港币")} ${money(fee.amount)}`;
    const remark = String(fee.remark || "").trim();
    const suffix = [remark].filter(Boolean).join("，");
    return suffix ? `${amount}（${suffix}）` : amount;
  }).join("；");
}

function driverExtraFieldForFeeName(feeName = "") {
  const name = String(feeName || "");
  return Object.entries(DRIVER_EXTRA_FEE_KEYWORDS)
    .find(([, keywords]) => keywords.some((keyword) => name.includes(keyword)))?.[0] || "";
}

function financeWageFeeColumnLabel(feeName = "") {
  const field = driverExtraFieldForFeeName(feeName);
  if (DRIVER_EXTRA_FIELD_LABELS[field]) return DRIVER_EXTRA_FIELD_LABELS[field];
  return String(feeName || "").trim();
}

function driverWageDetailForField(order, field, driver) {
  if (!field || !driver) return "";
  const rule = orderDriverWageRule(order, driver);
  if (!rule) return "司机工资未匹配规则";
  const rate = Number(rule[field] || 0);
  if (!rate) return "司机工资未设置规则";
  if (!driverExtraTripFeeApplies(order, field, driver)) return "";
  const amount = driverExtraTripFee(order, field, driver);
  if (DRIVER_QUANTITY_EXTRA_FIELDS.includes(field)) {
    const quantity = orderDriverExtraQuantity(order, field);
    return `${money(amount)} HKD（${money(quantity)}板×${money(rate)}/板）`;
  }
  return `${money(amount)} HKD`;
}

function driverWageDetailForFee(order, feeName, driver) {
  return driverWageDetailForField(order, driverExtraFieldForFeeName(feeName), driver);
}

function orderFeeCellWithDriverWageText(order, feeName, driver, options = {}) {
  const advanceSource = options.includeAllAdvanceFees
    ? (Array.isArray(order?.fees) ? order.fees : []).filter(isAdvanceFee)
    : advanceFeesForOrder(order, driver);
  const advanceText = advanceSource
    .filter((fee) => String(fee?.name || "").trim() === String(feeName || "").trim() && Number(fee?.amount || 0) !== 0)
    .map((fee) => {
      const amount = `${money(fee.amount)} ${currencyCodeDisplay(fee.currency || "港币")}`;
      const remark = String(fee.remark || "").trim();
      return remark ? `${amount}（${remark}）` : amount;
    })
    .join("；");
  const wageText = driverWageDetailForFee(order, feeName, driver);
  return [wageText, advanceText].filter(Boolean).join("；") || "-";
}

function financeWageDetailFeeColumns(row) {
  const columns = [];
  const upsertColumn = (label, feeName = "", driverField = "") => {
    const existing = columns.find((column) => column.label === label);
    if (existing) {
      if (feeName && !existing.feeNames.includes(feeName)) existing.feeNames.push(feeName);
      if (driverField && !existing.driverField) existing.driverField = driverField;
      return;
    }
    columns.push({ label, feeNames: feeName ? [feeName] : [], driverField });
  };
  (row?.orders || []).forEach((order) => {
    (Array.isArray(order?.fees) ? order.fees : []).forEach((fee) => {
      const name = String(fee?.name || "").trim();
      const label = financeWageFeeColumnLabel(name);
      const driverField = driverExtraFieldForFeeName(name);
      if (
        name
        && Number(fee?.amount || 0) !== 0
        && (
          isAdvanceFee(fee)
          || orderFeeCellWithDriverWageText(order, name, row?.driver) !== "-"
        )
      ) {
        upsertColumn(label, name, driverField);
      }
    });
    DRIVER_EXTRA_RULE_FIELDS.forEach((field) => {
      if (!driverExtraTripFeeApplies(order, field, row?.driver)) return;
      upsertColumn(DRIVER_EXTRA_FIELD_LABELS[field], "", field);
    });
  });
  return columns;
}

function financeWageDetailColumns(row) {
  const baseColumns = [
    { key: "no", label: "订单号", min: 112 },
    { key: "date", label: "日期", min: 90 },
    { key: "customer", label: "客户", min: 160 },
    { key: "transportMode", label: "运输模式", min: 74 },
    { key: "route", label: "路线", min: 180 },
    { key: "extraFeeTotal", label: "其他合计", min: 90 },
    { key: "tripFee", label: "司机趟费", min: 90 },
    { key: "advanceAmount", label: "代垫合计HKD", min: 96 },
    { key: "advanceAmountRMB", label: "代垫合计RMB", min: 96 }
  ];
  const feeColumns = financeWageDetailFeeColumns(row).map((column) => ({
    key: `fee:${column.label}`,
    feeNames: column.feeNames,
    feeName: column.feeNames[0],
    driverField: column.driverField,
    label: column.label,
    min: 92,
    max: 260
  }));
  return [...baseColumns, ...feeColumns, { key: "status", label: "状态", min: 76 }];
}

function orderedFinanceWageDetailColumns(row) {
  const columns = financeWageDetailColumns(row);
  const order = financeWageDetailColumnOrder.value || [];
  const lockedKeys = new Set((financeWageDetailLockedColumns.value || []).filter((key) =>
    columns.some((column) => column.key === key)
  ));
  if (!order.length) return columns;
  const columnMap = new Map(columns.map((column) => [column.key, column]));
  const orderedKnownColumns = order.map((key) => columnMap.get(key)).filter(Boolean);
  const orderedKeySet = new Set(orderedKnownColumns.map((column) => column.key));
  const newColumns = columns.filter((column) => !orderedKeySet.has(column.key));
  let insertIndex = orderedKnownColumns.length;
  while (insertIndex > 0 && lockedKeys.has(orderedKnownColumns[insertIndex - 1].key)) {
    insertIndex -= 1;
  }
  return [
    ...orderedKnownColumns.slice(0, insertIndex),
    ...newColumns,
    ...orderedKnownColumns.slice(insertIndex)
  ];
}

function visibleFinanceWageDetailColumns(row) {
  return orderedFinanceWageDetailColumns(row)
    .filter((column) => financeWageDetailColumnVisibility[column.key] !== false);
}

function setFinanceWageDetailColumnVisible(column, visible) {
  financeWageDetailColumnVisibility[column.key] = visible;
  saveStoredJson(dataTableStorageKey("finance_wage_detail", "visibility"), { ...financeWageDetailColumnVisibility });
}

function isFinanceWageDetailColumnLocked(column) {
  return (financeWageDetailLockedColumns.value || []).includes(column?.key);
}

function toggleFinanceWageDetailColumnLock(column) {
  if (!column?.key || column.key === "no") return;
  const keys = financeWageDetailLockedColumns.value || [];
  const currentOrder = orderedFinanceWageDetailColumns(activeFinanceWageDetailRow.value).map((item) => item.key);
  financeWageDetailColumnOrder.value = currentOrder;
  saveStoredJson(dataTableStorageKey("finance_wage_detail", "order"), currentOrder);
  financeWageDetailLockedColumns.value = keys.includes(column.key)
    ? keys.filter((key) => key !== column.key)
    : [...keys, column.key];
  saveStoredJson(dataTableStorageKey("finance_wage_detail", "locked"), financeWageDetailLockedColumns.value);
}

function moveFinanceWageDetailColumn(column, offset) {
  const columns = orderedFinanceWageDetailColumns(activeFinanceWageDetailRow.value);
  const keys = columns.map((item) => item.key);
  const index = keys.indexOf(column.key);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= keys.length) return;
  const [key] = keys.splice(index, 1);
  keys.splice(target, 0, key);
  financeWageDetailColumnOrder.value = keys;
  saveStoredJson(dataTableStorageKey("finance_wage_detail", "order"), keys);
  financeWageDetailLockedColumns.value = keys.filter((item) => isFinanceWageDetailColumnLocked({ key: item }));
  saveStoredJson(dataTableStorageKey("finance_wage_detail", "locked"), financeWageDetailLockedColumns.value);
}

function financeWageDetailStickyColumnStyle(row, column, index) {
  return index === 0 ? { left: "0px" } : {};
}

function financeWageDetailCellValue(order, column, row) {
  if (!order || !column) return "";
  if (column.key === "no") return order.no || "";
  if (column.key === "date") return order.date || "";
  if (column.key === "customer") return order.customer || "";
  if (column.key === "transportMode") return normalizeTransportMode(order.transportMode || "单司机") || "";
  if (column.key === "route") return relatedOrderRouteText(order);
  if (column.key === "extraFeeTotal") {
    const amount = driverExtraTripFeeTotal(order, row?.driver);
    return amount ? `${money(amount)} HKD` : "-";
  }
  if (column.key === "tripFee") {
    const amount = driverBaseTripFeeBreakdown(order, row?.driver);
    return moneyPairSuffix(amount.hkd, amount.rmb);
  }
  if (column.key === "advanceAmount") {
    const amount = orderAdvanceFeeDetailBreakdown(order).hkd;
    return amount ? `${money(amount)} HKD` : "-";
  }
  if (column.key === "advanceAmountRMB") {
    const amount = orderAdvanceFeeDetailBreakdown(order).rmb;
    return amount ? `${money(amount)} RMB` : "-";
  }
  if (column.key === "status") return order.status || "";
  if (column.feeNames?.length) {
    const values = column.feeNames
      .map((feeName) => orderFeeCellWithDriverWageText(order, feeName, row?.driver, { includeAllAdvanceFees: true }))
      .filter((text) => text && text !== "-")
    return [...new Set(values)].join("；") || "-";
  }
  if (column.driverField) return driverWageDetailForField(order, column.driverField, row?.driver) || "-";
  if (column.feeName) return orderFeeCellWithDriverWageText(order, column.feeName, row?.driver);
  return "";
}

function financeWageDetailSortValue(order, column, row) {
  const value = financeWageDetailCellValue(order, column, row);
  if (!column) return value;
  if (column.key === "date") return order?.date || "";
  if (column.key === "no") return order?.no || "";
  if (
    ["tripFee", "extraFeeTotal", "advanceAmount", "advanceAmountRMB"].includes(column.key)
    || column.feeNames?.length
    || column.driverField
    || column.feeName
  ) {
    const hkd = amountTotalFromFinanceText(value, "HKD");
    const rmb = amountTotalFromFinanceText(value, "RMB");
    return hkd || rmb ? hkd + rmb : "";
  }
  return value;
}

function sortedFinanceWageDetailOrders(row) {
  const orders = row?.orders || [];
  const state = loadTableSortState("financeWageDetail");
  if (!state.key || !state.direction) return orders;
  const column = financeWageDetailColumns(row).find((item) => item.key === state.key);
  if (!column) return orders;
  const direction = state.direction === "desc" ? -1 : 1;
  return orders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      const compared = compareSortValues(
        financeWageDetailSortValue(left.order, column, row),
        financeWageDetailSortValue(right.order, column, row)
      );
      if (compared !== 0) return compared * direction;
      return left.index - right.index;
    })
    .map((item) => item.order);
}

function amountTotalFromFinanceText(text = "", currency = "HKD") {
  const pattern = new RegExp(`(?:${currency}\\s*([-+]?\\d[\\d,]*(?:\\.\\d+)?)|([-+]?\\d[\\d,]*(?:\\.\\d+)?)\\s*${currency})`, "g");
  let total = 0;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    total += Number(String(match[1] || match[2] || "0").replace(/,/g, "")) || 0;
  }
  return total;
}

function financeWageDetailFooterValue(column, row) {
  if (!column || !row) return "";
  if (column.key === "no") return "合计";
  const texts = (row.orders || []).map((order) => financeWageDetailCellValue(order, column, row));
  if (column.key === "advanceAmount") {
    const total = texts.reduce((sum, text) => sum + amountTotalFromFinanceText(text, "HKD"), 0);
    return `${money(total)} HKD`;
  }
  if (column.key === "advanceAmountRMB") {
    const total = texts.reduce((sum, text) => sum + amountTotalFromFinanceText(text, "RMB"), 0);
    return `${money(total)} RMB`;
  }
  if (column.key === "tripFee" || column.key === "extraFeeTotal" || column.feeNames?.length || column.driverField || column.feeName) {
    const hkd = texts.reduce((sum, text) => sum + amountTotalFromFinanceText(text, "HKD"), 0);
    const rmb = texts.reduce((sum, text) => sum + amountTotalFromFinanceText(text, "RMB"), 0);
    return moneyPairSuffix(hkd, rmb);
  }
  return "";
}

function financeWageDetailColumnWidth(row, column) {
  const values = [column.label, ...(row?.orders || []).map((order) => financeWageDetailCellValue(order, column, row))];
  return values.reduce((width, value) => Math.max(width, textWidthPx(value, column.min || 72, column.max || 320)), column.min || 72);
}

function loadFinanceWageDetailSavedWidths() {
  try {
    return JSON.parse(localStorage.getItem(dataTableStorageKey("finance_wage_detail", "widths")) || "{}") || {};
  } catch {
    return {};
  }
}

function syncFinanceWageDetailColumnWidths(row) {
  const saved = loadFinanceWageDetailSavedWidths();
  financeWageDetailColumns(row).forEach((column) => {
    const savedWidth = Number(saved[column.key]);
    financeWageDetailColumnWidths[column.key] = Number.isFinite(savedWidth) && savedWidth >= column.min
      ? savedWidth
      : financeWageDetailColumnWidth(row, column);
  });
}

function resetFinanceWageDetailColumnWidths(row = activeFinanceWageDetailRow.value) {
  localStorage.removeItem(dataTableStorageKey("finance_wage_detail", "widths"));
  if (row) syncFinanceWageDetailColumnWidths(row);
  notify("已恢复自适应列宽");
}

function resetFinanceWageDetailColumnOrder() {
  financeWageDetailColumnOrder.value = [];
  financeWageDetailLockedColumns.value = ["no"];
  localStorage.removeItem(dataTableStorageKey("finance_wage_detail", "order"));
  saveStoredJson(dataTableStorageKey("finance_wage_detail", "locked"), financeWageDetailLockedColumns.value);
  notify("已恢复默认列顺序");
}

function buildFinanceWageRows(sourceOrders, sourceAdjustments) {
  return sortRowsByTable(driverRows.value.map((driver) => {
    const orders = sourceOrders.filter((order) =>
      orderIncludesDriver(order, driver) || order.plate === driver.boundPlate
    );
    const payableBreakdown = orders.reduce((sum, order) => {
      const amount = driverPayableTripFeeBreakdown(order, driver);
      return { hkd: sum.hkd + amount.hkd, rmb: sum.rmb + amount.rmb };
    }, { hkd: 0, rmb: 0 });
    const advanceBreakdown = orders
      .reduce((sum, order) => {
        const amount = orderAdvanceFeeBreakdown(order, driver);
        return { hkd: sum.hkd + amount.hkd, rmb: sum.rmb + amount.rmb };
      }, { hkd: 0, rmb: 0 });
    const adjustmentBreakdown = sourceAdjustments
      .filter((item) => item.driverId === driver.id)
      .reduce((sum, item) => {
        const currency = currencyCodeDisplay(item.currency || "港币");
        return {
          hkd: sum.hkd + (currency === "RMB" ? 0 : Number(item.amount || 0)),
          rmb: sum.rmb + (currency === "RMB" ? Number(item.amount || 0) : 0)
        };
      }, { hkd: 0, rmb: 0 });
    return {
      driver,
      orders,
      orderCount: orders.length,
      payable: payableBreakdown.hkd,
      payableRMB: payableBreakdown.rmb,
      advanceFee: advanceBreakdown.hkd,
      advanceFeeRMB: advanceBreakdown.rmb,
      adjustments: adjustmentBreakdown.hkd,
      adjustmentsRMB: adjustmentBreakdown.rmb,
      total: payableBreakdown.hkd + advanceBreakdown.hkd + adjustmentBreakdown.hkd,
      totalRMB: payableBreakdown.rmb + advanceBreakdown.rmb + adjustmentBreakdown.rmb
    };
  }).filter((row) => row.orderCount || row.payable || row.payableRMB || row.advanceFee || row.advanceFeeRMB || row.adjustments || row.adjustmentsRMB), "financeWages");
}

const financeWageRows = computed(() => buildFinanceWageRows(financeOrderRows.value, financeAdjustmentRows.value));
const statementWageRows = computed(() => buildFinanceWageRows(statementOrderRows.value, statementAdjustmentRows.value));

watch(activeFinanceWageDetailRow, (row) => {
  if (row) syncFinanceWageDetailColumnWidths(row);
}, { flush: "post" });

function buildFinanceSummary(sourceOrders, sourceWageRows) {
  const receivableHKD = sourceOrders.reduce((sum, order) => sum + Number(order.receivableHKD || 0), 0);
  const receivableRMB = sourceOrders.reduce((sum, order) => sum + Number(order.receivableRMB || 0), 0);
  const driverPayableHKD = sourceWageRows.reduce((sum, row) => sum + row.total, 0);
  const driverPayableRMB = sourceWageRows.reduce((sum, row) => sum + row.totalRMB, 0);
  const driverAdvanceHKD = sourceWageRows.reduce((sum, row) => sum + row.advanceFee, 0);
  const driverAdvanceRMB = sourceWageRows.reduce((sum, row) => sum + row.advanceFeeRMB, 0);
  const supplierAdvanceHKD = sourceOrders
    .filter(orderAdvanceFeeBelongsToSupplier)
    .reduce((sum, order) => sum + orderAdvanceFeeHKD(order), 0);
  const supplierAdvanceRMB = sourceOrders
    .filter(orderAdvanceFeeBelongsToSupplier)
    .reduce((sum, order) => sum + orderAdvanceFeeRMB(order), 0);
  const outsourcedHKD = sourceOrders.reduce((sum, order) => sum + outsourcedCostAmountForOrder(order), 0);
  const supplierPayableHKD = sourceOrders
    .filter(orderAdvanceFeeBelongsToSupplier)
    .reduce((sum, order) => {
      const payable = supplierOrderPayableBreakdown(order);
      return sum + payable.payableHKD + (payable.rule ? 0 : orderAdvanceFeeHKD(order));
    }, 0);
  const supplierPayableRMB = sourceOrders
    .filter(orderAdvanceFeeBelongsToSupplier)
    .reduce((sum, order) => {
      const payable = supplierOrderPayableBreakdown(order);
      return sum + payable.payableRMB + (payable.rule ? 0 : orderAdvanceFeeRMB(order));
    }, 0);
  return {
    orderCount: sourceOrders.length,
    receivableHKD,
    receivableRMB,
    driverPayableHKD,
    driverPayableRMB,
    driverAdvanceHKD,
    driverAdvanceRMB,
    supplierAdvanceHKD,
    supplierAdvanceRMB,
    outsourcedHKD,
    supplierPayableHKD,
    supplierPayableRMB,
    outsourcedOrderCount: sourceOrders.filter((order) => order.vehicleSource === "外派车辆").length
  };
}

const financeSummary = computed(() => buildFinanceSummary(financeOrderRows.value, financeWageRows.value));
const statementSummary = computed(() => buildFinanceSummary(statementOrderRows.value, statementWageRows.value));

const bossOrderRows = computed(() =>
  orderRows.value.filter((order) =>
    isOrderVisibleInOrderManagement(order) &&
    dateMatchesPeriodFilter(order.date, bossPeriodFilter.value)
  )
);

const bossAdjustmentRows = computed(() =>
  driverAdjustmentRows.value.filter((item) => dateMatchesPeriodFilter(item.date, bossPeriodFilter.value))
);

const bossWageRows = computed(() => buildFinanceWageRows(bossOrderRows.value, bossAdjustmentRows.value));
const bossFinanceSummary = computed(() => buildFinanceSummary(bossOrderRows.value, bossWageRows.value));

function amountTextNumber(value) {
  const matched = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return matched ? Number(matched[0]) : 0;
}

function bossCompanyExpenseAmount(row) {
  return amountTextNumber(row?.amount);
}

const bossCompanyExpenseDisplayRows = computed(() =>
  bossCompanyExpenseRows.filter((row) => dateMatchesPeriodFilter(`${row.date}-01`, bossPeriodFilter.value))
);

const bossCompanyExpenseSummary = computed(() => {
  const rows = bossCompanyExpenseDisplayRows.value;
  const total = rows.reduce((sum, row) => sum + bossCompanyExpenseAmount(row), 0);
  const posted = rows
    .filter((row) => row.status === "已入账")
    .reduce((sum, row) => sum + bossCompanyExpenseAmount(row), 0);
  const pending = rows
    .filter((row) => row.status !== "已入账")
    .reduce((sum, row) => sum + bossCompanyExpenseAmount(row), 0);
  const top = [...rows].sort((left, right) => bossCompanyExpenseAmount(right) - bossCompanyExpenseAmount(left))[0] || null;
  return {
    total,
    posted,
    pending,
    topCategory: top?.category || "-"
  };
});

function hkdToRmbRate() {
  const rate = Number(statementExchangeRate.value || 0.92);
  return Number.isFinite(rate) && rate > 0 ? rate : 0.92;
}

function rmbEquivalent(hkd = 0, rmb = 0) {
  return Number(rmb || 0) + Number(hkd || 0) * hkdToRmbRate();
}

function bossVehicleExchangeRatePeriodMonth(filterKey = bossPeriodFilter.value) {
  const { year, month } = periodFilterParts(filterKey);
  return `${year}-${month}`;
}

function normalizeBossVehicleExchangeRate(value = BOSS_VEHICLE_DEFAULT_EXCHANGE_RATE) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : Number(BOSS_VEHICLE_DEFAULT_EXCHANGE_RATE);
}

function bossVehicleExchangeRateRow(periodMonth = bossVehicleExchangeRatePeriodMonth()) {
  return bossVehicleExchangeRateRows.value.find((row) => row.periodMonth === periodMonth) || null;
}

function upsertBossVehicleExchangeRateRow(item = {}, options = {}) {
  const periodMonth = String(item.periodMonth || item.period_month || "").trim();
  if (!periodMonth) return;
  const next = {
    ...item,
    periodMonth,
    rate: normalizeBossVehicleExchangeRate(item.rate)
  };
  bossVehicleExchangeRateRows.value = bossVehicleExchangeRateRows.value.some((row) => row.periodMonth === periodMonth)
    ? bossVehicleExchangeRateRows.value.map((row) => row.periodMonth === periodMonth ? { ...row, ...next } : row)
    : [next, ...bossVehicleExchangeRateRows.value];
  if (options.syncInput && periodMonth === bossVehicleExchangeRatePeriodMonth()) {
    bossVehicleExchangeRateInputMonth.value = periodMonth;
    bossVehicleExchangeRate.value = String(next.rate);
  }
}

function syncBossVehicleExchangeRateFromRows() {
  const periodMonth = bossVehicleExchangeRatePeriodMonth();
  const row = bossVehicleExchangeRateRow(periodMonth);
  bossVehicleExchangeRateInputMonth.value = periodMonth;
  bossVehicleExchangeRate.value = String(row?.rate || BOSS_VEHICLE_DEFAULT_EXCHANGE_RATE);
}

function bossVehicleExchangeRateValue(periodMonth = bossVehicleExchangeRatePeriodMonth()) {
  const inputRate = Number(bossVehicleExchangeRate.value);
  if (bossVehicleExchangeRateInputMonth.value === periodMonth && Number.isFinite(inputRate) && inputRate > 0) {
    return inputRate;
  }
  const rowRate = Number(bossVehicleExchangeRateRow(periodMonth)?.rate);
  return Number.isFinite(rowRate) && rowRate > 0 ? rowRate : Number(BOSS_VEHICLE_DEFAULT_EXCHANGE_RATE);
}

function scheduleBossVehicleExchangeRateSave(periodMonth, rate) {
  window.clearTimeout(bossVehicleExchangeRateSaveTimer);
  bossVehicleExchangeRateSaveTimer = window.setTimeout(() => {
    saveBossVehicleExchangeRate(periodMonth, rate, { notifySuccess: false, notifyError: true });
  }, 500);
}

async function saveBossVehicleExchangeRate(periodMonth = bossVehicleExchangeRatePeriodMonth(), rateValue = bossVehicleExchangeRate.value, options = {}) {
  const rate = Number(rateValue);
  if (!periodMonth || !Number.isFinite(rate) || rate <= 0 || !loggedIn.value || !canAccessModule("bossVehicleProfit")) return null;
  const requestId = bossVehicleExchangeRateSaveRequestId + 1;
  bossVehicleExchangeRateSaveRequestId = requestId;
  bossVehicleExchangeRateSaving.value = true;
  try {
    const item = await financeApi.saveVehicleProfitExchangeRate({ periodMonth, rate });
    upsertBossVehicleExchangeRateRow(item, { syncInput: true });
    if (options.notifySuccess) notify("当月汇率已保存");
    return item;
  } catch (error) {
    if (options.notifyError !== false) notify(`当月汇率保存失败：${error.message}`);
    return null;
  } finally {
    if (requestId === bossVehicleExchangeRateSaveRequestId) {
      bossVehicleExchangeRateSaving.value = false;
    }
  }
}

function flushBossVehicleExchangeRateSave() {
  window.clearTimeout(bossVehicleExchangeRateSaveTimer);
  saveBossVehicleExchangeRate(
    bossVehicleExchangeRateInputMonth.value || bossVehicleExchangeRatePeriodMonth(),
    bossVehicleExchangeRate.value,
    { notifySuccess: false, notifyError: true }
  );
}

function setBossVehicleExchangeRate(value = "") {
  const text = String(value ?? "").trim();
  const periodMonth = bossVehicleExchangeRatePeriodMonth();
  const rate = Number(text);
  bossVehicleExchangeRateInputMonth.value = periodMonth;
  bossVehicleExchangeRate.value = text;
  if (!Number.isFinite(rate) || rate <= 0) {
    window.clearTimeout(bossVehicleExchangeRateSaveTimer);
    return;
  }
  upsertBossVehicleExchangeRateRow({ periodMonth, rate });
  scheduleBossVehicleExchangeRateSave(periodMonth, rate);
}

function bossVehicleRmbEquivalent(hkd = 0, rmb = 0, periodMonth = bossVehicleExchangeRatePeriodMonth()) {
  return Number(rmb || 0) + Number(hkd || 0) * bossVehicleExchangeRateValue(periodMonth);
}

function moneyRmbDisplay(value = 0) {
  return `RMB ${money(value)}`;
}

function bossVehicleProfitRateText(profitRMB = 0, totalCostRMB = 0) {
  const revenueRMB = Number(profitRMB || 0) + Number(totalCostRMB || 0);
  if (!revenueRMB) return "-";
  return `${((Number(profitRMB || 0) / revenueRMB) * 100).toFixed(1)}%`;
}

function marginText(profitHKD = 0, profitRMB = 0, revenueHKD = 0, revenueRMB = 0) {
  const revenue = rmbEquivalent(revenueHKD, revenueRMB);
  if (!revenue) return "-";
  return `${((rmbEquivalent(profitHKD, profitRMB) / revenue) * 100).toFixed(1)}%`;
}

function moneyPairDisplay(hkd = 0, rmb = 0) {
  return Number(hkd || 0) || Number(rmb || 0) ? moneyPair(hkd, rmb) : "HKD 0 / RMB 0";
}

function orderReceivableBreakdown(sourceOrders) {
  return sourceOrders.reduce((sum, order) => ({
    hkd: sum.hkd + Number(order.receivableHKD || 0),
    rmb: sum.rmb + Number(order.receivableRMB || 0)
  }), { hkd: 0, rmb: 0 });
}

function orderDriverRows(order) {
  return driverRows.value.filter((driver) =>
    orderIncludesDriver(order, driver) || (order.plate && order.plate === driver.boundPlate)
  );
}

function orderDriverPayBreakdown(order) {
  return orderDriverRows(order).reduce((sum, driver) => {
    const amount = driverPayableTripFeeBreakdown(order, driver);
    return {
      hkd: sum.hkd + Number(amount.hkd || 0),
      rmb: sum.rmb + Number(amount.rmb || 0)
    };
  }, { hkd: 0, rmb: 0 });
}

function periodMonthSpanForRows(filterKey, sourceRows) {
  const { mode } = periodFilterParts(filterKey);
  if (mode === "month") return 1;
  if (mode === "year") return 12;
  const months = new Set(sourceRows.map((row) => inputMonthKey(row.date)).filter(Boolean));
  return Math.max(1, months.size);
}

function vehicleFixedCostRMB(vehicle, sourceOrders, filterKey) {
  const monthlyCost = Number(vehicle?.monthlyCost || 0);
  if (!monthlyCost || !sourceOrders.length) return 0;
  return monthlyCost * periodMonthSpanForRows(filterKey, sourceOrders);
}

function vehicleExpenseAmountBreakdown(expense = {}, filterKey = currentPeriodMonthKey()) {
  if (!expense?.plate) return { hkd: 0, rmb: 0 };
  const amount = Number(expense.amount || 0);
  if (!amount) return { hkd: 0, rmb: 0 };
  if (expense.type === "annual") {
    const { mode, year } = periodFilterParts(filterKey);
    const expenseYear = String(expense.year || String(expense.date || "").slice(0, 4));
    if (mode !== "all" && expenseYear !== year) return { hkd: 0, rmb: 0 };
    const periodAmount = mode === "month" ? amount / 12 : amount;
    return expense.currency === "港币" ? { hkd: periodAmount, rmb: 0 } : { hkd: 0, rmb: periodAmount };
  }
  if (!dateMatchesPeriodFilter(expense.date, filterKey)) return { hkd: 0, rmb: 0 };
  return expense.currency === "港币" ? { hkd: amount, rmb: 0 } : { hkd: 0, rmb: amount };
}

function vehicleExpenseAppliesToPeriod(expense = {}, filterKey = currentPeriodMonthKey()) {
  const amount = vehicleExpenseAmountBreakdown(expense, filterKey);
  return Boolean(amount.hkd || amount.rmb);
}

function vehicleExpenseBreakdownForPlate(plate, filterKey = currentPeriodMonthKey()) {
  return vehicleExpenseRows.value
    .filter((expense) => String(expense.plate || "").trim() === String(plate || "").trim())
    .reduce((sum, expense) => {
      const amount = vehicleExpenseAmountBreakdown(expense, filterKey);
      return {
        hkd: sum.hkd + amount.hkd,
        rmb: sum.rmb + amount.rmb
      };
    }, { hkd: 0, rmb: 0 });
}

function vehicleExpenseBreakdownByTypeForPlate(plate, filterKey = currentPeriodMonthKey()) {
  const breakdowns = VEHICLE_EXPENSE_CONFIGS.reduce((result, config) => {
    result[config.type] = { hkd: 0, rmb: 0 };
    return result;
  }, {});
  breakdowns.insurance = { hkd: 0, rmb: 0 };
  breakdowns.review = { hkd: 0, rmb: 0 };
  breakdowns.plateHead = { hkd: 0, rmb: 0 };
  vehicleExpenseRows.value
    .filter((expense) => String(expense.plate || "").trim() === String(plate || "").trim())
    .forEach((expense) => {
      const amount = vehicleExpenseAmountBreakdown(expense, filterKey);
      const typeBucket = breakdowns[expense.type] || breakdowns.other;
      typeBucket.hkd += amount.hkd;
      typeBucket.rmb += amount.rmb;
      if (expense.type === "annual") {
        const annualName = String(expense.name || "").trim();
        const annualBucket = annualName === "年审费"
          ? breakdowns.review
          : annualName === "牌头费"
            ? breakdowns.plateHead
            : breakdowns.insurance;
        annualBucket.hkd += amount.hkd;
        annualBucket.rmb += amount.rmb;
      }
    });
  return breakdowns;
}

const BOSS_VEHICLE_FREIGHT_INCOME_FEE_NAMES = new Set(["中港运费", "基础运费"]);

function bossVehicleFeeName(fee = {}) {
  return String(feeItemForFee(fee)?.name || fee.name || "").trim();
}

function isBossVehicleFreightIncomeFee(fee = {}) {
  return BOSS_VEHICLE_FREIGHT_INCOME_FEE_NAMES.has(bossVehicleFeeName(fee));
}

function bossVehicleSingleDriverMode(order = {}) {
  return (normalizeTransportMode(order.transportMode || "单司机") || "单司机") === "单司机";
}

function bossVehicleRouteLevel1(value = "") {
  const [level1 = ""] = String(value || "")
    .split(/[\/／｜|>]+/)
    .map((item) => normalizeFreightLabel(item))
    .filter(Boolean);
  return level1;
}

function bossVehicleOrderDriverName(order = {}) {
  if (!bossVehicleSingleDriverMode(order)) return "";
  const directName = String(order.driver || order.hkDriver || order.mainlandDriver || "").trim();
  if (directName) return directName;
  const vehicle = vehicleRows.value.find((item) => item.plate === order.plate) || null;
  const boundDriver = driverRows.value.find((driver) => order.plate && driver.boundPlate === order.plate);
  return String(vehicle?.driver || boundDriver?.name || "").trim();
}

function bossVehicleOrderDriver(order = {}) {
  const driverName = bossVehicleOrderDriverName(order);
  if (!driverName && !order.plate) return null;
  return driverRows.value.find((driver) => driver.name === driverName)
    || driverRows.value.find((driver) => order.plate && driver.boundPlate === order.plate)
    || null;
}

function bossVehicleDriverCostRuleMatchesOrder(rule = {}, order = {}, driver = null) {
  if (rule.source !== "司机") return false;
  const driverName = bossVehicleOrderDriverName(order);
  const ruleDriverName = String(rule.entityName || "").trim();
  const ruleEntityId = String(rule.entityId || "").trim();
  const driverMatches = Boolean(
    (driver?.id && ruleEntityId === String(driver.id))
    || (driver?.name && ruleDriverName === driver.name)
    || (driverName && ruleDriverName === driverName)
  );
  if (!driverMatches) return false;
  return bossVehicleRouteLevel1(rule.origin) === bossVehicleRouteLevel1(order.loading)
    && bossVehicleRouteLevel1(rule.destination) === bossVehicleRouteLevel1(order.unloading);
}

function bossVehicleDriverCostRuleForOrder(order = {}) {
  if (!bossVehicleSingleDriverMode(order)) return null;
  const driver = bossVehicleOrderDriver(order);
  const rules = costCenterRateRows.value
    .filter((rule) => bossVehicleDriverCostRuleMatchesOrder(rule, order, driver))
    .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  return rules[0] || null;
}

function amountBreakdownByCurrency(amount = 0, currency = "港币") {
  const value = Number(amount || 0);
  if (!value) return { hkd: 0, rmb: 0 };
  return currencyCodeDisplay(currency || "港币") === "RMB"
    ? { hkd: 0, rmb: value }
    : { hkd: value, rmb: 0 };
}

function bossVehicleOrderFeeRows(order = {}) {
  const fees = (Array.isArray(order?.fees) ? order.fees : [])
    .filter((fee) => bossVehicleFeeName(fee) && Number(fee.amount || 0) !== 0);
  if (fees.length) return fees;
  const fallbackFees = [];
  if (Number(order.receivableHKD || 0)) {
    fallbackFees.push({ name: "中港运费", currency: "港币", amount: Number(order.receivableHKD || 0) });
  }
  if (Number(order.receivableRMB || 0)) {
    fallbackFees.push({ name: "中港运费", currency: "人民币", amount: Number(order.receivableRMB || 0) });
  }
  return fallbackFees;
}

function bossVehicleDriverCostValueForFee(rule = {}, fee = {}) {
  if (!rule) return 0;
  const values = normalizeCostCenterValues(rule.costValues);
  const item = feeItemForFee(fee);
  const keys = [
    item ? costCenterFeeValueKey(item) : "",
    item?.id,
    item?.name,
    fee.feeItemId,
    fee.fee_item_id,
    fee.name
  ].map((key) => String(key || "").trim()).filter(Boolean);
  const matchedKey = keys.find((key) => Object.prototype.hasOwnProperty.call(values, key));
  return matchedKey ? Number(values[matchedKey] || 0) : 0;
}

function bossVehicleDriverCostCurrencyForFee(fee = {}) {
  return feeItemForFee(fee)?.currency || fee.currency || "港币";
}

function bossVehicleOrderFeeBreakdown(order) {
  if (!bossVehicleSingleDriverMode(order)) {
    return { revenueHKD: 0, revenueRMB: 0, orderProfitHKD: 0, orderProfitRMB: 0, totalRevenueHKD: 0, totalRevenueRMB: 0 };
  }
  const costRule = bossVehicleDriverCostRuleForOrder(order);
  return bossVehicleOrderFeeRows(order)
    .reduce((sum, fee) => {
      const incomeHKD = feeAmountHKD(fee);
      const incomeRMB = feeAmountRMB(fee);
      const cost = amountBreakdownByCurrency(
        costRule ? bossVehicleDriverCostValueForFee(costRule, fee) : 0,
        bossVehicleDriverCostCurrencyForFee(fee)
      );
      const freightIncome = isBossVehicleFreightIncomeFee(fee)
        ? { hkd: incomeHKD, rmb: incomeRMB }
        : { hkd: 0, rmb: 0 };
      return {
        ...sum,
        revenueHKD: sum.revenueHKD + freightIncome.hkd,
        revenueRMB: sum.revenueRMB + freightIncome.rmb,
        totalRevenueHKD: sum.totalRevenueHKD + incomeHKD,
        totalRevenueRMB: sum.totalRevenueRMB + incomeRMB,
        orderProfitHKD: sum.orderProfitHKD + incomeHKD - cost.hkd,
        orderProfitRMB: sum.orderProfitRMB + incomeRMB - cost.rmb
      };
    }, { revenueHKD: 0, revenueRMB: 0, totalRevenueHKD: 0, totalRevenueRMB: 0, orderProfitHKD: 0, orderProfitRMB: 0 });
}

const bossVehicleProfitDisplayRows = computed(() => {
  const groups = new Map();
  bossOrderRows.value
    .filter((order) => order.vehicleSource === "本公司车辆" && String(order.plate || "").trim() && bossVehicleSingleDriverMode(order))
    .forEach((order) => {
      const plate = String(order.plate || "").trim();
      const row = groups.get(plate) || {
        plate,
        driverNames: new Set(),
        orders: [],
        revenueHKD: 0,
        revenueRMB: 0,
        totalRevenueHKD: 0,
        totalRevenueRMB: 0,
        orderProfitHKD: 0,
        orderProfitRMB: 0
      };
      const feeBreakdown = bossVehicleOrderFeeBreakdown(order);
      row.orders.push(order);
      row.revenueHKD += feeBreakdown.revenueHKD;
      row.revenueRMB += feeBreakdown.revenueRMB;
      row.totalRevenueHKD += feeBreakdown.totalRevenueHKD;
      row.totalRevenueRMB += feeBreakdown.totalRevenueRMB;
      row.orderProfitHKD += feeBreakdown.orderProfitHKD;
      row.orderProfitRMB += feeBreakdown.orderProfitRMB;
      const driverName = bossVehicleOrderDriverName(order);
      if (driverName) row.driverNames.add(driverName);
      groups.set(plate, row);
    });
  vehicleExpenseRows.value
    .filter((expense) => vehicleExpenseAppliesToPeriod(expense, bossPeriodFilter.value) && String(expense.plate || "").trim())
    .forEach((expense) => {
      const plate = String(expense.plate || "").trim();
      if (!groups.has(plate)) {
        groups.set(plate, {
          plate,
          driverNames: new Set(),
          orders: [],
          revenueHKD: 0,
          revenueRMB: 0,
          totalRevenueHKD: 0,
          totalRevenueRMB: 0,
          orderProfitHKD: 0,
          orderProfitRMB: 0
        });
      }
    });
  return Array.from(groups.values())
    .map((row) => {
      const vehicle = vehicleRows.value.find((item) => item.plate === row.plate) || null;
      const vehicleExpenseByType = vehicleExpenseBreakdownByTypeForPlate(row.plate, bossPeriodFilter.value);
      const vehicleExpense = Object.values(vehicleExpenseByType).reduce((sum, item) => ({
        hkd: sum.hkd + item.hkd,
        rmb: sum.rmb + item.rmb
      }), { hkd: 0, rmb: 0 });
      const expenseHKD = vehicleExpense.hkd;
      const expenseRMB = vehicleExpense.rmb;
      const profitHKD = row.orderProfitHKD - expenseHKD;
      const profitRMB = row.orderProfitRMB - expenseRMB;
      const profitEquivalent = bossVehicleRmbEquivalent(profitHKD, profitRMB);
      const revenueEquivalent = bossVehicleRmbEquivalent(row.totalRevenueHKD, row.totalRevenueRMB);
      const totalCostRMB = revenueEquivalent - profitEquivalent;
      return {
        plate: row.plate,
        driver: Array.from(row.driverNames).join("、") || vehicle?.driver || "-",
        orderCount: row.orders.length,
        revenue: moneyPairDisplay(row.revenueHKD, row.revenueRMB),
        orderProfit: moneyPairDisplay(row.orderProfitHKD, row.orderProfitRMB),
        fuelExpense: moneyPairDisplay(vehicleExpenseByType.fuel.hkd, vehicleExpenseByType.fuel.rmb),
        repairExpense: moneyPairDisplay(vehicleExpenseByType.repair.hkd, vehicleExpenseByType.repair.rmb),
        insuranceExpense: moneyPairDisplay(vehicleExpenseByType.insurance.hkd, vehicleExpenseByType.insurance.rmb),
        reviewExpense: moneyPairDisplay(vehicleExpenseByType.review.hkd, vehicleExpenseByType.review.rmb),
        plateHeadExpense: moneyPairDisplay(vehicleExpenseByType.plateHead.hkd, vehicleExpenseByType.plateHead.rmb),
        vehicleOtherExpense: moneyPairDisplay(vehicleExpenseByType.other.hkd, vehicleExpenseByType.other.rmb),
        expense: moneyPairDisplay(expenseHKD, expenseRMB),
        profit: moneyPairDisplay(profitHKD, profitRMB),
        profitRMBEquivalent: moneyRmbDisplay(profitEquivalent),
        totalCostRMB,
        margin: bossVehicleProfitRateText(profitEquivalent, totalCostRMB),
        profitEquivalent
      };
    })
    .sort((left, right) => right.profitEquivalent - left.profitEquivalent || right.orderCount - left.orderCount);
});

const bossTopVehicleProfitRow = computed(() => bossVehicleProfitDisplayRows.value[0] || {
  plate: "-",
  profit: "-",
  margin: "-"
});

function bossExpenseTotalForMonth(monthKey) {
  return bossCompanyExpenseRows
    .filter((row) => row.date === monthKey)
    .reduce((sum, row) => sum + bossCompanyExpenseAmount(row), 0);
}

function bossVehicleCostForOrders(sourceOrders, filterKey) {
  const wageRows = buildFinanceWageRows(
    sourceOrders,
    driverAdjustmentRows.value.filter((item) => dateMatchesPeriodFilter(item.date, filterKey))
  );
  const driverPayHKD = wageRows.reduce((sum, row) => sum + row.total, 0);
  const driverPayRMB = wageRows.reduce((sum, row) => sum + row.totalRMB, 0);
  const fixedCostRMB = Array.from(new Set(sourceOrders
    .filter((order) => order.vehicleSource === "本公司车辆" && order.plate)
    .map((order) => order.plate)))
    .reduce((sum, plate) => {
      const vehicle = vehicleRows.value.find((item) => item.plate === plate) || null;
      const plateOrders = sourceOrders.filter((order) => order.plate === plate);
      return sum + vehicleFixedCostRMB(vehicle, plateOrders, filterKey);
    }, 0);
  return { hkd: driverPayHKD, rmb: driverPayRMB + fixedCostRMB };
}

const bossCompanyProfitDisplayRows = computed(() => {
  const monthGroups = new Map();
  bossOrderRows.value.forEach((order) => {
    const monthKey = inputMonthKey(order.date);
    if (!monthKey) return;
    const rows = monthGroups.get(monthKey) || [];
    rows.push(order);
    monthGroups.set(monthKey, rows);
  });
  return Array.from(monthGroups.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([period, orders]) => {
      const transportOrders = orders.filter((order) => String(order.businessType || "").includes("运输"));
      const customsOrders = orders.filter((order) => String(order.businessType || "").includes("报关"));
      const revenue = orderReceivableBreakdown(orders);
      const transportRevenue = orderReceivableBreakdown(transportOrders);
      const customsRevenue = orderReceivableBreakdown(customsOrders);
      const vehicleCost = bossVehicleCostForOrders(orders, period);
      const expenseRMB = bossExpenseTotalForMonth(period);
      const netProfitHKD = revenue.hkd - vehicleCost.hkd;
      const netProfitRMB = revenue.rmb - vehicleCost.rmb - expenseRMB;
      return {
        period,
        transportRevenue: moneyPairDisplay(transportRevenue.hkd, transportRevenue.rmb),
        customsRevenue: moneyPairDisplay(customsRevenue.hkd, customsRevenue.rmb),
        vehicleCost: moneyPairDisplay(vehicleCost.hkd, vehicleCost.rmb),
        expenses: expenseRMB ? `RMB ${money(expenseRMB)}` : "-",
        netProfit: moneyPairDisplay(netProfitHKD, netProfitRMB),
        margin: marginText(netProfitHKD, netProfitRMB, revenue.hkd, revenue.rmb),
        transportHKD: transportRevenue.hkd,
        transportRMB: transportRevenue.rmb,
        customsHKD: customsRevenue.hkd,
        customsRMB: customsRevenue.rmb,
        revenueHKD: revenue.hkd,
        revenueRMB: revenue.rmb,
        netProfitHKD,
        netProfitRMB
      };
    });
});

const bossCompanyProfitSummary = computed(() => {
  const rows = bossCompanyProfitDisplayRows.value;
  const summary = rows.reduce((sum, row) => ({
    transportHKD: sum.transportHKD + row.transportHKD,
    transportRMB: sum.transportRMB + row.transportRMB,
    customsHKD: sum.customsHKD + row.customsHKD,
    customsRMB: sum.customsRMB + row.customsRMB,
    revenueHKD: sum.revenueHKD + row.revenueHKD,
    revenueRMB: sum.revenueRMB + row.revenueRMB,
    netProfitHKD: sum.netProfitHKD + row.netProfitHKD,
    netProfitRMB: sum.netProfitRMB + row.netProfitRMB
  }), { transportHKD: 0, transportRMB: 0, customsHKD: 0, customsRMB: 0, revenueHKD: 0, revenueRMB: 0, netProfitHKD: 0, netProfitRMB: 0 });
  return {
    transportRevenue: moneyPairDisplay(summary.transportHKD, summary.transportRMB),
    customsRevenue: moneyPairDisplay(summary.customsHKD, summary.customsRMB),
    revenue: moneyPairDisplay(summary.revenueHKD, summary.revenueRMB),
    netProfit: moneyPairDisplay(summary.netProfitHKD, summary.netProfitRMB),
    margin: marginText(summary.netProfitHKD, summary.netProfitRMB, summary.revenueHKD, summary.revenueRMB)
  };
});

const bossCustomerProfitDisplayRows = computed(() => {
  const groups = new Map();
  bossOrderRows.value.forEach((order) => {
    const customer = String(order.customer || "未填写客户").trim();
    const row = groups.get(customer) || {
      customer,
      orderCount: 0,
      revenueHKD: 0,
      revenueRMB: 0
    };
    row.orderCount += 1;
    row.revenueHKD += Number(order.receivableHKD || 0);
    row.revenueRMB += Number(order.receivableRMB || 0);
    groups.set(customer, row);
  });
  const costRatio = rmbEquivalent(
    bossFinanceSummary.value.driverPayableHKD + bossFinanceSummary.value.supplierPayableHKD,
    bossFinanceSummary.value.driverPayableRMB + bossFinanceSummary.value.supplierPayableRMB
  ) / Math.max(1, rmbEquivalent(bossFinanceSummary.value.receivableHKD, bossFinanceSummary.value.receivableRMB));
  return Array.from(groups.values())
    .map((row) => {
      const costHKD = row.revenueHKD * costRatio;
      const costRMB = row.revenueRMB * costRatio;
      const profitHKD = row.revenueHKD - costHKD;
      const profitRMB = row.revenueRMB - costRMB;
      return {
        customer: row.customer,
        orderCount: row.orderCount,
        revenue: moneyPairDisplay(row.revenueHKD, row.revenueRMB),
        profit: moneyPairDisplay(profitHKD, profitRMB),
        margin: marginText(profitHKD, profitRMB, row.revenueHKD, row.revenueRMB),
        profitEquivalent: rmbEquivalent(profitHKD, profitRMB)
      };
    })
    .sort((left, right) => right.profitEquivalent - left.profitEquivalent || right.orderCount - left.orderCount)
    .slice(0, 12);
});

const bossDashboardKpiRows = computed(() => [
  { label: "净利润", value: bossCompanyProfitSummary.value.netProfit, note: periodFilterLabelByScope("boss") },
  { label: "营业收入", value: bossCompanyProfitSummary.value.revenue, note: `订单 ${bossFinanceSummary.value.orderCount} 单` },
  { label: "待收款", value: moneyPairDisplay(bossFinanceSummary.value.receivableHKD, bossFinanceSummary.value.receivableRMB), note: "按当前筛选订单应收估算" },
  { label: "综合利润率", value: bossCompanyProfitSummary.value.margin, note: "收入扣减司机、外派和公司支出" }
]);

function financeDateRangeBounds(filterKey = financePeriodFilter.value) {
  return periodFilterBounds(filterKey);
}

function orderInDateRange(order, startValue, endValue) {
  const date = parseInputDate(order?.date);
  if (!date) return false;
  const start = parseInputDate(startValue);
  const end = parseInputDate(endValue);
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function buildFinanceCustomerRows(sourceOrders, limit = 0) {
  const groups = new Map();
  sourceOrders.forEach((order) => {
    const key = order.customer || "未填写客户";
    const row = groups.get(key) || { customer: key, customerId: order.customerId || "", count: 0, hkd: 0, rmb: 0 };
    if (!row.customerId && order.customerId) row.customerId = order.customerId;
    row.count += 1;
    row.hkd += Number(order.receivableHKD || 0);
    row.rmb += Number(order.receivableRMB || 0);
    groups.set(key, row);
  });
  const rows = Array.from(groups.values()).sort((a, b) => b.count - a.count || b.hkd - a.hkd);
  return limit ? rows.slice(0, limit) : rows;
}

const financeCustomerRanking = computed(() => buildFinanceCustomerRows(financeOrderRows.value, 12));
const statementCustomerRows = computed(() => buildFinanceCustomerRows(statementOrderRows.value));

function statementCustomerRecord(row = {}) {
  return customerRows.value.find((item) =>
    item.type === "客户" &&
    (
      (row.customerId && item.id === row.customerId) ||
      item.name === row.customer
    )
  ) || null;
}

function statementCustomerRowKey(row = {}) {
  const customer = statementCustomerRecord(row);
  return customer?.id || row.customerId || row.customer || "";
}

function statementCustomerSettlementCurrency(row = {}) {
  const raw = statementCustomerRecord(row)?.settlementCurrency || "人民币结算";
  return String(raw || "").includes("港") ? "港币" : "人民币";
}

function statementCustomerExchangeRate(row = {}) {
  const key = statementCustomerRowKey(row);
  const saved = key ? statementCustomerExchangeRates[key] : "";
  return String(saved || STATEMENT_DEFAULT_EXCHANGE_RATE);
}

function setStatementCustomerExchangeRate(row = {}, value = "") {
  const key = statementCustomerRowKey(row);
  if (!key) return;
  const raw = String(value || "").trim();
  const parsed = Number(raw);
  const nextValue = Number.isFinite(parsed) && parsed > 0 ? raw : STATEMENT_DEFAULT_EXCHANGE_RATE;
  statementCustomerExchangeRates[key] = nextValue;
  saveStoredJson(STATEMENT_CUSTOMER_EXCHANGE_RATES_KEY, { ...statementCustomerExchangeRates });
  if (statementExportMenuCustomerKey.value === key) {
    statementExchangeRate.value = nextValue;
    saveStatementExportSettings();
  }
}

function closeStatementExportMenu() {
  statementExportMenuOpen.value = false;
  statementExportMenuCustomerKey.value = "";
}

function applyStatementCustomerExportContext(row = {}) {
  statementExportType.value = "customer";
  statementExportEntity.value = row.customer || "";
  statementSettlementCurrency.value = statementCustomerSettlementCurrency(row);
  statementExchangeRate.value = statementCustomerExchangeRate(row);
  syncStatementExportRange(activeStatementMonthFilter.value);
  saveStatementExportSettings();
}

async function openStatementCustomerExportMenu(row = {}) {
  const key = statementCustomerRowKey(row);
  if (!key || !row.customer) {
    notify("当前客户信息不完整，无法导出对账单");
    return;
  }
  if (statementExportMenuOpen.value && statementExportMenuCustomerKey.value === key) {
    closeStatementExportMenu();
    return;
  }
  applyStatementCustomerExportContext(row);
  await ensureTemplateRowsLoaded({ silent: true });
  statementExportMenuCustomerKey.value = key;
  statementExportMenuOpen.value = true;
}

const activeStatementExportCustomerRow = computed(() =>
  statementCustomerRows.value.find((row) => statementCustomerRowKey(row) === statementExportMenuCustomerKey.value) || null
);

function statementDownloadKey(type, entityName, start, end) {
  return [type, entityName || "全部", start || "", end || ""].join("|");
}

async function markStatementDownloaded(type, entityName, start, end) {
  const key = statementDownloadKey(type, entityName, start, end);
  const payload = {
    key,
    type,
    entityName: entityName || "全部",
    start,
    end,
    status: "已导出",
    downloadedAt: new Date().toISOString()
  };
  try {
    const item = await financeApi.createStatementDownload(payload);
    const nextRows = statementDownloadRows.value.filter((row) => row.key !== item.key);
    statementDownloadRows.value = [item, ...nextRows].slice(0, 300);
    return true;
  } catch (error) {
    notify(`下载记录写入数据库失败：${error.message}`);
    return false;
  }
}

function statementDownloadRecordForCustomerRow(row = {}) {
  const { start, end } = statementDateRangeBounds(activeStatementMonthFilter.value);
  const key = statementDownloadKey("customer", row.customer || "全部", start || "", end || "");
  return statementDownloadRows.value.find((item) => (item.key || item.downloadKey) === key) || null;
}

function statementCustomerStatementStatus(row = {}) {
  return statementDownloadRecordForCustomerRow(row)?.status || "未导出";
}

function statementDownloadStatusClass(status = "") {
  if (status === "已导出") return "exported";
  if (status === "已发送") return "sent";
  if (status === "已开票") return "invoiced";
  return "";
}

async function updateCustomerStatementStatus(row = {}, status = "") {
  const record = statementDownloadRecordForCustomerRow(row);
  if (!record?.id) {
    notify("请先导出这份对账单，再修改发送或开票状态");
    return;
  }
  try {
    const item = await financeApi.updateStatementDownloadStatus(record.id, status);
    const nextRows = statementDownloadRows.value.filter((downloadRow) =>
      downloadRow.id !== item.id && downloadRow.key !== item.key && downloadRow.downloadKey !== item.downloadKey
    );
    statementDownloadRows.value = [item, ...nextRows].slice(0, 300);
    notify("对账单状态已更新");
  } catch (error) {
    notify(`对账单状态更新失败：${error.message}`);
  }
}

const statementEntityOptions = computed(() => {
  if (statementExportType.value === "driver") {
    return driverRows.value
      .filter((driver) => statementOrderRows.value.some((order) =>
        orderIncludesDriver(order, driver) || order.plate === driver.boundPlate
      ))
      .map((driver) => ({ id: driver.id, name: driver.name }))
      .filter((item) => item.name);
  }
  if (statementExportType.value === "supplier") {
    const names = new Set(statementOrderRows.value
      .filter((order) => order.vehicleSource === "外派车辆")
      .map((order) => order.supplier)
      .filter(Boolean));
    return Array.from(names).map((name) => ({ id: name, name }));
  }
  return statementCustomerRows.value
    .map((row) => {
      const customer = customerRows.value.find((item) => item.type === "客户" && item.name === row.customer);
      return { id: customer?.id || row.customer, name: row.customer };
    })
    .filter((item) => item.name);
});

watch(statementEntityOptions, (options) => {
  if (!options.length) {
    statementExportEntity.value = "";
    return;
  }
  const exists = options.some((item) => item.name === statementExportEntity.value || item.id === statementExportEntity.value);
  if (!exists) statementExportEntity.value = options[0].name;
}, { immediate: true });

function ensureStatementEntity() {
  const options = statementEntityOptions.value;
  if (!options.length) return "";
  const exists = options.some((item) => item.name === statementExportEntity.value || item.id === statementExportEntity.value);
  if (!exists) statementExportEntity.value = options[0].name;
  return statementExportEntity.value || options[0].name;
}

function statementDateRange() {
  const fallback = statementDateRangeBounds(activeStatementMonthFilter.value);
  return {
    start: statementExportStart.value || fallback.start || "",
    end: statementExportEnd.value || fallback.end || ""
  };
}

function selectedStatementOrders() {
  const entity = ensureStatementEntity();
  const { start, end } = statementDateRange();
  return orderRows.value.filter((order) => {
    if (!orderInDateRange(order, start, end)) return false;
    if (statementExportType.value === "supplier") {
      return order.vehicleSource === "外派车辆" && order.supplier === entity;
    }
    if (statementExportType.value === "driver") {
      const driver = driverRows.value.find((item) => item.name === entity || item.id === entity);
      return Boolean(driver && (orderIncludesDriver(order, driver) || order.plate === driver.boundPlate));
    }
    return order.customer === entity || customerRows.value.some((item) => item.name === entity && item.id === order.customerId);
  });
}

function statementConvertedTotal(orders, currency, rateValue) {
  const rate = Number(rateValue || 0);
  const hkd = orders.reduce((sum, order) => sum + Number(order.receivableHKD || 0), 0);
  const rmb = orders.reduce((sum, order) => sum + Number(order.receivableRMB || 0), 0);
  if (currency === "港币") {
    return { hkd, rmb, total: hkd + (rate ? rmb / rate : 0), label: "折合港币" };
  }
  return { hkd, rmb, total: rmb + hkd * rate, label: "折合人民币" };
}

function statementFeeText(order) {
  return (Array.isArray(order?.fees) ? order.fees : [])
    .filter((fee) => Number(fee.amount || 0) || fee.name)
    .map((fee) => `${fee.name || "费用"} ${fee.currency || ""}${money(fee.amount || 0)}`)
    .join("；");
}

async function statementAttachmentText(order) {
  try {
    const files = await loadFiles("order", order.no);
    return files.map((file) => file.filename || file.name).filter(Boolean).join("；");
  } catch {
    return "";
  }
}

function saveStatementExportSettings() {
  localStorage.setItem("hanye_statement_export_type", statementExportType.value);
  localStorage.setItem("hanye_statement_export_start", statementExportStart.value);
  localStorage.setItem("hanye_statement_export_end", statementExportEnd.value);
  localStorage.setItem("hanye_statement_settlement_currency", statementSettlementCurrency.value);
  localStorage.setItem("hanye_statement_exchange_rate", statementExchangeRate.value);
}

const routeAdjustSelectedCustomer = computed(() =>
  customerRows.value.find((item) =>
    item.type === "客户" && item.name === String(driverRouteAdjustForm.customerName || "").trim()
  ) || null
);

const routeAdjustAddressOptions = computed(() => {
  const map = new Map();
  const addOption = (source, value, meta = "") => {
    const text = String(value || "").trim();
    if (!text) return;
    const key = addressOptionKey(text);
    if (!key || map.has(key)) return;
    map.set(key, { key, source, value: text, meta });
  };
  const customer = routeAdjustSelectedCustomer.value;
  if (customer) {
    addOption("客户档案", [customer.city, customer.address].filter(Boolean).join(" / "), customer.name);
    customerContactRows.value
      .filter((item) => item.customerId === customer.id)
      .forEach((item) => {
        const area = contactAreaText(item);
        const address = contactAddressText(item);
        addOption("客户地址", [area, address].filter(Boolean).join(" / "), item.name || item.mobile || item.phone || "");
      });
  } else {
    addressBookRows.value.forEach((item) => {
      addOption("地址本", [item.area, item.address].filter(Boolean).join(" / "), item.contact || item.phone || item.note || "");
    });
  }
  return [...map.values()].slice(0, 120);
});

function routeAdjustDriverPickerLabel() {
  const ids = driverRouteAdjustForm.driverIds.map((id) => Number(id)).filter(Boolean);
  if (!ids.length) return "全部司机";
  const selected = driverRows.value.filter((item) => ids.includes(Number(item.id)));
  if (selected.length <= 2) return selected.map((item) => item.name).join("、") || "选择司机";
  return `已选 ${selected.length} 位司机`;
}

async function addDriverRouteAdjustRule() {
  if (!driverRouteAdjustForm.customerName && !driverRouteAdjustForm.loading && !driverRouteAdjustForm.unloading && !driverRouteAdjustForm.driverIds.length) {
    notify("请至少填写客户、路线或指定司机");
    return;
  }
  const selectedRuleDrivers = driverRows.value.filter((item) =>
    driverRouteAdjustForm.driverIds.map((id) => Number(id)).includes(Number(item.id))
  );
  const currency = driverRouteAdjustForm.currency || "港币";
  const amountHKD = currency === "人民币" ? 0 : Number(driverRouteAdjustForm.amountHKD || -50);
  const amountRMB = currency === "人民币" ? Number(driverRouteAdjustForm.amountRMB || -50) : 0;
  const payload = {
    customerName: driverRouteAdjustForm.customerName,
    driverIds: selectedRuleDrivers.map((item) => item.id),
    driverNames: selectedRuleDrivers.map((item) => item.name),
    driverId: selectedRuleDrivers.length === 1 ? selectedRuleDrivers[0].id : "",
    driverName: selectedRuleDrivers.length === 1 ? selectedRuleDrivers[0].name : "",
    transportMode: normalizeTransportMode(driverRouteAdjustForm.transportMode || ""),
    loading: supplierCostRuleAreaValue(driverRouteAdjustForm.loading),
    unloading: supplierCostRuleAreaValue(driverRouteAdjustForm.unloading),
    amountHKD,
    amountRMB,
    note: driverRouteAdjustForm.note
  };
  try {
    loading.value = true;
    const item = await financeApi.createDriverRouteAdjustRule(payload);
    driverRouteAdjustRules.value = [item, ...driverRouteAdjustRules.value.filter((rule) => rule.id !== item.id)];
    Object.assign(driverRouteAdjustForm, { customerName: "", driverIds: [], transportMode: "", loading: "", unloading: "", currency: "港币", amountHKD: -50, amountRMB: 0, note: "" });
    routeAdjustDriverPickerOpen.value = false;
    notify("司机路线扣减规则已保存到数据库");
  } catch (error) {
    notify(error.message || "保存司机路线扣减规则失败");
  } finally {
    loading.value = false;
  }
}

async function removeDriverRouteAdjustRule(rule) {
  if (!rule?.id) return;
  try {
    await financeApi.deleteDriverRouteAdjustRule(rule.id);
    driverRouteAdjustRules.value = driverRouteAdjustRules.value.filter((item) => item.id !== rule.id);
    notify("司机路线扣减规则已删除");
  } catch (error) {
    notify(error.message || "删除司机路线扣减规则失败");
  }
}

function orderBelongsToPartner(order, partner) {
  if (!partner) return false;
  if (partner.type === "供应商") {
    return order.vehicleSource === "外派车辆" && order.supplier === partner.name;
  }
  return order.customerId === partner.id || order.customer === partner.name;
}

function orderDispatchPlanRow(order = {}) {
  return dispatchPlanRows.value.find((row) =>
    (order.no && row.orderNo === order.no) ||
    (order.dispatchNo && row.dispatchNo === order.dispatchNo)
  );
}

function isOrderVisibleInOrderManagement(order = {}) {
  if (order.status === "预排") return false;
  const dispatchRow = orderDispatchPlanRow(order);
  if (!dispatchRow) return true;
  return !["预排", "已派车"].includes(normalizeDispatchPlanStatus(dispatchRow.status, dispatchRow));
}

const selectedCustomerOrders = computed(() => {
  if (!selectedCustomer.value) return [];
  return sortRowsByTable(orderRows.value.filter((item) =>
    orderBelongsToPartner(item, selectedCustomer.value) &&
    isOrderVisibleInOrderManagement(item)
  ), "customerOrders");
});

const selectedCustomerOrderNos = computed(() => selectedCustomerOrders.value.map((item) => item.no));

const selectedCustomerOrderCount = computed(() =>
  selectedOrderNos.value.filter((no) => selectedCustomerOrderNos.value.includes(no)).length
);

const allSelectedCustomerOrdersChecked = computed(() =>
  selectedCustomerOrders.value.length > 0 &&
  selectedCustomerOrders.value.every((item) => selectedOrderNos.value.includes(item.no))
);

const selectedCustomerScopedOrders = computed(() =>
  selectedCustomerOrders.value.filter((item) => selectedOrderNos.value.includes(item.no))
);

const customerListDetailRows = computed(() =>
  selectedCustomerIds.value.length
    ? visibleCustomers.value.filter((item) => selectedCustomerIds.value.includes(item.id))
    : visibleCustomers.value
);

const selectedCustomerContacts = computed(() => {
  if (!selectedCustomer.value) return [];
  return customerContactRows.value.filter((item) => item.customerId === selectedCustomer.value.id);
});

const customerDetailTabs = computed(() => {
  const tabs = ["订单管理", "联系人", "开票信息", "附件管理", "相关费用", "相关对账", "变更记录"];
  return activePartnerType.value === "供应商"
    ? ["外派费用规则", ...tabs]
    : tabs;
});

const customerDetailActionLabel = computed(() =>
  activeCustomerDetailTab.value === "联系人"
    ? "新建联系人"
    : "新建订单"
);

const showCustomerDetailPrimaryAction = computed(() => {
  if (activeCustomerDetailTab.value === "联系人") return true;
  if (activeCustomerDetailTab.value === "外派费用规则") return false;
  return activePartnerType.value === "客户";
});

const orderCustomerOptions = computed(() => {
  const keyword = normalizeLocationText(orderCustomerKeyword.value);
  return customerRows.value
    .filter((item) => item.type === "客户")
    .filter((item) => {
      if (!keyword) return true;
      return normalizeLocationText([item.id, item.name, item.taxNo, item.mobile, item.contact].join(" ")).includes(keyword);
    })
    .slice(0, 80);
});

const dispatchCustomerOptions = computed(() => {
  const keyword = normalizeLocationText(dispatchCustomerKeyword.value);
  return customerRows.value
    .filter((item) => item.type === "客户")
    .filter((item) => {
      if (!keyword) return true;
      return normalizeLocationText([item.id, item.name, item.taxNo, item.mobile, item.contact, item.type].join(" ")).includes(keyword);
    })
    .slice(0, 100);
});

const orderCustomerFilterOptions = computed(() => {
  const names = new Set();
  orderRows.value.forEach((item) => {
    if (!isOrderVisibleInOrderManagement(item)) return;
    if (orderStatusFilter.value && item.status !== orderStatusFilter.value) return;
    if (orderBusinessFilter.value && item.businessType !== orderBusinessFilter.value) return;
    if (!isOrderDateFilterMatch(item.date)) return;
    const name = String(item.customer || "").trim();
    if (name) names.add(name);
  });
  return Array.from(names).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN", { numeric: true, sensitivity: "base" })
  );
});

watch(orderCustomerFilterOptions, (options) => {
  if (orderCustomerFilter.value && !options.includes(orderCustomerFilter.value)) {
    orderCustomerFilter.value = "";
  }
});

function selectDispatchCustomer(customer) {
  dispatchForm.customerId = customer?.id || "";
  dispatchForm.customer = customer?.name || "";
  dispatchCustomerKeyword.value = customer?.name || "";
  dispatchCustomerPickerOpen.value = false;
}

function handleDispatchVehicleSourceChange() {
  if (dispatchForm.vehicleSource === "本公司车辆") {
    dispatchForm.supplier = "";
  } else if (dispatchForm.vehicleSource === "外派车辆") {
    dispatchForm.plate = "";
  } else {
    dispatchForm.plate = "";
    dispatchForm.supplier = "";
  }
}

const filteredOrders = computed(() => {
  return sortRowsByTable(orderRows.value.filter((item) => {
    if (!isOrderVisibleInOrderManagement(item)) return false;
    if (orderStatusFilter.value && item.status !== orderStatusFilter.value) return false;
    if (orderCustomerFilter.value && item.customer !== orderCustomerFilter.value) return false;
    if (orderBusinessFilter.value && item.businessType !== orderBusinessFilter.value) return false;
    return isOrderDateFilterMatch(item.date);
  }), "orders");
});

const orderDateRangeLabel = computed(() => {
  const option = ORDER_DATE_FILTERS.find((item) => item.key === orderDateFilter.value);
  const { start, end } = orderDateFilterBounds(orderDateFilter.value);
  const label = option?.label || "日期";
  if (!start && !end) return label;
  return start === end ? `${label}：${start}` : `${label}：${start} 至 ${end}`;
});

function isOrderDateFilterMatch(dateValue) {
  return dateMatchesOrderDateFilter(dateValue, orderDateFilter.value);
}

const visibleCustomerOrderColumns = computed(() =>
  customerOrderColumns.filter((column) => isCustomerOrderColumnVisible(column.key))
);

const customerOrderVisibleTableWidth = computed(() =>
  visibleCustomerOrderColumns.value.reduce((total, column) => total + Number(customerOrderColumnWidths[column.key] || column.width || 48), 0)
);

const visibleOrderColumns = computed(() =>
  orderColumns.filter((column) => isOrderColumnVisible(column.key))
);

const orderVisibleTableWidth = computed(() =>
  visibleOrderColumns.value.reduce((total, column) => total + Number(orderColumnWidths[column.key] || column.width || column.min || 72), 0)
);

function managedFrozenColumnStyle(visibleColumns, widths, lockedKeys, column, index) {
  if (!(lockedKeys || []).includes(column?.key)) return {};
  const left = visibleColumns
    .slice(0, index)
    .filter((item) => (lockedKeys || []).includes(item.key))
    .reduce((sum, item) => sum + Number(widths[item.key] || item.width || item.min || 72), 0);
  return { left: `${left}px` };
}

function isCustomerOrderColumnFrozen(column) {
  return (customerOrderLockedColumns.value || []).includes(column?.key);
}

function isOrderRightStickyColumn(column) {
  return ORDER_RIGHT_STICKY_KEYS.includes(column?.key);
}

function isOrderColumnFrozen(column) {
  return !isOrderRightStickyColumn(column) && (orderLockedColumns.value || []).includes(column?.key);
}

function isOrderFullDisplayColumn(columnOrKey) {
  const key = typeof columnOrKey === "string" ? columnOrKey : columnOrKey?.key;
  return ["date", "plate", "driver"].includes(key);
}

function customerOrderFrozenColumnStyle(column, index) {
  return managedFrozenColumnStyle(visibleCustomerOrderColumns.value, customerOrderColumnWidths, customerOrderLockedColumns.value, column, index);
}

function orderFrozenColumnStyle(column, index) {
  return managedFrozenColumnStyle(visibleOrderColumns.value, orderColumnWidths, orderLockedColumns.value, column, index);
}

function orderRightStickyColumnStyle(column) {
  if (!isOrderRightStickyColumn(column)) return {};
  const stickyColumns = ORDER_RIGHT_STICKY_KEYS
    .map((key) => visibleOrderColumns.value.find((item) => item.key === key))
    .filter(Boolean);
  const stickyIndex = stickyColumns.findIndex((item) => item.key === column.key);
  const right = stickyColumns
    .slice(stickyIndex + 1)
    .reduce((sum, item) => sum + Number(orderColumnWidths[item.key] || item.width || item.min || 72), 0);
  return { right: `${right}px` };
}

function orderStickyColumnStyle(column, index) {
  return isOrderRightStickyColumn(column)
    ? orderRightStickyColumnStyle(column)
    : orderFrozenColumnStyle(column, index);
}

const visibleFinanceWageTableColumns = computed(() =>
  financeWageTableColumns.filter((column) => financeWageTableColumnVisibility[column.key] !== false)
);

const visibleDispatchTableColumns = computed(() =>
  dispatchTableColumns.filter((column) =>
    dispatchTableColumnVisibility[column.key] !== false &&
    (column.key !== "driver" || activeDispatchStatusPool.value !== "预排")
  )
);

const dispatchDriverOptions = computed(() =>
  [...driverRows.value]
    .filter((driver) => String(driver?.name || "").trim())
    .sort((left, right) =>
      String(left.name || "").localeCompare(String(right.name || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" })
    )
);

const visibleCustomerListDetailColumns = computed(() =>
  customerListDetailColumns.filter((column) => customerListDetailColumnVisibility[column.key] !== false)
);

const visibleVehicleListDetailColumns = computed(() =>
  vehicleListDetailColumns.filter((column) => vehicleListDetailColumnVisibility[column.key] !== false)
);

const visibleDriverListDetailColumns = computed(() =>
  driverListDetailColumns.filter((column) => driverListDetailColumnVisibility[column.key] !== false)
);

const orderTotals = computed(() => {
  const hkd = orderFees.value
    .filter((fee) => fee.currency === "港币")
    .reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
  const rmb = orderFees.value
    .filter((fee) => fee.currency === "人民币")
    .reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
  return { hkd, rmb };
});

function createBlankFeeRow() {
  return {
    feeItemId: "",
    category: "正常",
    name: "",
    quantity: "",
    unitPrice: "",
    currency: "",
    amount: "",
    remark: ""
  };
}

function normalizeFeeAmount(fee) {
  const candidates = [
    fee?.amount,
    fee?.defaultAmount,
    fee?.amountValue,
    fee?.amount_hkd,
    fee?.amount_rmb,
    fee?.hkdAmount,
    fee?.rmbAmount
  ];
  const value = candidates.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  if (value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : "";
}

function isFreightFeeRow(fee) {
  return !fee.name || fee.name.includes("运费") || fee.autoFreight;
}

function shouldKeepManualFreightAmount(fee, existingAmount, templateAmount) {
  if (!isFreightFeeRow(fee) || !existingAmount) return false;
  if (fee._manualFreightAmount || fee.id) return true;
  if (!fee.autoFreight) return true;
  return templateAmount > 0 && Number(existingAmount) !== templateAmount;
}

function markFeeAmountManual(fee) {
  if (isFreightFeeRow(fee)) {
    fee._manualFreightAmount = true;
  }
}

function normalizeFeeUnitPrice(fee = {}) {
  const value = fee.unitPrice ?? fee.unit_price ?? fee.price ?? fee.defaultAmount ?? "";
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : "";
}

function calculateFeeAmountFromUnitPrice(fee = {}) {
  const quantity = Number(fee.quantity || 0);
  const unitPrice = Number(fee.unitPrice || 0);
  if (!quantity || !unitPrice) return "";
  return Number((quantity * unitPrice).toFixed(2));
}

function syncFeeAmountFromUnitPrice(fee) {
  const amount = calculateFeeAmountFromUnitPrice(fee);
  if (amount === "") return;
  fee.amount = amount;
  if (isFreightFeeRow(fee)) fee._manualFreightAmount = true;
}

function normalizeLocationText(value) {
  return String(value || "")
    .replace(/[市区县镇街道\s/｜|,，-]/g, "")
    .toLowerCase();
}

function normalizeFreightLabel(value) {
  return String(value || "")
    .trim()
    .replace(/[／｜|]+/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .replace(/^[-/]+|[-/]+$/g, "");
}

function freightRateCustomerId(item = {}) {
  return String(item.customerId ?? item.customer_id ?? "").trim();
}

function freightRateCustomerName(item = {}) {
  return String(item.customerName ?? item.customer_name ?? "").trim();
}

function isPublicFreightRate(item = {}) {
  return !freightRateCustomerId(item) && !freightRateCustomerName(item);
}

function freightRateBelongsToCustomer(item = {}, customer = {}) {
  const rateCustomerId = freightRateCustomerId(item);
  const rateCustomerName = freightRateCustomerName(item);
  const customerId = String(customer.id || "").trim();
  const customerName = String(customer.name || "").trim();
  if (!rateCustomerId && !rateCustomerName) return false;
  if (customerId && rateCustomerId) return rateCustomerId === customerId;
  if (customerName && rateCustomerName) return rateCustomerName === customerName;
  return false;
}

function normalizeFreightRateEntry(item) {
  const level1 = normalizeFreightLabel(item.level1 || item.city || "");
  const level2 = normalizeFreightLabel(item.level2 || "");
  const level3 = normalizeFreightLabel(item.level3 || "");
  return {
    ...item,
    customerId: freightRateCustomerId(item),
    customerName: freightRateCustomerName(item),
    direction: SHARED_DIRECTION,
    level1,
    level2,
    level3,
    city: normalizeFreightLabel(item.city || level3 || level2 || level1)
  };
}

function locationMatchesCity(locationText, city) {
  const location = normalizeLocationText(locationText);
  const target = normalizeLocationText(city);
  if (!location || !target) return false;
  return location.includes(target) || target.includes(location);
}

function splitLocationTokens(value) {
  return String(value || "")
    .split(/[\/／|｜,，>＞\-\s]+/)
    .map((item) => normalizeLocationText(item))
    .filter(Boolean);
}

function locationPartMatches(part, location, tokens) {
  if (!part || !location) return false;
  return (
    location.includes(part) ||
    part.includes(location) ||
    tokens.some((token) => token && (token.includes(part) || part.includes(token)))
  );
}

function freightRateLocationScore(item, locationText) {
  const normalizedItem = normalizeFreightRateEntry(item);
  const location = normalizeLocationText(locationText);
  const locationTokens = splitLocationTokens(locationText);
  const pathParts = [normalizedItem.level1, normalizedItem.level2, normalizedItem.level3]
    .map((value) => normalizeLocationText(value))
    .filter(Boolean);
  const matchedParts = pathParts.filter((part) => locationPartMatches(part, location, locationTokens));
  if (matchedParts.length) {
    let score = 0;
    pathParts.forEach((part, index) => {
      if (locationPartMatches(part, location, locationTokens)) {
        score += (index + 1) * 35 + part.length;
      }
    });
    if (matchedParts.length === pathParts.length) score += 120 + pathParts.length * 10;
    if (matchedParts.length >= 2) score += 60;
    return score;
  }
  const fields = [
    { value: normalizedItem.level3, weight: 40 },
    { value: normalizedItem.level2, weight: 30 },
    { value: normalizedItem.level1, weight: 20 },
    { value: normalizedItem.city, weight: 10 }
  ];
  return fields.reduce((best, field) => {
    if (!field.value || !locationMatchesCity(locationText, field.value)) return best;
    return Math.max(best, field.weight + normalizeLocationText(field.value).length);
  }, 0);
}

function currentOrderFreightCustomer() {
  return {
    id: String(orderForm.customerId || "").trim(),
    name: String(orderForm.customer || "").trim()
  };
}

function rankFreightRateRows(rows, pricedLocation, priceField, quotePriority = 0) {
  return rows
    .filter((item) => item.tonnage === orderForm.tonnage)
    .map((item) => ({
      item,
      quotePriority,
      score: freightRateLocationScore(item, pricedLocation),
      amount: Number(item?.[priceField] || 0)
    }))
    .filter((entry) => entry.score > 0);
}

function rankedRouteFreightRates() {
  const pricedLocation = orderForm.direction === "进口" ? orderForm.unloading : orderForm.loading;
  if (!orderForm.direction || !orderForm.tonnage || !orderForm.currency || !pricedLocation) {
    return [];
  }
  const priceField = orderForm.currency === "人民币" ? "rmbAmount" : "hkdAmount";
  const customer = currentOrderFreightCustomer();
  const customerRowsForQuote = freightRateRows.value.filter((item) => freightRateBelongsToCustomer(item, customer));
  const publicRowsForQuote = freightRateRows.value.filter(isPublicFreightRate);
  return [
    ...rankFreightRateRows(customerRowsForQuote, pricedLocation, priceField, 1),
    ...rankFreightRateRows(publicRowsForQuote, pricedLocation, priceField, 0)
  ].sort((a, b) => {
    if (b.quotePriority !== a.quotePriority) return b.quotePriority - a.quotePriority;
    const pricedDiff = Number(b.amount > 0) - Number(a.amount > 0);
    if (pricedDiff) return pricedDiff;
    return b.score - a.score;
  });
}

function matchRouteFreightRate() {
  return rankedRouteFreightRates()[0]?.item || null;
}

function findRouteFreightTemplate() {
  const matched = matchRouteFreightRate();
  const priceField = orderForm.currency === "人民币" ? "rmbAmount" : "hkdAmount";
  const amount = Number(matched?.[priceField] || 0);
  if (!matched) return null;
  return {
    category: "正常",
    name: "中港运费",
    currency: orderForm.currency,
    defaultAmount: amount > 0 ? amount : ""
  };
}

const routeFreightPreview = computed(() => {
  const pricedLocation = orderForm.direction === "进口" ? orderForm.unloading : orderForm.loading;
  const missing = [
    ["进出口", orderForm.direction],
    ["吨位", orderForm.tonnage],
    ["币种", currencyCodeDisplay(orderForm.currency)],
    [orderForm.direction === "进口" ? "卸货地" : "装货地", pricedLocation]
  ].filter(([, value]) => !value).map(([label]) => label);
  if (missing.length) {
    return { state: "pending", text: `运费模板：待填写 ${missing.join("、")}` };
  }

  const matched = matchRouteFreightRate();
  if (!matched) {
    return { state: "empty", text: `运费模板：未匹配到 ${orderForm.direction}/${pricedLocation}/${orderForm.tonnage}` };
  }

  const priceField = orderForm.currency === "人民币" ? "rmbAmount" : "hkdAmount";
  const amount = Number(matched[priceField] || 0);
  const routePath = [matched.level1, matched.level2, matched.level3].filter(Boolean).join(" / ") || matched.city || pricedLocation;
  if (amount <= 0) {
    return { state: "empty", text: `运费模板：${routePath} 有模板，但无${currencyCodeDisplay(orderForm.currency)}价格，金额留空` };
  }
  return { state: "matched", text: `运费模板：${routePath} / ${orderForm.tonnage} / ${currencyCodeDisplay(orderForm.currency)} ${amount}` };
});

function findFreightFeeTemplate() {
  const routeTemplate = findRouteFreightTemplate();
  if (routeTemplate) return routeTemplate;
  return null;
}

function findAutoFreightFeeIndex() {
  const index = orderFees.value.findIndex((fee) => fee.autoFreight || isFreightFeeRow(fee));
  return index >= 0 ? index : 0;
}

function syncAutoFreightFee() {
  if (!orderFees.value.length) {
    orderFees.value = [createBlankFeeRow()];
  }

  const template = findFreightFeeTemplate();
  if (!template) {
    const existingAutoFee = orderFees.value.find((fee) => fee.autoFreight);
    if (existingAutoFee && !normalizeFeeAmount(existingAutoFee)) {
      Object.assign(existingAutoFee, createBlankFeeRow());
    }
    return;
  }

  const pricedLocation = orderForm.direction === "进口" ? orderForm.unloading : orderForm.loading;
  const targetIndex = findAutoFreightFeeIndex();
  let targetFee = orderFees.value[targetIndex];
  if (!targetFee || !isFreightFeeRow(targetFee)) {
    targetFee = createBlankFeeRow();
    orderFees.value.splice(0, 0, targetFee);
  }
  if (!targetFee || !isFreightFeeRow(targetFee)) return;

  const existingAmount = normalizeFeeAmount(targetFee);
  const templateAmount = Number(template.defaultAmount || 0);
  const previousAutoAmount = Number(targetFee._autoFreightAmount || 0);
  const keepManualAmount = shouldKeepManualFreightAmount(targetFee, existingAmount, templateAmount);
  const canRefreshAutoAmount = targetFee.autoFreight && !keepManualAmount && (!existingAmount || Number(existingAmount) === previousAutoAmount);
  const amount = keepManualAmount
    ? existingAmount
    : canRefreshAutoAmount || !existingAmount
    ? (templateAmount > 0 ? templateAmount : "")
    : existingAmount;
  Object.assign(targetFee, {
    feeItemId: feeItemRows.value.find((item) => item.name === template.name)?.id || "",
    category: template.category || "正常",
    name: template.name,
    quantity: targetFee.quantity || "",
    unitPrice: targetFee.unitPrice || "",
    currency: template.currency,
    amount,
    remark: targetFee.remark || "",
    autoFreight: true,
    _autoFreightAmount: keepManualAmount ? (previousAutoAmount || templateAmount || "") : amount,
    _manualFreightAmount: keepManualAmount
  });
}

async function ensureReferenceDataLoaded() {
  if (customerRows.value.length && feeItemRows.value.length && freightRateRows.value.length) return;
  await loadDatabaseData({ preserveSelection: true });
}

function scheduleAutoFreightSync() {
  if (!orderModalOpen.value) return;
  nextTick(() => {
    syncAutoFreightFee();
  });
  window.setTimeout(() => {
    if (orderModalOpen.value) syncAutoFreightFee();
  }, 80);
}

function splitWorkspaceStyle(scope) {
  const value = scope === "vehicle" ? vehicleSplitPercent.value : customerSplitPercent.value;
  return { "--top-pane-height": `${value}%` };
}

function startSplitResize(scope, event) {
  const container = event.currentTarget?.closest?.(".split-workspace");
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const storageKey = scope === "vehicle" ? "hanye_vehicle_split_percent" : "hanye_customer_split_percent";
  const assign = (percent) => {
    const nextValue = Math.min(78, Math.max(24, percent));
    if (scope === "vehicle") vehicleSplitPercent.value = nextValue;
    else customerSplitPercent.value = nextValue;
    localStorage.setItem(storageKey, String(Math.round(nextValue)));
  };
  const clientYFromEvent = (moveEvent) => moveEvent.touches?.[0]?.clientY ?? moveEvent.clientY;
  const onMove = (moveEvent) => {
    moveEvent.preventDefault?.();
    assign(((clientYFromEvent(moveEvent) - rect.top) / rect.height) * 100);
  };
  const stop = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", stop);
    window.removeEventListener("touchmove", onMove);
    window.removeEventListener("touchend", stop);
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", stop);
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("touchend", stop);
}

const selectedFeeItem = computed(() =>
  feeItemRows.value.find((item) => item.id === selectedFeeItemId.value) || null
);

function feeItemSortValue(item, index = 0) {
  const sortOrder = Number(item?.sortOrder ?? item?.sort_order);
  return Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : 100000 + index;
}

function sortFeeItems(items) {
  return [...(items || [])].sort((a, b) =>
    feeItemSortValue(a) - feeItemSortValue(b)
    || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN")
    || Number(a.id || 0) - Number(b.id || 0)
  );
}

function normalizeFeeItemCostSources(value = ["供应商"]) {
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
    .map((source) => String(source || "").trim())
    .filter((source, index, list) => FEE_ITEM_COST_SOURCE_OPTIONS.includes(source) && list.indexOf(source) === index);
  return sources.length ? sources : ["供应商"];
}

function ensureFeeItemCostSources(target) {
  target.costSources = normalizeFeeItemCostSources(target.costSources);
}

function feeItemCostSourceText(item = {}) {
  return normalizeFeeItemCostSources(item.costSources || item.costSource || item.cost_source).join("、");
}

const sortedFeeItemRows = computed(() => sortFeeItems(feeItemRows.value));
const advanceFeeItemRows = computed(() =>
  sortedFeeItemRows.value.filter((item) => item.category === "代垫")
);

function feeItemIncludesCostSource(item = {}, source = "") {
  return normalizeFeeItemCostSources(item.costSources || item.costSource || item.cost_source).includes(source);
}

function costCenterFeeItemsForSource(source = activeCostCenterSource.value) {
  return sortedFeeItemRows.value.filter((item) => feeItemIncludesCostSource(item, source));
}

const activeCostCenterFeeItems = computed(() => costCenterFeeItemsForSource(activeCostCenterSource.value));
const costCenterRuleFeeItems = computed(() => costCenterFeeItemsForSource(costCenterRuleForm.source));

function costCenterFeeItemLabel(item = {}) {
  const currency = currencyCodeDisplay(item.currency || "港币") || "HKD";
  return `${item.name || "收费项目"} ${currency}`;
}

function driverCostStorageFieldForFeeItem(item = {}) {
  const name = String(item.name || "").trim();
  if (!name) return "";
  if (item.category !== "代垫" && /基础|运费|趟费/.test(name)) {
    return item.currency === "人民币" ? "baseRMB" : "baseHKD";
  }
  if (item.category !== "代垫") return driverExtraFieldForFeeName(name);
  return "";
}

function driverCostRateValue(rule = {}, item = {}) {
  const field = driverCostStorageFieldForFeeItem(item);
  if (field) return Number(rule?.[field] || 0);
  return advanceFeeRateValue(rule?.advanceFeeRates, item);
}

function setDriverCostRate(target = {}, item = {}, value = 0) {
  const field = driverCostStorageFieldForFeeItem(item);
  if (field) {
    target[field] = Number(value || 0);
    return;
  }
  target.advanceFeeRates ||= {};
  setAdvanceFeeRate(target.advanceFeeRates, item, value);
}

function normalizeCostCenterValues(value = {}) {
  return Object.fromEntries(
    Object.entries(value || {})
      .map(([key, amount]) => [String(key), Number(amount || 0)])
      .filter(([key]) => key)
  );
}

function costCenterFeeValueKey(item = {}) {
  return String(item.id || item.name || "");
}

const costCenterRouteGroups = computed(() =>
  freightRateGroups.value.filter((group) => group.level1)
);

const costCenterRouteLevel1Options = computed(() =>
  uniqueSorted(costCenterRouteGroups.value.map((group) => group.level1))
);

function splitCostCenterRouteValue(value = "") {
  const [level1 = ""] = String(value || "")
    .split(/[\/／]/)
    .map((item) => normalizeFreightLabel(item))
    .filter(Boolean);
  return { level1, level2: "" };
}

function costCenterRouteValue(kind = "origin") {
  const level1 = kind === "destination"
    ? costCenterRuleForm.destinationLevel1
    : costCenterRuleForm.originLevel1;
  return formatFreightLocationOption([level1]);
}

function syncCostCenterRouteValue(kind = "origin") {
  const value = costCenterRouteValue(kind);
  if (kind === "destination") {
    costCenterRuleForm.destination = value;
  } else {
    costCenterRuleForm.origin = value;
  }
}

function handleCostCenterRouteLevel1Change(kind = "origin") {
  if (kind === "destination") {
    costCenterRuleForm.destinationLevel2 = "";
  } else {
    costCenterRuleForm.originLevel2 = "";
  }
  syncCostCenterRouteValue(kind);
}

function closeCostCenterRoutePicker() {
  costCenterRoutePicker.open = false;
  costCenterRoutePicker.kind = "";
}

function isCostCenterRoutePickerOpen(kind = "origin") {
  return costCenterRoutePicker.open && costCenterRoutePicker.kind === kind;
}

function toggleCostCenterRoutePicker(kind = "origin") {
  if (isCostCenterRoutePickerOpen(kind)) {
    closeCostCenterRoutePicker();
    return;
  }
  costCenterRoutePicker.open = true;
  costCenterRoutePicker.kind = kind;
}

function costCenterRouteLevel1Value(kind = "origin") {
  return kind === "destination" ? costCenterRuleForm.destinationLevel1 : costCenterRuleForm.originLevel1;
}

function setCostCenterRouteSelection(kind = "origin", level1 = "") {
  if (kind === "destination") {
    costCenterRuleForm.destinationLevel1 = level1;
    costCenterRuleForm.destinationLevel2 = "";
  } else {
    costCenterRuleForm.originLevel1 = level1;
    costCenterRuleForm.originLevel2 = "";
  }
  syncCostCenterRouteValue(kind);
}

function selectCostCenterRouteLevel1(kind = "origin", level1 = "") {
  setCostCenterRouteSelection(kind, level1);
  closeCostCenterRoutePicker();
}

function hasCostCenterRuleRoute(row = {}) {
  return Boolean(String(row.origin || "").trim() || String(row.destination || "").trim());
}

const activeCostCenterRuleRows = computed(() =>
  costCenterRateRows.value
    .filter((item) => item.source === activeCostCenterSource.value && hasCostCenterRuleRoute(item))
    .sort((a, b) =>
      String(a.origin || "").localeCompare(String(b.origin || ""), "zh-Hans-CN")
      || String(a.destination || "").localeCompare(String(b.destination || ""), "zh-Hans-CN")
      || Number(a.id || 0) - Number(b.id || 0)
    )
);

const costCenterSupplierOptions = computed(() =>
  customerRows.value
    .filter((item) => item.type === "供应商")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"))
);

const costCenterDriverOptions = computed(() =>
  driverRows.value
    .filter((item) => item.name)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"))
);

function costCenterEntityLabelForSource(source = activeCostCenterSource.value) {
  if (source === "供应商") return "供应商";
  if (source === "司机") return "司机";
  if (source === "其他平台") return "平台名称";
  if (source === "公司自费") return "费用名称";
  return "成本对象";
}

const activeCostCenterEntityLabel = computed(() => costCenterEntityLabelForSource(activeCostCenterSource.value));
const costCenterRuleEntityLabel = computed(() => costCenterEntityLabelForSource(costCenterRuleForm.source));

function costCenterEntityOptionsForSource(source = costCenterRuleForm.source) {
  if (source === "供应商") return costCenterSupplierOptions.value;
  if (source === "司机") return costCenterDriverOptions.value;
  return [];
}

function costCenterEntityOptionId(item = {}) {
  return String(item.id ?? item.no ?? item.name ?? "").trim();
}

function costCenterEntityOptionName(item = {}) {
  return String(item.name || item.displayName || "").trim();
}

function findCostCenterEntityRefId(source = "", entityName = "") {
  const name = String(entityName || "").trim();
  if (!name) return "";
  const option = costCenterEntityOptionsForSource(source)
    .find((item) => costCenterEntityOptionName(item) === name);
  return option ? costCenterEntityOptionId(option) : "";
}

function syncCostCenterRuleEntityName() {
  const source = costCenterRuleForm.source;
  if (!["供应商", "司机"].includes(source)) return;
  const option = costCenterEntityOptionsForSource(source)
    .find((item) => costCenterEntityOptionId(item) === String(costCenterRuleForm.entityRefId || ""));
  costCenterRuleForm.entityName = option ? costCenterEntityOptionName(option) : "";
}

function costCenterRuleEntityDisplay(row = {}) {
  const name = String(row.entityName || "").trim();
  const routeName = [row.origin, row.destination].filter(Boolean).join(" - ");
  if (!name || name === row.source || name === routeName) return "-";
  return name;
}

function setActiveCostCenterSource(source) {
  if (!FEE_ITEM_COST_SOURCE_OPTIONS.includes(source)) return;
  activeCostCenterSource.value = source;
}

function costCenterRuleEntityName(rule = costCenterRuleForm) {
  return String(rule.entityName || "").trim()
    || [rule.origin, rule.destination].map((item) => String(item || "").trim()).filter(Boolean).join(" - ")
    || rule.source
    || activeCostCenterSource.value;
}

function createCostCenterRuleValues(source = activeCostCenterSource.value, savedValues = {}) {
  const values = {};
  costCenterFeeItemsForSource(source).forEach((item) => {
    values[costCenterFeeValueKey(item)] = Number(savedValues?.[costCenterFeeValueKey(item)] || 0);
  });
  return values;
}

function resetCostCenterRuleForm(item = null) {
  const source = item?.source || activeCostCenterSource.value;
  const costValues = createCostCenterRuleValues(source, normalizeCostCenterValues(item?.costValues));
  const originParts = splitCostCenterRouteValue(item?.origin || "");
  const destinationParts = splitCostCenterRouteValue(item?.destination || "");
  Object.assign(costCenterRuleForm, {
    id: item?.id || null,
    source,
    entityId: item?.entityId || "",
    entityRefId: findCostCenterEntityRefId(source, item?.entityName || ""),
    entityName: item?.entityName || "",
    origin: item?.origin || "",
    originLevel1: originParts.level1,
    originLevel2: originParts.level2,
    destination: item?.destination || "",
    destinationLevel1: destinationParts.level1,
    destinationLevel2: destinationParts.level2,
    costValues,
    note: item?.note || ""
  });
}

function openCostCenterRuleModal(item = null) {
  resetCostCenterRuleForm(item);
  closeCostCenterRoutePicker();
  costCenterRuleModalOpen.value = true;
}

function closeCostCenterRuleModal() {
  if (costCenterRuleSaving.value) return;
  closeCostCenterRoutePicker();
  costCenterRuleModalOpen.value = false;
}

function costCenterRuleValue(item = {}) {
  return Number(costCenterRuleForm.costValues?.[costCenterFeeValueKey(item)] || 0);
}

function setCostCenterRuleValue(item = {}, value = 0) {
  costCenterRuleForm.costValues[costCenterFeeValueKey(item)] = Number(value || 0);
}

function costCenterRuleRowValue(row = {}, item = {}) {
  return Number(normalizeCostCenterValues(row.costValues)?.[costCenterFeeValueKey(item)] || 0);
}

function createCostCenterRuleEntityId() {
  return `cost-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function saveCostCenterRule() {
  if (["供应商", "司机"].includes(costCenterRuleForm.source)) {
    syncCostCenterRuleEntityName();
  }
  syncCostCenterRouteValue("origin");
  syncCostCenterRouteValue("destination");
  const origin = String(costCenterRuleForm.origin || "").trim();
  const destination = String(costCenterRuleForm.destination || "").trim();
  const entityName = String(costCenterRuleForm.entityName || "").trim();
  if (["供应商", "司机"].includes(costCenterRuleForm.source) && !costCenterRuleForm.entityRefId) {
    notify(`请选择${costCenterRuleEntityLabel.value}`);
    return;
  }
  if (!entityName) {
    notify(`请先填写${costCenterRuleEntityLabel.value}`);
    return;
  }
  if (costCenterRouteLevel1Options.value.length === 0) {
    notify("请先在运费模板报价中维护一级目录");
    return;
  }
  if (!costCenterRuleForm.originLevel1 || !costCenterRuleForm.destinationLevel1) {
    notify("请选择装货地和卸货地的一级目录");
    return;
  }
  if (
    !costCenterRouteLevel1Options.value.includes(costCenterRuleForm.originLevel1)
    || !costCenterRouteLevel1Options.value.includes(costCenterRuleForm.destinationLevel1)
  ) {
    notify("装货地和卸货地需从运费模板报价目录中选择");
    return;
  }
  if (!origin || !destination) {
    notify("请选择装货地和卸货地");
    return;
  }
  const payload = {
    id: costCenterRuleForm.id || undefined,
    source: costCenterRuleForm.source || activeCostCenterSource.value,
    entityId: costCenterRuleForm.entityId || createCostCenterRuleEntityId(),
    entityName,
    origin,
    destination,
    costValues: normalizeCostCenterValues(costCenterRuleForm.costValues),
    note: costCenterRuleForm.note
  };
  try {
    costCenterRuleSaving.value = true;
    const item = await financeApi.saveCostCenterRate(payload);
    costCenterRateRows.value = costCenterRateRows.value.some((row) => row.id === item.id)
      ? costCenterRateRows.value.map((row) => row.id === item.id ? item : row)
      : [...costCenterRateRows.value, item];
    costCenterRuleModalOpen.value = false;
    notify(costCenterRuleForm.id ? "成本规则已更新" : "成本规则已增加");
  } catch (error) {
    notify(error.message);
  } finally {
    costCenterRuleSaving.value = false;
  }
}

async function deleteCostCenterRule(item) {
  if (!item?.id) return;
  if (!window.confirm(`确定删除 ${item.source}/${item.origin || "-"}-${item.destination || "-"} 的成本规则？`)) return;
  try {
    await financeApi.deleteCostCenterRate(item.id);
    costCenterRateRows.value = costCenterRateRows.value.filter((row) => row.id !== item.id);
    notify("成本规则已删除");
  } catch (error) {
    notify(error.message);
  }
}

function advanceFeeRateKey(item = {}) {
  return String(item.id || item.name || "");
}

function advanceFeeRateLabel(item = {}) {
  const currency = currencyCodeDisplay(item.currency || "港币") || "HKD";
  return `${item.name || "代垫项目"} ${currency}`;
}

function advanceFeeRateValue(rates = {}, item = {}) {
  return Number(rates?.[advanceFeeRateKey(item)] || 0);
}

function setAdvanceFeeRate(rates = {}, item = {}, value = 0) {
  rates[advanceFeeRateKey(item)] = Number(value || 0);
}

const selectedFreightRate = computed(() =>
  activeFreightRateRows.value.find((item) => item.id === selectedFreightRateId.value) || activeFreightRateRows.value[0]
);

function freightRateGroupKey(item) {
  const normalized = normalizeFreightRateEntry(item);
  return [
    normalized.customerId || "",
    normalized.direction || "",
    normalized.level1 || normalized.city || "",
    normalized.level2 || "",
    normalized.level3 || ""
  ].join("||");
}

function groupFreightRateRows(rows = []) {
  const groups = new Map();
  rows.forEach((item) => {
    const normalized = normalizeFreightRateEntry(item);
    const { level1, level2, level3 } = normalized;
    const key = freightRateGroupKey(normalized);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        customerId: normalized.customerId || "",
        customerName: normalized.customerName || "",
        direction: normalized.direction || "",
        level1,
        level2,
        level3,
        city: level3 || level2 || level1 || normalized.city || "",
        rates: {}
      });
    }
    groups.get(key).rates[normalized.tonnage] = normalized;
  });
  return [...groups.values()].sort((a, b) =>
    `${a.customerId}${a.direction}${a.level1}${a.level2}${a.level3}`.localeCompare(`${b.customerId}${b.direction}${b.level1}${b.level2}${b.level3}`, "zh-Hans-CN")
  );
}

const publicFreightRateRows = computed(() => freightRateRows.value.filter(isPublicFreightRate));

const freightCustomerRows = computed(() =>
  customerRows.value
    .filter((item) => item.type === "客户")
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN"))
);

const selectedFreightCustomer = computed(() =>
  freightCustomerRows.value.find((item) => item.id === selectedFreightCustomerId.value) || null
);

function currentFreightQuoteScope() {
  if (activeFreightQuoteType.value !== CUSTOMER_FREIGHT_QUOTE_TYPE) {
    return { customerId: "", customerName: "" };
  }
  const customer = selectedFreightCustomer.value;
  return {
    customerId: String(customer?.id || selectedFreightCustomerId.value || "").trim(),
    customerName: String(customer?.name || "").trim()
  };
}

function freightRateCountForCustomer(customer) {
  return freightRateRows.value.filter((item) => freightRateBelongsToCustomer(item, customer)).length;
}

const customerFreightRateRows = computed(() =>
  freightRateRows.value.filter((item) => freightRateCustomerId(item) || freightRateCustomerName(item))
);

const activeFreightRateRows = computed(() => {
  if (activeFreightQuoteType.value !== CUSTOMER_FREIGHT_QUOTE_TYPE) return publicFreightRateRows.value;
  const customer = selectedFreightCustomer.value;
  if (!customer) return [];
  return freightRateRows.value.filter((item) => freightRateBelongsToCustomer(item, customer));
});

const freightRateGroups = computed(() => groupFreightRateRows(publicFreightRateRows.value));
const activeFreightRateGroups = computed(() => groupFreightRateRows(activeFreightRateRows.value));
const freightGroupsByKey = computed(() => new Map(activeFreightRateGroups.value.map((group) => [group.key, group])));

const freightDirectoryMeta = computed(() =>
  FREIGHT_DIRECTORY_LEVELS.find((item) => item.value === freightDirectoryLevel.value) || FREIGHT_DIRECTORY_LEVELS[0]
);
const freightFixedEndpointText = computed(() =>
  activeFreightQuoteType.value === CUSTOMER_FREIGHT_QUOTE_TYPE
    ? `${selectedFreightCustomer.value?.name || "客户"}专属报价，未录入时为空`
    : "进出口共用报价，目录维护香港以外的常用片区"
);

const freightDirectionGroups = computed(() =>
  activeFreightRateGroups.value
);

const freightLevel1Options = computed(() => {
  const values = new Set();
  freightDirectionGroups.value.forEach((group) => {
    if (group.level1) values.add(group.level1);
  });
  return [...values].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
});

const freightLevel2Options = computed(() => {
  const values = new Set();
  freightDirectionGroups.value.forEach((group) => {
    if (group.level1 === freightParentLevel1.value && group.level2) values.add(group.level2);
  });
  return [...values].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
});

function uniqueSorted(values) {
  return [...new Set(values.map(normalizeFreightLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function buildFreightDirectoryGroup(level1, level2 = "", level3 = "") {
  const scope = currentFreightQuoteScope();
  const normalizedLevel1 = normalizeFreightLabel(level1);
  const normalizedLevel2 = normalizeFreightLabel(level2);
  const normalizedLevel3 = normalizeFreightLabel(level3);
  const key = freightRateGroupKey({
    customerId: scope.customerId,
    customerName: scope.customerName,
    direction: SHARED_DIRECTION,
    level1: normalizedLevel1,
    level2: normalizedLevel2,
    level3: normalizedLevel3
  });
  const existing = freightGroupsByKey.value.get(key);
  return existing || {
    key,
    customerId: scope.customerId,
    customerName: scope.customerName,
    direction: SHARED_DIRECTION,
    level1: normalizedLevel1,
    level2: normalizedLevel2,
    level3: normalizedLevel3,
    city: normalizedLevel3 || normalizedLevel2 || normalizedLevel1,
    rates: {},
    synthetic: true
  };
}

const visibleFreightRateGroups = computed(() => {
  const groups = freightDirectionGroups.value;
  if (freightDirectoryLevel.value === "level1") {
    return uniqueSorted(groups.map((group) => group.level1)).map((level1) => buildFreightDirectoryGroup(level1));
  }
  if (freightDirectoryLevel.value === "level2") {
    if (!freightParentLevel1.value) return [];
    return uniqueSorted(
      groups
        .filter((group) => group.level1 === freightParentLevel1.value)
        .map((group) => group.level2)
    ).map((level2) => buildFreightDirectoryGroup(freightParentLevel1.value, level2));
  }
  if (!freightParentLevel1.value || !freightParentLevel2.value) return [];
  return uniqueSorted(
    groups
      .filter((group) => group.level1 === freightParentLevel1.value && group.level2 === freightParentLevel2.value)
      .map((group) => group.level3)
  ).map((level3) => buildFreightDirectoryGroup(freightParentLevel1.value, freightParentLevel2.value, level3));
});

const visibleFreightRateDisplayGroups = computed(() => {
  return visibleFreightRateGroups.value.map((group) => {
    return {
      ...group,
      primaryLabel: freightGroupPrimaryLabel(group),
      secondaryLabel: freightGroupSecondaryLabel(group)
    };
  });
});

const visibleFreightStats = computed(() => ({
  groups: visibleFreightRateDisplayGroups.value.length,
  prices: visibleFreightRateDisplayGroups.value.reduce((sum, group) => sum + Object.keys(group.rates || {}).length, 0),
  label: freightDirectoryMeta.value.primary
}));

const freightQuoteTemplateRows = computed(() => [
  {
    key: CUSTOMER_FREIGHT_QUOTE_TYPE,
    title: "客户运费报价模板",
    description: "按客户维护独立报价，初始为空",
    countLabel: `${freightCustomerRows.value.length} 个客户`,
    priceLabel: `${customerFreightRateRows.value.length} 条客户报价`,
    icon: "users"
  },
  {
    key: PUBLIC_FREIGHT_QUOTE_TYPE,
    title: "公共运费报价模板",
    description: "系统默认报价，沿用当前公共数据",
    countLabel: `${freightRateGroups.value.length} 个目录`,
    priceLabel: `${publicFreightRateRows.value.length} 条公共报价`,
    icon: "file"
  }
]);

const activeFreightQuoteTitle = computed(() =>
  activeFreightQuoteType.value === CUSTOMER_FREIGHT_QUOTE_TYPE
    ? `${selectedFreightCustomer.value?.name || "客户"} · 客户运费报价模板`
    : "公共运费报价模板"
);

function freightGroupPrimaryLabel(group) {
  if (freightDirectoryLevel.value === "level1") return group.level1 || "-";
  if (freightDirectoryLevel.value === "level2") return group.level2 || "-";
  return group.level3 || group.level2 || "-";
}

function freightGroupSecondaryLabel(group) {
  if (freightDirectoryLevel.value === "level1") {
    const childCount = uniqueSorted(
      freightDirectionGroups.value
        .filter((item) => item.level1 === group.level1)
        .map((item) => item.level2)
    ).length;
    const priceCount = freightDirectionGroups.value
      .filter((item) => item.level1 === group.level1)
      .reduce((sum, item) => sum + Object.keys(item.rates || {}).length, 0);
    return `${childCount ? `${childCount} 个二级目录` : "暂无二级目录"} · ${priceCount} 条价格`;
  }
  if (freightDirectoryLevel.value === "level2") {
    const childCount = uniqueSorted(
      freightDirectionGroups.value
        .filter((item) => item.level1 === group.level1 && item.level2 === group.level2)
        .map((item) => item.level3)
    ).length;
    const priceCount = freightDirectionGroups.value
      .filter((item) => item.level1 === group.level1 && item.level2 === group.level2)
      .reduce((sum, item) => sum + Object.keys(item.rates || {}).length, 0);
    return `${group.level1 || "-"} · ${childCount ? `${childCount} 个三级目录` : "暂无三级目录"} · ${priceCount} 条价格`;
  }
  return [group.level1, group.level2].filter(Boolean).join(" / ") || "-";
}

function freightGroupChildCount(group) {
  if (freightDirectoryLevel.value === "level1") {
    return uniqueSorted(
      freightDirectionGroups.value
        .filter((item) => item.level1 === group.level1)
        .map((item) => item.level2)
    ).length;
  }
  if (freightDirectoryLevel.value === "level2") {
    return uniqueSorted(
      freightDirectionGroups.value
        .filter((item) => item.level1 === group.level1 && item.level2 === group.level2)
        .map((item) => item.level3)
    ).length;
  }
  return 0;
}

function canEnterFreightGroup(group) {
  return freightDirectoryLevel.value !== "level3" && freightGroupChildCount(group) > 0;
}

function resetFreightDirectoryState() {
  freightDirectionFilter.value = SHARED_DIRECTION;
  freightDirectoryLevel.value = "level1";
  freightParentLevel1.value = "";
  freightParentLevel2.value = "";
  cancelFreightDirectoryCreate();
  cancelFreightGroupRowEdit();
  clearFreightGroupSelection();
  selectedFreightRateId.value = null;
}

function openFreightQuoteRoot() {
  freightPanelTab.value = FREIGHT_QUOTE_TAB;
  freightQuoteView.value = FREIGHT_QUOTE_ROOT_VIEW;
  activeFreightQuoteType.value = PUBLIC_FREIGHT_QUOTE_TYPE;
  selectedFreightCustomerId.value = "";
  resetFreightDirectoryState();
}

function openPublicFreightQuoteTemplate() {
  freightPanelTab.value = FREIGHT_QUOTE_TAB;
  freightQuoteView.value = FREIGHT_QUOTE_MATRIX_VIEW;
  activeFreightQuoteType.value = PUBLIC_FREIGHT_QUOTE_TYPE;
  selectedFreightCustomerId.value = "";
  resetFreightDirectoryState();
  editFreightRate(publicFreightRateRows.value[0] || null, { silent: true });
}

function openCustomerFreightQuoteList() {
  freightPanelTab.value = FREIGHT_QUOTE_TAB;
  freightQuoteView.value = FREIGHT_QUOTE_CUSTOMERS_VIEW;
  activeFreightQuoteType.value = CUSTOMER_FREIGHT_QUOTE_TYPE;
  selectedFreightCustomerId.value = "";
  resetFreightDirectoryState();
}

function openCustomerFreightQuoteTemplate(customer) {
  if (!customer?.id) return;
  freightPanelTab.value = FREIGHT_QUOTE_TAB;
  freightQuoteView.value = FREIGHT_QUOTE_MATRIX_VIEW;
  activeFreightQuoteType.value = CUSTOMER_FREIGHT_QUOTE_TYPE;
  selectedFreightCustomerId.value = customer.id;
  resetFreightDirectoryState();
  editFreightRate(activeFreightRateRows.value[0] || null, { silent: true });
}

function openFreightQuoteTemplate(row) {
  if (row?.key === CUSTOMER_FREIGHT_QUOTE_TYPE) {
    openCustomerFreightQuoteList();
  } else {
    openPublicFreightQuoteTemplate();
  }
}

function setFreightDirectoryLevel(level) {
  const nextLevel = ["level1", "level2", "level3"].includes(level) ? level : "level1";
  if (nextLevel === "level2" && !freightParentLevel1.value) {
    freightParentLevel1.value = freightRateForm.level1 || freightLevel1Options.value[0] || "";
  }
  if (nextLevel === "level3") {
    if (!freightParentLevel1.value) {
      freightParentLevel1.value = freightRateForm.level1 || freightLevel1Options.value[0] || "";
    }
    if (!freightParentLevel2.value) {
      freightParentLevel2.value = freightRateForm.level2 || freightLevel2Options.value[0] || "";
    }
  }
  freightDirectoryLevel.value = nextLevel;
  cancelFreightDirectoryCreate();
  clearFreightGroupSelection();
}

function switchFreightDirection(direction) {
  openFreightQuoteRoot();
  Object.assign(freightRateForm, {
    customerId: "",
    customerName: "",
    direction: SHARED_DIRECTION,
    level1: "",
    level2: "",
    level3: "",
    city: ""
  });
}

function enterFreightGroup(group) {
  if (!canEnterFreightGroup(group)) {
    editFreightGroup(group, freightRateForm.tonnage || "3T");
    return;
  }
  if (freightDirectoryLevel.value === "level1") {
    freightParentLevel1.value = group.level1 || "";
    freightDirectoryLevel.value = "level2";
    Object.assign(freightRateForm, {
      direction: SHARED_DIRECTION,
      level1: group.level1 || "",
      level2: "",
      level3: "",
      city: ""
    });
  } else if (freightDirectoryLevel.value === "level2") {
    freightParentLevel1.value = group.level1 || freightParentLevel1.value || "";
    freightParentLevel2.value = group.level2 || "";
    freightDirectoryLevel.value = "level3";
    Object.assign(freightRateForm, {
      direction: SHARED_DIRECTION,
      level1: group.level1 || "",
      level2: group.level2 || "",
      level3: "",
      city: ""
    });
  }
  clearFreightGroupSelection();
}

function addressOptionKey(value) {
  return normalizeLocationText(value) || String(value || "").trim();
}

function formatFreightLocationOption(levels) {
  return levels.filter(Boolean).join(" / ");
}

const freightAddressOptions = computed(() => {
  const map = new Map();
  freightRateGroups.value.forEach((group) => {
    const levels = [group.level1, group.level2, group.level3].filter(Boolean);
    levels.forEach((_, index) => {
      const pathLevels = levels.slice(0, index + 1);
      const value = formatFreightLocationOption(pathLevels);
      if (!value) return;
      const key = `freight:${group.direction}:${addressOptionKey(value)}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          source: "运费模板",
          direction: group.direction || "-",
          level1: pathLevels[0] || "-",
          level2: pathLevels[1] || "-",
          level3: pathLevels[2] || "-",
          rank: pathLevels.length,
          pathLabel: value,
          value
        });
      }
    });
  });
  return [...map.values()];
});

const historicalAddressOptions = computed(() => {
  const map = new Map();
  const hidden = new Set(hiddenAddressHistoryRows.value.map((item) => item.key));
  orderRows.value.forEach((order) => {
    [
      { value: order.loading, kind: "装货地" },
      { value: order.unloading, kind: "卸货地" }
    ].forEach(({ value, kind }) => {
      const text = String(value || "").trim();
      if (!text) return;
      const addressKey = addressOptionKey(text);
      if (hidden.has(addressKey)) return;
      const key = `history:${addressKey}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          source: "历史地址",
          direction: kind,
          level1: "-",
          level2: "-",
          level3: "-",
          rank: 0,
          pathLabel: text,
          value: text
        });
      }
    });
  });
  return [...map.values()].slice(0, 100);
});

const savedAddressBookOptions = computed(() =>
  addressBookRows.value.map((item) => ({
    key: `book:${item.id}`,
    id: item.id,
    source: "地址本",
    direction: "-",
    level1: "-",
    level2: "-",
    level3: "-",
    rank: 0,
    area: item.area || "",
    contact: item.contact || "",
    phone: item.phone || "",
    note: item.note || "",
    pathLabel: item.address,
    value: [item.area, item.address].filter(Boolean).join(" / "),
    address: item.address || ""
  }))
);

function currentAddressBookCustomerId() {
  if (locationPicker.owner === "dispatch") {
    const matchedCustomer = customerRows.value.find(
      (item) => item.type === "客户" && (item.id === dispatchForm.customerId || item.name === String(dispatchForm.customer || "").trim())
    );
    return dispatchForm.customerId || matchedCustomer?.id || "";
  }
  return orderForm.customerId || selectedCustomer.value?.id || "";
}

const customerContactAddressOptions = computed(() => {
  const customerId = currentAddressBookCustomerId();
  if (!customerId) return [];
  return customerContactRows.value
    .filter((item) => item.customerId === customerId)
    .map((item) => {
      const area = contactAreaText(item);
      const address = contactAddressText(item);
      return {
        key: `contact:${item.id}`,
        id: item.id,
        source: "联系人",
        direction: "-",
        level1: "-",
        level2: "-",
        level3: "-",
        rank: 0,
        area,
        contact: item.name || "",
        phone: item.mobile || item.phone || "",
        note: item.remark || "",
        pathLabel: address,
        value: [area, address].filter(Boolean).join(" / "),
        address
      };
    })
    .filter((item) => item.area || item.address || item.contact || item.phone);
});

const addressBookAreaLevel1Options = computed(() =>
  uniqueSorted(templateLocationGroups.value.map((group) => group.level1))
);

const addressBookAreaLevel2Options = computed(() => {
  if (!addressBookAreaTree.level1) return [];
  return uniqueSorted(templateLocationGroups.value
    .filter((group) => group.level1 === addressBookAreaTree.level1)
    .map((group) => group.level2));
});

const addressBookAreaLevel3Options = computed(() => {
  if (!addressBookAreaTree.level1 || !addressBookAreaTree.level2) return [];
  return uniqueSorted(templateLocationGroups.value
    .filter((group) => group.level1 === addressBookAreaTree.level1 && group.level2 === addressBookAreaTree.level2)
    .map((group) => group.level3));
});

const addressBookAreaTreeValue = computed(() =>
  formatFreightLocationOption([addressBookAreaTree.level1, addressBookAreaTree.level2, addressBookAreaTree.level3])
);

const contactAreaLevel1Options = computed(() =>
  uniqueSorted(templateLocationGroups.value.map((group) => group.level1))
);

const contactAreaLevel2Options = computed(() => {
  if (!contactAreaTree.level1) return [];
  return uniqueSorted(templateLocationGroups.value
    .filter((group) => group.level1 === contactAreaTree.level1)
    .map((group) => group.level2));
});

const contactAreaLevel3Options = computed(() => {
  if (!contactAreaTree.level1 || !contactAreaTree.level2) return [];
  return uniqueSorted(templateLocationGroups.value
    .filter((group) => group.level1 === contactAreaTree.level1 && group.level2 === contactAreaTree.level2)
    .map((group) => group.level3));
});

const contactAreaTreeValue = computed(() =>
  formatFreightLocationOption([contactAreaTree.level1, contactAreaTree.level2, contactAreaTree.level3])
);

const addressBookListOptions = computed(() => {
  const keyword = normalizeLocationText(locationPicker.keyword);
  return customerContactAddressOptions.value
    .filter((option) => {
      if (!keyword) return true;
      return normalizeLocationText([
        option.source,
        option.contact,
        option.phone,
        option.area,
        option.value,
        option.note
      ].join(" ")).includes(keyword);
    })
    .slice(0, 120);
});

const visibleSavedAddressBookIds = computed(() =>
  addressBookListOptions.value
    .filter((item) => item.source === "联系人")
    .map((item) => item.id)
);

const allVisibleAddressBookSelected = computed(() =>
  visibleSavedAddressBookIds.value.length > 0 &&
  visibleSavedAddressBookIds.value.every((id) => selectedAddressBookIds.value.includes(id))
);

const locationPickerTitle = computed(() =>
  `${locationPicker.mode === "addressBook" ? "客户联系人地址" : "选择运费模板片区"} · ${locationPicker.target === "unloading" ? "卸货地" : "装货地"}`
);

const directionTemplateLocationGroups = computed(() => {
  return freightRateGroups.value;
});

const templateLocationGroups = computed(() => {
  const groups = directionTemplateLocationGroups.value.length
    ? directionTemplateLocationGroups.value
    : freightRateGroups.value;
  return groups.filter((group) => group.level1);
});

function templateGroupMatchesOrderTarget(group, target) {
  const mode = orderLocationHongKongMode(target);
  if (mode === "all") return true;
  const isHongKongGroup = isHongKongLocation([group.level1, group.level2, group.level3].join("/"));
  return mode === "onlyHongKong" ? isHongKongGroup : !isHongKongGroup;
}

function orderLocationHongKongMode(target) {
  const direction = orderForm.direction || "";
  if (!direction || !target) return "all";
  if (
    (direction === "出口" && target === "unloading")
    || (direction === "进口" && target === "loading")
  ) {
    return "onlyHongKong";
  }
  if (
    (direction === "出口" && target === "loading")
    || (direction === "进口" && target === "unloading")
  ) {
    return "excludeHongKong";
  }
  return "all";
}

function orderLocationGroupsForTarget(target) {
  return freightRateGroups.value
    .filter((group) => group.level1)
    .filter((group) => templateGroupMatchesOrderTarget(group, target));
}

const locationPickerTemplateGroups = computed(() => orderLocationGroupsForTarget(locationPicker.target));

const routeTreeLocationGroups = computed(() => orderLocationGroupsForTarget(routeTreeDropdown.target));

const templateLocationLevel1Options = computed(() =>
  uniqueSorted(locationPickerTemplateGroups.value.map((group) => group.level1))
);

const templateLocationLevel2Options = computed(() => {
  if (!locationPicker.level1) return [];
  return uniqueSorted(locationPickerTemplateGroups.value
    .filter((group) => group.level1 === locationPicker.level1)
    .map((group) => group.level2));
});

const templateLocationLevel3Options = computed(() => {
  if (!locationPicker.level1 || !locationPicker.level2) return [];
  return uniqueSorted(locationPickerTemplateGroups.value
    .filter((group) => group.level1 === locationPicker.level1 && group.level2 === locationPicker.level2)
    .map((group) => group.level3));
});

const templateLocationValue = computed(() =>
  formatFreightLocationOption([locationPicker.level1, locationPicker.level2, locationPicker.level3])
);

const routeTreeLevel1Options = computed(() =>
  uniqueSorted(routeTreeLocationGroups.value.map((group) => group.level1))
);

const routeTreeLevel2Options = computed(() => {
  if (!routeTreeDropdown.level1) return [];
  return uniqueSorted(routeTreeLocationGroups.value
    .filter((group) => group.level1 === routeTreeDropdown.level1)
    .map((group) => group.level2));
});

const routeTreeLevel3Options = computed(() => {
  if (!routeTreeDropdown.level1 || !routeTreeDropdown.level2) return [];
  return uniqueSorted(routeTreeLocationGroups.value
    .filter((group) => group.level1 === routeTreeDropdown.level1 && group.level2 === routeTreeDropdown.level2)
    .map((group) => group.level3));
});

const routeTreeValue = computed(() =>
  formatFreightLocationOption([routeTreeDropdown.level1, routeTreeDropdown.level2, routeTreeDropdown.level3])
);
const routeTreeEmptyText = computed(() =>
  routeTreeLocationGroups.value.length === 0 && orderLocationHongKongMode(routeTreeDropdown.target) === "onlyHongKong"
    ? "暂无香港运费模板目录"
    : "暂无运费模板目录"
);

const locationPickerOptions = computed(() => {
  const keyword = normalizeLocationText(locationPicker.keyword);
  const dedup = new Map();
  const scoreOption = (option) => {
    let score = option.source === "运费模板" ? 100 : 0;
    score += Number(option.rank || 0);
    return score;
  };
  const sourceOptions = locationPicker.mode === "addressBook"
    ? addressBookListOptions.value
    : freightAddressOptions.value;
  sourceOptions.forEach((option) => {
    const key = `${option.source}:${addressOptionKey(option.value)}`;
    const previous = dedup.get(key);
    if (!previous || scoreOption(option) > scoreOption(previous)) dedup.set(key, option);
  });
  return [...dedup.values()].filter((option) => {
    if (!keyword) return true;
    return normalizeLocationText([
      option.source,
      option.direction,
      option.level1,
      option.level2,
      option.level3,
      option.value
    ].join(" ")).includes(keyword);
  }).sort((a, b) => {
    if (a.source !== b.source) return a.source === "运费模板" ? -1 : 1;
    if ((b.rank || 0) !== (a.rank || 0)) return (b.rank || 0) - (a.rank || 0);
    return String(a.value || "").localeCompare(String(b.value || ""), "zh-Hans-CN");
  }).slice(0, 120);
});

const selectedVisibleFreightGroups = computed(() => {
  const selected = new Set(selectedFreightGroupKeys.value);
  return visibleFreightRateGroups.value.filter((group) => selected.has(group.key));
});

const allVisibleFreightGroupsSelected = computed(() =>
  visibleFreightRateGroups.value.length > 0 &&
  visibleFreightRateGroups.value.every((group) => selectedFreightGroupKeys.value.includes(group.key))
);

function partnerRecentOrderDate(partner) {
  if (!partner) return "-";
  const dates = orderRows.value
    .filter((order) => orderBelongsToPartner(order, partner))
    .map((order) => String(order.date || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
  return dates[0] || partner.recentOrder || "-";
}

function isInternalTemplateRow(item) {
  if (String(item?.name || "").startsWith("外派费用规则-")) return true;
  if (["order-freight-template", "outsourced-cost-rule"].includes(item?.contentType)) return true;
  if (parseSupplierCostRuleTemplate(item)) return true;
  try {
    const content = JSON.parse(item?.content || "{}");
    return ["order-freight-template", "outsourced-cost-rule"].includes(content?.type);
  } catch {
    return false;
  }
}

const exportTemplateRows = computed(() =>
  templateRows.value.filter((item) => !isInternalTemplateRow(item))
);

const selectedTemplate = computed(() =>
  exportTemplateRows.value.find((item) => item.id === selectedTemplateId.value) || exportTemplateRows.value[0]
);

watch(exportTemplateRows, (rows) => {
  if (!rows.some((item) => item.id === selectedTemplateId.value)) {
    selectedTemplateId.value = rows[0]?.id || null;
  }
});

function currentOrderTemplateCustomer() {
  return {
    id: orderForm.customerId || selectedCustomer.value?.id || "",
    name: orderForm.customer || selectedCustomer.value?.name || ""
  };
}

function orderTemplateCustomerFromContent(content = {}) {
  const order = content.order || {};
  return {
    id: content.customerId || content.customer_id || order.customerId || order.customer_id || "",
    name: content.customer || order.customer || ""
  };
}

function orderTemplateMatchesCurrentCustomer(content = {}) {
  const current = currentOrderTemplateCustomer();
  const owner = orderTemplateCustomerFromContent(content);
  if (current.id && owner.id) return current.id === owner.id;
  if (current.name && owner.name) return current.name === owner.name;
  return false;
}

const orderFreightTemplateOptions = computed(() =>
  templateRows.value
    .map((item) => {
      let content = null;
      try {
        content = JSON.parse(item.content || "{}");
      } catch {
        content = null;
      }
      return { item, content };
    })
    .filter(({ content }) => content?.type === "order-freight-template" && orderTemplateMatchesCurrentCustomer(content))
    .map(({ item, content }) => ({
      ...item,
      feeCount: Array.isArray(content.fees) ? content.fees.length : 0
    }))
);
const latestOrderTemplateSource = computed(() => {
  const customerId = orderForm.customerId || selectedCustomer.value?.id || "";
  const customerName = orderForm.customer || selectedCustomer.value?.name || "";
  return orderRows.value
    .filter((item) =>
      item.no !== editingOrderNo.value
      && Array.isArray(item.fees)
      && item.fees.length > 0
      && (
        (customerId && item.customerId === customerId)
        || (customerName && item.customer === customerName)
      )
    )
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.no || "").localeCompare(String(a.no || "")))[0] || null;
});
const templateDesignerColumns = computed(() => visibleTemplateColumnsForOrders(templatePreviewDataRows.value));

const TEMPLATE_PREVIEW_PAGE_SIZE = Object.freeze({
  portrait: { width: 794, height: 1123 },
  landscape: { width: 1123, height: 794 },
  fluid: { width: 1123, height: 794 }
});

function templateTablePixelWidth() {
  return templateDesignerColumns.value.reduce((sum, column) => {
    return sum + Number(column.width || defaultTemplateColumnWidth(column.key) || 86);
  }, 0);
}

const templatePreviewScale = computed(() => {
  if (templateDesigner.previewZoom === "fit") return 1;
  const zoom = Math.max(60, Math.min(160, Number(templateDesigner.previewZoom || 100)));
  return zoom / 100;
});

const templatePreviewViewportStyle = computed(() => {
  const baseSize = TEMPLATE_PREVIEW_PAGE_SIZE[templateDesigner.orientation] || TEMPLATE_PREVIEW_PAGE_SIZE.landscape;
  const tableWidth = Math.max(1, templateTablePixelWidth());
  const size = templateDesigner.orientation === "fluid"
    ? {
      width: Math.max(baseSize.width, tableWidth + 72),
      height: baseSize.height
    }
    : baseSize;
  const scale = templatePreviewScale.value;
  return {
    width: `${Math.round(size.width * scale)}px`,
    height: `${Math.round(size.height * scale)}px`,
    "--template-page-width": `${size.width}px`,
    "--template-page-height": `${size.height}px`,
    "--template-preview-scale": String(scale)
  };
});

const templatePreviewStyle = computed(() => ({
  width: "var(--template-page-width)",
  height: "var(--template-page-height)"
}));

const templatePreviewTableStyle = computed(() => {
  const width = templateTablePixelWidth();
  return {
    width: `${Math.max(1, width)}px`,
    minWidth: templateDesigner.orientation === "fluid" ? `${Math.max(1, width)}px` : "100%"
  };
});

const templatePreviewDataRows = computed(() => {
  const realRows = orderRows.value
    .filter((item) => item && !item.deletedAt)
    .sort((a, b) => templatePreviewOrderNoCompare(a, b))
    .slice(0, 6);
  const rows = realRows.length ? realRows : TEMPLATE_PREVIEW_SAMPLE_ORDERS;
  return [...rows]
    .sort((a, b) => templatePreviewOrderNoCompare(a, b))
    .slice(0, 6);
});

const templatePreviewRows = computed(() => [
  ...templatePreviewDataRows.value,
  { __total: true }
]);

function templatePreviewTextValue(value) {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function isRemovedTemplateColumnKey(key = "") {
  return TEMPLATE_REMOVED_COLUMN_KEYS.has(templatePreviewTextValue(key));
}

function filterRemovedTemplateColumns(columns = []) {
  if (!Array.isArray(columns)) return [];
  return columns.filter((column) => !isRemovedTemplateColumnKey(column?.key));
}

function templatePreviewOrderNoForSort(order = {}) {
  return templatePreviewTextValue(order?.no || order?.orderNo || order?.order_no).trim();
}

function templatePreviewOrderNoCompare(a = {}, b = {}) {
  const left = templatePreviewOrderNoForSort(a);
  const right = templatePreviewOrderNoForSort(b);
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function templatePreviewAmountDisplay(value, emptyZero = true) {
  const amount = Number(value || 0);
  if (!amount && emptyZero) return "";
  return amount ? amount.toLocaleString("zh-Hans-CN") : "0";
}

function normalizeTemplateFeeCurrency(value = "") {
  const text = templatePreviewTextValue(value).trim().toUpperCase();
  if (text === "人民币" || text === "RMB") return "RMB";
  return "HKD";
}

function templateCurrencyDisplay(value = "") {
  return normalizeTemplateFeeCurrency(value) === "RMB" ? "人民币" : "港币";
}

function currencyCodeDisplay(value = "") {
  const text = templatePreviewTextValue(value).trim();
  if (!text) return "";
  return normalizeTemplateFeeCurrency(text) === "RMB" ? "RMB" : "HKD";
}

function templateFeeItemForColumn(column) {
  const feeItemId = templatePreviewTextValue(column?.feeItemId).trim();
  const feeName = templatePreviewTextValue(column?.feeName || column?.label).trim();
  if (feeItemId) {
    const byId = feeItemRows.value.find((item) => String(item.id) === feeItemId);
    if (byId) return byId;
  }
  if (feeName) {
    const byName = feeItemRows.value.find((item) => item.name === feeName);
    if (byName) return byName;
  }
  return null;
}

function resolveTemplateFeeColumnCurrency(column) {
  const feeItem = templateFeeItemForColumn(column);
  if (feeItem?.currency) return feeItem.currency;
  return templatePreviewTextValue(column?.feeCurrency).trim();
}

function templateColumnCurrencyLabel(column) {
  const key = templatePreviewTextValue(column?.key);
  if (key === "__hkdTotal" || key === "receivableHKD") return "HKD";
  if (key === "__rmbTotal" || key === "receivableRMB") return "RMB";
  if (key.startsWith("fee-item-") || column?.feeItemId || column?.feeName) {
    const feeCurrency = resolveTemplateFeeColumnCurrency(column);
    return feeCurrency ? currencyCodeDisplay(feeCurrency) : "";
  }
  return "";
}

function templateColumnBaseLabel(column) {
  const label = templatePreviewTextValue(column?.label);
  const currency = templateColumnCurrencyLabel(column);
  if (!currency) return label;
  const normalizedCurrency = normalizeTemplateFeeCurrency(currency);
  const displayCurrency = templateCurrencyDisplay(currency);
  return label
    .replace(new RegExp(`\\s*(?:${currency}|${normalizedCurrency}|${displayCurrency})$`, "i"), "")
    .trim() || label;
}

function feeHasTemplateValue(fee) {
  if (!templatePreviewTextValue(fee?.name).trim()) return false;
  return Number(fee?.amount || 0) !== 0
    || Boolean(templatePreviewTextValue(fee?.quantity).trim())
    || Boolean(templatePreviewTextValue(fee?.remark).trim());
}

function templateFeeRowsForColumn(order, column) {
  const fees = Array.isArray(order?.fees) ? order.fees : [];
  const feeItemId = templatePreviewTextValue(column?.feeItemId).trim();
  const feeName = templatePreviewTextValue(column?.feeName || column?.label).trim();
  const feeCurrency = resolveTemplateFeeColumnCurrency(column);
  const normalizedColumnCurrency = normalizeTemplateFeeCurrency(feeCurrency);
  if (!feeItemId && !feeName) return [];
  return fees.filter((fee) => {
    const name = templatePreviewTextValue(fee.name).trim();
    const itemId = templatePreviewTextValue(fee.feeItemId || fee.fee_item_id).trim();
    const currencyMatches = !feeCurrency || normalizeTemplateFeeCurrency(fee.currency) === normalizedColumnCurrency;
    if (feeItemId && itemId) return itemId === feeItemId && currencyMatches;
    return name === feeName && currencyMatches;
  });
}

function templateFeeColumnHasRecordedValue(column, orders = []) {
  if (!isTemplateFeeItemColumn(column)) return true;
  return orders.some((order) => templateFeeRowsForColumn(order, column).some(feeHasTemplateValue));
}

function visibleTemplateColumnsForOrders(orders = []) {
  return templateDesigner.columns
    .filter((item) => !isRemovedTemplateColumnKey(item.key) && item.visible && templateFeeColumnHasRecordedValue(item, orders))
    .map((item) => ({
      ...item,
      key: item.key,
      label: item.label,
      fontSize: Number(item.fontSize || templateDesigner.tableFontSize || 11),
      width: Math.max(
        Number(item.width || defaultTemplateColumnWidth(item.key)),
        templateColumnAutoWidth(item, orders)
      )
    }));
}

function templateTextDisplayWidth(value = "") {
  return Array.from(templatePreviewTextValue(value)).reduce((sum, char) => {
    return sum + (/[\u2e80-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1);
  }, 0);
}

function templateColumnMinimumWidth(column = {}) {
  const key = templatePreviewTextValue(column?.key);
  const currency = templateColumnCurrencyLabel(column);
  const label = templateColumnBaseLabel(column);
  const isFeeColumn = key.startsWith("fee-item-") || column?.feeItemId || column?.feeName;
  const widthUnits = Math.max(templateTextDisplayWidth(label), templateTextDisplayWidth(currency));
  const baseWidth = widthUnits * 7 + 14;
  return Math.max(isFeeColumn ? 58 : 42, Math.min(isFeeColumn ? 118 : 160, baseWidth));
}

function templateCellDisplayWidth(value = "") {
  const lines = templatePreviewTextValue(value).split(/\r?\n/);
  return Math.max(...lines.map(templateTextDisplayWidth), 0);
}

function templateColumnAutoWidth(column = {}, orders = []) {
  const key = templatePreviewTextValue(column?.key);
  const isFeeColumn = key.startsWith("fee-item-") || column?.feeItemId || column?.feeName;
  const sidePadding = templateDesigner.orientation === "fluid" ? 14 : 10;
  const headerWidth = templateColumnMinimumWidth(column);
  const valueWidth = orders.reduce((max, order, index) => {
    return Math.max(max, templateCellDisplayWidth(templatePreviewCellValue(order, column, index)));
  }, 0);
  const contentWidth = valueWidth ? valueWidth * 6.5 + 18 + sidePadding : 0;
  if (templateDesigner.orientation === "fluid") {
    return Math.max(headerWidth + sidePadding, Math.min(isFeeColumn ? 220 : 360, contentWidth || headerWidth));
  }
  return Math.max(headerWidth + sidePadding, Math.min(isFeeColumn ? 150 : 240, contentWidth));
}

function templatePreviewShortLocation(value) {
  const parts = templatePreviewTextValue(value)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 2 ? parts.slice(0, 2).join(" / ") : templatePreviewTextValue(value);
}

function isTemplatePreviewAmountColumn(column) {
  const key = templatePreviewTextValue(column?.key);
  const label = templatePreviewTextValue(column?.label);
  return key === "__hkdTotal"
    || key === "__rmbTotal"
    || key === "receivableHKD"
    || key === "receivableRMB"
    || key.startsWith("fee-item-")
    || /金额|应收|港币|人民币|运费|税金|过磅费|停车费|登记费|等候费|装货费|卸货费/.test(label);
}

function templatePreviewFeeAmount(order, column, rowIndex = 0) {
  return templateFeeRowsForColumn(order, column)
    .reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
}

function templatePreviewFeeDisplay(order, column) {
  const rows = templateFeeRowsForColumn(order, column);
  const amount = rows.reduce((sum, fee) => sum + Number(fee.amount || 0), 0);
  const amountText = templatePreviewAmountDisplay(amount);
  if (amountText) return amountText;
  return "-";
}

function templatePreviewAmountValue(order, column, rowIndex = 0) {
  const key = templatePreviewTextValue(column?.key);
  if (key === "__sequence") return 0;
  if (key === "__hkdTotal") return Number(order?.receivableHKD || 0);
  if (key === "__rmbTotal") return Number(order?.receivableRMB || 0);
  if (key === "receivableHKD" || key === "receivableRMB") return Number(order?.[key] || 0);
  if (key.startsWith("fee-item-")) return templatePreviewFeeAmount(order, column, rowIndex);
  const amount = Number(order?.[key] || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function templatePreviewTotalCellValue(column, columnIndex = 0) {
  if (columnIndex === 0) return "合计";
  if (!isTemplatePreviewAmountColumn(column)) return "";
  const amount = templatePreviewDataRows.value.reduce((sum, row, rowIndex) => {
    return sum + templatePreviewAmountValue(row, column, rowIndex);
  }, 0);
  return templatePreviewAmountDisplay(amount, false);
}

function templatePreviewCellValue(order, column, rowIndex = 0) {
  const key = templatePreviewTextValue(column?.key);
  if (order?.__total) return templatePreviewTotalCellValue(column, templateDesignerColumns.value.findIndex((item) => item.key === key));
  if (key === "__sequence") return rowIndex + 1;
  if (key === "__hkdTotal") return templatePreviewAmountDisplay(order?.receivableHKD);
  if (key === "__rmbTotal") return templatePreviewAmountDisplay(order?.receivableRMB);
  if (key === "loading" || key === "unloading") return templatePreviewShortLocation(order?.[key]);
  if (key === "quantity") return templatePreviewTextValue(order?.quantity ?? order?.pieces ?? order?.count);
  if (key === "receivableHKD" || key === "receivableRMB") {
    return templatePreviewAmountDisplay(order?.[key]);
  }
  if (key.startsWith("fee-item-")) {
    return templatePreviewFeeDisplay(order, column);
  }
  const value = order?.[key];
  if (value !== undefined && value !== null && value !== "") {
    if (Number(value) === 0 && String(value).trim() !== "") return "";
    return templatePreviewTextValue(value);
  }
  return "-";
}

const activeTemplateTextItem = computed(() => {
  const textItems = activeTemplateVariableTarget.type === "footer"
    ? templateDesigner.footerTextItems
    : templateDesigner.headerTextItems;
  return textItems.find((item) => item.id === activeTemplateVariableTarget.id) || null;
});

function templateTextItemKey(type, id) {
  return `${type}:${id}`;
}

function templatePagePixelHeight() {
  if (templateDesigner.orientation === "fluid") return 594;
  return templateDesigner.orientation === "portrait" ? 842 : 594;
}

function templatePagePixelWidth() {
  if (templateDesigner.orientation === "fluid") return Math.max(842, templateTablePixelWidth() + 72);
  return templateDesigner.orientation === "portrait" ? 595 : 842;
}

function normalizeTemplateTextItem(item = {}, type = "header") {
  if (!item.id) item.id = `${type}-text-${Date.now()}`;
  if (!item.width) item.width = 220;
  if (!item.height) item.height = 44;
  if (!item.fontFamily) item.fontFamily = type === "footer" ? templateDesigner.footerFontFamily : templateDesigner.headerFontFamily;
  if (!item.fontSize) item.fontSize = type === "footer" ? Number(templateDesigner.footerFontSize || 12) : Number(templateDesigner.headerFontSize || 14);
  if (!item.color) item.color = type === "footer" ? templateDesigner.footerTextColor || "#64748b" : templateDesigner.headerTextColor || "#17233c";
  if (!item.align) item.align = "left";
  if (item.free !== true) item.free = false;
  return item;
}

function findTemplateTextItem(type, id) {
  const textItems = type === "footer" ? templateDesigner.footerTextItems : templateDesigner.headerTextItems;
  return textItems.find((item) => item.id === id) || null;
}

function promoteTemplateTextToFree(type, item) {
  if (!item || item.free === true) return item;
  if (type === "footer") {
    item.y = Math.max(0, templatePagePixelHeight() - Number(templateDesigner.footerHeight || 70) + Number(item.y || 0));
  }
  item.free = true;
  return item;
}

const templatePageTextEntries = computed(() => [
  ...templateDesigner.headerTextItems.map((item, index) => {
    const normalized = promoteTemplateTextToFree("header", normalizeTemplateTextItem(item, "header"));
    return { type: "header", item: normalized, index, key: templateTextItemKey("header", normalized.id) };
  }),
  ...templateDesigner.footerTextItems.map((item, index) => {
    const normalized = promoteTemplateTextToFree("footer", normalizeTemplateTextItem(item, "footer"));
    return { type: "footer", item: normalized, index, key: templateTextItemKey("footer", normalized.id) };
  })
]);

function templateTextItemStyle(entry) {
  const item = normalizeTemplateTextItem(entry.item, entry.type);
  return {
    left: `${Number(item.x || 0)}px`,
    top: `${Number(item.y || 0)}px`,
    width: `${Number(item.width || 220)}px`,
    height: `${Number(item.height || 44)}px`,
    fontFamily: fontPresetStack(item.fontFamily || templateDesigner.headerFontFamily),
    fontSize: `${Number(item.fontSize || 12)}px`,
    color: item.color || "#17233c",
    fontWeight: item.bold ? 700 : 400,
    textAlign: item.align || "left"
  };
}

function isTemplateTextEditing(type, id) {
  return editingTemplateTextKey.value === templateTextItemKey(type, id);
}

function editTemplateTextBox(type, id) {
  const item = findTemplateTextItem(type, id);
  if (!item) return;
  promoteTemplateTextToFree(type, item);
  showTemplateTextToolbar(type, id);
  editingTemplateTextKey.value = templateTextItemKey(type, id);
  nextTick(() => {
    document
      .querySelector(`[data-template-text-key="${templateTextItemKey(type, id)}"] .template-free-text-editor`)
      ?.focus?.();
  });
}

function finishTemplateTextEdit() {
  editingTemplateTextKey.value = "";
}

function updateTemplateTextItem(type, id, value) {
  const item = findTemplateTextItem(type, id);
  if (item) item.text = value;
}

function removeTemplateTextBox(type, id) {
  const list = type === "footer" ? templateDesigner.footerTextItems : templateDesigner.headerTextItems;
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return;
  list.splice(index, 1);
  if (activeTemplateVariableTarget.type === type && activeTemplateVariableTarget.id === id) {
    const fallback = templateDesigner.headerTextItems[0] || templateDesigner.footerTextItems[0];
    if (fallback?.id) {
      const fallbackType = templateDesigner.headerTextItems.includes(fallback) ? "header" : "footer";
      setTemplateVariableTarget(fallbackType, fallback.id);
    } else {
      hideTemplateTextToolbar();
      setTemplateVariableTarget("header", "");
    }
  }
}

function startTemplateTextResize(event, type, id) {
  const item = findTemplateTextItem(type, id);
  if (!item) return;
  promoteTemplateTextToFree(type, item);
  showTemplateTextToolbar(type, id);
  templateTextResize.active = true;
  templateTextResize.type = type;
  templateTextResize.id = id;
  templateTextResize.startX = event.clientX;
  templateTextResize.startY = event.clientY;
  templateTextResize.startWidth = Number(item.width || 220);
  templateTextResize.startHeight = Number(item.height || 44);
  event.currentTarget?.setPointerCapture?.(event.pointerId);
}

function moveTemplateTextResize(event) {
  if (!templateTextResize.active) return;
  const item = findTemplateTextItem(templateTextResize.type, templateTextResize.id);
  if (!item) return;
  const nextWidth = templateTextResize.startWidth + event.clientX - templateTextResize.startX;
  const nextHeight = templateTextResize.startHeight + event.clientY - templateTextResize.startY;
  const maxWidth = Math.max(60, templatePagePixelWidth() - Number(item.x || 0) - 6);
  const maxHeight = Math.max(24, templatePagePixelHeight() - Number(item.y || 0) - 6);
  item.width = Math.max(60, Math.min(maxWidth, Math.round(nextWidth)));
  item.height = Math.max(24, Math.min(maxHeight, Math.round(nextHeight)));
}

function stopTemplateTextResize() {
  templateTextResize.active = false;
  templateTextResize.type = "";
  templateTextResize.id = "";
}

const selectedRule = computed(() =>
  ruleRows.value.find((item) => item.id === selectedRuleId.value) || ruleRows.value[0]
);

const selectedMaster = computed(() =>
  masterRows.value.find((item) => item.id === selectedMasterId.value) || masterRows.value[0]
);

const selectedAccount = computed(() =>
  accountRows.value.find((item) => item.id === selectedAccountId.value) || accountRows.value[0]
);

const currentAccount = computed(() =>
  accountRows.value.find((item) => item.username === currentUsername.value) ||
  currentSessionAccount.value || {
    username: currentUsername.value || "",
    displayName: "",
    role: "司机",
    status: "已登录"
  }
);

const currentAccountLabel = computed(() =>
  currentAccount.value.displayName || currentAccount.value.username || "当前账号"
);

configureApiClient({
  getToken: () => authToken.value,
  getAccount: () => currentAccount.value,
  onUnauthorized: () => {
    if (loggedIn.value) logout({ silent: true });
  }
});

function setSessionAccount(account) {
  if (!account) return;
  currentSessionAccount.value = account;
  currentUsername.value = account.username || currentUsername.value;
  writeStoredSessionItem(SESSION_ACCOUNT_KEY, JSON.stringify(account));
  writeStoredSessionItem(SESSION_USER_KEY, currentUsername.value);
}

function saveLoginSession(token, account, expiresAtValue) {
  const expiresAt = normalizeSessionExpiresAt(expiresAtValue, token) || Date.now() + ACCOUNT_SESSION_TTL_MS;
  authToken.value = token || "";
  setSessionAccount(account);
  writeStoredSessionItem(SESSION_LOGIN_KEY, "1");
  writeStoredSessionItem(SESSION_TOKEN_KEY, authToken.value);
  writeStoredSessionItem(SESSION_EXPIRES_KEY, String(expiresAt));
}

async function refreshCurrentAccount(options = {}) {
  if (!authToken.value) return null;
  try {
    const result = await authApi.getCurrentAccount();
    if (result?.account) {
      setSessionAccount(result.account);
      return result.account;
    }
  } catch (error) {
    if (!options.silent) notify(error.message);
  }
  return null;
}

function tableSortKey(tableId) {
  return `hanye_table_sort_${tableId}`;
}

function loadTableSortState(tableId) {
  if (tableSortState[tableId]) return tableSortState[tableId];
  try {
    const saved = JSON.parse(localStorage.getItem(tableSortKey(tableId)) || "{}");
    tableSortState[tableId] = {
      key: String(saved.key || ""),
      direction: saved.direction === "desc" ? "desc" : (saved.direction === "asc" ? "asc" : "")
    };
  } catch {
    tableSortState[tableId] = { key: "", direction: "" };
  }
  return tableSortState[tableId];
}

function tableSortDirection(tableId, key) {
  const state = loadTableSortState(tableId);
  return state.key === key ? state.direction : "";
}

function toggleTableSort(tableId, column = {}) {
  if (!column?.key || ["select", "actions", "sequence"].includes(column.key)) return;
  const state = loadTableSortState(tableId);
  if (state.key !== column.key) {
    state.key = column.key;
    state.direction = "asc";
  } else if (state.direction === "asc") {
    state.direction = "desc";
  } else {
    state.key = "";
    state.direction = "";
  }
  localStorage.setItem(tableSortKey(tableId), JSON.stringify(state));
}

function tableSortLabel(tableId, column = {}) {
  const direction = tableSortDirection(tableId, column.key);
  if (direction === "asc") return "升序";
  if (direction === "desc") return "降序";
  return "";
}

function tableSortValue(row = {}, key = "") {
  if (!key) return "";
  if (key === "driver" && row.driver) return row.driver.name || "";
  if (key === "type" && row.driver) return row.driver.type || "";
  if (key === "status" && row.driver) return row.driver.status || "";
  if (key === "orderCount") return row.orderCount ?? "";
  if (key === "tripFee") return (row.payable ?? 0) + (row.payableRMB ?? 0);
  if (key === "advanceFee") return (row.advanceFee ?? 0) + (row.advanceFeeRMB ?? 0);
  if (key === "adjustments") return (row.adjustments ?? 0) + (row.adjustmentsRMB ?? 0);
  if (key === "total") return (row.total ?? 0) + (row.totalRMB ?? 0);
  if (key === "recentOrderDate") return partnerRecentOrderDate(row);
  const direct = row?.[key];
  if (direct !== undefined && direct !== null && direct !== "") return direct;
  if (row.order && row.order[key] !== undefined) return row.order[key];
  if (row.driver && row.driver[key] !== undefined) return row.driver[key];
  if (key === "route") return `${row.loading || row.order?.loading || ""} ${row.unloading || row.order?.unloading || ""}`;
  if (key === "baseFee") return row.baseFee ?? row.payable ?? "";
  if (key === "tripFee") return row.payable ?? "";
  return "";
}

function normalizeSortValue(value) {
  if (value === null || value === undefined) return { type: "empty", value: "" };
  const text = String(value).trim();
  if (!text) return { type: "empty", value: "" };
  const date = parseInputDate(text);
  if (date && /^\d{4}-\d{2}-\d{2}/.test(text)) return { type: "date", value: date.getTime() };
  const numeric = Number(text.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  if (Number.isFinite(numeric) && /-?\d/.test(text)) return { type: "number", value: numeric };
  return { type: "text", value: text };
}

function compareSortValues(left, right) {
  const a = normalizeSortValue(left);
  const b = normalizeSortValue(right);
  if (a.type === "empty" && b.type !== "empty") return 1;
  if (b.type === "empty" && a.type !== "empty") return -1;
  if (a.type === "number" && b.type === "number") return a.value - b.value;
  if (a.type === "date" && b.type === "date") return a.value - b.value;
  return String(a.value).localeCompare(String(b.value), "zh-Hans-CN", { numeric: true });
}

function sortRowsByTable(rows = [], tableId, fallbackIndexKey = "__sortIndex") {
  const state = loadTableSortState(tableId);
  if (!state.key || !state.direction) return rows;
  const direction = state.direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const compared = compareSortValues(tableSortValue(left.row, state.key), tableSortValue(right.row, state.key));
      if (compared !== 0) return compared * direction;
      return (left.row?.[fallbackIndexKey] ?? left.index) - (right.row?.[fallbackIndexKey] ?? right.index);
    })
    .map((item) => item.row);
}

const currentAccountCanDeleteInTransitOrder = computed(() =>
  normalizeAccountRole(currentAccount.value.role) === "管理员"
);

watch(() => accountForm.role, (role) => {
  accountForm.permissionsText = permissionTextForRole(role);
});

watch(() => accountCreateForm.role, (role) => {
  accountCreateForm.permissionsText = permissionTextForRole(role);
});

function canDeleteOrder(order = {}) {
  if (order.status === "已审核") return false;
  if (order.status === "通关中") return currentAccountCanDeleteInTransitOrder.value;
  return true;
}

function findAddressBookContactForLocation(location = "") {
  const normalizedLocation = normalizeLocationText(location);
  if (!normalizedLocation) return null;
  const contactMatch = customerContactAddressOptions.value.find((item) => {
    const candidates = [
      item.address,
      item.area,
      [item.area, item.address].filter(Boolean).join(" / ")
    ].map((value) => normalizeLocationText(value));
    return candidates.some((candidate) =>
      candidate && (candidate.includes(normalizedLocation) || normalizedLocation.includes(candidate))
    );
  });
  if (contactMatch) {
    return {
      contact: contactMatch.contact,
      phone: contactMatch.phone
    };
  }
  return addressBookRows.value.find((item) => {
    const candidates = [
      item.address,
      item.area,
      [item.area, item.address].filter(Boolean).join(" / ")
    ].map((value) => normalizeLocationText(value));
    return candidates.some((candidate) =>
      candidate && (candidate.includes(normalizedLocation) || normalizedLocation.includes(candidate))
    );
  }) || null;
}

function dispatchLocationLines(target) {
  const location = String(orderForm[target] || "").trim();
  const contactKey = target === "loading" ? "loadingContact" : "unloadingContact";
  const phoneKey = target === "loading" ? "loadingPhone" : "unloadingPhone";
  const matched = findAddressBookContactForLocation(location);
  const contact = String(orderForm[contactKey] || matched?.contact || "").trim();
  const phone = String(orderForm[phoneKey] || matched?.phone || "").trim();
  return [
    location || "-",
    contact ? `联系人：${contact}` : "",
    phone ? `电话：${phone}` : ""
  ].filter(Boolean);
}

const dispatchMessage = computed(() => [
  `日期：${orderForm.date || "-"}`,
  `装货时间：${orderForm.loadingTime || "-"}`,
  `车牌：${orderForm.plate || "-"}`,
  `口岸：${orderForm.port || "-"}`,
  `吨位：${orderForm.tonnage || "-"}`,
  `板数：${orderForm.quantity || "-"}`,
  `装货地：${dispatchLocationLines("loading").join("\n  ")}`,
  "",
  `卸货地：${dispatchLocationLines("unloading").join("\n  ")}`,
  `备注：${orderForm.remark || "-"}`
].join("\n"));

function orderStatusClass(status) {
  return {
    audited: status === "已审核",
    signed: status === "已签收",
    danger: status === "缺票据",
    warning: status === "费用待确认" || status === "待确认"
  };
}

watch(orderTotals, (totals) => {
  orderForm.receivableHKD = totals.hkd;
  orderForm.receivableRMB = totals.rmb;
}, { deep: true });

watch(
  () => [
    orderModalOpen.value,
    orderForm.customerId,
    orderForm.direction,
    orderForm.tonnage,
    orderForm.currency,
    orderForm.loading,
    orderForm.unloading,
    orderForm.quantity,
    freightRateRows.value
      .map((item) => [
        item.id,
        item.direction,
        item.level1,
        item.level2,
        item.level3,
        item.tonnage,
        item.rmbAmount,
        item.hkdAmount
      ].join(":"))
      .join("|")
  ],
  scheduleAutoFreightSync,
  { flush: "post" }
);

watch([freightDirectionFilter, freightDirectoryLevel, freightLevel1Options], () => {
  if (!freightParentLevel1.value || !freightLevel1Options.value.includes(freightParentLevel1.value)) {
    freightParentLevel1.value = freightLevel1Options.value[0] || "";
  }
  selectedFreightGroupKeys.value = selectedFreightGroupKeys.value.filter((key) =>
    visibleFreightRateGroups.value.some((group) => group.key === key)
  );
}, { flush: "post" });

watch([freightParentLevel1, freightLevel2Options], () => {
  if (!freightParentLevel2.value || !freightLevel2Options.value.includes(freightParentLevel2.value)) {
    freightParentLevel2.value = freightLevel2Options.value[0] || "";
  }
  selectedFreightGroupKeys.value = selectedFreightGroupKeys.value.filter((key) =>
    visibleFreightRateGroups.value.some((group) => group.key === key)
  );
}, { flush: "post" });

watch(driverWageAreaOptions, () => {
  if (driverWageRuleForm.city && !driverWageAreaOptions.value.includes(driverWageRuleForm.city)) {
    driverWageRuleForm.city = "";
  }
}, { flush: "post" });

watch([supplierCostCityOptions, () => supplierCostRuleForm.direction], () => {
  if (supplierCostRuleForm.city && !supplierCostCityOptions.value.includes(supplierCostRuleForm.city)) {
    supplierCostRuleForm.city = "";
  }
}, { flush: "post" });

watch([selectedCustomerId, activePartnerType], () => {
  if (activePartnerType.value === "供应商") {
    prepareNewSupplierCostRule(false);
  }
  if (!customerDetailTabs.value.includes(activeCustomerDetailTab.value)) {
    activeCustomerDetailTab.value = customerDetailTabs.value[0] || "订单管理";
  }
}, { flush: "post" });

watch([feeItemRows, () => templateModalOpen.value], () => {
  if (templateModalOpen.value) ensureAllTemplateColumns();
}, { deep: true, flush: "post" });

watch(activeModule, (moduleId) => {
  resetPeriodFiltersForModuleNavigation();
  if (loggedIn.value && moduleId === "templates") {
    ensureTemplateRowsLoaded({ silent: true }).catch((error) => {
      notify(error.message || "模板中心加载失败");
    });
  }
  if (loggedIn.value && moduleId === "customsBusiness") {
    loadCustomsBusinesses({ silent: true }).catch((error) => {
      notify(error.message || "报关业务加载失败");
    });
  }
}, { immediate: true });

watch(bossPeriodFilter, () => {
  syncBossVehicleExchangeRateFromRows();
});

watch(customsBusinessPeriodFilter, () => {
  if (loggedIn.value && activeModule.value === "customsBusiness") {
    loadCustomsBusinesses().catch((error) => notify(error.message || "报关业务加载失败"));
  }
});

watch([
  () => templateModalOpen.value,
  () => templateForm.id,
  () => templateForm.name,
  () => templateForm.description,
  templateDesigner
], () => {
  scheduleTemplateAutosave();
}, { deep: true, flush: "post" });

function notify(message) {
  notice.value = message;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.value = "";
  }, 2600);
}

function setOrderAttachmentUploadStatus(message, tone = "busy") {
  window.clearTimeout(orderAttachmentUploadStatusTimer);
  orderAttachmentUploadStatus.value = message;
  orderAttachmentUploadTone.value = tone;
}

function clearOrderAttachmentUploadStatus() {
  window.clearTimeout(orderAttachmentUploadStatusTimer);
  orderAttachmentUploadStatus.value = "";
  orderAttachmentUploadTone.value = "busy";
}

function scheduleClearOrderAttachmentUploadStatus(delay = 4200) {
  window.clearTimeout(orderAttachmentUploadStatusTimer);
  orderAttachmentUploadStatusTimer = window.setTimeout(() => {
    orderAttachmentUploadStatus.value = "";
    orderAttachmentUploadTone.value = "busy";
  }, delay);
}

function readRouteTreePath(value) {
  const [level1 = "", level2 = "", level3 = ""] = String(value || "")
    .split("/")
    .map((part) => part.trim());
  return { level1, level2, level3 };
}

function syncAddressBookAreaTreeFromValue(value = addressBookForm.area) {
  const current = readRouteTreePath(value);
  addressBookAreaTree.level1 = current.level1;
  addressBookAreaTree.level2 = current.level2;
  addressBookAreaTree.level3 = current.level3;
}

function toggleAddressBookAreaTree() {
  if (addressBookAreaTree.open) {
    addressBookAreaTree.open = false;
    return;
  }
  syncAddressBookAreaTreeFromValue();
  addressBookAreaTree.open = true;
}

function selectAddressBookAreaLevel(level, value) {
  if (level === 1) {
    const selected = addressBookAreaTree.level1 === value;
    addressBookAreaTree.level1 = selected ? "" : value;
    addressBookAreaTree.level2 = "";
    addressBookAreaTree.level3 = "";
  } else if (level === 2) {
    const selected = addressBookAreaTree.level2 === value;
    addressBookAreaTree.level2 = selected ? "" : value;
    addressBookAreaTree.level3 = "";
  } else {
    addressBookAreaTree.level3 = addressBookAreaTree.level3 === value ? "" : value;
  }
}

function confirmAddressBookAreaSelection() {
  addressBookForm.area = addressBookAreaTreeValue.value;
  addressBookAreaTree.open = false;
}

function syncContactAreaTreeFromValue(value = contactRowDraft.area) {
  const current = readRouteTreePath(value);
  contactAreaTree.level1 = current.level1;
  contactAreaTree.level2 = current.level2;
  contactAreaTree.level3 = current.level3;
}

function toggleContactAreaTree() {
  if (contactAreaTree.open) {
    contactAreaTree.open = false;
    return;
  }
  syncContactAreaTreeFromValue();
  contactAreaTree.open = true;
}

function selectContactAreaLevel(level, value) {
  if (level === 1) {
    const selected = contactAreaTree.level1 === value;
    contactAreaTree.level1 = selected ? "" : value;
    contactAreaTree.level2 = "";
    contactAreaTree.level3 = "";
  } else if (level === 2) {
    const selected = contactAreaTree.level2 === value;
    contactAreaTree.level2 = selected ? "" : value;
    contactAreaTree.level3 = "";
  } else {
    contactAreaTree.level3 = contactAreaTree.level3 === value ? "" : value;
  }
}

function confirmContactAreaSelection() {
  contactRowDraft.area = contactAreaTreeValue.value;
  contactAreaTree.open = false;
}

function customerOrderColumnStyle(key) {
  return { width: `${customerOrderColumnWidths[key] || 48}px` };
}

function customerOrderTableStyle() {
  return { width: `max(100%, ${customerOrderVisibleTableWidth.value}px)` };
}

function orderTableStyle() {
  return { width: `max(100%, ${orderVisibleTableWidth.value}px)` };
}

function startCustomerOrderColumnResize(column, event) {
  event.preventDefault();
  event.stopPropagation();
  customerOrderResizeState = {
    key: column.key,
    min: column.min,
    startX: event.clientX,
    startWidth: customerOrderColumnWidths[column.key] || column.width
  };
  document.body.classList.add("is-column-resizing");
  window.addEventListener("pointermove", resizeCustomerOrderColumn);
  window.addEventListener("pointerup", stopCustomerOrderColumnResize);
}

function resizeCustomerOrderColumn(event) {
  if (!customerOrderResizeState) return;
  const nextWidth = Math.max(
    customerOrderResizeState.min,
    Math.round(customerOrderResizeState.startWidth + event.clientX - customerOrderResizeState.startX)
  );
  customerOrderColumnWidths[customerOrderResizeState.key] = nextWidth;
}

function stopCustomerOrderColumnResize() {
  if (customerOrderResizeState) {
    saveCustomerOrderColumnWidths();
  }
  customerOrderResizeState = null;
  document.body.classList.remove("is-column-resizing");
  window.removeEventListener("pointermove", resizeCustomerOrderColumn);
  window.removeEventListener("pointerup", stopCustomerOrderColumnResize);
}

function orderColumnStyle(key) {
  return { width: `${orderColumnWidths[key] || 64}px` };
}

function startOrderColumnResize(column, event) {
  event.preventDefault();
  event.stopPropagation();
  orderResizeState = {
    key: column.key,
    min: column.min,
    startX: event.clientX,
    startWidth: orderColumnWidths[column.key] || column.width
  };
  document.body.classList.add("is-column-resizing");
  window.addEventListener("pointermove", resizeOrderColumn);
  window.addEventListener("pointerup", stopOrderColumnResize);
}

function resizeOrderColumn(event) {
  if (!orderResizeState) return;
  const nextWidth = Math.max(
    orderResizeState.min,
    Math.round(orderResizeState.startWidth + event.clientX - orderResizeState.startX)
  );
  orderColumnWidths[orderResizeState.key] = nextWidth;
}

function stopOrderColumnResize() {
  if (orderResizeState) {
    saveOrderColumnWidths();
  }
  orderResizeState = null;
  document.body.classList.remove("is-column-resizing");
  window.removeEventListener("pointermove", resizeOrderColumn);
  window.removeEventListener("pointerup", stopOrderColumnResize);
}

function relatedOrderColumnStyle(widths, key) {
  return { width: `${widths[key] || 72}px` };
}

function saveRelatedVehicleOrderColumnWidths() {
  localStorage.setItem(RELATED_VEHICLE_ORDER_COLUMN_STORAGE_KEY, JSON.stringify({ ...relatedVehicleOrderColumnWidths }));
}

function saveRelatedDriverOrderColumnWidths() {
  localStorage.setItem(RELATED_DRIVER_ORDER_COLUMN_STORAGE_KEY, JSON.stringify({ ...relatedDriverOrderColumnWidths }));
}

function startRelatedOrderColumnResize(stateSetter, widths, column, moveHandler, stopHandler, event) {
  event.preventDefault();
  event.stopPropagation();
  stateSetter({
    key: column.key,
    min: column.min,
    startX: event.clientX,
    startWidth: widths[column.key] || column.width
  });
  document.body.classList.add("is-column-resizing");
  window.addEventListener("pointermove", moveHandler);
  window.addEventListener("pointerup", stopHandler);
}

function startRelatedVehicleOrderColumnResize(column, event) {
  startRelatedOrderColumnResize(
    (state) => { relatedVehicleOrderResizeState = state; },
    relatedVehicleOrderColumnWidths,
    column,
    resizeRelatedVehicleOrderColumn,
    stopRelatedVehicleOrderColumnResize,
    event
  );
}

function resizeRelatedVehicleOrderColumn(event) {
  if (!relatedVehicleOrderResizeState) return;
  relatedVehicleOrderColumnWidths[relatedVehicleOrderResizeState.key] = Math.max(
    relatedVehicleOrderResizeState.min,
    Math.round(relatedVehicleOrderResizeState.startWidth + event.clientX - relatedVehicleOrderResizeState.startX)
  );
}

function stopRelatedVehicleOrderColumnResize() {
  if (relatedVehicleOrderResizeState) {
    saveRelatedVehicleOrderColumnWidths();
  }
  relatedVehicleOrderResizeState = null;
  document.body.classList.remove("is-column-resizing");
  window.removeEventListener("pointermove", resizeRelatedVehicleOrderColumn);
  window.removeEventListener("pointerup", stopRelatedVehicleOrderColumnResize);
}

function startRelatedDriverOrderColumnResize(column, event) {
  startRelatedOrderColumnResize(
    (state) => { relatedDriverOrderResizeState = state; },
    relatedDriverOrderColumnWidths,
    column,
    resizeRelatedDriverOrderColumn,
    stopRelatedDriverOrderColumnResize,
    event
  );
}

function resizeRelatedDriverOrderColumn(event) {
  if (!relatedDriverOrderResizeState) return;
  relatedDriverOrderColumnWidths[relatedDriverOrderResizeState.key] = Math.max(
    relatedDriverOrderResizeState.min,
    Math.round(relatedDriverOrderResizeState.startWidth + event.clientX - relatedDriverOrderResizeState.startX)
  );
}

function stopRelatedDriverOrderColumnResize() {
  if (relatedDriverOrderResizeState) {
    saveRelatedDriverOrderColumnWidths();
  }
  relatedDriverOrderResizeState = null;
  document.body.classList.remove("is-column-resizing");
  window.removeEventListener("pointermove", resizeRelatedDriverOrderColumn);
  window.removeEventListener("pointerup", stopRelatedDriverOrderColumnResize);
}

function dataTableColumnStyle(widths, key) {
  return { width: `${widths[key] || 80}px` };
}

function startDataTableColumnResize(tableId, widths, column, event) {
  event.preventDefault();
  event.stopPropagation();
  dataTableResizeState = {
    tableId,
    widths,
    key: column.key,
    min: column.min,
    startX: event.clientX,
    startWidth: widths[column.key] || column.width
  };
  document.body.classList.add("is-column-resizing");
  window.addEventListener("pointermove", resizeDataTableColumn);
  window.addEventListener("pointerup", stopDataTableColumnResize);
}

function resizeDataTableColumn(event) {
  if (!dataTableResizeState) return;
  dataTableResizeState.widths[dataTableResizeState.key] = Math.max(
    dataTableResizeState.min,
    Math.round(dataTableResizeState.startWidth + event.clientX - dataTableResizeState.startX)
  );
}

function stopDataTableColumnResize() {
  if (dataTableResizeState) {
    localStorage.setItem(dataTableStorageKey(dataTableResizeState.tableId, "widths"), JSON.stringify({ ...dataTableResizeState.widths }));
  }
  dataTableResizeState = null;
  document.body.classList.remove("is-column-resizing");
  window.removeEventListener("pointermove", resizeDataTableColumn);
  window.removeEventListener("pointerup", stopDataTableColumnResize);
}

function setDataTableColumnVisible(tableId, visibility, column, visible) {
  if (column.locked) return;
  visibility[column.key] = visible;
  localStorage.setItem(dataTableStorageKey(tableId, "visibility"), JSON.stringify({ ...visibility }));
}

function setDataTableDensity(value) {
  dataTableDensity.value = dataTableDensityOptions.some((item) => item.key === value) ? value : "compact";
  localStorage.setItem("hanye_data_table_density", dataTableDensity.value);
}

function dataTableDensityClass() {
  return `data-table-density-${dataTableDensity.value}`;
}

function isCustomerOrderColumnVisible(key) {
  return customerOrderColumnVisibility[key] !== false;
}

function isOrderColumnVisible(key) {
  if (ORDER_RIGHT_STICKY_KEYS.includes(key)) return true;
  return orderColumnVisibility[key] !== false;
}

function isDispatchColumnVisible(key) {
  return dispatchTableColumnVisibility[key] !== false;
}

function dataTableColumnVisible(visibility, key) {
  return visibility[key] !== false;
}

function setCustomerOrderColumnVisible(column, visible) {
  if (column.locked) return;
  customerOrderColumnVisibility[column.key] = visible;
  localStorage.setItem(CUSTOMER_ORDER_COLUMN_VISIBILITY_KEY, JSON.stringify({ ...customerOrderColumnVisibility }));
}

function setOrderColumnVisible(column, visible) {
  if (column.locked || isOrderRightStickyColumn(column)) return;
  orderColumnVisibility[column.key] = visible;
  localStorage.setItem(ORDER_COLUMN_VISIBILITY_KEY, JSON.stringify({ ...orderColumnVisibility }));
}

function toggleCustomerOrderColumnVisible(column) {
  setCustomerOrderColumnVisible(column, !isCustomerOrderColumnVisible(column.key));
}

function toggleOrderColumnVisible(column) {
  setOrderColumnVisible(column, !isOrderColumnVisible(column.key));
}

function toggleDispatchColumnVisible(column) {
  setDataTableColumnVisible("dispatch_board", dispatchTableColumnVisibility, column, !isDispatchColumnVisible(column.key));
}

function saveCurrentColumnOrder(columns, storageKey) {
  localStorage.setItem(storageKey, JSON.stringify(columns.filter((column) => !column.locked && !column.rightPinned).map((column) => column.key)));
}

function isManagedColumnLocked(lockedRef, column) {
  return Boolean(column?.locked) || (lockedRef.value || []).includes(column?.key);
}

function toggleManagedColumnLock(columns, lockedRef, column, storageKey, orderStorageKey) {
  if (!column?.key || column.locked) return;
  saveCurrentColumnOrder(columns, orderStorageKey);
  const keys = lockedRef.value || [];
  lockedRef.value = keys.includes(column.key)
    ? keys.filter((key) => key !== column.key)
    : [...keys, column.key];
  saveStoredJson(storageKey, lockedRef.value);
}

function isCustomerOrderColumnLocked(column) {
  return isManagedColumnLocked(customerOrderLockedColumns, column);
}

function isOrderColumnLocked(column) {
  return isOrderRightStickyColumn(column) || isManagedColumnLocked(orderLockedColumns, column);
}

function toggleCustomerOrderColumnLock(column) {
  toggleManagedColumnLock(customerOrderColumns, customerOrderLockedColumns, column, CUSTOMER_ORDER_COLUMN_LOCKED_KEY, CUSTOMER_ORDER_COLUMN_ORDER_KEY);
}

function toggleOrderColumnLock(column) {
  if (isOrderRightStickyColumn(column)) return;
  toggleManagedColumnLock(orderColumns, orderLockedColumns, column, ORDER_COLUMN_LOCKED_KEY, ORDER_COLUMN_ORDER_KEY);
}

function moveColumn(columns, draggedKey, targetKey, storageKey) {
  if (!draggedKey || draggedKey === targetKey) return;
  const fromIndex = columns.findIndex((column) => column.key === draggedKey && !column.locked && !column.rightPinned);
  const toIndex = columns.findIndex((column) => column.key === targetKey && !column.locked && !column.rightPinned);
  if (fromIndex < 0 || toIndex < 0) return;
  const [moved] = columns.splice(fromIndex, 1);
  const nextIndex = columns.findIndex((column) => column.key === targetKey);
  columns.splice(nextIndex, 0, moved);
  localStorage.setItem(storageKey, JSON.stringify(columns.filter((column) => !column.locked && !column.rightPinned).map((column) => column.key)));
}

function moveColumnByOffset(columns, column, offset, storageKey) {
  if (!column?.key || column.locked || column.rightPinned) return;
  const movableKeys = columns.filter((item) => !item.locked && !item.rightPinned).map((item) => item.key);
  const movableIndex = movableKeys.indexOf(column.key);
  const targetMovableKey = movableKeys[movableIndex + offset];
  if (!targetMovableKey) return;
  const fromIndex = columns.findIndex((item) => item.key === column.key);
  const targetIndex = columns.findIndex((item) => item.key === targetMovableKey);
  if (fromIndex < 0 || targetIndex < 0) return;
  const [moved] = columns.splice(fromIndex, 1);
  const nextIndex = columns.findIndex((item) => item.key === targetMovableKey);
  columns.splice(offset > 0 ? nextIndex + 1 : nextIndex, 0, moved);
  localStorage.setItem(storageKey, JSON.stringify(columns.filter((item) => !item.locked && !item.rightPinned).map((item) => item.key)));
}

function resetManagedColumnWidths(columns, widths, storageKey) {
  localStorage.removeItem(storageKey);
  columns.forEach((column) => {
    widths[column.key] = column.width;
  });
  notify("已恢复自适应列宽");
}

function resetManagedColumnOrder(columns, lockedRef, orderStorageKey, lockedStorageKey) {
  localStorage.removeItem(orderStorageKey);
  lockedRef.value = [];
  saveStoredJson(lockedStorageKey, lockedRef.value);
  const lockedStart = columns.filter((column) => column.locked && column.key === "select");
  const lockedEnd = columns
    .filter((column) => column.rightPinned || (column.locked && column.key !== "select"))
    .sort((left, right) => (left.defaultIndex ?? 0) - (right.defaultIndex ?? 0));
  const fixedKeys = new Set([...lockedStart, ...lockedEnd].map((column) => column.key));
  const unlocked = columns.filter((column) => !fixedKeys.has(column.key)).sort((left, right) =>
    (left.defaultIndex ?? 0) - (right.defaultIndex ?? 0)
  );
  columns.splice(0, columns.length, ...lockedStart, ...unlocked, ...lockedEnd);
  notify("已恢复默认列顺序");
}

function resetOrderColumnWidths() {
  resetManagedColumnWidths(orderColumns, orderColumnWidths, ORDER_COLUMN_STORAGE_KEY);
}

function resetOrderColumnOrder() {
  resetManagedColumnOrder(orderColumns, orderLockedColumns, ORDER_COLUMN_ORDER_KEY, ORDER_COLUMN_LOCKED_KEY);
}

function resetCustomerOrderColumnWidths() {
  resetManagedColumnWidths(customerOrderColumns, customerOrderColumnWidths, CUSTOMER_ORDER_COLUMN_STORAGE_KEY);
}

function resetCustomerOrderColumnOrder() {
  resetManagedColumnOrder(customerOrderColumns, customerOrderLockedColumns, CUSTOMER_ORDER_COLUMN_ORDER_KEY, CUSTOMER_ORDER_COLUMN_LOCKED_KEY);
}

function moveCustomerOrderColumn(column, offset) {
  moveColumnByOffset(customerOrderColumns, column, offset, CUSTOMER_ORDER_COLUMN_ORDER_KEY);
}

function moveOrderColumn(column, offset) {
  moveColumnByOffset(orderColumns, column, offset, ORDER_COLUMN_ORDER_KEY);
}

function startCustomerOrderColumnDrag(column, event) {
  draggedCustomerOrderColumnKey = column.key;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", column.key);
}

function dropCustomerOrderColumn(column) {
  moveColumn(customerOrderColumns, draggedCustomerOrderColumnKey, column.key, CUSTOMER_ORDER_COLUMN_ORDER_KEY);
  draggedCustomerOrderColumnKey = "";
}

function startOrderColumnDrag(column, event) {
  draggedOrderColumnKey = column.key;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", column.key);
}

function dropOrderColumn(column) {
  moveColumn(orderColumns, draggedOrderColumnKey, column.key, ORDER_COLUMN_ORDER_KEY);
  draggedOrderColumnKey = "";
}

function startDispatchColumnDrag(column, event) {
  draggedDispatchTableColumnKey = column.key;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", column.key);
}

function dropDispatchColumn(column) {
  moveDataTableColumn(dispatchTableColumns, "dispatch_board", draggedDispatchTableColumnKey, column.key);
  draggedDispatchTableColumnKey = "";
}

function customerOrderCellText(order, key) {
  const values = {
    no: order.no,
    businessType: order.businessType,
    port: order.port,
    direction: order.direction,
    tonnage: order.tonnage,
    currency: order.currency,
    quantity: order.quantity,
    weight: order.weight,
    tripNo: order.tripNo,
    sixSheetNo: order.sixSheetNo,
    vehicleSource: order.vehicleSource,
    plate: order.plate || "",
    driver: order.driver || "",
    transportMode: normalizeTransportMode(order.transportMode || ""),
    loading: relatedOrderLocationText(order.loading),
    unloading: relatedOrderLocationText(order.unloading),
    date: order.date,
    receivableHKD: `港币 ${Number(order.receivableHKD || 0).toLocaleString()}`,
    receivableRMB: `人民币 ${Number(order.receivableRMB || 0).toLocaleString()}`
  };
  return values[key] ?? "";
}

function orderCellText(order, key) {
  const values = {
    no: order.no,
    customer: order.customer,
    businessType: order.businessType,
    port: order.port,
    direction: order.direction,
    tonnage: order.tonnage,
    currency: order.currency,
    quantity: order.quantity,
    weight: order.weight,
    vehicleSource: order.vehicleSource,
    plate: order.plate || "-",
    driver: orderDetailDriverText(order),
    transportMode: normalizeTransportMode(order.transportMode || "") || "-",
    supplier: order.supplier,
    loading: relatedOrderLocationText(order.loading),
    unloading: relatedOrderLocationText(order.unloading),
    date: order.date,
    receivableHKD: `港币 ${Number(order.receivableHKD || 0).toLocaleString()}`,
    receivableRMB: `人民币 ${Number(order.receivableRMB || 0).toLocaleString()}`
  };
  return values[key] ?? "";
}

function orderTableCellTitle(order, key) {
  if (key === "loading" || key === "unloading") return order?.[key] || "";
  if (isOrderFullDisplayColumn(key)) return orderCellText(order, key);
  return "";
}

function customerOrderColumnColspan(keys) {
  return keys.filter((key) => isCustomerOrderColumnVisible(key)).length;
}

function orderColumnColspan(keys) {
  return keys.filter((key) => isOrderColumnVisible(key)).length;
}

function customerListDetailCellText(item = {}, key = "") {
  const values = {
    id: item.id,
    type: item.type,
    name: item.name,
    city: item.city || "-",
    term: item.term || "-",
    settlementCurrency: item.type === "客户" ? (item.settlementCurrency || "人民币结算") : "-",
    receivableRMB: `人民币 ${Number(item.receivableRMB || 0).toLocaleString()}`,
    receivableHKD: `港币 ${Number(item.receivableHKD || 0).toLocaleString()}`,
    recentOrderDate: partnerRecentOrderDate(item) || "-",
    createdAt: item.createdAt || "-"
  };
  return values[key] ?? item[key] ?? "-";
}

function dispatchDriverLabel(driver = {}) {
  const name = String(driver.name || "").trim();
  const type = String(driver.type || "").trim();
  return name ? (type ? `${name} · ${type}` : name) : "";
}

function dispatchDriverText(row = {}) {
  return String(row.driver || "").trim() || "-";
}

function dispatchListDetailCellText(row = {}, key = "") {
  const order = row.order || {};
  const values = {
    sequence: row.displayIndex + 1,
    loadTime: `${order.date || row.date || dispatchDate.value} ${row.loadTime || "-"}`,
    dispatchNo: row.dispatchNo || "-",
    customer: order.customer || row.customer || "-",
    plate: row.plate || "-",
    driver: dispatchDriverText(row),
    port: order.port || row.port || "-",
    direction: order.direction || row.direction || "-",
    tonnage: order.tonnage || row.tonnage || "-",
    quantity: order.quantity || row.quantity || "-",
    weight: order.weight || row.weight || "-",
    route: dispatchOrderRouteText(order),
    vehicleSource: dispatchVehicleSourceText(row),
    status: row.status || DISPATCH_PLAN_DEFAULT_STATUS,
    note: row.note || "-"
  };
  if (key === "dispatchNo") return row.dispatchNo || "-";
  if (key === "orderNo") return order.no || row.orderNo || "-";
  if (key === "driver") return dispatchDriverText(row);
  return values[key] ?? order[key] ?? row[key] ?? "-";
}

function vehicleListDetailCellText(item = {}, key = "") {
  const values = {
    plate: item.plate,
    brand: item.brand || "-",
    model: item.model || "-",
    type: item.type || "-",
    mainlandInsuranceDate: item.mainlandInsuranceDate || "-",
    hkInsuranceDate: item.hkInsuranceDate || "-",
    status: item.status || "-",
    monthlyCost: `HKD ${money(item.monthlyCost || 0)}`,
    note: item.note || "-"
  };
  return values[key] ?? item[key] ?? "-";
}

function driverListDetailCellText(item = {}, key = "") {
  const values = {
    type: item.type || "香港司机",
    name: item.name,
    phone: item.phone || "-",
    idNo: item.idNo || "-",
    license: item.license || "-",
    birthday: item.birthday || "-",
    hireDate: item.hireDate || "-",
    leaveDate: item.leaveDate || "-",
    expireAt: item.expireAt || "-",
    status: item.status || "-",
    note: item.note || "-"
  };
  return values[key] ?? item[key] ?? "-";
}

function closeRouteTreeDropdown() {
  routeTreeDropdown.open = false;
}

function toggleRouteTreeDropdown(target) {
  if (routeTreeDropdown.open && routeTreeDropdown.target === target) {
    closeRouteTreeDropdown();
    return;
  }
  const current = readRouteTreePath(orderForm[target]);
  routeTreeDropdown.target = target;
  routeTreeDropdown.level1 = current.level1;
  routeTreeDropdown.level2 = current.level2;
  routeTreeDropdown.level3 = current.level3;
  const validLevel1Options = uniqueSorted(orderLocationGroupsForTarget(target).map((group) => group.level1));
  if (routeTreeDropdown.level1 && !validLevel1Options.includes(routeTreeDropdown.level1)) {
    routeTreeDropdown.level1 = "";
    routeTreeDropdown.level2 = "";
    routeTreeDropdown.level3 = "";
  }
  routeTreeDropdown.open = true;
}

function selectRouteTreeLevel(level, value) {
  if (level === 1) {
    const selected = routeTreeDropdown.level1 === value;
    routeTreeDropdown.level1 = selected ? "" : value;
    routeTreeDropdown.level2 = "";
    routeTreeDropdown.level3 = "";
  } else if (level === 2) {
    const selected = routeTreeDropdown.level2 === value;
    routeTreeDropdown.level2 = selected ? "" : value;
    routeTreeDropdown.level3 = "";
  } else {
    routeTreeDropdown.level3 = routeTreeDropdown.level3 === value ? "" : value;
  }
}

function confirmRouteTreeSelection() {
  const value = routeTreeValue.value;
  if (!value) {
    orderForm[routeTreeDropdown.target] = "";
  } else {
    orderForm[routeTreeDropdown.target] = value;
  }
  closeRouteTreeDropdown();
  scheduleAutoFreightSync();
}

function currentLocationForm() {
  return locationPicker.owner === "dispatch" ? dispatchForm : orderForm;
}

function openLocationPicker(target, mode = "template", owner = "order") {
  locationPicker.owner = owner;
  locationPicker.target = target;
  locationPicker.mode = mode;
  const form = currentLocationForm();
  locationPicker.keyword = mode === "addressBook" ? "" : (form[target] || "");
  locationPicker.detail = "";
  if (mode === "addressBook") {
    resetAddressBookForm();
    addressBookFormOpen.value = false;
  }
  const [level1 = "", level2 = "", level3 = ""] = String(form[target] || "")
    .split("/")
    .map((part) => part.trim());
  locationPicker.level1 = mode === "template" ? level1 : "";
  locationPicker.level2 = mode === "template" ? level2 : "";
  locationPicker.level3 = mode === "template" ? level3 : "";
  locationPicker.open = true;
}

function openDispatchLocationPicker(target) {
  openLocationPicker(target, "addressBook", "dispatch");
}

function closeLocationPicker() {
  locationPicker.open = false;
  addressBookAreaTree.open = false;
}

function resetAddressBookForm() {
  editingAddressBookId.value = "";
  Object.assign(addressBookForm, {
    area: "",
    contact: "",
    phone: "",
    address: "",
    note: ""
  });
}

function startNewAddressBookEntry() {
  resetAddressBookForm();
  syncAddressBookAreaTreeFromValue("");
  addressBookFormOpen.value = true;
}

function buildAddressBookContactRemark(row) {
  return row.note ? String(row.note).trim() : "";
}

async function syncAddressBookEntryToCustomerContact(row, contactId = "", customerId = currentAddressBookCustomerId()) {
  const activeCustomerId = String(customerId || "").trim();
  const name = String(row.contact || "").trim();
  if (!activeCustomerId || !name) return false;

  const phone = String(row.phone || "").trim();
  const remark = buildAddressBookContactRemark(row);
  const existing = customerContactRows.value.find((item) => {
    if (contactId && item.id === contactId) return true;
    if (item.customerId !== activeCustomerId) return false;
    if (phone) {
      return item.name === name && (item.phone === phone || item.mobile === phone);
    }
    return item.name === name;
  });
  const payload = {
    customerId: activeCustomerId,
    name,
    gender: existing?.gender || "",
    title: existing?.title || "",
    mobile: existing?.mobile || "",
    phone: existing?.mobile === phone ? (existing?.phone || "") : (phone || existing?.phone || ""),
    area: row.area || existing?.area || "",
    address: row.address || existing?.address || "",
    fax: existing?.fax || "",
    email: existing?.email || "",
    wechat: existing?.wechat || "",
    qq: existing?.qq || "",
    remark: remark || existing?.remark || ""
  };
  const saved = existing
    ? await customersApi.updateCustomerContact(existing.id, payload)
    : await customersApi.createCustomerContact(payload);
  customerContactRows.value = existing
    ? customerContactRows.value.map((item) => item.id === saved.id ? saved : item)
    : [saved, ...customerContactRows.value];
  return true;
}

async function saveAddressBookEntry() {
  const address = String(addressBookForm.address || "").trim();
  if (!address) {
    notify("请填写详细地址");
    return;
  }
  const customerId = currentAddressBookCustomerId();
  if (!customerId) {
    notify("请先选择当前客户");
    return;
  }
  const row = {
    area: String(addressBookForm.area || "").trim(),
    contact: String(addressBookForm.contact || "").trim(),
    phone: String(addressBookForm.phone || "").trim(),
    address,
    note: String(addressBookForm.note || "").trim()
  };
  try {
    const contactSynced = await syncAddressBookEntryToCustomerContact(row, editingAddressBookId.value, customerId);
    if (!contactSynced) {
      notify("请先填写联系人");
      return;
    }
    resetAddressBookForm();
    addressBookFormOpen.value = false;
    notify("地址已保存到客户联系人");
  } catch (error) {
    notify(error.message);
  }
}

function editAddressBookEntry(option) {
  if (!option?.id) return;
  const row = customerContactRows.value.find((item) => item.id === option.id);
  if (!row) return;
  editingAddressBookId.value = row.id;
  addressBookFormOpen.value = true;
  syncAddressBookAreaTreeFromValue(contactAreaText(row) || "");
  Object.assign(addressBookForm, {
    area: contactAreaText(row) || "",
    contact: row.name || "",
    phone: row.mobile || row.phone || "",
    address: contactAddressText(row) || "",
    note: row.remark || ""
  });
}

async function deleteAddressBookEntry(id) {
  if (!id) return;
  try {
    await customersApi.deleteCustomerContact(id);
    customerContactRows.value = customerContactRows.value.filter((item) => item.id !== id);
    selectedAddressBookIds.value = selectedAddressBookIds.value.filter((item) => item !== id);
    if (editingAddressBookId.value === id) {
      resetAddressBookForm();
      addressBookFormOpen.value = false;
    }
    notify("联系人地址已删除");
  } catch (error) {
    notify(error.message);
  }
}

function toggleAddressBookSelection(id, checked) {
  if (!id) return;
  selectedAddressBookIds.value = checked
    ? [...new Set([...selectedAddressBookIds.value, id])]
    : selectedAddressBookIds.value.filter((item) => item !== id);
}

function toggleAllAddressBookSelection(checked) {
  selectedAddressBookIds.value = checked ? [...visibleSavedAddressBookIds.value] : [];
}

async function deleteSelectedAddressBookEntries() {
  const selected = new Set(selectedAddressBookIds.value);
  if (selected.size === 0) {
    notify("请先勾选地址");
    return;
  }
  try {
    await Promise.all([...selected].map((id) =>
      customersApi.deleteCustomerContact(id)
    ));
    customerContactRows.value = customerContactRows.value.filter((item) => !selected.has(item.id));
    selectedAddressBookIds.value = [];
    if (selected.has(editingAddressBookId.value)) {
      resetAddressBookForm();
      addressBookFormOpen.value = false;
    }
    notify(`已删除 ${selected.size} 条联系人地址`);
  } catch (error) {
    notify(error.message);
  }
}

async function hideHistoricalAddress(option) {
  const address = String(option?.value || "").trim();
  const key = addressOptionKey(address);
  if (!address || !key) return;
  try {
    const hidden = await customersApi.hideAddressHistory({ key, address });
    hiddenAddressHistoryRows.value = [hidden, ...hiddenAddressHistoryRows.value.filter((item) => item.key !== hidden.key)];
    notify("历史地址已删除");
  } catch (error) {
    notify(error.message);
  }
}

async function applyAddressBookEntry(option) {
  applyLocationOption(option);
  if (option?.source !== "联系人") return;
  try {
    const contactSynced = await syncAddressBookEntryToCustomerContact({
      area: option.area || "",
      contact: option.contact || "",
      phone: option.phone || "",
      address: option.address || option.value || "",
      note: option.note || ""
    });
    if (contactSynced) notify("地址已写入，联系人已同步");
  } catch (error) {
    notify(`地址已写入，联系人同步失败：${error.message}`);
  }
}

function handleLocationInput(target) {
  const form = currentLocationForm();
  if (locationPicker.open && locationPicker.target === target) {
    locationPicker.keyword = form[target] || "";
  }
  if (locationPicker.owner === "order") {
    scheduleAutoFreightSync();
  }
}

function applyLocationOption(option) {
  const detail = String(locationPicker.detail || "").trim();
  const value = detail && !String(option.value).includes(detail)
    ? `${option.value} / ${detail}`
    : option.value;
  const form = currentLocationForm();
  form[locationPicker.target] = value;
  if (locationPicker.owner === "order" && locationPicker.target === "unloading") {
    orderForm.unloadingContact = option.contact || "";
    orderForm.unloadingPhone = option.phone || "";
  } else if (locationPicker.owner === "order") {
    orderForm.loadingContact = option.contact || "";
    orderForm.loadingPhone = option.phone || "";
  }
  closeLocationPicker();
  if (locationPicker.owner === "order") {
    scheduleAutoFreightSync();
  }
}

function handleTemplateLocationLevelChange(level) {
  if (level === 1) {
    locationPicker.level2 = "";
    locationPicker.level3 = "";
  } else if (level === 2) {
    locationPicker.level3 = "";
  }
  locationPicker.keyword = templateLocationValue.value;
}

function applyTemplateLocationSelection() {
  const value = templateLocationValue.value;
  if (!value) {
    notify("请选择一级目录");
    return;
  }
  const detail = String(locationPicker.detail || "").trim();
  const form = currentLocationForm();
  form[locationPicker.target] = detail && !value.includes(detail)
    ? `${value} / ${detail}`
    : value;
  closeLocationPicker();
  if (locationPicker.owner === "order") {
    scheduleAutoFreightSync();
  }
}

function applyCustomLocation() {
  if (locationPicker.mode === "template" && templateLocationValue.value) {
    applyTemplateLocationSelection();
    return;
  }
  const value = String(locationPicker.keyword || locationPicker.detail || "").trim();
  if (!value) {
    notify("请输入地址或选择片区");
    return;
  }
  const form = currentLocationForm();
  form[locationPicker.target] = value;
  closeLocationPicker();
  if (locationPicker.owner === "order") {
    scheduleAutoFreightSync();
  }
}

function money(value) {
  return Number(value || 0).toLocaleString();
}

function moneyPair(hkd = 0, rmb = 0) {
  const parts = [];
  if (Number(hkd || 0) !== 0) parts.push(`HKD ${money(hkd)}`);
  if (Number(rmb || 0) !== 0) parts.push(`RMB ${money(rmb)}`);
  return parts.join(" / ") || "-";
}

function moneyPairSuffix(hkd = 0, rmb = 0) {
  const parts = [];
  if (Number(hkd || 0) !== 0) parts.push(`${money(hkd)} HKD`);
  if (Number(rmb || 0) !== 0) parts.push(`${money(rmb)} RMB`);
  return parts.join(" / ") || "-";
}

function quantityNumber(value) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

async function apiFetchListFrom(request, label, options = {}) {
  try {
    const data = await request();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(`${label} 加载失败`, error);
    if (!options.silent) {
      notify(`${label} 加载失败：${error.message}`);
    }
    return [];
  }
}

function customsBusinessQueryPath() {
  return `/customs-businesses?period=${encodeURIComponent(periodFilterValue("customsBusiness"))}`;
}

function resetCustomsBusinessForm() {
  Object.assign(customsBusinessForm, blankCustomsBusinessForm());
}

async function loadCustomsBusinesses(options = {}) {
  if (!loggedIn.value || !canAccessModule("customsBusiness")) {
    customsBusinessRows.value = [];
    return [];
  }
  customsBusinessRows.value = await apiFetchListFrom(() => customsBusinessApi.listCustomsBusinesses(periodFilterValue("customsBusiness")), "报关业务", options);
  return customsBusinessRows.value;
}

function openCustomsBusinessModal() {
  resetCustomsBusinessForm();
  customsBusinessForm.date = periodFilterDateValue(customsBusinessPeriodFilter.value);
  customsBusinessModalOpen.value = true;
}

async function saveCustomsBusiness() {
  if (!customsBusinessForm.company.trim()) {
    notify("请填写公司名称");
    return;
  }
  if (!customsBusinessForm.declarationNo.trim() && !customsBusinessForm.sixSheetNo.trim()) {
    notify("请填写报关单号或六联单号");
    return;
  }
  try {
    customsBusinessSaving.value = true;
    const item = await customsBusinessApi.createCustomsBusiness({
      ...customsBusinessForm,
      total: customsBusinessFormTotal.value
    });
    if (dateMatchesPeriodFilter(item.date, customsBusinessPeriodFilter.value)) {
      customsBusinessRows.value = [item, ...customsBusinessRows.value.filter((row) => row.id !== item.id)];
    } else {
      await loadCustomsBusinesses({ silent: true });
    }
    customsBusinessModalOpen.value = false;
    notify("已新增报关业务");
  } catch (error) {
    notify(error.message);
  } finally {
    customsBusinessSaving.value = false;
  }
}

async function migrateLegacyClientStorageToPostgres(options = {}) {
  const {
    canLoadDriverRouteAdjustRules = false,
    canLoadStatementDownloads = false,
    canLoadBossVehicleExchangeRates = false
  } = options;
  if (canLoadDriverRouteAdjustRules) {
    const rows = loadStoredJson(LEGACY_DRIVER_ROUTE_ADJUST_RULES_KEY, []);
    if (Array.isArray(rows) && rows.length > 0) {
      try {
        await financeApi.syncDriverRouteAdjustRules(rows);
        localStorage.removeItem(LEGACY_DRIVER_ROUTE_ADJUST_RULES_KEY);
        driverRouteAdjustRules.value = await apiFetchListFrom(financeApi.listDriverRouteAdjustRules, "司机路线扣减规则", { silent: true });
        notify(`已迁移 ${rows.length} 条本地司机路线扣减规则到数据库`);
      } catch (error) {
        console.warn("司机路线扣减规则迁移失败", error);
        notify(`司机路线扣减规则迁移失败：${error.message}`);
      }
    }
  }

  if (canLoadStatementDownloads) {
    const rows = loadStoredJson(LEGACY_STATEMENT_DOWNLOAD_ROWS_KEY, []);
    if (Array.isArray(rows) && rows.length > 0) {
      try {
        await financeApi.syncStatementDownloads(rows);
        localStorage.removeItem(LEGACY_STATEMENT_DOWNLOAD_ROWS_KEY);
        statementDownloadRows.value = await apiFetchListFrom(financeApi.listStatementDownloads, "对账下载记录", { silent: true });
        notify(`已迁移 ${rows.length} 条本地对账单下载记录到数据库`);
      } catch (error) {
        console.warn("对账单下载记录迁移失败", error);
        notify(`对账单下载记录迁移失败：${error.message}`);
      }
    }
  }

  if (canLoadBossVehicleExchangeRates) {
    const legacyRate = localStorage.getItem("hanye_boss_vehicle_exchange_rate");
    const rate = Number(legacyRate);
    const periodMonth = currentPeriodMonthKey();
    if (legacyRate && Number.isFinite(rate) && rate > 0 && !bossVehicleExchangeRateRow(periodMonth)) {
      try {
        const item = await financeApi.saveVehicleProfitExchangeRate({ periodMonth, rate });
        upsertBossVehicleExchangeRateRow(item, { syncInput: true });
        localStorage.removeItem("hanye_boss_vehicle_exchange_rate");
      } catch (error) {
        console.warn("车辆利润汇率迁移失败", error);
      }
    } else if (legacyRate) {
      localStorage.removeItem("hanye_boss_vehicle_exchange_rate");
    }
    syncBossVehicleExchangeRateFromRows();
  }
}

async function reloadTemplateRows(options = {}) {
  templateRows.value = await apiFetchListFrom(() => templatesApi.listTemplates("?includeContent=0&scope=export"), "模板中心", options);
  templateRowsLoaded.value = true;
}

async function ensureTemplateRowsLoaded(options = {}) {
  if (templateRowsLoaded.value && !options.force) return templateRows.value;
  await reloadTemplateRows(options);
  return templateRows.value;
}

function fileEndpoint(file, action) {
  if (action === "download") return file?.downloadUrl || "";
  return file?.previewUrl || file?.downloadUrl || "";
}

function openStoredFile(file, action = "preview") {
  const url = fileEndpoint(file, action);
  if (!url) {
    notify(file?.storageProvider === "oss"
      ? "OSS 附件地址暂时不可用，请刷新后重试"
      : "该附件尚未迁移到 OSS，请先配置 OSS 并重启后端完成迁移");
    return;
  }
  if (action === "preview") {
    previewFile.value = file;
    filePreviewOpen.value = true;
    return;
  }
  window.open(url, "_blank", "noopener");
}

function closeFilePreview() {
  filePreviewOpen.value = false;
  previewFile.value = null;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

function base64ByteSize(base64) {
  const clean = String(base64 || "").replace(/\s/g, "");
  if (!clean) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

function compressedImageFilename(filename) {
  const base = String(filename || "image").replace(/\.[^.]+$/, "");
  return `${base}.jpg`;
}

function uploadFileValidationMessage(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase() || "";
  if (!SAFE_UPLOAD_EXTENSIONS.has(extension)) return "仅支持图片或 PDF 文件";
  if (file.size > MAX_UPLOAD_BYTES) return "文件不能超过 8MB";
  return "";
}

function mimeForUpload(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLowerCase() || "";
  return file?.type || UPLOAD_MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

async function compressImageFileForUpload(file) {
  const mime = mimeForUpload(file);
  const compressibleTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!compressibleTypes.has(mime)) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      filename: file.name,
      mime,
      size: file.size,
      contentBase64: dataUrl.split(",")[1] || "",
      compressed: false
    };
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const originalBase64 = originalDataUrl.split(",")[1] || "";
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片压缩失败"));
    img.src = originalDataUrl;
  });
  const maxSide = 1600;
  const ratio = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
  const width = Math.max(1, Math.round((image.width || 1) * ratio));
  const height = Math.max(1, Math.round((image.height || 1) * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.78);
  const compressedBase64 = compressedDataUrl.split(",")[1] || "";
  const compressedSize = base64ByteSize(compressedBase64);
  if (!compressedBase64 || compressedSize >= file.size) {
    return {
      filename: file.name,
      mime,
      size: file.size,
      contentBase64: originalBase64,
      compressed: false
    };
  }
  return {
    filename: compressedImageFilename(file.name),
    mime: "image/jpeg",
    size: compressedSize,
    contentBase64: compressedBase64,
    compressed: true,
    originalSize: file.size
  };
}

async function loadFiles(entityType, entityId) {
  if (!entityType || !entityId) return [];
  return filesApi.listFiles(entityType, entityId);
}

async function loadDeletedFiles(entityType, entityId) {
  if (!entityType || !entityId) return [];
  return filesApi.listFiles(entityType, entityId, { deletedOnly: true });
}

async function uploadFileFor(entityType, entityId, category, event, targetRows, options = {}) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return false;
  if (!entityId) {
    notify("请先保存资料，再上传附件");
    return false;
  }
  const validationMessage = uploadFileValidationMessage(file);
  if (validationMessage) {
    notify(validationMessage);
    return false;
  }
  try {
    options.onStart?.(file);
    loading.value = true;
    const preparingMessage = String(file.type || "").startsWith("image/")
      ? `正在处理图片：${file.name}`
      : `正在处理文件：${file.name}`;
    options.onStatus?.(preparingMessage, "busy");
    notify(`正在上传：${file.name}`);
    const uploadFile = await compressImageFileForUpload(file);
    options.onStatus?.(`正在上传到 OSS：${uploadFile.filename}`, "busy");
    const uploaded = await filesApi.uploadFile({
      entityType,
      entityId,
      category,
      filename: uploadFile.filename,
      mime: uploadFile.mime,
      size: uploadFile.size,
      contentBase64: uploadFile.contentBase64
    });
    targetRows.value = [uploaded, ...targetRows.value];
    const successMessage = uploadFile.compressed
      ? `已压缩并上传：${file.name}（${fileSizeText(uploadFile.originalSize)} → ${fileSizeText(uploadFile.size)}）`
      : `已上传：${file.name}`;
    options.onStatus?.(successMessage, "success");
    notify(successMessage);
    return true;
  } catch (error) {
    options.onStatus?.(`上传失败：${error.message}`, "error");
    notify(error.message);
    return false;
  } finally {
    loading.value = false;
    options.onFinish?.();
  }
}

async function deleteFile(file, targetRows) {
  if (!window.confirm(`确定删除文件 ${file.filename}？`)) return;
  try {
    await filesApi.deleteFileById(file.id);
    if (targetRows && "value" in Object(targetRows)) {
      targetRows.value = targetRows.value.filter((item) => item.id !== file.id);
    } else if (Array.isArray(targetRows)) {
      const index = targetRows.findIndex((item) => item.id === file.id);
      if (index >= 0) targetRows.splice(index, 1);
    }
    notify("文件已删除");
  } catch (error) {
    notify(error.message);
  }
}

async function openAttachmentRecycleBin() {
  if (!editingOrderNo.value) {
    notify("请先保存订单，再查看附件回收站");
    return;
  }
  try {
    attachmentRecycleRows.value = await loadDeletedFiles("order", editingOrderNo.value);
    attachmentRecycleModalOpen.value = true;
  } catch (error) {
    notify(error.message);
  }
}

async function restoreFile(file) {
  try {
    const restored = await filesApi.restoreFileById(file.id);
    attachmentRecycleRows.value = attachmentRecycleRows.value.filter((item) => item.id !== file.id);
    if (editingOrderNo.value && restored.entityType === "order" && restored.entityId === editingOrderNo.value) {
      orderAttachmentRows.value = [restored, ...orderAttachmentRows.value];
    }
    notify("附件已恢复");
  } catch (error) {
    notify(error.message);
  }
}

async function purgeFile(file) {
  if (!window.confirm(`确定彻底删除文件 ${file.filename}？彻底删除后不能恢复。`)) return;
  try {
    await filesApi.permanentlyDeleteFile(file.id);
    attachmentRecycleRows.value = attachmentRecycleRows.value.filter((item) => item.id !== file.id);
    notify("附件已彻底删除");
  } catch (error) {
    notify(error.message);
  }
}

function fileSizeText(size) {
  const value = Number(size || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

function keepSelection(previousValue, rows, key, fallback = "") {
  return rows.some((item) => item?.[key] === previousValue) ? previousValue : fallback;
}

async function loadDatabaseData(options = {}) {
  const { preserveSelection = false } = options;
  const canLoadCustomers = canAccessModule("customers");
  const canLoadOrders = canAccessModule("orders");
  const canLoadCustomsBusiness = canAccessModule("customsBusiness");
  const canLoadVehicleDriver = canAccessModule("vehicleDriver");
  const canLoadVehicleExpenses = canLoadVehicleDriver || VEHICLE_EXPENSE_MODULES.some((moduleId) => canAccessModule(moduleId));
  const canLoadDriverWageRules = canAccessModule("financeCostCenter");
  const canLoadCostCenterRates = canAccessModule("financeCostCenter");
  const canLoadBossVehicleExchangeRates = canAccessModule("bossVehicleProfit");
  const canLoadMasterData = canAccessModule("master");
  const canLoadAccounts = canAccessModule("accounts");
  const canLoadAuditLogs = canAccessModule("security");
  const canLoadDriverRouteAdjustRules = canAccessModule("financeWages");
  const canLoadStatementDownloads = canAccessModule("financeCosts");
  const previousSelection = {
    customerId: selectedCustomerId.value,
    vehiclePlate: selectedVehiclePlate.value,
    driverId: selectedDriverId.value,
    driverWageRuleId: selectedDriverWageRuleId.value,
    feeItemId: selectedFeeItemId.value,
    freightRateId: selectedFreightRateId.value,
    templateId: selectedTemplateId.value,
    ruleId: selectedRuleId.value,
    masterId: selectedMasterId.value,
    accountId: selectedAccountId.value
  };
  loading.value = true;
  try {
    const [
      customerData,
      customerContactData,
      orderData,
      vehicleData,
      vehicleExpenseData,
      driverData,
      driverWageRuleData,
      costCenterRateData,
      bossVehicleExchangeRateData,
      driverAdjustmentData,
      feeItemData,
      freightRateData,
      masterData,
      accountData,
      addressBookData,
      hiddenAddressHistoryData,
      driverRouteAdjustRuleData,
      statementDownloadData,
      customsBusinessData,
      auditData
    ] = await Promise.all([
      canLoadCustomers ? apiFetchListFrom(customersApi.listCustomers, "客户/供应商") : Promise.resolve([]),
      canLoadCustomers ? apiFetchListFrom(customersApi.listCustomerContacts, "联系人") : Promise.resolve([]),
      canLoadOrders ? apiFetchListFrom(ordersApi.listOrders, "订单") : Promise.resolve([]),
      canLoadVehicleDriver ? apiFetchListFrom(vehiclesApi.listVehicles, "车辆") : Promise.resolve([]),
      canLoadVehicleExpenses ? apiFetchListFrom(vehiclesApi.listVehicleExpenses, "车辆支出") : Promise.resolve([]),
      canLoadVehicleDriver ? apiFetchListFrom(vehiclesApi.listDrivers, "司机") : Promise.resolve([]),
      canLoadDriverWageRules ? apiFetchListFrom(vehiclesApi.listDriverWageRules, "司机费用规则") : Promise.resolve([]),
      canLoadCostCenterRates ? apiFetchListFrom(financeApi.listCostCenterRates, "成本中心") : Promise.resolve([]),
      canLoadBossVehicleExchangeRates ? apiFetchListFrom(financeApi.listVehicleProfitExchangeRates, "车辆利润汇率") : Promise.resolve([]),
      canLoadVehicleDriver ? apiFetchListFrom(vehiclesApi.listDriverAdjustments, "司机预支/报销") : Promise.resolve([]),
      apiFetchListFrom(masterDataApi.listFeeItems, "收费项目"),
      apiFetchListFrom(masterDataApi.listFreightRates, "运费模板"),
      canLoadMasterData ? apiFetchListFrom(masterDataApi.listMasterData, "基础数据") : Promise.resolve([]),
      canLoadAccounts ? apiFetchListFrom(accountsApi.listAccounts, "权限账号") : Promise.resolve([]),
      apiFetchListFrom(customersApi.listAddressBook, "地址本"),
      apiFetchListFrom(customersApi.listHiddenAddressHistory, "隐藏历史地址"),
      canLoadDriverRouteAdjustRules ? apiFetchListFrom(financeApi.listDriverRouteAdjustRules, "司机路线扣减规则") : Promise.resolve([]),
      canLoadStatementDownloads ? apiFetchListFrom(financeApi.listStatementDownloads, "对账下载记录") : Promise.resolve([]),
      canLoadCustomsBusiness ? apiFetchListFrom(() => customsBusinessApi.listCustomsBusinesses(periodFilterValue("customsBusiness")), "报关业务") : Promise.resolve([]),
      canLoadAuditLogs ? apiFetchListFrom(securityApi.listAuditLogs, "审计记录") : Promise.resolve([])
    ]);
    customerRows.value = customerData;
    customerContactRows.value = customerContactData;
    orderRows.value = orderData;
    vehicleRows.value = vehicleData;
    vehicleExpenseRows.value = vehicleExpenseData;
    driverRows.value = driverData;
    driverWageRuleRows.value = driverWageRuleData;
    costCenterRateRows.value = costCenterRateData;
    bossVehicleExchangeRateRows.value = bossVehicleExchangeRateData;
    syncBossVehicleExchangeRateFromRows();
    driverAdjustmentRows.value = driverAdjustmentData;
    feeItemRows.value = sortFeeItems(feeItemData);
    freightRateRows.value = freightRateData;
    ruleRows.value = [];
    masterRows.value = masterData;
    accountRows.value = accountData;
    addressBookRows.value = addressBookData;
    hiddenAddressHistoryRows.value = hiddenAddressHistoryData;
    driverRouteAdjustRules.value = driverRouteAdjustRuleData;
    statementDownloadRows.value = statementDownloadData;
    customsBusinessRows.value = customsBusinessData;
    await migrateLegacyClientStorageToPostgres({ canLoadDriverRouteAdjustRules, canLoadStatementDownloads, canLoadBossVehicleExchangeRates });
    auditRows.value = auditData;
    const activeCustomerFallbackId = firstCustomerIdForActiveType(customerData);
    const previousCustomer = customerData.find((item) => item.id === previousSelection.customerId);
    selectedCustomerId.value = preserveSelection && previousCustomer?.type === activePartnerType.value
      ? previousCustomer.id
      : activeCustomerFallbackId;
    selectedVehiclePlate.value = preserveSelection
      ? keepSelection(previousSelection.vehiclePlate, vehicleData, "plate", vehicleData[0]?.plate || "")
      : (vehicleData[0]?.plate || "");
    selectedDriverId.value = preserveSelection
      ? keepSelection(previousSelection.driverId, driverData, "id", driverData[0]?.id || null)
      : (driverData[0]?.id || null);
    selectedDriverWageRuleId.value = preserveSelection
      ? keepSelection(previousSelection.driverWageRuleId, driverWageRuleData, "id", driverWageRuleData.find((item) => item.driverId === selectedDriverId.value)?.id || null)
      : (driverWageRuleData.find((item) => item.driverId === selectedDriverId.value)?.id || null);
    selectedFeeItemId.value = preserveSelection
      ? keepSelection(previousSelection.feeItemId, feeItemData, "id", feeItemData[0]?.id || null)
      : (feeItemData[0]?.id || null);
    selectedFreightRateId.value = preserveSelection
      ? keepSelection(previousSelection.freightRateId, freightRateData, "id", freightRateData[0]?.id || null)
      : (freightRateData[0]?.id || null);
    const visibleTemplateData = templateRows.value.filter((item) => !isInternalTemplateRow(item));
    selectedTemplateId.value = preserveSelection
      ? keepSelection(previousSelection.templateId, visibleTemplateData, "id", visibleTemplateData[0]?.id || null)
      : (visibleTemplateData[0]?.id || null);
    selectedRuleId.value = null;
    selectedMasterId.value = preserveSelection
      ? keepSelection(previousSelection.masterId, masterData, "id", masterData[0]?.id || null)
      : (masterData[0]?.id || null);
    selectedAccountId.value = preserveSelection
      ? keepSelection(previousSelection.accountId, accountData, "id", accountData[0]?.id || null)
      : (accountData[0]?.id || null);
    closeFeeItemForm();
    editFreightRate(freightRateData.find((item) => item.id === selectedFreightRateId.value) || freightRateData[0] || null, { silent: true });
    editDriverWageRule(driverWageRuleData.find((item) => item.id === selectedDriverWageRuleId.value) || driverWageRuleData.find((item) => item.driverId === selectedDriverId.value) || null);
    editTemplate(visibleTemplateData.find((item) => item.id === selectedTemplateId.value) || visibleTemplateData[0] || null);
    editRule(null);
    editMaster(masterData.find((item) => item.id === selectedMasterId.value) || masterData[0] || null);
    editAccount(accountData.find((item) => item.id === selectedAccountId.value) || accountData[0] || null);
    apiStatus.value = "已连接本地数据库";
  } catch (error) {
    apiStatus.value = `接口未连接，请先启动后端：${error.message}`;
  } finally {
    loading.value = false;
  }
}

function openAccountPasswordModal() {
  Object.assign(accountPasswordForm, {
    current: "",
    next: "",
    confirm: ""
  });
  accountPasswordModalOpen.value = true;
}

async function saveAccountPassword() {
  if (!accountPasswordForm.current) {
    notify("请输入原密码");
    return;
  }
  if (accountPasswordForm.next.length < 4) {
    notify("新密码至少 4 位");
    return;
  }
  if (accountPasswordForm.current === accountPasswordForm.next) {
    notify("新密码不能和原密码相同");
    return;
  }
  if (accountPasswordForm.next !== accountPasswordForm.confirm) {
    notify("两次输入的新密码不一致");
    return;
  }
  try {
    accountPasswordSaving.value = true;
    await authApi.updatePassword({
      currentPassword: accountPasswordForm.current,
      nextPassword: accountPasswordForm.next
    });
    accountPasswordModalOpen.value = false;
    Object.assign(accountPasswordForm, { current: "", next: "", confirm: "" });
    notify("密码已修改");
  } catch (error) {
    notify(error.message);
  } finally {
    accountPasswordSaving.value = false;
  }
}

function openAccountSettings() {
  Object.assign(accountProfileForm, {
    displayName: currentAccount.value.displayName || "",
    phone: currentAccount.value.phone || "",
    email: currentAccount.value.email || "",
    note: currentAccount.value.note || ""
  });
  accountProfileModalOpen.value = true;
}

async function saveAccountProfile() {
  try {
    accountProfileSaving.value = true;
    const account = await authApi.updateProfile(accountProfileForm);
    setSessionAccount(account);
    accountRows.value = accountRows.value.some((row) => row.id === account.id)
      ? accountRows.value.map((row) => row.id === account.id ? account : row)
      : accountRows.value;
    accountProfileModalOpen.value = false;
    notify("账号资料已保存");
  } catch (error) {
    notify(error.message);
  } finally {
    accountProfileSaving.value = false;
  }
}

async function login() {
  try {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(loginForm)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "账号或密码错误");
    }
    const result = await response.json();
    if (!result.token) throw new Error("登录凭证生成失败");
    saveLoginSession(result.token || "", result.account || { username: loginForm.username, role: "司机" }, result.expiresAt);
    loggedIn.value = true;
    if (!canAccessModule(activeModule.value)) {
      activeModule.value = firstAccessibleModule.value;
      location.hash = activeModule.value === "vehicleDriver" ? "vehicleManage" : activeModule.value;
    }
    loadDatabaseData();
    if (canAccessModule("dispatchBoard")) loadDispatchPlansForCurrentFilter();
    if (activeModule.value === "templates") {
      ensureTemplateRowsLoaded({ silent: true }).catch((error) => notify(error.message || "模板中心加载失败"));
    }
  } catch (error) {
    notify(error.message || "账号或密码错误");
  }
}

function logout(options = {}) {
  clearStoredSession();
  authToken.value = "";
  currentSessionAccount.value = null;
  currentUsername.value = "";
  closeTransientUi();
  loggedIn.value = false;
  if (!options.silent) notify("已退出登录");
}

function closeTransientUi() {
  customerModalOpen.value = false;
  orderModalOpen.value = false;
  recycleModalOpen.value = false;
  vehicleModalOpen.value = false;
  vehicleExpenseModalOpen.value = false;
  driverModalOpen.value = false;
  closeFilePreview();
  dispatchMessageOpen.value = false;
  customerOrderColumnMenuOpen.value = false;
  orderColumnMenuOpen.value = false;
  dispatchColumnMenuOpen.value = false;
  accountPasswordModalOpen.value = false;
  accountProfileModalOpen.value = false;
  accountCreateModalOpen.value = false;
  accountEditModalOpen.value = false;
  customsBusinessModalOpen.value = false;
  loadFeeTemplateMenuOpen.value = false;
  activeOrderDetailTab.value = "收费项目";
}

let databaseRefreshTimer = null;

function scheduleDatabaseRefresh() {
  if (!loggedIn.value) return;
  window.clearTimeout(databaseRefreshTimer);
  databaseRefreshTimer = window.setTimeout(() => {
    loadDatabaseData({ preserveSelection: true }).catch((error) => {
      apiStatus.value = `接口未连接，请先启动后端：${error.message}`;
    });
  }, 100);
}

function openModule(id) {
  const routeKey = String(id || "").split("?")[0];
  const requested = normalizeRoute(routeKey);
  const partnerType = partnerTypeForCustomerRoute(routeKey);
  if (partnerType) {
    activePartnerType.value = partnerType;
  }
  const next = loggedIn.value && !canAccessModule(requested) ? firstAccessibleModule.value : requested;
  if (next !== activeModule.value) {
    closeTransientUi();
  }
  activeModule.value = next;
  const hashTarget = next === "vehicleDriver"
    ? (routeKey === "driverManage" ? "driverManage" : "vehicleManage")
    : next === "customers"
      ? (partnerType ? routeKey : customerRouteForPartnerType(activePartnerType.value))
    : next;
  if (next === "vehicleDriver") {
    syncVehicleDriverTabFromRoute(hashTarget);
  }
  syncedHash = `#${hashTarget}`;
  location.hash = hashTarget;
  scheduleDatabaseRefresh();
}

function openHomeCustomerCreate() {
  if (!canAccessModule("customers")) {
    notify("当前账号无权新建客户");
    return;
  }
  openPartnerCreateModal("客户");
}

async function openHomeDispatchCreate() {
  if (!canAccessModule("dispatchBoard")) {
    notify("当前账号无权新建排车单");
    return;
  }
  dispatchDate.value = todayInputValue();
  await openDispatchModal();
}

function toggleCustomerBatchSelection() {
  if (visibleCustomers.value.length === 0) {
    notify(`当前没有可选择的${activePartnerType.value}`);
    return;
  }
  const allSelected = selectedCustomerIds.value.length === visibleCustomers.value.length;
  selectedCustomerIds.value = allSelected ? [] : visibleCustomers.value.map((item) => item.id);
  notify(allSelected ? "已清空选择" : `已选择 ${selectedCustomerIds.value.length} 项`);
}

watch(() => customerForm.type, (type) => {
  if (type === "客户" && !customerForm.settlementCurrency) {
    customerForm.settlementCurrency = "人民币结算";
  }
});

function toggleVehicleDriverBatchSelection() {
  if (activeVehicleTab.value === "车辆管理") {
    if (visibleVehicles.value.length === 0) {
      notify("当前没有可选择的车辆");
      return;
    }
    const allSelected = selectedVehiclePlates.value.length === visibleVehicles.value.length;
    selectedVehiclePlates.value = allSelected ? [] : visibleVehicles.value.map((item) => item.plate);
    notify(allSelected ? "已清空选择" : `已选择 ${selectedVehiclePlates.value.length} 台车辆`);
    return;
  }
  if (visibleDrivers.value.length === 0) {
    notify("当前没有可选择的司机");
    return;
  }
  const allSelected = selectedDriverIds.value.length === visibleDrivers.value.length;
  selectedDriverIds.value = allSelected ? [] : visibleDrivers.value.map((item) => item.id);
  notify(allSelected ? "已清空选择" : `已选择 ${selectedDriverIds.value.length} 位司机`);
}

function invoiceValue(customer, key) {
  return customer?.invoice?.[key] || "";
}

function buildCustomerPayload() {
  return {
    ...customerForm,
    settlementCurrency: customerForm.type === "客户" ? (customerForm.settlementCurrency || "人民币结算") : "",
    taxNo: customerForm.invoiceTax || customerForm.taxNo,
    invoice: {
      title: customerForm.invoiceTitle || customerForm.name,
      taxNo: customerForm.invoiceTax,
      bank: customerForm.invoiceBank,
      account: customerForm.invoiceAccount,
      addressPhone: [customerForm.address, customerForm.invoiceAddressPhone].filter(Boolean).join(" / ")
    }
  };
}

function findProvinceCity(addressText = "") {
  let province = provinceOptions.find((name) => addressText.includes(name));
  const cityPool = province ? chinaProvinceCities[province] : Object.values(chinaProvinceCities).flat();
  const city = cityPool.find((name) => addressText.includes(name));
  if (!province && city) {
    province = Object.entries(chinaProvinceCities).find(([, cities]) => cities.includes(city))?.[0] || "";
  }
  return { province: province || "", city: city || "" };
}

function parseCustomerInvoicePaste(text) {
  const raw = String(text || "").trim();
  if (!raw) return {};
  const normalized = raw
    .replace(/[：:]/g, ":")
    .replace(/[，,;]/g, "\n")
    .replace(/\s{2,}/g, "\n");
  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const result = {};
  const cleanValue = (value) => String(value || "")
    .replace(/^(公司名称|名称|发票抬头|抬头|纳税人识别号|税号|开户行|开户银行|银行账号|账号|帐号|账户|地址|电话)\s*[:：]?\s*/g, "")
    .trim();
  const takeValue = (line) => cleanValue(line.includes(":") ? line.split(":").slice(1).join(":") : line);

  lines.forEach((line) => {
    const value = takeValue(line);
    if (/抬头|名称|公司/.test(line) && value && !result.name) result.name = value;
    else if (/税号|纳税人|识别号/.test(line) && value && !result.taxNo) result.taxNo = value.match(/[0-9A-Z]{15,20}/)?.[0] || value;
    else if (/开户行|开户银行/.test(line) && value && !result.bank) result.bank = value;
    else if (/银行账号|账号|账户|帐号/.test(line) && value && !result.account) result.account = value.match(/\d[\d\s-]{8,}/)?.[0]?.trim() || value;
    else if (/地址/.test(line) && value && !result.address) result.address = value;
    else if (/电话|联系电话|手机/.test(line) && value && !result.phone) result.phone = value.match(/(?:\+?86[-\s]?)?(?:1[3-9]\d{9}|0\d{2,3}[-\s]?\d{7,8})/)?.[0] || value;
  });

  const taxLine = lines.find((line) => /[0-9A-Z]{15,20}/.test(line));
  const accountLine = lines.find((line) => /\d[\d\s-]{8,}/.test(line) && line !== taxLine && !/电话|手机|联系/.test(line));
  if (!result.name) result.name = cleanValue(lines.find((line) => /公司|名称|抬头/.test(line)) || lines[0] || "");
  if (!result.taxNo) result.taxNo = taxLine?.match(/[0-9A-Z]{15,20}/)?.[0] || "";
  if (!result.account) result.account = accountLine?.match(/\d[\d\s-]{8,}/)?.[0]?.trim() || "";
  if (!result.bank) result.bank = cleanValue(lines.find((line) => /开户行|开户银行|支行/.test(line)) || "");
  if (!result.address) result.address = cleanValue(lines.find((line) => /地址|省|市|区|县|镇|街|路|号|工业园|大厦|楼|室/.test(line) && !/开户|银行|账号|账户|电话|手机|税号|识别号/.test(line)) || "");
  if (!result.phone) result.phone = lines.join("\n").match(/(?:\+?86[-\s]?)?(?:1[3-9]\d{9}|0\d{2,3}[-\s]?\d{7,8})/)?.[0] || "";
  const region = findProvinceCity(result.address);
  result.province = region.province;
  result.city = region.city;
  return result;
}

function applyCustomerInvoicePaste() {
  const parsed = parseCustomerInvoicePaste(customerForm.invoicePasteText);
  if (parsed.name) {
    customerForm.name = parsed.name;
    customerForm.invoiceTitle = parsed.name;
  }
  if (parsed.taxNo) {
    customerForm.taxNo = parsed.taxNo;
    customerForm.invoiceTax = parsed.taxNo;
  }
  if (parsed.bank) customerForm.invoiceBank = parsed.bank;
  if (parsed.account) customerForm.invoiceAccount = parsed.account;
  if (parsed.address) customerForm.address = parsed.address;
  if (parsed.phone) customerForm.invoiceAddressPhone = parsed.phone;
  if (parsed.province) {
    customerForm.province = parsed.province;
    customerForm.city = parsed.city || "";
  }
}

function openPartnerCreateModal(type = activePartnerType.value) {
  activePartnerType.value = type === "供应商" ? "供应商" : "客户";
  openCustomerModal(null, activePartnerType.value);
}

function openCustomerModal(customer = null, createType = activePartnerType.value) {
  editingCustomerId.value = customer?.id || "";
  customerModalTab.value = "客户资料";
  const type = customer?.type || (createType === "供应商" ? "供应商" : "客户");
  Object.assign(customerForm, {
    type,
    name: customer?.name || "",
    province: customer?.province || "",
    city: customer?.city || "",
    address: customer?.address || "",
    term: customer?.term || "",
    settlementCurrency: type === "客户" ? (customer?.settlementCurrency || "人民币结算") : "",
    taxNo: customer?.taxNo || invoiceValue(customer, "taxNo"),
    contact: customer?.contact || "",
    mobile: customer?.mobile || "",
    defaultTemplateId: customer?.defaultTemplateId || "",
    invoiceTitle: invoiceValue(customer, "title") || customer?.name || "",
    invoiceTax: invoiceValue(customer, "taxNo") || customer?.taxNo || "",
    invoiceBank: invoiceValue(customer, "bank"),
    invoiceAccount: invoiceValue(customer, "account"),
    invoiceAddressPhone: invoiceValue(customer, "addressPhone"),
    invoicePasteText: ""
  });
  customerModalOpen.value = true;
}

function handleCustomerProvinceChange() {
  customerForm.city = "";
}

async function saveCustomer() {
  try {
    loading.value = true;
    const payload = buildCustomerPayload();
    const item = editingCustomerId.value
      ? await customersApi.updateCustomer(editingCustomerId.value, payload)
      : await customersApi.createCustomer(payload);
    customerRows.value = editingCustomerId.value
      ? customerRows.value.map((row) => row.id === item.id ? item : row)
      : [item, ...customerRows.value];
    activePartnerType.value = item.type;
    selectedCustomerId.value = item.id;
    customerModalOpen.value = false;
    notify(`已保存${item.type}：${item.name}`);
  } catch (error) {
    notify(error.message);
  } finally {
    loading.value = false;
  }
}

function resetOrderForm() {
  Object.assign(orderForm, {
    dispatchNo: "",
    customerId: "",
    customer: "",
    businessType: "",
    port: "",
    direction: "",
    tonnage: "",
    currency: "",
    quantity: "",
    weight: "",
    vehicleSource: "",
  supplier: "",
  plate: "",
  driver: "",
  hkDriver: "",
  mainlandDriver: "",
  transportMode: "",
    loading: "",
    loadingContact: "",
    loadingPhone: "",
    unloading: "",
    unloadingContact: "",
    unloadingPhone: "",
    date: todayInputValue(),
    receivableHKD: 0,
    receivableRMB: 0,
    status: "待确认",
    remark: "",
    tripNoEnabled: false,
    tripNo: "",
    sixSheetEnabled: false,
    sixSheetNo: "",
    customsNo: "",
    customsUnit: "",
    customsItemCount: "",
    customsPageCount: ""
  });
  orderFees.value = [createBlankFeeRow()];
}

function syncOrderCustomerFromId() {
  const customer = customerRows.value.find((item) => item.id === orderForm.customerId);
  orderForm.customer = customer?.name || "";
  orderCustomerKeyword.value = customer?.name || "";
}

function openOrderCustomerPicker() {
  orderCustomerKeyword.value = orderForm.customer || "";
  orderCustomerPickerOpen.value = true;
}

function selectOrderCustomer(customer) {
  orderForm.customerId = customer?.id || "";
  orderForm.customer = customer?.name || "";
  orderCustomerKeyword.value = customer?.name || "";
  orderCustomerPickerOpen.value = false;
  if (!editingOrderNo.value && !pendingDispatchBindId.value) {
    const bindableRows = bindableDispatchRowsForCustomer(orderForm.customer);
    if (bindableRows.length) {
      const targetRow = bindableRows[0];
      const shouldBind = window.confirm(`发现该经营单位有未绑定排车单 ${targetRow.dispatchNo}，是否绑定并自动带入排车信息？`);
      if (shouldBind) applyDispatchRowToOrderForm(targetRow);
    }
  }
}

function isHongKongLocation(value = "") {
  return normalizeLocationText(value).includes("香港");
}

function handleOrderDirectionChange() {
  if (orderHasTransportFields.value) {
    if (orderForm.direction === "出口") {
      if (!orderForm.unloading) orderForm.unloading = "香港";
      if (isHongKongLocation(orderForm.loading)) orderForm.loading = "";
    } else if (orderForm.direction === "进口") {
      if (!orderForm.loading) orderForm.loading = "香港";
      if (isHongKongLocation(orderForm.unloading)) orderForm.unloading = "";
    }
  }
  scheduleAutoFreightSync();
}

function clearOrderTransportFields() {
  Object.assign(orderForm, {
    tonnage: "",
    weight: "",
    vehicleSource: "",
    supplier: "",
    plate: "",
    driver: "",
    hkDriver: "",
    mainlandDriver: "",
    transportMode: "",
    loading: "",
    loadingContact: "",
    loadingPhone: "",
    unloading: "",
    unloadingContact: "",
    unloadingPhone: "",
    tripNoEnabled: false,
    tripNo: "",
    sixSheetEnabled: false,
    sixSheetNo: ""
  });
  closeRouteTreeDropdown();
}

function stripCustomsRemark(remark = "") {
  return String(remark || "")
    .split("\n")
    .filter((line) => !line.startsWith(CUSTOMS_REMARK_PREFIX))
    .join("\n")
    .trim();
}

function buildCustomsRemarkLine() {
  if (!orderHasCustomsFields.value) return "";
  const parts = [
    orderForm.customsNo ? `报关单号 ${orderForm.customsNo}` : "",
    orderForm.customsUnit ? `消费使用单位 ${orderForm.customsUnit}` : "",
    orderForm.customsItemCount !== "" && orderForm.customsItemCount != null ? `品名项数 ${orderForm.customsItemCount}` : "",
    orderForm.customsPageCount !== "" && orderForm.customsPageCount != null ? `续页数量 ${orderForm.customsPageCount}` : ""
  ].filter(Boolean);
  return parts.length ? `${CUSTOMS_REMARK_PREFIX}${parts.join("；")}` : "";
}

function mergeCustomsRemark(remark = "") {
  const base = stripCustomsRemark(remark);
  const customsLine = buildCustomsRemarkLine();
  return [base, customsLine].filter(Boolean).join("\n");
}

function loadCustomsFieldsFromRemark(remark = "") {
  const line = String(remark || "").split("\n").find((item) => item.startsWith(CUSTOMS_REMARK_PREFIX)) || "";
  orderForm.customsNo = line.match(/报关单号\s*([^；]+)/)?.[1]?.trim() || "";
  orderForm.customsUnit = line.match(/消费使用单位\s*([^；]+)/)?.[1]?.trim() || "";
  orderForm.customsItemCount = line.match(/品名项数\s*([^；]+)/)?.[1]?.trim() || "";
  orderForm.customsPageCount = line.match(/续页数量\s*([^；]+)/)?.[1]?.trim() || "";
  orderForm.remark = stripCustomsRemark(remark);
}

function handleOrderBusinessTypeChange() {
  if (orderIsCustomsOnly.value) {
    clearOrderTransportFields();
  }
  scheduleAutoFreightSync();
}

function handleOrderVehicleSourceChange() {
  if (orderUsesOwnVehicle.value) {
    orderForm.supplier = "";
  } else if (orderUsesOutsourcedVehicle.value) {
    orderForm.plate = "";
    orderForm.driver = "";
    orderForm.hkDriver = "";
    orderForm.mainlandDriver = "";
    orderForm.transportMode = "";
  } else {
    orderForm.supplier = "";
    orderForm.plate = "";
    orderForm.driver = "";
    orderForm.hkDriver = "";
    orderForm.mainlandDriver = "";
    orderForm.transportMode = "";
  }
}

function normalizeTransportMode(value = "") {
  if (value === "香港司机直送") return "单司机";
  if (value === "香港司机 + 大陆骑师接驳") return "双司机";
  if (value === "口岸交货") return "口岸转国内车";
  return TRANSPORT_MODE_OPTIONS.includes(value) ? value : (value || "");
}

function isDomesticTransferMode(value = "") {
  return normalizeTransportMode(value) === "口岸转国内车";
}

function handleOrderTransportModeChange() {
  orderForm.transportMode = normalizeTransportMode(orderForm.transportMode);
  if (orderUsesRelayDrivers.value) {
    orderForm.hkDriver = orderForm.hkDriver || orderForm.driver || "";
    orderForm.driver = "";
  } else {
    orderForm.driver = orderForm.driver || orderForm.hkDriver || "";
    orderForm.hkDriver = "";
    orderForm.mainlandDriver = "";
  }
}

function normalizeOrderDriversForSave() {
  if (!orderUsesOwnVehicle.value) {
    orderForm.driver = "";
    orderForm.hkDriver = "";
    orderForm.mainlandDriver = "";
    return;
  }
  if (orderUsesRelayDrivers.value) {
    orderForm.driver = [orderForm.hkDriver, orderForm.mainlandDriver].filter(Boolean).join(" / ");
  } else {
    orderForm.hkDriver = "";
    orderForm.mainlandDriver = "";
  }
}

async function openOrderModal(customer = null, order = null) {
  await ensureReferenceDataLoaded();
  editingOrderNo.value = order?.no || "";
  pendingDispatchBindId.value = "";
  activeOrderDetailTab.value = "收费项目";
  orderAttachmentRows.value = [];
  orderAttachmentUploading.value = false;
  clearOrderAttachmentUploadStatus();
  if (order) {
    Object.assign(orderForm, {
      dispatchNo: order.dispatchNo || "",
      customerId: order.customerId || "",
      customer: order.customer || "",
      businessType: order.businessType || "",
      port: order.port || "",
      direction: order.direction || "",
      tonnage: order.tonnage || "",
      currency: order.currency || "",
      quantity: String(order.quantity || ""),
      weight: order.weight || "",
      vehicleSource: order.vehicleSource || "",
      supplier: order.supplier || "",
      plate: order.plate || "",
      driver: order.driver || "",
      hkDriver: order.hkDriver || "",
      mainlandDriver: order.mainlandDriver || "",
      transportMode: normalizeTransportMode(order.transportMode || ""),
      loading: order.loading || "",
      loadingContact: order.loadingContact || "",
      loadingPhone: order.loadingPhone || "",
      unloading: order.unloading || "",
      unloadingContact: order.unloadingContact || "",
      unloadingPhone: order.unloadingPhone || "",
      date: order.date || "",
      receivableHKD: Number(order.receivableHKD || 0),
      receivableRMB: Number(order.receivableRMB || 0),
      status: order.status || "",
      remark: order.remark || "",
      tripNoEnabled: Boolean(order.tripNoEnabled),
      tripNo: order.tripNo || "",
      sixSheetEnabled: Boolean(order.sixSheetEnabled),
      sixSheetNo: order.sixSheetNo || "",
      customsNo: "",
      customsUnit: "",
      customsItemCount: "",
      customsPageCount: ""
    });
    if (orderUsesRelayDrivers.value && !orderForm.hkDriver && orderForm.driver.includes(" / ")) {
      const [hkDriver = "", mainlandDriver = ""] = orderForm.driver.split(" / ");
      orderForm.hkDriver = hkDriver.trim();
      orderForm.mainlandDriver = mainlandDriver.trim();
      orderForm.driver = "";
    }
    loadCustomsFieldsFromRemark(order.remark || "");
    orderFees.value = (order.fees?.length ? order.fees : [
      {
        feeItemId: "",
        category: "正常",
        name: "中港运费",
        quantity: "",
        unitPrice: "",
        currency: order.receivableHKD ? "港币" : "人民币",
        amount: Number(order.receivableHKD || order.receivableRMB || 0),
        remark: ""
      }
    ]).map((fee) => {
      const amount = normalizeFeeAmount(fee);
      const row = {
        id: fee.id || "",
        feeItemId: fee.feeItemId || fee.fee_item_id || "",
        category: fee.category || "正常",
        name: fee.name || "",
        quantity: fee.quantity || "",
        unitPrice: normalizeFeeUnitPrice(fee),
        currency: fee.currency || "",
        amount,
        remark: fee.remark || "",
        driverRole: fee.driverRole || fee.driver_role || "",
        driverName: fee.driverName || fee.driver_name || "",
        autoFreight: Boolean(fee.autoFreight)
      };
      return {
        ...row,
        _manualFreightAmount: isFreightFeeRow(row) && amount !== "" && !row.autoFreight
      };
    });
    loadOrderFiles(order.no);
  } else {
    resetOrderForm();
    if (customer?.id) {
      orderForm.customerId = customer.id;
      orderForm.customer = customer.name || "";
    }
    const bindableRows = bindableDispatchRowsForCustomer(orderForm.customer);
    if (bindableRows.length) {
      const targetRow = bindableRows[0];
      const shouldBind = window.confirm(`发现该经营单位有未绑定排车单 ${targetRow.dispatchNo}，是否绑定并自动带入排车信息？`);
      if (shouldBind) applyDispatchRowToOrderForm(targetRow);
    }
  }
  orderCustomerKeyword.value = orderForm.customer || "";
  orderCustomerPickerOpen.value = false;
  orderModalOpen.value = true;
  scheduleAutoFreightSync();
}

async function saveOrder() {
  try {
    if (orderAttachmentUploading.value) {
      notify("附件正在上传，请稍候再保存订单");
      return;
    }
    if (!(await confirmSaveOrderWithMissingAdvanceReceipts())) return;
    loading.value = true;
    if (orderIsCustomsOnly.value) {
      clearOrderTransportFields();
    } else {
      handleOrderVehicleSourceChange();
    }
    normalizeOrderDriversForSave();
    const payload = {
      ...orderForm,
      remark: mergeCustomsRemark(orderForm.remark),
      fees: orderFees.value
        .map((fee) => ({ ...fee, amount: normalizeFeeAmount(fee), unitPrice: normalizeFeeUnitPrice(fee) }))
        .filter((fee) => fee.name || fee.amount || fee.quantity || fee.remark)
    };
    const item = editingOrderNo.value
      ? await ordersApi.updateOrder(editingOrderNo.value, payload)
      : await ordersApi.createOrder(payload);
    orderRows.value = editingOrderNo.value
      ? orderRows.value.map((row) => row.no === item.no ? item : row)
      : [item, ...orderRows.value];
    if (item.customerId) {
      selectedCustomerId.value = item.customerId;
    }
    activePartnerType.value = "客户";
    activeCustomerDetailTab.value = "订单管理";
    if (pendingDispatchBindId.value) {
      const target = dispatchPlanRows.value.find((row) => row.id === pendingDispatchBindId.value);
      if (target) {
        target.orderNo = item.no;
        target.dispatchNo = item.dispatchNo || target.dispatchNo;
        target.customer = item.customer || target.customer;
        target.port = item.port || target.port;
        target.direction = item.direction || target.direction;
        target.tonnage = item.tonnage || target.tonnage;
        target.quantity = item.quantity || target.quantity;
        target.weight = item.weight || target.weight;
        target.loading = item.loading || target.loading;
        target.unloading = item.unloading || target.unloading;
        target.vehicleSource = item.vehicleSource || target.vehicleSource;
        target.supplier = item.supplier || target.supplier;
        target.plate = item.plate || target.plate;
        saveDispatchPlan({ silent: true });
      }
      pendingDispatchBindId.value = "";
    }
    editingOrderNo.value = item.no;
    orderModalOpen.value = false;
    notify(`已保存订单：${item.no}`);
  } catch (error) {
    notify(error.message);
  } finally {
    loading.value = false;
  }
}

async function loadOrderFiles(orderNo = editingOrderNo.value) {
  orderAttachmentRows.value = orderNo ? await loadFiles("order", orderNo) : [];
}

function orderUploadStatusOptions() {
  return {
    onStart() {
      orderAttachmentUploading.value = true;
    },
    onStatus: setOrderAttachmentUploadStatus,
    onFinish() {
      orderAttachmentUploading.value = false;
      if (orderAttachmentUploadStatus.value) {
        scheduleClearOrderAttachmentUploadStatus(orderAttachmentUploadTone.value === "error" ? 7000 : 4200);
      }
    }
  };
}

function uploadOrderFile(event) {
  if (orderAttachmentUploading.value) {
    event.target.value = "";
    notify("附件正在上传，请稍候");
    return;
  }
  uploadFileFor("order", editingOrderNo.value, "订单附件", event, orderAttachmentRows, orderUploadStatusOptions());
}

function feeAttachmentCategory(fee, index) {
  const name = String(fee?.name || "").trim();
  return `收费项目-${name || `第${index + 1}行`}`;
}

function feeAttachmentRows(fee, index) {
  const category = feeAttachmentCategory(fee, index);
  return orderAttachmentRows.value.filter((file) => file.category === category);
}

function orderFeeHasContent(fee = {}) {
  return Boolean(
    String(fee.name || "").trim()
    || String(fee.quantity || "").trim()
    || normalizeFeeAmount(fee)
    || normalizeFeeUnitPrice(fee)
    || String(fee.remark || "").trim()
  );
}

function isReceiptAttachmentFile(file = {}) {
  const mime = String(file.mime || file.type || "").toLowerCase();
  const filename = String(file.filename || file.name || "").toLowerCase();
  return mime.startsWith("image/")
    || mime === "application/pdf"
    || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif|heic|heif|pdf)$/i.test(filename);
}

function feeHasReceiptAttachment(fee, index) {
  return feeAttachmentRows(fee, index).some(isReceiptAttachmentFile);
}

function missingAdvanceReceiptLabels() {
  return orderFees.value
    .map((fee, index) => ({ fee, index }))
    .filter(({ fee }) => orderFeeHasContent(fee) && feeCategoryLabel(fee) === "代垫")
    .filter(({ fee, index }) => !feeHasReceiptAttachment(fee, index))
    .map(({ fee, index }) => String(fee.name || "").trim() || `第 ${index + 1} 行代垫费用`);
}

function missingAdvanceReceiptMessage(labels = []) {
  const names = labels.slice(0, 5).join("、");
  const suffix = labels.length > 5 ? `等 ${labels.length} 项` : "";
  return [
    `检测到代垫费用「${names}${suffix}」还没有上传对应票据图片或 PDF。`,
    "票据缺失可能影响后续对账和审核，建议先补齐票据。",
    "",
    "是否仍然保存订单？"
  ].join("\n");
}

async function confirmSaveOrderWithMissingAdvanceReceipts() {
  if (editingOrderNo.value) {
    await loadOrderFiles(editingOrderNo.value);
  }
  const missingLabels = missingAdvanceReceiptLabels();
  if (!missingLabels.length) return true;
  return window.confirm(missingAdvanceReceiptMessage(missingLabels));
}

function uploadOrderFeeFile(fee, index, event) {
  if (orderAttachmentUploading.value) {
    event.target.value = "";
    notify("附件正在上传，请稍候");
    return;
  }
  if (!editingOrderNo.value) {
    event.target.value = "";
    notify("请先保存订单，再上传收费项目附件");
    return;
  }
  if (!String(fee?.name || "").trim()) {
    event.target.value = "";
    notify("请先选择收费项目，再上传附件");
    return;
  }
  uploadFileFor("order", editingOrderNo.value, feeAttachmentCategory(fee, index), event, orderAttachmentRows, orderUploadStatusOptions());
}

async function loadCustomerFiles() {
  customerFileRows.value = selectedCustomer.value
    ? await filesApi.listFiles("customer", selectedCustomer.value.id, { includeOrderFiles: true })
    : [];
}

function uploadCustomerFile(event) {
  uploadFileFor("customer", selectedCustomer.value?.id, "客户附件", event, customerFileRows)
    ?.then?.(() => loadCustomerFiles().catch((error) => notify(error.message)));
}

async function loadVehicleFiles() {
  vehicleFileRows.value = selectedVehicle.value ? await loadFiles("vehicle", selectedVehicle.value.plate) : [];
}

function uploadVehicleFile(event) {
  uploadFileFor("vehicle", selectedVehicle.value?.plate, "车辆证件", event, vehicleFileRows);
}

function uploadVehicleInsuranceFile(category, event) {
  const targetPlate = editingVehiclePlate.value || "";
  if (!targetPlate) {
    event.target.value = "";
    notify("请先保存车辆，再上传保险单据");
    return;
  }
  if (vehicleForm.plate && vehicleForm.plate !== editingVehiclePlate.value) {
    event.target.value = "";
    notify("车牌已修改，请先保存车辆后再上传保险单据");
    return;
  }
  uploadFileFor("vehicle", targetPlate, category, event, vehicleFileRows);
}

function vehicleInsuranceFiles(category) {
  return vehicleFileRows.value.filter((file) => file.category === category);
}

async function loadDriverFiles() {
  driverFileRows.value = selectedDriver.value ? await loadFiles("driver", selectedDriver.value.id) : [];
}

function uploadDriverFile(event) {
  uploadFileFor("driver", selectedDriver.value?.id, "司机证件", event, driverFileRows);
}

function addFeeRow() {
  orderFees.value.push({
    feeItemId: "",
    category: "正常",
    name: "",
    quantity: "",
    unitPrice: "",
    currency: orderForm.currency || "",
    amount: "",
    remark: ""
  });
}

function ensureTrailingBlankFeeRow() {
  const last = orderFees.value[orderFees.value.length - 1];
  if (!last || last.feeItemId || last.name || last.amount || last.quantity || last.remark) {
    addFeeRow();
  }
}

function removeFeeRow(index) {
  if (orderFees.value.length === 1) return;
  orderFees.value.splice(index, 1);
}

function replaceOrder(updatedOrder) {
  orderRows.value = orderRows.value.map((item) => item.no === updatedOrder.no ? updatedOrder : item);
}

function canAuditOrder(order = {}) {
  return order.status === "已签收";
}

function orderAuditButtonTitle(order = {}) {
  if (canAuditOrder(order)) return "审核订单";
  if (order.status === "已审核") return "订单已审核";
  return "订单状态为已签收后才能审核";
}

async function auditOrder(order) {
  if (order.status === "已审核") {
    notify("该订单已审核");
    return;
  }
  if (!canAuditOrder(order)) {
    notify("只有已签收订单才能审核");
    return;
  }
  try {
    const updated = await ordersApi.updateOrderStatus(order.no, "已审核");
    replaceOrder(updated);
    notify(`订单 ${order.no} 已审核`);
  } catch (error) {
    notify(error.message);
  }
}

async function cancelAuditOrder(order) {
  if (order.status !== "已审核") {
    notify("只有已审核订单才需要取消审核");
    return;
  }
  if (!window.confirm(`确定取消审核订单 ${order.no}？`)) return;
  try {
    const updated = await ordersApi.updateOrderStatus(order.no, "已签收");
    replaceOrder(updated);
    notify(`订单 ${order.no} 已取消审核`);
  } catch (error) {
    notify(error.message);
  }
}

async function auditPendingOrders() {
  const scope = selectedOrderNos.value.length
    ? filteredOrders.value.filter((item) => selectedOrderNos.value.includes(item.no))
    : filteredOrders.value;
  const auditableOrders = scope.filter(canAuditOrder);
  const pendingNos = auditableOrders.map((item) => item.no);
  if (pendingNos.length === 0) {
    notify("当前没有已签收订单可审核");
    return;
  }
  try {
    const updatedOrders = await ordersApi.auditOrders({ orderNos: pendingNos });
    const updatedMap = new Map(updatedOrders.map((item) => [item.no, item]));
    orderRows.value = orderRows.value.map((item) => updatedMap.get(item.no) || item);
    selectedOrderNos.value = [];
    notify(`已批量审核 ${updatedOrders.length} 条订单`);
  } catch (error) {
    notify(error.message);
  }
}

async function cancelSelectedAudits() {
  const targets = filteredOrders.value.filter((item) => selectedOrderNos.value.includes(item.no));
  if (targets.length === 0) {
    notify("请先勾选要取消审核的订单");
    return;
  }
  const auditedOrders = targets.filter((item) => item.status === "已审核");
  if (auditedOrders.length === 0) {
    notify("已勾选订单没有已审核状态");
    return;
  }
  if (!window.confirm(`确定取消审核 ${auditedOrders.length} 条订单？`)) return;
  try {
    const updatedOrders = await Promise.all(auditedOrders.map((order) =>
      ordersApi.updateOrderStatus(order.no, "已签收")
    ));
    const updatedMap = new Map(updatedOrders.map((item) => [item.no, item]));
    orderRows.value = orderRows.value.map((item) => updatedMap.get(item.no) || item);
    selectedOrderNos.value = [];
    notify(`已取消审核 ${updatedOrders.length} 条订单`);
  } catch (error) {
    notify(error.message);
  }
}

async function deleteSelectedOrders() {
  const targets = filteredOrders.value.filter((item) => selectedOrderNos.value.includes(item.no));
  if (targets.length === 0) {
    notify("请先勾选要删除的订单");
    return;
  }
  const locked = targets.filter((item) => !canDeleteOrder(item));
  if (locked.length) {
    notify(currentAccountCanDeleteInTransitOrder.value ? "已审核订单不可删除，请取消勾选后再操作" : "已审核或通关中订单不可删除，请取消勾选后再操作");
    return;
  }
  if (!window.confirm(`确定删除 ${targets.length} 条订单？删除后会进入回收站。`)) return;
  try {
    for (const order of targets) {
      await ordersApi.deleteOrder(order.no);
    }
    const deletedNos = new Set(targets.map((item) => item.no));
    orderRows.value = orderRows.value.filter((item) => !deletedNos.has(item.no));
    selectedOrderNos.value = [];
    notify(`已删除 ${targets.length} 条订单`);
  } catch (error) {
    notify(error.message);
  }
}

async function deleteOrder(order) {
  if (!canDeleteOrder(order)) {
    if (order.status === "通关中") {
      notify("通关中订单不可删除，请使用管理员账号操作");
      return;
    }
    notify("已审核订单不可删除");
    return;
  }
  const orderLabel = [order.no, order.customer].filter(Boolean).join(" / ");
  if (!window.confirm(`确定删除订单 ${orderLabel || order.no || ""}？删除后会进入回收站。`)) return;
  try {
    await ordersApi.deleteOrder(order.no);
    orderRows.value = orderRows.value.filter((item) => item.no !== order.no);
    notify(`订单 ${order.no} 已移入回收站`);
  } catch (error) {
    notify(error.message);
  }
}

function toggleCustomerOrderSelection(orderNo, checked) {
  if (checked) {
    selectedOrderNos.value = Array.from(new Set([...selectedOrderNos.value, orderNo]));
  } else {
    selectedOrderNos.value = selectedOrderNos.value.filter((no) => no !== orderNo);
  }
}

function toggleAllCustomerOrders(checked) {
  const customerNos = selectedCustomerOrderNos.value;
  selectedOrderNos.value = selectedOrderNos.value.filter((no) => !customerNos.includes(no));
  if (checked) {
    selectedOrderNos.value = [...selectedOrderNos.value, ...customerNos];
  }
}

function currentSelectedCustomerOrderTargets() {
  if (selectedCustomerScopedOrders.value.length === 0) {
    notify("请先勾选要管理的订单");
    return [];
  }
  return selectedCustomerScopedOrders.value;
}

async function auditSelectedCustomerOrders() {
  const targets = currentSelectedCustomerOrderTargets();
  if (targets.length === 0) return;
  const auditableOrders = targets.filter(canAuditOrder);
  if (auditableOrders.length === 0) {
    notify("已勾选订单没有已签收状态");
    return;
  }
  try {
    const updatedOrders = await ordersApi.auditOrders({ orderNos: auditableOrders.map((item) => item.no) });
    const updatedMap = new Map(updatedOrders.map((item) => [item.no, item]));
    orderRows.value = orderRows.value.map((item) => updatedMap.get(item.no) || item);
    selectedOrderNos.value = selectedOrderNos.value.filter((no) => !updatedMap.has(no));
    notify(`已审核 ${updatedOrders.length} 条订单`);
  } catch (error) {
    notify(error.message);
  }
}

async function cancelSelectedCustomerAudits() {
  const targets = currentSelectedCustomerOrderTargets();
  if (targets.length === 0) return;
  const auditedOrders = targets.filter((item) => item.status === "已审核");
  if (auditedOrders.length === 0) {
    notify("已勾选订单没有已审核状态");
    return;
  }
  if (!window.confirm(`确定取消审核 ${auditedOrders.length} 条订单？`)) return;
  try {
    const updatedOrders = await Promise.all(auditedOrders.map((order) =>
      ordersApi.updateOrderStatus(order.no, "已签收")
    ));
    const updatedMap = new Map(updatedOrders.map((item) => [item.no, item]));
    orderRows.value = orderRows.value.map((item) => updatedMap.get(item.no) || item);
    selectedOrderNos.value = selectedOrderNos.value.filter((no) => !updatedMap.has(no));
    notify(`已取消审核 ${updatedOrders.length} 条订单`);
  } catch (error) {
    notify(error.message);
  }
}

async function deleteSelectedCustomerOrders() {
  const targets = currentSelectedCustomerOrderTargets();
  if (targets.length === 0) return;
  const locked = targets.filter((item) => !canDeleteOrder(item));
  if (locked.length) {
    notify(currentAccountCanDeleteInTransitOrder.value ? "已审核订单不可删除，请先取消审核或取消勾选" : "已审核或通关中订单不可删除，请先取消勾选");
    return;
  }
  if (!window.confirm(`确定删除 ${targets.length} 条订单？删除后会进入回收站。`)) return;
  try {
    for (const order of targets) {
      await ordersApi.deleteOrder(order.no);
    }
    const deletedNos = new Set(targets.map((item) => item.no));
    orderRows.value = orderRows.value.filter((item) => !deletedNos.has(item.no));
    selectedOrderNos.value = selectedOrderNos.value.filter((no) => !deletedNos.has(no));
    notify(`已删除 ${targets.length} 条订单`);
  } catch (error) {
    notify(error.message);
  }
}

async function openRecycleBin() {
  try {
    recycleRows.value = await ordersApi.listRecycleOrders();
    recycleModalOpen.value = true;
  } catch (error) {
    notify(error.message);
  }
}

async function restoreOrder(order) {
  try {
    const restored = await ordersApi.restoreOrder(order.no);
    orderRows.value.unshift(restored);
    recycleRows.value = recycleRows.value.filter((item) => item.no !== restored.no);
    notify(`已恢复订单：${restored.no}`);
  } catch (error) {
    notify(error.message);
  }
}

const ORDER_EXPORT_HEADERS = ["排车单号", "订单号", "客户", "业务类型", "口岸", "进出口", "吨位", "币种", "件数/板数", "重量", "车辆来源", "车牌", "司机", "运输模式", "外派供应商", "装货地", "卸货地", "日期", "应收港币", "应收人民币", "状态"];

function orderExportRows(orders) {
  return orders.map((item) => [
    item.dispatchNo, item.no, item.customer, item.businessType, item.port, item.direction, item.tonnage,
    currencyCodeDisplay(item.currency), item.quantity, item.weight, item.vehicleSource, item.plate, item.driver, item.transportMode, item.supplier,
    item.loading, item.unloading, item.date, item.receivableHKD, item.receivableRMB, item.status
  ]);
}

function exportFilenamePart(value, fallback = "未填写") {
  return String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .trim() || fallback;
}

function exportOrderDailySequence(order) {
  const no = String(order?.no || "");
  const match = no.match(/(\d+)$/);
  if (!match) return "01";
  return String(Number(match[1].slice(-2)) || 1).padStart(2, "0");
}

function orderExportFilename(orders, extension) {
  const first = orders[0] || {};
  const customer = exportFilenamePart(first.customer || selectedCustomer.value?.name || "客户");
  const date = exportFilenamePart(first.date || todayInputValue()).replaceAll("-", "");
  const sequence = exportOrderDailySequence(first);
  return `${customer}_${date}${sequence}.${extension}`;
}

function orderExportExchangePayload() {
  const mode = String(orderExportExchangeMode.value || "");
  const rate = Number(orderExportExchangeRate.value || 0);
  if (!mode || !Number.isFinite(rate) || rate <= 0) return null;
  return { mode, rate };
}

function appendOrderExportExchangeParams(params, exchange = orderExportExchangePayload()) {
  if (!exchange) return;
  params.set("exchangeMode", exchange.mode);
  params.set("exchangeRate", String(exchange.rate));
}

async function exportOrderRowsAsCsv(orders, title = "订单导出", templateRow = selectedTemplate.value, exchangeOverride = null) {
  if (orders.length === 0) {
    notify("没有可导出的订单");
    return false;
  }
  const templateName = templateRow?.name || "默认模板";
  try {
    loading.value = true;
    const params = new URLSearchParams({
      title: `${title}-${templateName}`,
      orderNos: orders.map((item) => item.no).join(",")
    });
    if (templateRow?.id && templateRow.id !== "default") params.set("templateId", templateRow.id);
    appendOrderExportExchangeParams(params, exchangeOverride || orderExportExchangePayload());
    const response = await fetch(`${API_BASE}/orders/export/excel?${params.toString()}`, {
      headers: apiRequestHeaders()
    });
    if (!response.ok) {
      throw new Error(await apiDownloadErrorMessage(response, "Excel 导出失败"));
    }
    const blob = await response.blob();
    downloadBlob(blob, orderExportFilename(orders, "xlsx"));
    notify(`已按模板导出 Excel：${templateName}`);
    return true;
  } catch (error) {
    notify(error.message || "Excel 导出失败");
    return false;
  } finally {
    loading.value = false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportOrderRowsAsPdf(orders, title = "订单导出", templateRow = selectedTemplate.value, exchangeOverride = null) {
  if (orders.length === 0) {
    notify("没有可导出的订单");
    return false;
  }
  try {
    loading.value = true;
    const fullTemplateRow = await ensureTemplateContent(templateRow);
    const template = parseVisualExportTemplate(fullTemplateRow);
    const response = await fetch(`${API_BASE}/orders/export/pdf`, {
      method: "POST",
      headers: apiRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        orderNos: orders.map((item) => item.no),
        title,
        template,
        exchange: exchangeOverride || orderExportExchangePayload()
      })
    });
    if (!response.ok) {
      throw new Error(await apiDownloadErrorMessage(response, "PDF 导出失败"));
    }
    const blob = await response.blob();
    const templateName = fullTemplateRow?.name || "默认模板";
    downloadBlob(blob, orderExportFilename(orders, "pdf"));
    notify(`已按模板导出 PDF：${templateName}`);
    return true;
  } catch (error) {
    notify(error.message);
    return false;
  } finally {
    loading.value = false;
  }
}

function customerOrderExportScope() {
  return selectedCustomerScopedOrders.value.length ? selectedCustomerScopedOrders.value : selectedCustomerOrders.value;
}

function supplierOrderPayableBreakdown(order) {
  const rule = outsourcedCostRuleForOrder(order);
  const currency = supplierCostRuleCurrency(rule, order) || order.currency || "港币";
  const amount = supplierCostRuleAmount(rule, order);
  return {
    rule,
    currency,
    payableHKD: currency === "人民币" ? 0 : amount,
    payableRMB: currency === "人民币" ? amount : 0
  };
}

function supplierOrderPayableDetailText(order) {
  const rule = outsourcedCostRuleForOrder(order);
  if (!rule) return "-";
  const lines = [];
  const currency = supplierCostRuleCurrency(rule, order) || order.currency || "港币";
  const base = currency === "人民币" ? Number(rule.baseRMB || 0) : Number(rule.baseHKD || 0);
  if (base) lines.push(`基础 ${currencyCodeDisplay(currency)} ${money(base)}`);
  [
    ["loadPerBoard", "装货", "板"],
    ["unloadPerBoard", "卸货", "板"],
    ["crossSeaFee", "过海", ""],
    ["addPointFee", "加点", ""],
    ["waitingPerHour", "等候", "小时"]
  ].forEach(([field, label, unit]) => {
    if (!orderHasActualDriverExtraFee(order, field)) return;
    const rate = Number(rule[field] || 0);
    if (!rate) return;
    if (["loadPerBoard", "unloadPerBoard"].includes(field)) {
      const quantity = orderDriverExtraQuantity(order, field);
      lines.push(`${label} HKD ${money(quantity * rate)}（${money(quantity)}${unit}×${money(rate)}/${unit}）`);
    } else {
      lines.push(`${label} HKD ${money(rate)}`);
    }
  });
  advanceFeeItemRows.value.forEach((item) => {
    if (!orderHasFeeItem(order, item)) return;
    const amount = advanceFeeRateValue(rule.advanceFeeRates, item);
    if (!amount) return;
    lines.push(`${item.name || "代垫项目"} ${currencyCodeDisplay(item.currency || "港币")} ${money(amount)}`);
  });
  return lines.join("；") || "-";
}

function exportSupplierCustomerOrdersCsv() {
  const orders = customerOrderExportScope();
  if (!orders.length) {
    notify("没有可导出的供应商订单");
    return;
  }
  const missingRules = orders.filter((order) => !outsourcedCostRuleForOrder(order));
  const rows = orders.map((order, index) => {
    const payable = supplierOrderPayableBreakdown(order);
    return [
      index + 1,
      order.dispatchNo || "",
      order.no || "",
      order.date || "",
      order.customer || "",
      order.port || "",
      order.direction || "",
      order.tonnage || "",
      order.quantity || "",
      order.weight || "",
      order.loading || "",
      order.unloading || "",
      selectedCustomer.value?.name || order.supplier || "",
      order.plate || "",
      order.transportMode || "",
      payable.currency,
      payable.payableHKD,
      payable.payableRMB,
      payable.rule ? "已匹配报价" : "未匹配报价",
      supplierOrderPayableDetailText(order),
      order.status || ""
    ];
  });
  exportCsv(
    `${exportFilenamePart(selectedCustomer.value?.name || "供应商")}_供应商对账_${todayInputValue()}.csv`,
    ["序号", "排车单号", "订单号", "日期", "客户", "口岸", "进出口", "吨位", "件数/板数", "重量", "装货地", "卸货地", "供应商", "车牌", "运输模式", "币种", "应付港币", "应付人民币", "报价匹配", "应付明细", "状态"],
    rows
  );
  notify(missingRules.length
    ? `已导出供应商对账，${missingRules.length} 单未匹配报价规则`
    : "已导出供应商对账"
  );
}

function exportCustomerOrdersExcel(templateRow = selectedTemplate.value) {
  if (selectedCustomer.value?.type === "供应商") {
    exportSupplierCustomerOrdersCsv();
    return;
  }
  exportOrderRowsAsCsv(customerOrderExportScope(), `${selectedCustomer.value?.name || "客户"}订单`, templateRow);
}

function exportCustomerOrdersPdf(templateRow = selectedTemplate.value) {
  if (selectedCustomer.value?.type === "供应商") {
    notify("供应商订单请先导出 Excel/CSV，避免套用客户应收模板");
    return;
  }
  exportOrderRowsAsPdf(customerOrderExportScope(), `${selectedCustomer.value?.name || "客户"}订单`, templateRow);
}

async function toggleCustomerOrderExportMenu() {
  if (!customerOrderExportMenuOpen.value) {
    await ensureTemplateRowsLoaded({ silent: true });
  }
  customerOrderExportMenuOpen.value = !customerOrderExportMenuOpen.value;
}

function exportCustomerOrders(format, templateRow = selectedTemplate.value) {
  customerOrderExportMenuOpen.value = false;
  if (templateRow?.id) selectedTemplateId.value = templateRow.id;
  if (format === "pdf") {
    exportCustomerOrdersPdf(templateRow);
  } else {
    exportCustomerOrdersExcel(templateRow);
  }
}

function filteredOrderExportScope() {
  return selectedOrderNos.value.length
    ? filteredOrders.value.filter((item) => selectedOrderNos.value.includes(item.no))
    : filteredOrders.value;
}

const orderListDetailRows = computed(() =>
  orderListDetailOpen.value
    ? sortRowsByTable(
      orderListDetailScope.value === "customer" ? customerOrderExportScope() : filteredOrderExportScope(),
      "orders"
    )
    : []
);

const orderListDetailSubtitle = computed(() => {
  if (orderListDetailScope.value === "customer") {
    return selectedCustomerOrderCount.value
      ? `已选 ${orderListDetailRows.value.length} 条`
      : `当前${activePartnerType.value} ${orderListDetailRows.value.length} 条`;
  }
  return selectedOrderNos.value
    ? `已选 ${orderListDetailRows.value.length} 条`
    : `当前筛选 ${orderListDetailRows.value.length} 条`;
});

const orderListDetailColumns = computed(() =>
  visibleOrderColumns.value.filter((column) => column.key !== "select")
);

const orderListDetailManageColumns = computed(() =>
  orderColumns.filter((column) => column.key !== "select")
);

function openOrderListDetail(scope = "orders") {
  orderListDetailScope.value = scope;
  const rows = scope === "customer" ? customerOrderExportScope() : filteredOrderExportScope();
  if (!rows.length) {
    notify("当前没有可查看的订单");
    return;
  }
  orderListDetailOpen.value = true;
}

function closeOrderListDetail() {
  orderListDetailOpen.value = false;
}

function openCustomerListDetail() {
  if (!customerListDetailRows.value.length) {
    notify(`当前没有可查看的${activePartnerType.value}`);
    return;
  }
  customerListDetailOpen.value = true;
}

function closeCustomerListDetail() {
  customerListDetailOpen.value = false;
}

function openDispatchListDetail() {
  if (!dispatchListDetailRows.value.length) {
    notify("当前没有可查看的排车单");
    return;
  }
  dispatchListDetailOpen.value = true;
}

function closeDispatchListDetail() {
  dispatchListDetailOpen.value = false;
}

function openVehicleDriverListDetail() {
  if (!vehicleDriverListDetailRows.value.length) {
    notify(`当前没有可查看的${activeVehicleTab.value === "车辆管理" ? "车辆" : "司机"}`);
    return;
  }
  vehicleDriverListDetailOpen.value = true;
}

function closeVehicleDriverListDetail() {
  vehicleDriverListDetailOpen.value = false;
}

function exportOrders(templateRow = selectedTemplate.value) {
  exportOrderRowsAsCsv(filteredOrderExportScope(), "订单导出", templateRow);
}

function exportOrdersPdf(templateRow = selectedTemplate.value) {
  exportOrderRowsAsPdf(filteredOrderExportScope(), "订单导出", templateRow);
}

async function toggleOrderExportMenu() {
  if (!orderExportMenuOpen.value) {
    await ensureTemplateRowsLoaded({ silent: true });
  }
  orderExportMenuOpen.value = !orderExportMenuOpen.value;
}

function exportOrdersByFormat(format, templateRow = selectedTemplate.value) {
  orderExportMenuOpen.value = false;
  if (templateRow?.id) selectedTemplateId.value = templateRow.id;
  if (format === "pdf") {
    exportOrdersPdf(templateRow);
  } else {
    exportOrders(templateRow);
  }
}

function openVehicleModal(vehicle = null) {
  if (!canAccessModule("vehicleDriver")) {
    notify("当前账号无权管理车辆");
    return;
  }
  editingVehiclePlate.value = vehicle?.plate || "";
  Object.assign(vehicleForm, {
    plate: vehicle?.plate || "",
    brand: vehicle?.brand || "",
    model: vehicle?.model || "",
    type: vehicle?.type || "3T",
    purchaseDate: vehicle?.purchaseDate || "",
    factoryDate: vehicle?.factoryDate || "",
    mainlandReviewDate: vehicle?.mainlandReviewDate || "",
    hkReviewDate: vehicle?.hkReviewDate || "",
    mainlandInsuranceDate: vehicle?.mainlandInsuranceDate || "",
    hkInsuranceDate: vehicle?.hkInsuranceDate || "",
    insuranceReminder: vehicle?.insuranceReminder || "提前30天",
    maintenanceReminder: vehicle?.maintenanceReminder || "",
    status: vehicle?.status || "正常",
    monthlyCost: Number(vehicle?.monthlyCost || 0),
    note: vehicle?.note || ""
  });
  vehicleModalOpen.value = true;
  vehicleFileRows.value = [];
  if (editingVehiclePlate.value) {
    loadFiles("vehicle", editingVehiclePlate.value)
      .then((rows) => { vehicleFileRows.value = rows; })
      .catch((error) => notify(error.message));
  }
}

async function saveVehicle() {
  try {
    loading.value = true;
    const item = await vehiclesApi.saveVehicle(editingVehiclePlate.value, vehicleForm);
    vehicleRows.value = editingVehiclePlate.value
      ? vehicleRows.value.map((row) => row.plate === editingVehiclePlate.value ? item : row)
      : [item, ...vehicleRows.value];
    selectedVehiclePlate.value = item.plate;
    vehicleModalOpen.value = false;
    notify(`已保存车辆：${item.plate}`);
  } catch (error) {
    notify(error.message);
  } finally {
    loading.value = false;
  }
}

function resetVehicleExpenseForm(config = activeVehicleExpenseConfig.value) {
  Object.assign(vehicleExpenseForm, {
    type: config.type,
    name: config.type === "annual" ? config.defaultName : (config.type === "other" ? "" : config.defaultName),
    plate: selectedVehiclePlate.value || vehicleRows.value[0]?.plate || "",
    date: config.type === "annual" ? todayInputValue() : periodFilterDateValue(periodFilterValue("vehicleExpenses")),
    year: Number(currentPeriodMonthKey().slice(0, 4)),
    currency: "人民币",
    amount: "",
    note: ""
  });
}

function openVehicleExpenseModal(item = null) {
  const config = item ? (VEHICLE_EXPENSE_CONFIG_BY_TYPE[item.type] || activeVehicleExpenseConfig.value) : activeVehicleExpenseConfig.value;
  editingVehicleExpenseId.value = item?.id || null;
  Object.assign(vehicleExpenseForm, {
    type: config.type,
    name: item?.name || (config.type === "other" ? "" : config.defaultName),
    plate: item?.plate || selectedVehiclePlate.value || vehicleRows.value[0]?.plate || "",
    date: item?.date || (config.type === "annual" ? todayInputValue() : periodFilterDateValue(periodFilterValue("vehicleExpenses"))),
    year: Number(item?.year || String(item?.date || currentPeriodMonthKey()).slice(0, 4) || currentPeriodMonthKey().slice(0, 4)),
    currency: item?.currency || "人民币",
    amount: item?.amount || "",
    note: item?.note || ""
  });
  vehicleExpenseModalOpen.value = true;
}

async function saveVehicleExpense() {
  try {
    vehicleExpenseSaving.value = true;
    const item = await vehiclesApi.saveVehicleExpense(editingVehicleExpenseId.value, vehicleExpenseForm);
    vehicleExpenseRows.value = editingVehicleExpenseId.value
      ? vehicleExpenseRows.value.map((row) => row.id === item.id ? item : row)
      : [item, ...vehicleExpenseRows.value];
    selectedVehiclePlate.value = item.plate || selectedVehiclePlate.value;
    vehicleExpenseModalOpen.value = false;
    notify(`已保存${vehicleExpenseTypeLabel(item.type)}：${item.plate}`);
  } catch (error) {
    notify(error.message);
  } finally {
    vehicleExpenseSaving.value = false;
  }
}

async function deleteVehicleExpense(item) {
  if (!item?.id) return;
  if (!window.confirm(`确定删除 ${item.plate} 的 ${item.name || vehicleExpenseTypeLabel(item.type)}？`)) return;
  try {
    await vehiclesApi.deleteVehicleExpense(item.id);
    vehicleExpenseRows.value = vehicleExpenseRows.value.filter((row) => row.id !== item.id);
    notify("车辆支出已删除");
  } catch (error) {
    notify(error.message);
  }
}

function openDriverModal(driver = null) {
  if (!canAccessModule("vehicleDriver")) {
    notify("当前账号无权管理司机");
    return;
  }
  editingDriverId.value = driver?.id || null;
  Object.assign(driverForm, {
    id: driver?.id || null,
    type: driver?.type || "香港司机",
    name: driver?.name || "",
    phone: driver?.phone || "",
    idNo: driver?.idNo || "",
    license: driver?.license || "",
    birthday: driver?.birthday || "",
    hireDate: driver?.hireDate || "",
    leaveDate: driver?.leaveDate || "",
    expireAt: driver?.expireAt || "",
    status: driver?.status || "正常",
    note: driver?.note || ""
  });
  driverModalOpen.value = true;
}

function birthdayFromChineseIdNo(idNo) {
  const cleaned = String(idNo || "").trim().toUpperCase();
  const birth = /^\d{17}[\dX]$/.test(cleaned)
    ? cleaned.slice(6, 14)
    : /^\d{15}$/.test(cleaned)
      ? `19${cleaned.slice(6, 12)}`
      : "";
  if (!birth) return "";
  const year = Number(birth.slice(0, 4));
  const month = Number(birth.slice(4, 6));
  const day = Number(birth.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return "";
  return `${birth.slice(0, 4)}-${birth.slice(4, 6)}-${birth.slice(6, 8)}`;
}

function syncDriverBirthdayFromIdNo() {
  const birthday = birthdayFromChineseIdNo(driverForm.idNo);
  if (birthday) driverForm.birthday = birthday;
}

async function saveDriver() {
  try {
    syncDriverBirthdayFromIdNo();
    loading.value = true;
    const item = await vehiclesApi.saveDriver(editingDriverId.value, driverForm);
    driverRows.value = editingDriverId.value
      ? driverRows.value.map((row) => row.id === item.id ? item : row)
      : [item, ...driverRows.value];
    selectedDriverId.value = item.id;
    driverModalOpen.value = false;
    notify(`已保存司机：${item.name}`);
  } catch (error) {
    notify(error.message);
  } finally {
    loading.value = false;
  }
}

function editDriverWageRule(item = null) {
  const driverId = selectedDriver.value?.id || null;
  const nextDirection = SHARED_DIRECTION;
  const nextCity = driverWageCityValue(item?.city || "");
  const nextMode = normalizeTransportMode(item?.transportMode || item?.transport_mode || "");
  Object.assign(driverWageRuleForm, {
    id: item?.id || null,
    driverId: item?.driverId ?? driverId,
    direction: nextDirection,
    city: driverWageAreaOptions.value.includes(nextCity) ? nextCity : "",
    transportMode: driverWageTransportModeOptions.value.includes(nextMode) ? nextMode : driverWageTransportModeOptions.value[0],
    currency: item?.currency || "港币",
    baseRMB: Number(item?.baseRMB || 0),
    baseHKD: Number(item?.baseHKD || 0),
    loadPerBoard: Number(item?.loadPerBoard || 0),
    unloadPerBoard: Number(item?.unloadPerBoard || 0),
    crossSeaFee: Number(item?.crossSeaFee || 0),
    addPointFee: Number(item?.addPointFee || 0),
    waitingPerHour: Number(item?.waitingPerHour || 0),
    advanceFeeRates: normalizeAdvanceFeeRates(item?.advanceFeeRates),
    note: item?.note || ""
  });
  selectedDriverWageRuleId.value = item?.id || null;
}

function prepareNewDriverWageRule(keepPricing = false) {
  const saved = keepPricing ? { ...driverWageRuleForm } : null;
  const nextMode = driverWageTransportModeOptions.value.includes(normalizeTransportMode(saved?.transportMode || ""))
    ? normalizeTransportMode(saved.transportMode)
    : driverWageTransportModeOptions.value[0];
  Object.assign(driverWageRuleForm, {
    id: null,
    driverId: selectedDriver.value?.id || null,
    direction: SHARED_DIRECTION,
    city: "",
    transportMode: nextMode,
    currency: saved?.currency || "港币",
    baseRMB: keepPricing ? Number(saved.baseRMB || 0) : 0,
    baseHKD: keepPricing ? Number(saved.baseHKD || 0) : 0,
    loadPerBoard: keepPricing ? Number(saved.loadPerBoard || 0) : 0,
    unloadPerBoard: keepPricing ? Number(saved.unloadPerBoard || 0) : 0,
    crossSeaFee: keepPricing ? Number(saved.crossSeaFee || 0) : 0,
    addPointFee: keepPricing ? Number(saved.addPointFee || 0) : 0,
    waitingPerHour: keepPricing ? Number(saved.waitingPerHour || 0) : 0,
    advanceFeeRates: keepPricing ? normalizeAdvanceFeeRates(saved.advanceFeeRates) : {},
    note: ""
  });
  selectedDriverWageRuleId.value = null;
}

function prepareDriverWageRuleForMode(mode) {
  const normalizedMode = normalizeTransportMode(mode) || "单司机";
  if (!driverWageTransportModeOptions.value.includes(normalizedMode)) {
    notify("大陆骑师只适用于双司机规则");
    return;
  }
  const saved = { ...driverWageRuleForm };
  prepareNewDriverWageRule(true);
  driverWageRuleForm.transportMode = normalizedMode;
  driverWageRuleForm.city = driverWageAreaOptions.value.includes(saved.city) ? saved.city : "";
  driverWageRuleForm.note = normalizedMode === "单司机"
    ? "单司机直送规则"
    : `${normalizedMode}：当前司机对应本段趟费规则`;
}

async function saveDriverWageRule() {
  try {
    driverWageRuleForm.direction = SHARED_DIRECTION;
    driverWageRuleForm.transportMode = normalizeTransportMode(driverWageRuleForm.transportMode) || driverWageTransportModeOptions.value[0];
    if (!driverWageTransportModeOptions.value.includes(driverWageRuleForm.transportMode)) {
      notify("大陆骑师只适用于双司机规则");
      return;
    }
    if (!driverWageRuleForm.city || !driverWageAreaOptions.value.includes(driverWageRuleForm.city)) {
      notify("请先在运费模板维护一级目录城市，再选择计价城市保存司机费用规则");
      return;
    }
    const payload = {
      ...driverWageRuleForm,
      advanceFeeRates: normalizeAdvanceFeeRates(driverWageRuleForm.advanceFeeRates),
      driverId: driverWageRuleForm.driverId || selectedDriver.value?.id || null
    };
    const item = await vehiclesApi.saveDriverWageRule(payload.id, payload);
    driverWageRuleRows.value = payload.id
      ? driverWageRuleRows.value.map((row) => row.id === item.id ? item : row)
      : [...driverWageRuleRows.value, item];
    prepareNewDriverWageRule(true);
    notify("司机费用规则已保存，可继续选择其他片区新增");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteDriverWageRule(item) {
  if (!window.confirm(`确定删除 ${item.direction}/${driverWageCityValue(item.city)}/${normalizeTransportMode(item.transportMode || "单司机")} 的司机费用规则？`)) return;
  try {
    await vehiclesApi.deleteDriverWageRule(item.id);
    driverWageRuleRows.value = driverWageRuleRows.value.filter((row) => row.id !== item.id);
    editDriverWageRule(null);
    notify("司机费用规则已删除");
  } catch (error) {
    notify(error.message);
  }
}

function prepareNewSupplierCostRule(keepPricing = false) {
  const saved = keepPricing ? { ...supplierCostRuleForm } : null;
  Object.assign(supplierCostRuleForm, {
    id: null,
    supplierId: selectedCustomer.value?.id || "",
    supplier: selectedCustomer.value?.name || "",
    direction: supplierCostRuleDirection(saved?.direction),
    city: "",
    tonnage: saved?.tonnage || "3T",
    currency: saved?.currency || "港币",
    baseRMB: keepPricing ? Number(saved.baseRMB || 0) : 0,
    baseHKD: keepPricing ? Number(saved.baseHKD || 0) : 0,
    loadPerBoard: keepPricing ? Number(saved.loadPerBoard || 0) : 0,
    unloadPerBoard: keepPricing ? Number(saved.unloadPerBoard || 0) : 0,
    crossSeaFee: keepPricing ? Number(saved.crossSeaFee || 0) : 0,
    addPointFee: keepPricing ? Number(saved.addPointFee || 0) : 0,
    waitingPerHour: keepPricing ? Number(saved.waitingPerHour || 0) : 0,
    advanceFeeRates: keepPricing ? normalizeAdvanceFeeRates(saved.advanceFeeRates) : {},
    note: ""
  });
}

function editSupplierCostRule(rule = null) {
  supplierCostBatchOpen.value = false;
  cancelSupplierCostGroupEdit();
  if (!rule) {
    editingSupplierCostRuleKey.value = "";
    supplierCostRuleFormOpen.value = true;
    prepareNewSupplierCostRule(false);
    return;
  }
  supplierCostRuleFormOpen.value = false;
  editingSupplierCostRuleKey.value = rule.key || "";
  Object.assign(supplierCostRuleForm, {
    id: rule.id || null,
    supplierId: rule.supplierId || selectedCustomer.value?.id || "",
    supplier: rule.supplier || selectedCustomer.value?.name || "",
    direction: supplierCostRuleDirection(rule.direction),
    city: supplierCostRuleAreaValue(rule.city || ""),
    tonnage: rule.tonnage || "3T",
    currency: rule.currency || "港币",
    baseRMB: Number(rule.baseRMB || 0),
    baseHKD: Number(rule.baseHKD || 0),
    loadPerBoard: Number(rule.loadPerBoard || 0),
    unloadPerBoard: Number(rule.unloadPerBoard || 0),
    crossSeaFee: Number(rule.crossSeaFee || 0),
    addPointFee: Number(rule.addPointFee || 0),
    waitingPerHour: Number(rule.waitingPerHour || 0),
    advanceFeeRates: normalizeAdvanceFeeRates(rule.advanceFeeRates),
    note: rule.note || ""
  });
}

function cancelSupplierCostRuleInlineEdit() {
  editingSupplierCostRuleKey.value = "";
  prepareNewSupplierCostRule(false);
}

function supplierCostRuleTemplateName(rule) {
  return [
    "外派费用规则",
    rule.supplierId || rule.supplier || "供应商",
    rule.direction || "方向",
    rule.city || "片区",
    rule.tonnage || "吨位",
    rule.currency || "币种"
  ].join("-");
}

function supplierCostRuleTemplatePayload(content) {
  return {
    name: supplierCostRuleTemplateName(content),
    format: "成本规则",
    description: [
      content.supplier,
      content.direction,
      content.city,
      content.tonnage,
      `RMB ${money(content.baseRMB)}`,
      `HKD ${money(content.baseHKD)}`
    ].filter(Boolean).join(" / "),
    content: JSON.stringify(content)
  };
}

function findExistingSupplierCostRuleTemplate(content, currentId = null) {
  const templateName = supplierCostRuleTemplateName(content);
  return currentId
    ? templateRows.value.find((item) => item.id === currentId)
    : templateRows.value.find((item) => {
      if (item.name === templateName) return true;
      const current = parseSupplierCostRuleTemplate(item);
      return current
        && current.supplierId === content.supplierId
        && current.direction === content.direction
        && supplierCostRuleAreaValue(current.city) === content.city
        && current.tonnage === content.tonnage
        && current.currency === content.currency;
    });
}

function supplierCostRuleContentFromRule(rule, override = {}) {
  const supplierId = selectedCustomer.value?.id || rule.supplierId || "";
  const supplier = selectedCustomer.value?.name || rule.supplier || "";
  return {
    type: "outsourced-cost-rule",
    supplierId,
    supplier,
    direction: rule.direction,
    city: supplierCostRuleAreaValue(rule.city || ""),
    tonnage: rule.tonnage,
    currency: rule.currency || "港币",
    baseRMB: Number(rule.baseRMB || 0),
    baseHKD: Number(rule.baseHKD || 0),
    loadPerBoard: Number(rule.loadPerBoard || 0),
    unloadPerBoard: Number(rule.unloadPerBoard || 0),
    crossSeaFee: Number(rule.crossSeaFee || 0),
    addPointFee: Number(rule.addPointFee || 0),
    waitingPerHour: Number(rule.waitingPerHour || 0),
    advanceFeeRates: normalizeAdvanceFeeRates(rule.advanceFeeRates),
    note: rule.note || "",
    ...override,
    supplierId,
    supplier,
    savedAt: new Date().toISOString()
  };
}

async function upsertSupplierCostRuleContent(content, currentId = null) {
  const payload = supplierCostRuleTemplatePayload(content);
  const existing = findExistingSupplierCostRuleTemplate(content, currentId);
  let item;
  let target = existing;
  try {
    item = await templatesApi.saveTemplate(target?.id, target ? { ...target, ...payload } : payload);
  } catch (error) {
    if (target || !String(error.message || "").includes("模板名称已存在")) throw error;
    await reloadTemplateRows({ silent: true });
    target = findExistingSupplierCostRuleTemplate(content, currentId);
    if (!target) throw error;
    item = await templatesApi.updateTemplate(target.id, { ...target, ...payload });
  }
  if (target) {
    templateRows.value = templateRows.value.map((row) => row.id === item.id ? item : row);
  } else {
    templateRows.value = [item, ...templateRows.value];
  }
  return { item, existing: target };
}

function resetSupplierCostRuleBatchForm() {
  Object.assign(supplierCostRuleBatchForm, {
    tonnage: "",
    baseRMB: "",
    baseHKD: "",
    loadPerBoard: "",
    unloadPerBoard: "",
    crossSeaFee: "",
    addPointFee: "",
    waitingPerHour: "",
    note: ""
  });
}

function toggleSupplierCostBatch() {
  supplierCostBatchOpen.value = !supplierCostBatchOpen.value;
  if (supplierCostBatchOpen.value) {
    supplierCostRuleFormOpen.value = false;
    editingSupplierCostRuleKey.value = "";
    cancelSupplierCostGroupEdit();
  }
}

function toggleSupplierCostRuleSelection(rule) {
  const keys = new Set(selectedSupplierCostRuleKeys.value);
  if (supplierCostBatchOpen.value && supplierCostRuleBatchForm.tonnage) {
    const scopeKey = supplierCostRuleBatchScopeKey(rule);
    const scopeRules = selectedSupplierCostRules.value.filter((item) =>
      supplierCostRuleBatchScopeKey(item) === scopeKey
    );
    const shouldSelect = !scopeRules.some((item) => keys.has(item.key));
    scopeRules.forEach((item) => {
      if (shouldSelect) {
        keys.add(item.key);
      } else {
        keys.delete(item.key);
      }
    });
    selectedSupplierCostRuleKeys.value = Array.from(keys);
    return;
  }
  if (keys.has(rule.key)) {
    keys.delete(rule.key);
  } else {
    keys.add(rule.key);
  }
  selectedSupplierCostRuleKeys.value = Array.from(keys);
}

function supplierCostGroupRules(row) {
  return TONNAGE_OPTIONS
    .map((tonnage) => row.tonnageRules?.[tonnage])
    .filter(Boolean);
}

function supplierCostGroupSelected(row) {
  const rules = supplierCostGroupRules(row);
  if (supplierCostBatchOpen.value && supplierCostRuleBatchForm.tonnage) {
    return rules.length > 0 && rules.every((rule) =>
      selectedSupplierCostBatchScopeSet.value.has(supplierCostRuleBatchScopeKey(rule))
    );
  }
  return rules.length > 0 && rules.every((rule) => selectedSupplierCostRuleSet.value.has(rule.key));
}

function supplierCostRuleSelectionChecked(rule) {
  if (supplierCostBatchOpen.value && supplierCostRuleBatchForm.tonnage) {
    return selectedSupplierCostBatchScopeSet.value.has(supplierCostRuleBatchScopeKey(rule));
  }
  return selectedSupplierCostRuleSet.value.has(rule.key);
}

function toggleSupplierCostGroupSelection(row) {
  const keys = new Set(selectedSupplierCostRuleKeys.value);
  const rules = supplierCostGroupRules(row);
  if (supplierCostBatchOpen.value && supplierCostRuleBatchForm.tonnage) {
    const shouldSelect = !supplierCostGroupSelected(row);
    rules.forEach((rule) => {
      if (shouldSelect) {
        keys.add(rule.key);
      } else {
        keys.delete(rule.key);
      }
    });
    selectedSupplierCostRuleKeys.value = Array.from(keys);
    return;
  }
  const shouldSelect = !rules.every((rule) => keys.has(rule.key));
  rules.forEach((rule) => {
    if (shouldSelect) {
      keys.add(rule.key);
    } else {
      keys.delete(rule.key);
    }
  });
  selectedSupplierCostRuleKeys.value = Array.from(keys);
}

function toggleSupplierCostGroup(row) {
  const keys = new Set(expandedSupplierCostGroupKeys.value);
  if (keys.has(row.key)) {
    keys.delete(row.key);
  } else {
    keys.add(row.key);
  }
  expandedSupplierCostGroupKeys.value = Array.from(keys);
}

function supplierCostRulePriceLines(rule) {
  return [
    { currency: "RMB", value: Number(rule?.baseRMB || 0) ? money(rule.baseRMB) : "" },
    { currency: "HKD", value: Number(rule?.baseHKD || 0) ? money(rule.baseHKD) : "" },
    { currency: "装/板", value: Number(rule?.loadPerBoard || 0) ? `HKD ${money(rule.loadPerBoard)}` : "" },
    { currency: "卸/板", value: Number(rule?.unloadPerBoard || 0) ? `HKD ${money(rule.unloadPerBoard)}` : "" },
    { currency: "过海", value: Number(rule?.crossSeaFee || 0) ? `HKD ${money(rule.crossSeaFee)}` : "" },
    { currency: "加点", value: Number(rule?.addPointFee || 0) ? `HKD ${money(rule.addPointFee)}` : "" },
    { currency: "等候", value: Number(rule?.waitingPerHour || 0) ? `HKD ${money(rule.waitingPerHour)}` : "" },
  ];
}

function supplierCostGroupDraftKey(tonnage, currency) {
  return `${tonnage}|${currency}`;
}

function clearSupplierCostGroupDraft() {
  Object.keys(supplierCostGroupDraft).forEach((key) => delete supplierCostGroupDraft[key]);
}

function supplierCostAmountInput(value) {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return 0;
  const valueNumber = Number(text);
  return Number.isFinite(valueNumber) ? valueNumber : 0;
}

function supplierCostDisplayInput(value) {
  const valueNumber = Number(value || 0);
  return Number.isFinite(valueNumber) && valueNumber > 0 ? String(valueNumber) : "";
}

function supplierCostDraftValue(tonnage, currency) {
  return supplierCostGroupDraft[supplierCostGroupDraftKey(tonnage, currency)] ?? "";
}

function setSupplierCostDraftValue(tonnage, currency, value) {
  supplierCostGroupDraft[supplierCostGroupDraftKey(tonnage, currency)] = value;
}

function supplierCostGroupEditKey(row) {
  return row?.key || "";
}

function isEditingSupplierCostGroup(row) {
  return editingSupplierCostGroupKey.value === supplierCostGroupEditKey(row);
}

function cancelSupplierCostGroupEdit() {
  editingSupplierCostGroupKey.value = "";
  clearSupplierCostGroupDraft();
}

function beginEditSupplierCostGroup(row) {
  if (!row) return;
  supplierCostBatchOpen.value = false;
  supplierCostRuleFormOpen.value = false;
  editingSupplierCostRuleKey.value = "";
  editingSupplierCostGroupKey.value = supplierCostGroupEditKey(row);
  clearSupplierCostGroupDraft();
  TONNAGE_OPTIONS.forEach((tonnage) => {
    const rule = row.tonnageRules?.[tonnage] || {};
    setSupplierCostDraftValue(tonnage, "RMB", supplierCostDisplayInput(rule.baseRMB));
    setSupplierCostDraftValue(tonnage, "HKD", supplierCostDisplayInput(rule.baseHKD));
  });
}

async function saveSupplierCostGroup(row) {
  if (!selectedCustomer.value || selectedCustomer.value.type !== "供应商") {
    notify("请先选择供应商");
    return;
  }
  if (!row) return;
  const city = row.level === 2 ? row.city : row.level1;
  if (!row.direction || !city) {
    notify("缺少方向或计价片区");
    return;
  }
  const changedRules = TONNAGE_OPTIONS
    .map((tonnage) => {
      const existing = row.tonnageRules?.[tonnage] || {};
      const baseRMB = supplierCostAmountInput(supplierCostDraftValue(tonnage, "RMB"));
      const baseHKD = supplierCostAmountInput(supplierCostDraftValue(tonnage, "HKD"));
      return { tonnage, existing, baseRMB, baseHKD };
    })
    .filter(({ existing, baseRMB, baseHKD }) => existing.id || baseRMB > 0 || baseHKD > 0);
  if (changedRules.length === 0) {
    notify("请先填写要保存的金额");
    return;
  }
  try {
    for (const { tonnage, existing, baseRMB, baseHKD } of changedRules) {
      await upsertSupplierCostRuleContent(supplierCostRuleContentFromRule({
        direction: supplierCostRuleDirection(row.direction),
        city,
        tonnage,
        currency: existing.currency || "港币",
        baseRMB,
        baseHKD,
        loadPerBoard: Number(existing.loadPerBoard || 0),
        unloadPerBoard: Number(existing.unloadPerBoard || 0),
        crossSeaFee: Number(existing.crossSeaFee || 0),
        addPointFee: Number(existing.addPointFee || 0),
        waitingPerHour: Number(existing.waitingPerHour || 0),
        note: existing.note || ""
      }), existing.id || null);
    }
    await reloadTemplateRows({ silent: true });
    cancelSupplierCostGroupEdit();
    notify(`外派吨位基础价已保存 ${changedRules.length} 项`);
  } catch (error) {
    notify(error.message);
  }
}

function supplierCostRuleFeeValue(value) {
  const amount = Number(value || 0);
  return amount ? money(amount) : "待填";
}

function supplierCostGroupFeeValue(row, field) {
  const values = supplierCostGroupRules(row)
    .map((item) => Number(item?.[field] || 0))
    .filter((value) => value > 0)
    .map((value) => money(value));
  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length === 0) return "待填";
  return uniqueValues.length === 1 ? uniqueValues[0] : "多值";
}

function supplierCostExtraRules(row) {
  return row && Array.isArray(row.rules) ? row.rules : [];
}

function supplierCostExtraFeeValue(row, field) {
  const values = supplierCostExtraRules(row)
    .map((item) => Number(item?.advanceFeeRates?.[field] || 0))
    .filter((value) => value > 0)
    .map((value) => money(value));
  const uniqueValues = Array.from(new Set(values));
  if (uniqueValues.length === 0) return "待填";
  return uniqueValues.length === 1 ? uniqueValues[0] : "多值";
}

function supplierCostExtraNote(row) {
  const notes = supplierCostExtraRules(row)
    .map((item) => String(item?.note || "").trim())
    .filter(Boolean);
  const uniqueNotes = Array.from(new Set(notes));
  if (uniqueNotes.length === 0) return "";
  return uniqueNotes.length === 1 ? uniqueNotes[0] : "多值";
}

function supplierCostExtraDraftValue(field) {
  return supplierCostExtraDraft[field] ?? "";
}

function setSupplierCostExtraDraftValue(field, value) {
  supplierCostExtraDraft[field] = value;
}

function supplierCostExtraSingleValue(row, field) {
  const values = supplierCostExtraRules(row)
    .map((item) => field === "note" ? String(item?.note || "").trim() : Number(item?.advanceFeeRates?.[field] || 0))
    .filter((value) => field === "note" ? Boolean(value) : value > 0);
  const uniqueValues = Array.from(new Set(values));
  return uniqueValues.length === 1 ? String(uniqueValues[0]) : "";
}

function isEditingSupplierCostExtra(row) {
  return editingSupplierCostExtraKey.value === row?.key;
}

function cancelSupplierCostExtraEdit() {
  editingSupplierCostExtraKey.value = "";
  Object.keys(supplierCostExtraDraft).forEach((key) => delete supplierCostExtraDraft[key]);
}

function beginEditSupplierCostExtra(row) {
  if (!row) return;
  supplierCostBatchOpen.value = false;
  supplierCostRuleFormOpen.value = false;
  cancelSupplierCostGroupEdit();
  editingSupplierCostExtraKey.value = row.key;
  [...advanceFeeItemRows.value.map(advanceFeeRateKey), "note"].forEach((field) => {
    supplierCostExtraDraft[field] = supplierCostExtraSingleValue(row, field);
  });
}

async function saveSupplierCostExtra(row) {
  if (!selectedCustomer.value || selectedCustomer.value.type !== "供应商") {
    notify("请先选择供应商");
    return;
  }
  const rules = supplierCostExtraRules(row);
  if (!rules.length) {
    notify("暂无可保存的附加费用规则");
    return;
  }
  try {
    for (const rule of rules) {
      const advanceFeeRates = { ...normalizeAdvanceFeeRates(rule.advanceFeeRates) };
      advanceFeeItemRows.value.forEach((item) => {
        advanceFeeRates[advanceFeeRateKey(item)] = supplierCostAmountInput(supplierCostExtraDraft[advanceFeeRateKey(item)]);
      });
      await upsertSupplierCostRuleContent({
        ...supplierCostRuleContentFromRule(rule),
        advanceFeeRates,
        note: String(supplierCostExtraDraft.note || "").trim()
      }, rule.id || null);
    }
    await reloadTemplateRows({ silent: true });
    cancelSupplierCostExtraEdit();
    notify("附加费用规则已保存");
  } catch (error) {
    notify(error.message);
  }
}

function toggleAllSupplierCostRules() {
  selectedSupplierCostRuleKeys.value = allSupplierCostRulesSelected.value
    ? []
    : selectedSupplierCostRules.value.map((rule) => rule.key);
}

async function saveSupplierCostRuleBatch() {
  if (!selectedCustomer.value || selectedCustomer.value.type !== "供应商") {
    notify("请先选择供应商");
    return;
  }
  if (selectedSupplierCostRuleRows.value.length === 0) {
    notify("请先勾选要批量填价的规则");
    return;
  }
  if (supplierCostBatchTargetRows.value.length === 0) {
    notify("当前勾选范围内没有该吨位规则");
    return;
  }
  const override = {};
  ["baseRMB", "baseHKD"].forEach((key) => {
    if (supplierCostRuleBatchForm[key] !== "") override[key] = Number(supplierCostRuleBatchForm[key] || 0);
  });
  if (supplierCostRuleBatchForm.note.trim()) override.note = supplierCostRuleBatchForm.note.trim();
  if (Object.keys(override).length === 0) {
    notify("请先输入要批量更新的金额");
    return;
  }
  try {
    const updatedCount = supplierCostBatchTargetRows.value.length;
    for (const rule of supplierCostBatchTargetRows.value) {
      const content = supplierCostRuleContentFromRule(rule, override);
      await upsertSupplierCostRuleContent(content, rule.id || null);
    }
    await reloadTemplateRows({ silent: true });
    supplierCostRuleBatchForm.baseRMB = "";
    supplierCostRuleBatchForm.baseHKD = "";
    supplierCostRuleBatchForm.note = "";
    notify(`外派费用规则已批量更新 ${updatedCount} 项`);
  } catch (error) {
    notify(error.message);
  }
}

async function saveSupplierCostRule() {
  if (!selectedCustomer.value || selectedCustomer.value.type !== "供应商") {
    notify("请先选择供应商");
    return;
  }
  if (!supplierCostRuleForm.city || !supplierCostCityOptions.value.includes(supplierCostRuleForm.city)) {
    notify("请先在运费模板维护一二级片区，再选择计价片区保存外派费用规则");
    return;
  }
  const content = supplierCostRuleContentFromRule({
    supplierId: selectedCustomer.value.id,
    supplier: selectedCustomer.value.name,
    direction: supplierCostRuleForm.direction,
    city: supplierCostRuleForm.city,
    tonnage: supplierCostRuleForm.tonnage,
    currency: supplierCostRuleForm.currency,
    baseRMB: Number(supplierCostRuleForm.baseRMB || 0),
    baseHKD: Number(supplierCostRuleForm.baseHKD || 0),
    loadPerBoard: Number(supplierCostRuleForm.loadPerBoard || 0),
    unloadPerBoard: Number(supplierCostRuleForm.unloadPerBoard || 0),
    crossSeaFee: Number(supplierCostRuleForm.crossSeaFee || 0),
    addPointFee: Number(supplierCostRuleForm.addPointFee || 0),
    waitingPerHour: Number(supplierCostRuleForm.waitingPerHour || 0),
    advanceFeeRates: normalizeAdvanceFeeRates(supplierCostRuleForm.advanceFeeRates),
    note: supplierCostRuleForm.note || ""
  });
  try {
    const currentId = supplierCostRuleForm.id;
    const { existing } = await upsertSupplierCostRuleContent(content, currentId);
    await reloadTemplateRows({ silent: true });
    editingSupplierCostRuleKey.value = "";
    prepareNewSupplierCostRule(true);
    supplierCostRuleFormOpen.value = false;
    notify(existing ? "外派费用规则已更新" : "外派费用规则已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteSupplierCostRule(rule) {
  if (!window.confirm(`确定删除 ${rule.supplier}/${rule.direction}/${rule.city}/${rule.tonnage} 的外派费用规则？`)) return;
  try {
    await templatesApi.deleteTemplate(rule.id);
    templateRows.value = templateRows.value.filter((row) => row.id !== rule.id);
    if (supplierCostRuleForm.id === rule.id || editingSupplierCostRuleKey.value === rule.key) {
      editingSupplierCostRuleKey.value = "";
      prepareNewSupplierCostRule(false);
      supplierCostRuleFormOpen.value = false;
    }
    notify("外派费用规则已删除");
  } catch (error) {
    notify(error.message);
  }
}

function resetDriverAdjustmentForm() {
  Object.assign(driverAdjustmentForm, {
    id: null,
    driverId: selectedDriver.value?.id || null,
    date: todayInputValue(),
    type: "预支款",
    currency: "港币",
    amount: 0,
    status: "待工资结算",
    note: ""
  });
}

function editDriverAdjustment(item) {
  Object.assign(driverAdjustmentForm, {
    id: item.id,
    driverId: item.driverId,
    date: item.date || todayInputValue(),
    type: item.type || "预支款",
    currency: item.currency || "港币",
    amount: Number(item.amount || 0),
    status: item.status || "待工资结算",
    note: item.note || ""
  });
}

async function saveDriverAdjustment() {
  try {
    const payload = {
      ...driverAdjustmentForm,
      driverId: driverAdjustmentForm.driverId || selectedDriver.value?.id || null
    };
    const item = await vehiclesApi.saveDriverAdjustment(payload.id, payload);
    driverAdjustmentRows.value = payload.id
      ? driverAdjustmentRows.value.map((row) => row.id === item.id ? item : row)
      : [item, ...driverAdjustmentRows.value];
    resetDriverAdjustmentForm();
    notify("预支/报销记录已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteDriverAdjustment(item) {
  if (!window.confirm(`确定删除 ${item.date} ${item.type}？`)) return;
  try {
    await vehiclesApi.deleteDriverAdjustment(item.id);
    driverAdjustmentRows.value = driverAdjustmentRows.value.filter((row) => row.id !== item.id);
    if (driverAdjustmentForm.id === item.id) resetDriverAdjustmentForm();
    notify("预支/报销记录已删除");
  } catch (error) {
    notify(error.message);
  }
}

function exportCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")
  ).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, filename);
}

function spreadsheetTextWidth(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .reduce((max, line) => {
      const width = Array.from(line).reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
      return Math.max(max, width);
    }, 0);
}

function textWidthPx(value, min = 56, max = 320) {
  return Math.min(max, Math.max(min, Math.round(spreadsheetTextWidth(value) * 8 + 28)));
}

function worksheetAutoColumns(headers, rows) {
  return headers.map((header, index) => {
    const maxWidth = [header, ...rows.map((row) => row[index])]
      .reduce((max, value) => Math.max(max, spreadsheetTextWidth(value)), 0);
    return { wch: Math.min(Math.max(maxWidth + 2, 8), 60) };
  });
}

async function exportXlsx(filename, headers, rows, sheetName = "导出数据") {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet["!cols"] = worksheetAutoColumns(headers, rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  XLSX.writeFile(workbook, filename);
}

function financeWageExportValue(row, key) {
  const values = {
    driver: row.driver.name,
    type: row.driver.type || "香港司机",
    orderCount: row.orderCount,
    tripFee: moneyPair(row.payable, row.payableRMB),
    advanceFee: moneyPair(row.advanceFee, row.advanceFeeRMB),
    adjustments: moneyPair(row.adjustments, row.adjustmentsRMB),
    total: moneyPair(row.total, row.totalRMB),
    status: row.driver.status || "-"
  };
  return values[key] ?? "";
}

function syncFinanceWageTableColumnWidths() {
  const saved = loadDataTableSavedWidths("finance_wages");
  financeWageTableColumns.forEach((column) => {
    if (saved[column.key]) {
      financeWageTableColumnWidths[column.key] = Number(saved[column.key]);
      return;
    }
    const values = [
      column.label,
      ...financeWageRows.value.map((row) => financeWageExportValue(row, column.key))
    ];
    const maxWidth = values.reduce((width, value) =>
      Math.max(width, textWidthPx(value, column.min || 64, column.max || 220)), column.min || 64);
    financeWageTableColumnWidths[column.key] = Math.max(column.min || 64, maxWidth);
  });
}

watch([financeWageRows, visibleFinanceWageTableColumns], () => {
  syncFinanceWageTableColumnWidths();
}, { flush: "post" });

async function exportFinanceWages(rows = financeWageRows.value) {
  const columns = visibleFinanceWageTableColumns.value.filter((column) => column.exportable !== false);
  await exportXlsx(
    `工资统计-${financeDateRangeLabel()}-${todayInputValue()}.xlsx`,
    columns.map((column) => column.label),
    rows.map((row) => columns.map((column) => financeWageExportValue(row, column.key))),
    "工资统计"
  );
  notify("已导出工资统计");
}

function financeDriverOrderDetailRows(row, feeColumns = financeWageDetailFeeColumns(row)) {
  const driver = row?.driver;
  if (!driver) return [];
  return (row.orders || []).map((order, index) => {
    const tripFee = driverPayableTripFeeBreakdown(order, driver);
    const detailAdvanceFee = orderAdvanceFeeDetailBreakdown(order);
    const payableAdvanceFee = orderAdvanceFeeBelongsToDriverRow(order, driver)
      ? orderAdvanceFeeBreakdown(order, driver)
      : { hkd: 0, rmb: 0 };
    const baseFee = driverBaseTripFeeBreakdown(order, driver);
    return [
      index + 1,
      order.no || "",
      order.date || "",
      order.customer || "",
      normalizeTransportMode(order.transportMode || "单司机") || "",
      order.vehicleSource || "",
      order.plate || "",
      orderDriverWageCity(order, driver) || "",
      relatedOrderRouteText(order),
      money(baseFee.hkd),
      money(baseFee.rmb),
      money(driverExtraTripFeeTotal(order, driver)),
      money(detailAdvanceFee.hkd),
      money(detailAdvanceFee.rmb),
      orderAdvanceFeeDetailText(order, driver),
      ...feeColumns.map((column) => financeWageDetailCellValue(order, column, row) || "-"),
      money(driverCustomerTripAdjust(order, driver)),
      "",
      "",
      money(tripFee.hkd + payableAdvanceFee.hkd),
      money(tripFee.rmb + payableAdvanceFee.rmb),
      order.status || ""
    ];
  });
}

async function exportFinanceWageRow(row) {
  const feeColumns = financeWageDetailFeeColumns(row);
  const detailRows = financeDriverOrderDetailRows(row, feeColumns);
  if (!detailRows.length) {
    notify("该司机当前期间暂无可导出的订单明细");
    return;
  }
  const baseTotal = row.orders.reduce((sum, order) => {
    const amount = driverBaseTripFeeBreakdown(order, row.driver);
    return { hkd: sum.hkd + amount.hkd, rmb: sum.rmb + amount.rmb };
  }, { hkd: 0, rmb: 0 });
  const extraTotal = row.orders.reduce((sum, order) => sum + driverExtraTripFeeTotal(order, row.driver), 0);
  const customerAdjustTotal = row.orders.reduce((sum, order) => sum + driverCustomerTripAdjust(order, row.driver), 0);
  const totalRow = [
    "合计",
    "",
    "",
    `${detailRows.length} 单`,
    "",
    "",
    "",
    "",
    "",
    money(baseTotal.hkd),
    money(baseTotal.rmb),
    money(extraTotal),
    money(row.advanceFee),
    money(row.advanceFeeRMB),
    "",
    ...feeColumns.map(() => ""),
    money(customerAdjustTotal),
    money(row.adjustments),
    money(row.adjustmentsRMB),
    money(row.total),
    money(row.totalRMB),
    ""
  ];
  await exportXlsx(
    `工资核对-${row.driver.name}-${financeDateRangeLabel()}-${todayInputValue()}.xlsx`,
    ["序号", "订单号", "日期", "客户", "运输模式", "车辆来源", "车牌", "计价城市", "路线", "基础趟费HKD", "基础趟费RMB", "其他合计HKD", "代垫费HKD", "代垫费RMB", "代垫明细", ...feeColumns.map((column) => column.label), "客户调整HKD", "预支/报销HKD", "预支/报销RMB", "应付合计HKD", "应付合计RMB", "状态"],
    [...detailRows, totalRow],
    "工资核对"
  );
  notify(`已导出${row.driver.name}的订单核对明细`);
}

async function exportStatementCsv() {
  const entityName = ensureStatementEntity();
  const { start, end } = statementDateRange();
  const orders = selectedStatementOrders();
  if (!entityName) {
    notify("请先选择对账对象");
    return;
  }
  if (!orders.length) {
    notify("当前条件没有可导出的对账订单");
    return;
  }
  saveStatementExportSettings();
  try {
    loading.value = true;
    if (statementExportType.value === "supplier") {
      const rows = orders.map((order, index) => {
        const payable = supplierOrderPayableBreakdown(order);
        return [
          index + 1,
          order.dispatchNo || "",
          order.no || "",
          order.date || "",
          order.customer || "",
          order.port || "",
          order.direction || "",
          order.tonnage || "",
          order.quantity || "",
          order.weight || "",
          relatedOrderLocationText(order.loading),
          relatedOrderLocationText(order.unloading),
          order.plate || "",
          order.transportMode || "",
          payable.currency,
          payable.payableHKD,
          payable.payableRMB,
          payable.rule ? "已匹配报价" : "未匹配报价",
          supplierOrderPayableDetailText(order),
          order.status || ""
        ];
      });
      const totalHKD = rows.reduce((sum, row) => sum + Number(row[15] || 0), 0);
      const totalRMB = rows.reduce((sum, row) => sum + Number(row[16] || 0), 0);
      await exportXlsx(
        `${exportFilenamePart(entityName)}_供应商对账_${start || "全部"}_${end || "全部"}.xlsx`,
        ["序号", "排车单号", "订单号", "日期", "客户", "口岸", "进出口", "吨位", "件数/板数", "重量", "装货地", "卸货地", "车牌", "运输模式", "币种", "应付HKD", "应付RMB", "报价匹配", "应付明细", "状态"],
        [...rows, ["合计", "", "", "", "", "", "", "", "", "", "", "", "", "", "", money(totalHKD), money(totalRMB), "", "", ""]],
        "供应商对账"
      );
      await markStatementDownloaded("supplier", entityName, start, end);
      notify("已按供应商报价规则导出对账单");
      return;
    }

    if (statementExportType.value === "driver") {
      const driver = driverRows.value.find((item) => item.name === entityName || item.id === entityName);
      const rows = orders.map((order, index) => {
        const base = driverBaseTripFeeBreakdown(order, driver);
        const extra = driverExtraTripFeeTotal(order, driver);
        const advance = orderAdvanceFeeBelongsToDriverRow(order, driver) ? orderAdvanceFeeBreakdown(order, driver) : { hkd: 0, rmb: 0 };
        const adjust = driverCustomerTripAdjust(order, driver);
        return [
          index + 1,
          order.no || "",
          order.date || "",
          order.customer || "",
          order.vehicleSource || "",
          order.plate || "",
          normalizeTransportMode(order.transportMode || "单司机") || "",
          orderDriverWageCity(order, driver) || "",
          relatedOrderRouteText(order),
          money(base.hkd),
          money(base.rmb),
          money(extra),
          money(advance.hkd),
          money(advance.rmb),
          orderAdvanceFeeDetailText(order, driver),
          money(adjust),
          money(base.hkd + extra + advance.hkd + adjust),
          money(base.rmb + advance.rmb),
          order.status || ""
        ];
      });
      await exportXlsx(
        `${exportFilenamePart(entityName)}_司机对账_${start || "全部"}_${end || "全部"}.xlsx`,
        ["序号", "订单号", "日期", "客户", "车辆来源", "车牌", "运输模式", "计价城市", "路线", "基础趟费HKD", "基础趟费RMB", "附加趟费HKD", "代垫费HKD", "代垫费RMB", "代垫明细", "路线/客户调整HKD", "应付HKD", "应付RMB", "状态"],
        rows,
        "司机对账"
      );
      await markStatementDownloaded("driver", entityName, start, end);
      notify("已导出司机对账单");
      return;
    }

    const attachmentTexts = await Promise.all(orders.map((order) => statementAttachmentText(order)));
    const rows = orders.map((order, index) => [
      index + 1,
      order.dispatchNo || "",
      order.no || "",
      order.date || "",
      order.customer || "",
      order.port || "",
      order.direction || "",
      order.tonnage || "",
      order.quantity || "",
      order.weight || "",
      relatedOrderLocationText(order.loading),
      relatedOrderLocationText(order.unloading),
      order.receivableHKD || "",
      order.receivableRMB || "",
      statementFeeText(order),
      attachmentTexts[index] || "",
      order.status || ""
    ]);
    const total = statementConvertedTotal(orders, statementSettlementCurrency.value, statementExchangeRate.value);
    await exportXlsx(
      `${exportFilenamePart(entityName)}_客户对账_${start || "全部"}_${end || "全部"}.xlsx`,
      ["序号", "排车单号", "订单号", "日期", "客户", "口岸", "进出口", "吨位", "件数/板数", "重量", "装货地", "卸货地", "应收HKD", "应收RMB", "杂费明细", "附件", "状态"],
      [
        ...rows,
        ["合计", "", "", "", "", "", "", "", "", "", "", "", money(total.hkd), money(total.rmb), `${total.label}：${statementSettlementCurrency.value} ${money(total.total)}；汇率 ${statementExchangeRate.value}`, "", ""]
      ],
      "客户对账"
    );
    await markStatementDownloaded("customer", entityName, start, end);
    notify("已导出客户对账单并记录下载");
  } catch (error) {
    notify(error.message || "对账单导出失败");
  } finally {
    loading.value = false;
  }
}

function statementExportExchangePayload() {
  const rate = Number(statementExchangeRate.value || 0);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return {
    mode: statementSettlementCurrency.value === "港币" ? "rmb-to-hkd" : "hkd-to-rmb",
    rate
  };
}

function statementExportTypeLabel() {
  if (statementExportType.value === "supplier") return "供应商对账单";
  if (statementExportType.value === "driver") return "司机对账单";
  return "客户对账单";
}

async function toggleStatementExportMenu() {
  if (!statementExportMenuOpen.value) {
    await ensureTemplateRowsLoaded({ silent: true });
  }
  statementExportMenuOpen.value = !statementExportMenuOpen.value;
}

async function exportStatementByFormat(format, templateRow = selectedTemplate.value) {
  closeStatementExportMenu();
  const entityName = ensureStatementEntity();
  const { start, end } = statementDateRange();
  const orders = selectedStatementOrders();
  if (!entityName) {
    notify("请先选择对账对象");
    return;
  }
  if (!orders.length) {
    notify("当前条件没有可导出的对账订单");
    return;
  }
  saveStatementExportSettings();
  if (templateRow?.id) selectedTemplateId.value = templateRow.id;
  const title = `${statementExportTypeLabel()}-${entityName}`;
  const exchange = statementExportExchangePayload();
  const ok = format === "pdf"
    ? await exportOrderRowsAsPdf(orders, title, templateRow, exchange)
    : await exportOrderRowsAsCsv(orders, title, templateRow, exchange);
  if (ok) await markStatementDownloaded(statementExportType.value, entityName, start, end);
}

function parseVisualExportTemplate(item = selectedTemplate.value) {
  if (!item?.content) return null;
  try {
    const content = JSON.parse(item.content);
    if (content?.type !== "visual-export-template") return null;
    return content;
  } catch {
    return null;
  }
}

function orderExportTemplateOptions() {
  return exportTemplateRows.value.length
    ? exportTemplateRows.value
    : [{ id: "default", name: "默认模板", content: "" }];
}

function templateFormatLabel() {
  return "Excel / PDF";
}

async function ensureTemplateContent(item = selectedTemplate.value) {
  if (!item?.id || item.id === "default" || item.contentLoaded || item.content) return item;
  const fullItem = await templatesApi.getTemplate(item.id);
  templateRows.value = templateRows.value.map((row) => row.id === fullItem.id ? fullItem : row);
  if (selectedTemplateId.value === item.id) selectedTemplateId.value = fullItem.id;
  return fullItem;
}

function orderTemplateColumns(template = parseVisualExportTemplate()) {
  const columns = Array.isArray(template?.columns) && template.columns.length
    ? template.columns
    : defaultTemplateColumns();
  return filterRemovedTemplateColumns(columns)
    .filter((column) => column.visible !== false)
    .map((column) => ({
      key: column.key,
      label: column.label || column.key,
      fontSize: Number(column.fontSize || template?.tableFontSize || 11)
    }));
}

function orderExportValue(order, key) {
  const values = {
    dispatchNo: order.dispatchNo || "-",
    no: order.no,
    customer: order.customer,
    businessType: order.businessType,
    port: order.port,
    direction: order.direction,
    tonnage: order.tonnage,
    currency: order.currency,
    quantity: order.quantity,
    weight: order.weight,
    vehicleSource: order.vehicleSource,
    plate: order.plate,
    driver: order.driver,
    transportMode: normalizeTransportMode(order.transportMode || ""),
    supplier: order.supplier,
    loading: order.loading,
    unloading: order.unloading,
    date: order.date,
    receivableHKD: order.receivableHKD,
    receivableRMB: order.receivableRMB,
    status: order.status
  };
  return values[key] ?? order[key] ?? "";
}

function exportCustomers() {
  const rows = selectedCustomerIds.value.length
    ? visibleCustomers.value.filter((item) => selectedCustomerIds.value.includes(item.id))
    : visibleCustomers.value;
  exportCsv(
    `${activePartnerType.value}${selectedCustomerIds.value.length ? "已选" : "筛选"}导出-${todayInputValue()}.csv`,
    ["编号", "类型", "名称", "城市", "账期", "结算币种", "应收人民币", "应收港币", "最近订单日期", "创建日期"],
    rows.map((item) => [
      item.id,
      item.type,
      item.name,
      item.city,
      item.term,
      item.type === "客户" ? (item.settlementCurrency || "人民币结算") : "",
      item.receivableRMB,
      item.receivableHKD,
      partnerRecentOrderDate(item),
      item.createdAt
    ])
  );
  notify(selectedCustomerIds.value.length
    ? `已导出已选 ${rows.length} 个${activePartnerType.value}`
    : `已导出当前${activePartnerType.value}列表`
  );
}

async function deleteSelectedCustomer() {
  const targets = selectedCustomerIds.value.length
    ? visibleCustomers.value.filter((item) => selectedCustomerIds.value.includes(item.id))
    : (selectedCustomer.value ? [selectedCustomer.value] : []);
  if (targets.length === 0) {
    notify(`请先选择要删除的${activePartnerType.value}`);
    return;
  }
  if (!window.confirm(`确定删除 ${targets.length} 个${activePartnerType.value}？已有订单记录时系统会阻止删除。`)) return;
  try {
    for (const target of targets) {
      await customersApi.deleteCustomer(target.id);
    }
    const deletedIds = new Set(targets.map((item) => item.id));
    customerRows.value = customerRows.value.filter((item) => !deletedIds.has(item.id));
    selectedCustomerIds.value = [];
    selectedCustomerId.value = visibleCustomers.value[0]?.id || "";
    notify("已删除，相关审计已记录");
  } catch (error) {
    notify(error.message);
  }
}

function exportVehicleDriver() {
  if (activeVehicleTab.value === "车辆管理") {
    const rows = selectedVehiclePlates.value.length
      ? visibleVehicles.value.filter((item) => selectedVehiclePlates.value.includes(item.plate))
      : visibleVehicles.value;
    exportCsv(
      `车辆${selectedVehiclePlates.value.length ? "已选" : "筛选"}导出-${todayInputValue()}.csv`,
      ["车牌", "品牌", "型号", "车型", "大陆保险", "香港保险", "状态", "本月费用", "备注"],
      rows.map((item) => [item.plate, item.brand, item.model, item.type, item.mainlandInsuranceDate, item.hkInsuranceDate, item.status, item.monthlyCost, item.note])
    );
  } else {
    const rows = selectedDriverIds.value.length
      ? visibleDrivers.value.filter((item) => selectedDriverIds.value.includes(item.id))
      : visibleDrivers.value;
    exportCsv(
      `司机${selectedDriverIds.value.length ? "已选" : "筛选"}导出-${todayInputValue()}.csv`,
      ["类型", "司机", "电话", "身份证号", "驾驶证", "生日", "入职日期", "离职日期", "证件到期", "状态", "备注"],
      rows.map((item) => [item.type || "香港司机", item.name, item.phone, item.idNo, item.license, item.birthday, item.hireDate, item.leaveDate, item.expireAt, item.status, item.note])
    );
  }
  notify(`已导出${activeVehicleTab.value}`);
}

function exportVehicleExpenses() {
  const config = activeVehicleExpenseConfig.value;
  exportCsv(
    `${config.title}导出-${todayInputValue()}.csv`,
    ["名称", "车牌", config.type === "annual" ? "年份" : "时间", "币种", "金额", "分摊说明", "备注"],
    visibleVehicleExpenses.value.map((item) => [
      item.name || config.defaultName || vehicleExpenseTypeLabel(item.type),
      item.plate,
      vehicleExpenseDateText(item),
      currencyCodeDisplay(item.currency),
      item.amount,
      vehicleExpenseAllocationText(item),
      item.note
    ])
  );
  notify(`已导出${config.title}`);
}

function exportLocalBackup() {
  const snapshot = {
    exportedAt: new Date().toISOString(),
    customers: customerRows.value,
    orders: orderRows.value,
    vehicles: vehicleRows.value,
    vehicleExpenses: vehicleExpenseRows.value,
    drivers: driverRows.value,
    driverWageRules: driverWageRuleRows.value,
    costCenterRates: costCenterRateRows.value,
    vehicleProfitExchangeRates: bossVehicleExchangeRateRows.value,
    feeItems: feeItemRows.value,
    freightRates: freightRateRows.value,
    templates: templateRows.value,
    rules: ruleRows.value,
    masterData: masterRows.value,
    accounts: accountRows.value
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `汉业数据备份-${todayInputValue()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  notify("已生成本地备份文件");
}

function showRestoreNotice() {
  notify("正式恢复功能需要由服务器校验后导入。");
}

async function deleteSelectedVehicleDriver() {
  try {
    if (activeVehicleTab.value === "车辆管理") {
      const targets = selectedVehiclePlates.value.length
        ? visibleVehicles.value.filter((item) => selectedVehiclePlates.value.includes(item.plate))
        : (selectedVehicle.value ? [selectedVehicle.value] : []);
      if (targets.length === 0) {
        notify("请先选择要删除的车辆");
        return;
      }
      if (!window.confirm(`确定删除 ${targets.length} 台车辆？`)) return;
      for (const target of targets) {
        await vehiclesApi.deleteVehicle(target.plate);
      }
      const deletedPlates = new Set(targets.map((item) => item.plate));
      vehicleRows.value = vehicleRows.value.filter((item) => !deletedPlates.has(item.plate));
      selectedVehiclePlates.value = [];
      selectedVehiclePlate.value = vehicleRows.value[0]?.plate || "";
      notify("车辆已移入回收状态");
      return;
    }
    if (activeVehicleTab.value === "司机管理") {
      const targets = selectedDriverIds.value.length
        ? visibleDrivers.value.filter((item) => selectedDriverIds.value.includes(item.id))
        : (selectedDriver.value ? [selectedDriver.value] : []);
      if (targets.length === 0) {
        notify("请先选择要删除的司机");
        return;
      }
      if (!window.confirm(`确定删除 ${targets.length} 位司机？`)) return;
      for (const target of targets) {
        await vehiclesApi.deleteDriver(target.id);
      }
      const deletedIds = new Set(targets.map((item) => item.id));
      driverRows.value = driverRows.value.filter((item) => !deletedIds.has(item.id));
      selectedDriverIds.value = [];
      selectedDriverId.value = driverRows.value[0]?.id || null;
      notify("司机已移入回收状态");
    }
  } catch (error) {
    notify(error.message);
  }
}

function editFeeItem(item = null, options = {}) {
  Object.assign(feeItemForm, {
    id: item?.id || null,
    category: item?.category || "正常",
    name: item?.name || "",
    currency: item?.currency || "港币",
    defaultAmount: Number(item?.defaultAmount || 0),
    defaultDriverRole: item?.defaultDriverRole || "",
    costSources: normalizeFeeItemCostSources(item?.costSources || item?.costSource || item?.cost_source)
  });
  selectedFeeItemId.value = item?.id || null;
  feeItemFormOpen.value = true;
  editingFeeItemRowId.value = null;
  nextTick(() => {
    feeItemNameInput.value?.focus();
    feeItemNameInput.value?.select?.();
  });
  if (!options.silent) {
    notify(item?.name ? `正在编辑收费项目：${item.name}` : "正在新增收费项目");
  }
}

function startNewFeeItem(options = {}) {
  editFeeItem(null, options);
}

function closeFeeItemForm() {
  feeItemFormOpen.value = false;
  Object.assign(feeItemForm, {
    id: null,
    category: "正常",
    name: "",
    currency: "港币",
    defaultAmount: 0,
    defaultDriverRole: "",
    costSources: ["供应商"]
  });
}

function startFeeItemRowEdit(item) {
  editingFeeItemRowId.value = item.id;
  feeItemFormOpen.value = false;
  selectedFeeItemId.value = item.id;
  Object.assign(feeItemRowDraft, {
    category: item.category || "正常",
    name: item.name || "",
    currency: item.currency || "港币",
    defaultAmount: Number(item.defaultAmount || 0),
    defaultDriverRole: item.defaultDriverRole || "",
    costSources: normalizeFeeItemCostSources(item.costSources || item.costSource || item.cost_source)
  });
}

function cancelFeeItemRowEdit() {
  editingFeeItemRowId.value = null;
}

async function saveFeeItemRow(item) {
  try {
    const saved = await masterDataApi.saveFeeItem(item.id, { ...feeItemRowDraft, id: item.id });
    feeItemRows.value = sortFeeItems(feeItemRows.value.map((row) => row.id === saved.id ? saved : row));
    editingFeeItemRowId.value = null;
    notify("收费项目已保存");
  } catch (error) {
    notify(error.message);
  }
}

function selectFeeItem(item) {
  selectedFeeItemId.value = item?.id || null;
}

function openFeeItemManager(index = null) {
  feeItemManagerTargetIndex.value = Number.isInteger(index) ? index : null;
  feeItemManagerOpen.value = true;
  closeFeeItemForm();
}

function closeFeeItemManager() {
  feeItemManagerOpen.value = false;
  feeItemManagerTargetIndex.value = null;
  editingFeeItemRowId.value = null;
}

function chooseFeeItemForOrder(item) {
  if (!item) return;
  selectFeeItem(item);
  if (!orderModalOpen.value) {
    return;
  }
  const targetIndex = Number.isInteger(feeItemManagerTargetIndex.value)
    ? feeItemManagerTargetIndex.value
    : orderFees.value.findIndex((fee) => !fee.name);
  const targetFee = orderFees.value[targetIndex >= 0 ? targetIndex : 0];
  if (targetFee) {
    fillFeeFromItem(targetFee, item.id);
    notify(`已选择收费项目：${item.name}`);
  }
  closeFeeItemManager();
}

async function saveFeeItem() {
  try {
    const item = await masterDataApi.saveFeeItem(feeItemForm.id, feeItemForm);
    feeItemRows.value = feeItemForm.id
      ? sortFeeItems(feeItemRows.value.map((row) => row.id === item.id ? item : row))
      : sortFeeItems([...feeItemRows.value, item]);
    closeFeeItemForm();
    notify("收费项目已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteFeeItem(item) {
  try {
    await masterDataApi.deleteFeeItem(item.id);
    feeItemRows.value = sortFeeItems(feeItemRows.value.filter((row) => row.id !== item.id));
    if (editingFeeItemRowId.value === item.id) {
      editingFeeItemRowId.value = null;
    }
    if (selectedFeeItemId.value === item.id) {
      selectedFeeItemId.value = sortedFeeItemRows.value[0]?.id || null;
    }
    notify("收费项目已删除");
  } catch (error) {
    notify(error.message);
  }
}

async function persistFeeItemOrder(items, options = {}) {
  const orderedItems = items.map((item, index) => ({ ...item, sortOrder: getTemplateColumnOrderValue(item, index) }));
  feeItemRows.value = orderedItems;
  try {
    const saved = await masterDataApi.reorderFeeItems(orderedItems.map((item) => item.id));
    feeItemRows.value = sortFeeItems(saved);
    if (!options.silent) notify("收费项目顺序已保存");
  } catch (error) {
    notify(error.message || "收费项目排序保存失败");
    loadAllData({ preserveSelection: true });
  }
}

function startFeeItemDrag(item) {
  draggedFeeItemId.value = item?.id || null;
}

function dropFeeItem(targetItem) {
  const sourceId = draggedFeeItemId.value;
  draggedFeeItemId.value = null;
  if (!sourceId || !targetItem?.id || sourceId === targetItem.id) return;
  const items = sortedFeeItemRows.value;
  const sourceIndex = items.findIndex((item) => item.id === sourceId);
  const targetIndex = items.findIndex((item) => item.id === targetItem.id);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const nextItems = [...items];
  const [sourceItem] = nextItems.splice(sourceIndex, 1);
  nextItems.splice(targetIndex, 0, sourceItem);
  persistFeeItemOrder(nextItems);
}

function endFeeItemDrag() {
  draggedFeeItemId.value = null;
}

function isTemplateFeeItemColumn(column) {
  if (column?.feeItemId || column?.feeName || String(column?.key || "").startsWith("fee-item-")) return true;
  return feeItemRows.value.some((item) => item.name && item.name === column?.label);
}

function buildFeeItemTemplateColumn(item, existing = null, fallbackIndex = templateDesigner.columns.length) {
  return {
    key: existing?.key || `fee-item-${item.id}`,
    label: item.name,
    visible: existing ? existing.visible !== false : true,
    order: getTemplateColumnOrder(existing, fallbackIndex),
    fontSize: Number(existing?.fontSize || templateDesigner.tableFontSize || 11),
    width: Number(existing?.width || 96),
    feeItemId: item.id,
    feeName: item.name,
    feeCurrency: item.currency || "港币",
    ...normalizeTemplateColumnStyle(existing || {})
  };
}

async function syncFeeItemOrderFromTemplateColumns(options = {}) {
  const feeColumnNames = templateDesigner.columns
    .filter(isTemplateFeeItemColumn)
    .map((column) => column.feeName || column.label)
    .filter(Boolean);
  if (feeColumnNames.length === 0) return;
  const byName = new Map(feeItemRows.value.map((item) => [item.name, item]));
  const ordered = [];
  feeColumnNames.forEach((name) => {
    const item = byName.get(name);
    if (item && !ordered.some((row) => row.id === item.id)) ordered.push(item);
  });
  sortedFeeItemRows.value.forEach((item) => {
    if (!ordered.some((row) => row.id === item.id)) ordered.push(item);
  });
  await persistFeeItemOrder(ordered, { silent: options.silent !== false });
}

function editFreightRate(item = null, options = {}) {
  const level1 = item?.level1 || item?.city || "";
  const level2 = item?.level2 || "";
  const level3 = item?.level3 || "";
  const scope = item
    ? { customerId: freightRateCustomerId(item), customerName: freightRateCustomerName(item) }
    : currentFreightQuoteScope();
  Object.assign(freightRateForm, {
    id: item?.id || null,
    customerId: scope.customerId,
    customerName: scope.customerName,
    direction: SHARED_DIRECTION,
    level1,
    level2,
    level3,
    city: item?.city || level3 || level2 || level1 || "",
    tonnage: item?.tonnage || "3T",
    rmbAmount: Number(item?.rmbAmount || 0),
    hkdAmount: Number(item?.hkdAmount || 0)
  });
  selectedFreightRateId.value = item?.id || null;
  freightDirectionFilter.value = SHARED_DIRECTION;
  if (!options.silent) {
    const path = [freightRateForm.level1, freightRateForm.level2, freightRateForm.level3].filter(Boolean).join("/");
    notify(item ? `正在编辑运费模板：${item.direction}/${path}/${item.tonnage}` : "正在新增运费模板");
  }
}

function editFreightGroup(group, tonnage = "3T") {
  const item = group?.rates?.[tonnage] || null;
  if (item) {
    editFreightRate(item);
    return;
  }
  const scope = currentFreightQuoteScope();
  Object.assign(freightRateForm, {
    id: null,
    customerId: scope.customerId,
    customerName: scope.customerName,
    direction: SHARED_DIRECTION,
    level1: group?.level1 || "",
    level2: group?.level2 || "",
    level3: group?.level3 || "",
    city: group?.city || group?.level3 || group?.level2 || group?.level1 || "",
    tonnage,
    rmbAmount: 0,
    hkdAmount: 0
  });
  selectedFreightRateId.value = null;
  notify(`正在新增 ${freightRateForm.level1}/${freightRateForm.tonnage} 价格`);
}

function isEditingFreightGroup(group) {
  return Boolean(group?.key && freightRowEditor.key === group.key);
}

function beginFreightGroupRowEdit(group) {
  if (!group?.key) return;
  freightRowEditor.key = group.key;
  freightRowEditor.group = group;
  freightRowEditor.drafts = Object.fromEntries(
    TONNAGE_OPTIONS.map((tonnage) => {
      const current = group.rates?.[tonnage] || {};
      return [tonnage, {
        rmbAmount: Number(current.rmbAmount || 0),
        hkdAmount: Number(current.hkdAmount || 0)
      }];
    })
  );
  selectedFreightRateId.value = Object.values(group.rates || {}).find((item) => item?.id)?.id || null;
}

function cancelFreightGroupRowEdit() {
  freightRowEditor.key = "";
  freightRowEditor.group = null;
  freightRowEditor.drafts = {};
}

function resetFreightDirectoryCreatorDrafts() {
  freightDirectoryCreator.drafts = Object.fromEntries(
    TONNAGE_OPTIONS.map((tonnage) => [tonnage, { rmbAmount: 0, hkdAmount: 0 }])
  );
}

function cancelFreightDirectoryCreate() {
  freightDirectoryCreator.open = false;
  freightDirectoryCreator.level = freightDirectoryLevel.value;
  freightDirectoryCreator.name = "";
  freightDirectoryCreator.drafts = {};
}

async function saveFreightGroupRowEdit(group = freightRowEditor.group) {
  if (!group?.key || !isEditingFreightGroup(group)) return;
  try {
    const updated = await Promise.all(
      TONNAGE_OPTIONS.map((tonnage) => upsertFreightRateForGroup(group, tonnage, {
        rmbAmount: Number(freightRowEditor.drafts[tonnage]?.rmbAmount || 0),
        hkdAmount: Number(freightRowEditor.drafts[tonnage]?.hkdAmount || 0)
      }))
    );
    const nextRows = [...freightRateRows.value];
    updated.forEach((item) => {
      const index = nextRows.findIndex((row) => row.id === item.id);
      if (index >= 0) nextRows.splice(index, 1, item);
      else nextRows.push(item);
    });
    freightRateRows.value = nextRows;
    selectedFreightRateId.value = updated.find((item) => item?.id)?.id || selectedFreightRateId.value;
    cancelFreightGroupRowEdit();
    syncAutoFreightFee();
    notify("整行价格已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function saveFreightDirectoryCreate() {
  const name = freightDirectoryCreator.name.trim();
  if (!name) {
    notify(`请输入${freightDirectoryMeta.value.primary}`);
    return;
  }
  if (freightDirectoryLevel.value === "level2" && !freightParentLevel1.value) {
    notify("请先选择所属一级目录");
    return;
  }
  if (freightDirectoryLevel.value === "level3" && (!freightParentLevel1.value || !freightParentLevel2.value)) {
    notify("请先选择所属一级和二级目录");
    return;
  }
  const group = buildFreightDirectoryGroup(
    freightDirectoryLevel.value === "level1" ? name : freightParentLevel1.value,
    freightDirectoryLevel.value === "level2" ? name : (freightDirectoryLevel.value === "level3" ? freightParentLevel2.value : ""),
    freightDirectoryLevel.value === "level3" ? name : ""
  );
  try {
    const updated = await Promise.all(
      TONNAGE_OPTIONS.map((tonnage) => upsertFreightRateForGroup(group, tonnage, {
        rmbAmount: Number(freightDirectoryCreator.drafts[tonnage]?.rmbAmount || 0),
        hkdAmount: Number(freightDirectoryCreator.drafts[tonnage]?.hkdAmount || 0)
      }))
    );
    const nextRows = [...freightRateRows.value];
    updated.forEach((item) => {
      const index = nextRows.findIndex((row) => row.id === item.id);
      if (index >= 0) nextRows.splice(index, 1, item);
      else nextRows.push(item);
    });
    freightRateRows.value = nextRows;
    selectedFreightRateId.value = updated.find((item) => item?.id)?.id || selectedFreightRateId.value;
    cancelFreightDirectoryCreate();
    clearFreightGroupSelection();
    syncAutoFreightFee();
    notify("目录已新增");
  } catch (error) {
    notify(error.message);
  }
}

function prepareFreightDirectory(level) {
  freightPanelTab.value = FREIGHT_QUOTE_TAB;
  freightDirectionFilter.value = SHARED_DIRECTION;
  freightDirectoryLevel.value = `level${level}`;
  const scope = currentFreightQuoteScope();
  Object.assign(freightRateForm, {
    id: null,
    customerId: scope.customerId,
    customerName: scope.customerName,
    direction: SHARED_DIRECTION,
    level1: level >= 1 ? (level === 1 ? "" : freightParentLevel1.value || freightRateForm.level1 || "") : "",
    level2: level >= 2 ? (level === 2 ? "" : freightParentLevel2.value || freightRateForm.level2 || "") : "",
    level3: level >= 3 ? (freightRateForm.level3 || "") : "",
    city: "",
    tonnage: freightRateForm.tonnage || "3T",
    rmbAmount: 0,
    hkdAmount: 0
  });
  selectedFreightRateId.value = null;
  freightDirectoryCreator.open = true;
  freightDirectoryCreator.level = `level${level}`;
  freightDirectoryCreator.name = "";
  resetFreightDirectoryCreatorDrafts();
  notify(`请填写${["一", "二", "三"][level - 1]}级目录和各吨位价格`);
}

function isFreightGroupSelected(group) {
  return selectedFreightGroupKeys.value.includes(group.key);
}

function toggleFreightGroupSelection(group, checked) {
  if (!group?.key) return;
  const next = new Set(selectedFreightGroupKeys.value);
  if (checked) next.add(group.key);
  else next.delete(group.key);
  selectedFreightGroupKeys.value = [...next];
}

function toggleAllVisibleFreightGroups(checked) {
  const visibleKeys = new Set(visibleFreightRateGroups.value.map((group) => group.key));
  if (!checked) {
    selectedFreightGroupKeys.value = selectedFreightGroupKeys.value.filter((key) => !visibleKeys.has(key));
    return;
  }
  const next = new Set(selectedFreightGroupKeys.value);
  visibleFreightRateGroups.value.forEach((group) => next.add(group.key));
  selectedFreightGroupKeys.value = [...next];
}

function selectAllVisibleFreightGroups() {
  toggleAllVisibleFreightGroups(true);
}

function clearFreightGroupSelection() {
  selectedFreightGroupKeys.value = [];
}

function freightBatchHasValue(value) {
  return value !== "" && value !== null && value !== undefined;
}

async function upsertFreightRateForGroup(group, tonnage, amountPatch) {
  const current = group.rates?.[tonnage] || null;
  const scope = group?.customerId || group?.customerName
    ? { customerId: freightRateCustomerId(group), customerName: freightRateCustomerName(group) }
    : currentFreightQuoteScope();
  const normalized = normalizeFreightRateEntry({
    direction: SHARED_DIRECTION,
    level1: group.level1 || group.city || "",
    level2: group.level2 || "",
    level3: group.level3 || "",
    city: group.city || group.level3 || group.level2 || group.level1 || ""
  });
  const payload = {
    customerId: scope.customerId,
    customerName: scope.customerName,
    direction: SHARED_DIRECTION,
    level1: normalized.level1,
    level2: normalized.level2,
    level3: normalized.level3,
    city: normalized.level3 || normalized.level2 || normalized.level1 || normalized.city,
    tonnage,
    rmbAmount: Number(current?.rmbAmount || 0),
    hkdAmount: Number(current?.hkdAmount || 0),
    ...amountPatch
  };
  return masterDataApi.saveFreightRate(current?.id, payload);
}

async function applyFreightBatchPrice() {
  const groups = selectedVisibleFreightGroups.value;
  if (groups.length === 0) {
    notify("请先勾选要批量修改的目录");
    return;
  }
  if (!freightBatchForm.tonnage) {
    notify("请选择要修改的吨位");
    return;
  }
  const amountPatch = {};
  if (freightBatchHasValue(freightBatchForm.rmbAmount)) amountPatch.rmbAmount = Number(freightBatchForm.rmbAmount) || 0;
  if (freightBatchHasValue(freightBatchForm.hkdAmount)) amountPatch.hkdAmount = Number(freightBatchForm.hkdAmount) || 0;
  if (!("rmbAmount" in amountPatch) && !("hkdAmount" in amountPatch)) {
    notify("请输入 RMB 或 HKD，留空表示不改");
    return;
  }

  try {
    const updated = await Promise.all(
      groups.map((group) => upsertFreightRateForGroup(group, freightBatchForm.tonnage, amountPatch))
    );
    const nextRows = [...freightRateRows.value];
    updated.forEach((item) => {
      const index = nextRows.findIndex((row) => row.id === item.id);
      if (index >= 0) nextRows.splice(index, 1, item);
      else nextRows.push(item);
    });
    freightRateRows.value = nextRows;
    selectedFreightRateId.value = updated[0]?.id || selectedFreightRateId.value;
    syncAutoFreightFee();
    notify(`已批量修改 ${updated.length} 个目录的 ${freightBatchForm.tonnage} 价格`);
  } catch (error) {
    notify(error.message);
  }
}

async function saveFreightRate() {
  try {
    const scope = currentFreightQuoteScope();
    if (activeFreightQuoteType.value === CUSTOMER_FREIGHT_QUOTE_TYPE && !scope.customerId) {
      notify("请先选择客户运费报价模板");
      return;
    }
    if (freightDirectoryLevel.value === "level2" && !freightRateForm.level1) {
      freightRateForm.level1 = freightParentLevel1.value;
    }
    if (freightDirectoryLevel.value === "level3") {
      if (!freightRateForm.level1) freightRateForm.level1 = freightParentLevel1.value;
      if (!freightRateForm.level2) freightRateForm.level2 = freightParentLevel2.value;
    }
    const normalized = normalizeFreightRateEntry({
      ...freightRateForm,
      direction: SHARED_DIRECTION,
      city: freightRateForm.level3 || freightRateForm.level2 || freightRateForm.level1 || freightRateForm.city
    });
    Object.assign(freightRateForm, {
      customerId: scope.customerId,
      customerName: scope.customerName,
      direction: SHARED_DIRECTION,
      level1: normalized.level1,
      level2: normalized.level2,
      level3: normalized.level3,
      city: normalized.level3 || normalized.level2 || normalized.level1 || normalized.city
    });
    const item = await masterDataApi.saveFreightRate(freightRateForm.id, freightRateForm);
    freightRateRows.value = freightRateForm.id
      ? freightRateRows.value.map((row) => row.id === item.id ? item : row)
      : [...freightRateRows.value, item];
    editFreightRate(item, { silent: true });
    syncAutoFreightFee();
    notify("运费模板已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteFreightRate(item) {
  const path = [item.level1 || item.city, item.level2, item.level3].filter(Boolean).join("/");
  if (!window.confirm(`确定删除 ${item.direction}/${path}/${item.tonnage} 运费模板？`)) return;
  try {
    await masterDataApi.deleteFreightRate(item.id);
    freightRateRows.value = freightRateRows.value.filter((row) => row.id !== item.id);
    editFreightRate(freightRateRows.value[0] || null, { silent: true });
    syncAutoFreightFee();
    notify("运费模板已删除");
  } catch (error) {
    notify(error.message);
  }
}

function freightRateRowsForGroup(group) {
  if (!group?.key) return [];
  const targetCustomerId = freightRateCustomerId(group);
  const targetCustomerName = freightRateCustomerName(group);
  const targetDirection = normalizeFreightLabel(group.direction || freightDirectionFilter.value);
  const targetLevel1 = normalizeFreightLabel(group.level1 || "");
  const targetLevel2 = normalizeFreightLabel(group.level2 || "");
  const targetLevel3 = normalizeFreightLabel(group.level3 || "");
  return freightRateRows.value.filter((row) => {
    const item = normalizeFreightRateEntry(row);
    if (targetCustomerId || targetCustomerName) {
      if (!freightRateBelongsToCustomer(item, { id: targetCustomerId, name: targetCustomerName })) return false;
    } else if (!isPublicFreightRate(item)) {
      return false;
    }
    if (normalizeFreightLabel(item.direction) !== targetDirection) return false;
    if (targetLevel1 && item.level1 !== targetLevel1) return false;
    if (targetLevel2 && item.level2 !== targetLevel2) return false;
    if (targetLevel3 && item.level3 !== targetLevel3) return false;
    return true;
  });
}

function uniqueFreightRateItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function deleteFreightGroup(group) {
  const items = uniqueFreightRateItems(freightRateRowsForGroup(group));
  const path = [group.level1, group.level2, group.level3].filter(Boolean).join("/");
  if (items.length === 0) {
    notify("该目录下暂无可删除的运费价格");
    return;
  }
  if (!window.confirm(`确定删除 ${group.direction}/${path} 下所有子目录和吨位价格？共 ${items.length} 条。`)) return;
  try {
    await Promise.all(items.map((item) => masterDataApi.deleteFreightRate(item.id)));
    const ids = new Set(items.map((item) => item.id));
    freightRateRows.value = freightRateRows.value.filter((row) => !ids.has(row.id));
    selectedFreightGroupKeys.value = selectedFreightGroupKeys.value.filter((key) => key !== group.key);
    editFreightRate(freightRateRows.value[0] || null, { silent: true });
    syncAutoFreightFee();
    notify("运费目录已删除");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteSelectedFreightGroups() {
  const groups = selectedVisibleFreightGroups.value;
  if (groups.length === 0) {
    notify("请先勾选要删除的目录");
    return;
  }
  const items = uniqueFreightRateItems(groups.flatMap((group) => freightRateRowsForGroup(group)));
  if (items.length === 0) {
    notify("选中的目录下暂无可删除的运费价格");
    return;
  }
  if (!window.confirm(`确定删除已选 ${groups.length} 个目录下所有子目录和吨位价格？共 ${items.length} 条。`)) return;
  try {
    await Promise.all(items.map((item) => masterDataApi.deleteFreightRate(item.id)));
    const ids = new Set(items.map((item) => item.id));
    freightRateRows.value = freightRateRows.value.filter((row) => !ids.has(row.id));
    clearFreightGroupSelection();
    editFreightRate(freightRateRows.value[0] || null, { silent: true });
    syncAutoFreightFee();
    notify("已批量删除运费价格");
  } catch (error) {
    notify(error.message);
  }
}

function loadFeeTemplate() {
  loadFeeTemplateMenuOpen.value = false;
  syncAutoFreightFee();
  const autoFreightFee = orderFees.value.find((fee) => fee.autoFreight && fee.name);
  const templateRows = sortedFeeItemRows.value
    .filter((item) => item.name !== autoFreightFee?.name)
    .slice(0, 3)
    .map((item) => ({
      feeItemId: item.id,
      category: item.category,
      name: item.name,
      quantity: 1,
      unitPrice: Number(item.defaultAmount || 0),
      currency: item.currency,
      amount: Number(item.defaultAmount || 0),
      remark: ""
    }));
  orderFees.value = [
    ...(autoFreightFee ? [{ ...autoFreightFee }] : []),
    ...templateRows
  ];
  if (orderFees.value.length === 0) addFeeRow();
  notify("已载入收费项目模板");
}

function parseOrderFreightTemplate(item) {
  try {
    const content = JSON.parse(item?.content || "{}");
    return content?.type === "order-freight-template" ? content : null;
  } catch {
    return null;
  }
}

function applyFeeTemplateRows(fees) {
  orderFees.value = (Array.isArray(fees) ? fees : []).map((fee) => {
    const amount = normalizeFeeAmount(fee);
    const row = {
      feeItemId: fee.feeItemId || fee.fee_item_id || feeItemRows.value.find((row) => row.name === fee.name)?.id || "",
      category: fee.category || "正常",
      name: fee.name || "",
      quantity: fee.quantity || "",
      unitPrice: normalizeFeeUnitPrice(fee),
      currency: fee.currency || orderForm.currency || "",
      amount,
      remark: fee.remark || "",
      driverRole: fee.driverRole || "",
      driverName: fee.driverName || "",
      attachments: Array.isArray(fee.attachments) ? fee.attachments : []
    };
    return {
      ...row,
      _manualFreightAmount: isFreightFeeRow(row) && amount !== ""
    };
  });
  if (!orderFees.value.length) addFeeRow();
}

function applyOrderTemplateFields(order = {}) {
  const customerId = order.customerId || order.customer_id || "";
  const customer = customerRows.value.find((item) => item.id === customerId || item.name === order.customer);
  Object.assign(orderForm, {
    customerId: customer?.id || customerId || orderForm.customerId,
    customer: customer?.name || order.customer || orderForm.customer,
    businessType: order.businessType || order.business_type || orderForm.businessType,
    port: order.port || orderForm.port,
    direction: order.direction || orderForm.direction,
    tonnage: order.tonnage || orderForm.tonnage,
    currency: order.currency || orderForm.currency,
    quantity: order.quantity || orderForm.quantity,
    weight: order.weight || orderForm.weight,
    vehicleSource: order.vehicleSource || order.vehicle_source || orderForm.vehicleSource,
    supplier: order.supplier || orderForm.supplier,
    plate: order.plate || orderForm.plate,
    driver: order.driver || orderForm.driver,
    hkDriver: order.hkDriver || order.hk_driver || orderForm.hkDriver,
    mainlandDriver: order.mainlandDriver || order.mainland_driver || orderForm.mainlandDriver,
    transportMode: normalizeTransportMode(order.transportMode || order.transport_mode || orderForm.transportMode),
    loading: order.loading || orderForm.loading,
    loadingContact: order.loadingContact || order.loading_contact || orderForm.loadingContact,
    loadingPhone: order.loadingPhone || order.loading_phone || orderForm.loadingPhone,
    unloading: order.unloading || orderForm.unloading,
    unloadingContact: order.unloadingContact || order.unloading_contact || orderForm.unloadingContact,
    unloadingPhone: order.unloadingPhone || order.unloading_phone || orderForm.unloadingPhone,
    tripNoEnabled: Boolean(order.tripNoEnabled ?? order.trip_no_enabled ?? orderForm.tripNoEnabled),
    tripNo: order.tripNo || order.trip_no || orderForm.tripNo,
    sixSheetEnabled: Boolean(order.sixSheetEnabled ?? order.six_sheet_enabled ?? orderForm.sixSheetEnabled),
    sixSheetNo: order.sixSheetNo || order.six_sheet_no || orderForm.sixSheetNo
  });
}

function loadSavedFeeTemplate(item) {
  const content = parseOrderFreightTemplate(item);
  const fees = Array.isArray(content?.fees) ? content.fees : [];
  if (!fees.length) {
    notify("该模板暂无收费项目");
    return;
  }
  applyOrderTemplateFields(content.order || {});
  applyFeeTemplateRows(fees);
  loadFeeTemplateMenuOpen.value = false;
  notify(`已载入模板：${item.name}`);
}

function loadLatestOrderTemplate() {
  const order = latestOrderTemplateSource.value;
  if (!order) {
    notify("暂无可载入的最近订单模板");
    return;
  }
  applyOrderTemplateFields(order);
  applyFeeTemplateRows(order.fees);
  loadFeeTemplateMenuOpen.value = false;
  notify(`已载入最近订单模板：${order.no}`);
}

function editSavedFeeTemplate(item) {
  loadSavedFeeTemplate(item);
  freightTemplateNameForm.name = item.name || defaultFreightTemplateName();
  saveFreightTemplateModalOpen.value = true;
}

async function deleteSavedFeeTemplate(item) {
  if (!window.confirm(`确定删除模板「${item.name}」？`)) return;
  try {
    await templatesApi.deleteTemplate(item.id);
    templateRows.value = templateRows.value.filter((row) => row.id !== item.id);
    if (selectedTemplateId.value === item.id) selectedTemplateId.value = exportTemplateRows.value[0]?.id || null;
    notify("模板已删除");
  } catch (error) {
    notify(error.message);
  }
}

function freightTemplateLocationName(value, fallback) {
  const parts = String(value || "")
    .split(/[\/｜|>]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.slice(0, 2).join(" / ") || fallback;
}

function defaultFreightTemplateName() {
  const routeName = [
    freightTemplateLocationName(orderForm.loading, "装货地"),
    freightTemplateLocationName(orderForm.unloading, "卸货地")
  ].filter(Boolean).join("-");
  return [orderForm.tonnage, routeName, orderForm.date || todayInputValue()].filter(Boolean).join("-") || "订单运费模板";
}

function openSaveFreightTemplateModal() {
  freightTemplateNameForm.name = defaultFreightTemplateName();
  saveFreightTemplateModalOpen.value = true;
}

function closeSaveFreightTemplateModal() {
  saveFreightTemplateModalOpen.value = false;
}

async function saveCurrentFeesAsTemplate() {
  const name = freightTemplateNameForm.name.trim();
  if (!name) {
    notify("请输入模板名称");
    return;
  }
  try {
    const fees = orderFees.value
      .filter((fee) => fee.name)
      .map((fee) => ({
        feeItemId: fee.feeItemId || null,
        category: fee.category || "正常",
        name: fee.name,
        quantity: fee.quantity || "",
        unitPrice: normalizeFeeUnitPrice(fee),
        currency: fee.currency || orderForm.currency || "港币",
        amount: Number(normalizeFeeAmount(fee) || 0),
        remark: fee.remark || "",
        driverRole: fee.driverRole || "",
        driverName: fee.driverName || "",
        attachments: fee.attachments || []
      }));
    const content = {
      type: "order-freight-template",
      savedAt: new Date().toISOString(),
      customerId: orderForm.customerId,
      customer: orderForm.customer,
      order: {
        customerId: orderForm.customerId,
        customer: orderForm.customer,
        businessType: orderForm.businessType,
        port: orderForm.port,
        direction: orderForm.direction,
        tonnage: orderForm.tonnage,
        currency: orderForm.currency,
        quantity: orderForm.quantity,
        weight: orderForm.weight,
        vehicleSource: orderForm.vehicleSource,
        supplier: orderForm.supplier,
        plate: orderForm.plate,
        driver: orderForm.driver,
        hkDriver: orderForm.hkDriver,
        mainlandDriver: orderForm.mainlandDriver,
        transportMode: orderForm.transportMode,
        loading: orderForm.loading,
        loadingContact: orderForm.loadingContact,
        loadingPhone: orderForm.loadingPhone,
        unloading: orderForm.unloading,
        unloadingContact: orderForm.unloadingContact,
        unloadingPhone: orderForm.unloadingPhone,
        tripNoEnabled: orderForm.tripNoEnabled,
        tripNo: orderForm.tripNo,
        sixSheetEnabled: orderForm.sixSheetEnabled,
        sixSheetNo: orderForm.sixSheetNo
      },
      fees
    };
    const payload = {
      name,
      format: "通用",
      description: [
        "订单运费模板",
        orderForm.direction,
        orderForm.port,
        orderForm.tonnage,
        orderForm.currency,
        orderForm.loading ? `装货地：${orderForm.loading}` : "",
        orderForm.unloading ? `卸货地：${orderForm.unloading}` : ""
      ].filter(Boolean).join(" / "),
      content: JSON.stringify(content)
    };
    const existing = templateRows.value.find((item) => {
      if (item.name !== name) return false;
      return orderTemplateMatchesCurrentCustomer(parseOrderFreightTemplate(item) || {});
    });
    const item = await templatesApi.saveTemplate(existing?.id, existing ? { ...existing, ...payload } : payload);
    templateRows.value = existing
      ? templateRows.value.map((row) => row.id === item.id ? item : row)
      : [item, ...templateRows.value];
    selectedTemplateId.value = item.id;
    closeSaveFreightTemplateModal();
    notify(existing ? `已更新运费模板：${name}` : `已保存运费模板：${name}`);
  } catch (error) {
    notify(error.message);
  }
}

function fillFeeFromItem(fee, id) {
  const item = feeItemRows.value.find((row) => row.id === Number(id));
  if (!item) {
    Object.assign(fee, {
      feeItemId: "",
      name: "",
      category: "正常",
      currency: "",
      unitPrice: "",
      amount: "",
      driverRole: "",
      driverName: "",
      remark: fee.remark || ""
    });
    return;
  }
  Object.assign(fee, {
    feeItemId: item.id,
    name: item.name,
    category: item.category,
    quantity: fee.quantity || 1,
    unitPrice: Number(item.defaultAmount || 0) || "",
    currency: item.currency,
    amount: "",
    driverRole: item.category === "代垫" ? (item.defaultDriverRole || "") : "",
    driverName: ""
  });
  syncFeeAmountFromUnitPrice(fee);
}

function buildTemplateDesignerContent() {
  ensureAllTemplateColumns();
  const columns = filterRemovedTemplateColumns(templateDesigner.columns);
  return JSON.stringify({
    type: "visual-export-template",
    orientation: templateDesigner.orientation,
    header: templateDesigner.header,
    headerX: Number(templateDesigner.headerX || 18),
    headerY: Number(templateDesigner.headerY || 18),
    headerTextItems: templateDesigner.headerTextItems.map((item) => ({ ...item })),
    footerTextItems: templateDesigner.footerTextItems.map((item) => ({ ...item })),
    logo: templateDesigner.logo,
    logoName: templateDesigner.logoName,
    logoWidth: Number(templateDesigner.logoWidth || 92),
    logoHeight: Number(templateDesigner.logoHeight || 56),
    logoFit: templateDesigner.logoFit === "cover" ? "cover" : "contain",
    logoX: Number(templateDesigner.logoX || 18),
    logoY: Number(templateDesigner.logoY || 12),
    footer: templateDesigner.footerTextItems.map((item) => item.text).filter(Boolean).join("\n"),
    headerHeight: Number(templateDesigner.headerHeight || 92),
    footerHeight: Number(templateDesigner.footerHeight || 70),
    headerFontFamily: normalizeFontPreset(templateDesigner.headerFontFamily),
    headerFontSize: Number(templateDesigner.headerFontSize || 14),
    headerTextColor: templateDesigner.headerTextColor,
    tableFontFamily: normalizeFontPreset(templateDesigner.tableFontFamily),
    tableFontSize: Number(templateDesigner.tableFontSize || 11),
    tableTextColor: templateDesigner.tableTextColor,
    tableHeaderTextColor: templateDesigner.tableHeaderTextColor,
    tableHeaderBgColor: templateDesigner.tableHeaderBgColor,
    tableBorderColor: templateDesigner.tableBorderColor,
    tableBorderWidth: Number(templateDesigner.tableBorderWidth || 1),
    tableHeaderBold: Boolean(templateDesigner.tableHeaderBold),
    tableBold: Boolean(templateDesigner.tableBold),
    tableAlign: templateDesigner.tableAlign || "left",
    footerFontFamily: normalizeFontPreset(templateDesigner.footerFontFamily),
    footerFontSize: Number(templateDesigner.footerFontSize || 12),
    footerTextColor: templateDesigner.footerTextColor,
    columns: columns.map((column) => ({ ...column }))
  });
}

function templateDesignerPayload() {
  return {
    id: templateForm.id,
    name: String(templateForm.name || "").trim(),
    format: "通用",
    description: String(templateForm.description || "").trim(),
    content: buildTemplateDesignerContent()
  };
}

function templateAutosaveSnapshot(payload = templateDesignerPayload()) {
  return JSON.stringify({
    id: payload.id || null,
    name: payload.name || "",
    description: payload.description || "",
    content: payload.content || ""
  });
}

function markTemplateSnapshot(payload = templateForm) {
  templateLastSavedSnapshot = templateAutosaveSnapshot({
    id: payload.id,
    name: payload.name,
    description: payload.description,
    content: payload.content
  });
}

function applyTemplateServerItem(item) {
  templateAutosaveApplying = true;
  Object.assign(templateForm, item);
  markTemplateSnapshot(item);
  nextTick(() => {
    templateAutosaveApplying = false;
  });
}

function scheduleTemplateAutosave() {
  window.clearTimeout(templateAutosaveTimer);
  if (templateAutosaveApplying || templateEditorLoading.value || !templateModalOpen.value || !templateForm.id) return;
  templateAutosaveTimer = window.setTimeout(() => {
    autosaveTemplateDesignerContent();
  }, 900);
}

async function saveTemplate() {
  if (templateEditorLoading.value) return;
  try {
    await syncFeeItemOrderFromTemplateColumns();
    const payload = templateDesignerPayload();
    const item = await templatesApi.saveTemplate(payload.id, payload);
    templateRows.value = templateForm.id
      ? templateRows.value.map((row) => row.id === item.id ? item : row)
      : [item, ...templateRows.value];
    applyTemplateServerItem(item);
    selectedTemplateId.value = item.id;
    notify("模板已保存");
    templateModalOpen.value = false;
  } catch (error) {
    notify(error.message);
  }
}

async function autosaveTemplateDesignerContent(options = {}) {
  if (!templateForm.id || templateEditorLoading.value) return;
  try {
    await syncFeeItemOrderFromTemplateColumns();
    const payload = templateDesignerPayload();
    const snapshot = templateAutosaveSnapshot(payload);
    if (!options.force && snapshot === templateLastSavedSnapshot) return;
    const item = await templatesApi.updateTemplate(payload.id, payload);
    templateRows.value = templateRows.value.map((row) => row.id === item.id ? item : row);
    applyTemplateServerItem(item);
  } catch (error) {
    notify(error.message);
  }
}

function defaultTemplateColumns() {
  return [
    { ...TEMPLATE_SYSTEM_SEQUENCE_COLUMN, visible: true, fontSize: 11 },
    { key: "no", label: "订单号", visible: true, fontSize: 11, width: 118 },
    { key: "customer", label: "客户", visible: true, fontSize: 11, width: 156 },
    { key: "date", label: "日期", visible: true, fontSize: 11, width: 86 },
    { key: "businessType", label: "业务类型", visible: true, fontSize: 11, width: 70 },
    { key: "loading", label: "装货地", visible: true, fontSize: 11, width: 96 },
    { key: "unloading", label: "卸货地", visible: true, fontSize: 11, width: 96 },
    { key: "status", label: "状态", visible: true, fontSize: 11, width: 64 },
    ...TEMPLATE_SYSTEM_TOTAL_COLUMNS.map((column) => ({
      ...column,
      visible: true,
      fontSize: 11
    }))
  ];
}

function defaultTemplateColumnWidth(key = "") {
  return defaultTemplateColumns().find((column) => column.key === key)?.width
    || TEMPLATE_ORDER_BASE_COLUMNS.find((column) => column.key === key)?.width
    || 86;
}

function defaultHeaderTextItems(header = "公司名称 / 导出标题\n日期：{{date}}") {
  return [{
    id: `header-text-${Date.now()}`,
    text: header,
    x: 18,
    y: 18,
    width: 260,
    fontFamily: "standard-serif-cn",
    fontSize: 14,
    bold: true,
    align: "left"
  }];
}

function loadTemplateDesigner(content = "") {
  let parsed = null;
  try {
    parsed = content ? JSON.parse(content) : null;
  } catch {
    parsed = null;
  }
  templateDesigner.orientation = ["portrait", "landscape", "fluid"].includes(parsed?.orientation) ? parsed.orientation : "portrait";
  templateDesigner.header = parsed?.header || "公司名称 / 导出标题\n日期：{{date}}";
  templateDesigner.headerX = Number(parsed?.headerX ?? 18);
  templateDesigner.headerY = Number(parsed?.headerY ?? 18);
  const headerItems = Array.isArray(parsed?.headerTextItems) && parsed.headerTextItems.length
    ? parsed.headerTextItems
    : defaultHeaderTextItems(templateDesigner.header);
  templateDesigner.headerTextItems.splice(
    0,
    templateDesigner.headerTextItems.length,
    ...headerItems.map((item, index) => ({
      id: item.id || `header-text-${Date.now()}-${index}`,
      text: item.text || "",
      x: Number(item.x ?? templateDesigner.headerX ?? 18),
      y: Number(item.y ?? templateDesigner.headerY ?? 18),
      width: Math.max(80, Math.min(520, Number(item.width || 260))),
      fontFamily: normalizeFontPreset(item.fontFamily || parsed?.headerFontFamily),
      fontSize: Number(item.fontSize || parsed?.headerFontSize || 14),
      color: item.color || parsed?.headerTextColor || "#17233c",
      bold: Boolean(item.bold),
      align: ["left", "center", "right"].includes(item.align) ? item.align : "left"
    }))
  );
  setTemplateVariableTarget("header", templateDesigner.headerTextItems[0]?.id || "");
  templateDesigner.logo = parsed?.logo || "";
  templateDesigner.logoName = parsed?.logoName || "";
  templateDesigner.logoWidth = Number(parsed?.logoWidth || 92);
  templateDesigner.logoHeight = Number(parsed?.logoHeight || 56);
  templateDesigner.logoFit = parsed?.logoFit === "cover" ? "cover" : "contain";
  templateDesigner.logoX = Number(parsed?.logoX ?? 18);
  templateDesigner.logoY = Number(parsed?.logoY ?? 12);
  templateDesigner.footer = parsed?.footer || "制表人：{{user}}    第 {{page}} 页 / 共 {{pages}} 页";
  const footerItems = Array.isArray(parsed?.footerTextItems) && parsed.footerTextItems.length
    ? parsed.footerTextItems
    : [{
      id: `footer-text-${Date.now()}`,
      text: templateDesigner.footer,
      x: 18,
      y: 12,
      width: 280,
      fontFamily: parsed?.footerFontFamily,
      fontSize: parsed?.footerFontSize || 12,
      color: parsed?.footerTextColor || "#64748b",
      bold: false,
      align: "left"
    }];
  templateDesigner.footerTextItems.splice(
    0,
    templateDesigner.footerTextItems.length,
    ...footerItems.map((item, index) => ({
      id: item.id || `footer-text-${Date.now()}-${index}`,
      text: item.text || "",
      x: Number(item.x ?? 18),
      y: Number(item.y ?? 12),
      width: Math.max(80, Math.min(520, Number(item.width || 280))),
      fontFamily: normalizeFontPreset(item.fontFamily || parsed?.footerFontFamily),
      fontSize: Number(item.fontSize || parsed?.footerFontSize || 12),
      color: item.color || parsed?.footerTextColor || "#64748b",
      bold: Boolean(item.bold),
      align: ["left", "center", "right"].includes(item.align) ? item.align : "left"
    }))
  );
  templateDesigner.headerHeight = Number(parsed?.headerHeight || 92);
  templateDesigner.footerHeight = Number(parsed?.footerHeight || 70);
  templateDesigner.headerFontFamily = normalizeFontPreset(parsed?.headerFontFamily);
  templateDesigner.headerFontSize = Number(parsed?.headerFontSize || 14);
  templateDesigner.headerTextColor = parsed?.headerTextColor || "#17233c";
  templateDesigner.tableFontFamily = normalizeFontPreset(parsed?.tableFontFamily);
  templateDesigner.tableFontSize = Number(parsed?.tableFontSize || 11);
  templateDesigner.tableTextColor = parsed?.tableTextColor || "#1f2937";
  templateDesigner.tableHeaderTextColor = parsed?.tableHeaderTextColor || "#164e8f";
  templateDesigner.tableHeaderBgColor = parsed?.tableHeaderBgColor || "#eef6ff";
  templateDesigner.tableBorderColor = parsed?.tableBorderColor || "#dbeafe";
  templateDesigner.tableBorderWidth = Number(parsed?.tableBorderWidth || 1);
  templateDesigner.tableHeaderBold = parsed?.tableHeaderBold !== false;
  templateDesigner.tableBold = Boolean(parsed?.tableBold);
  templateDesigner.tableAlign = ["left", "center", "right"].includes(parsed?.tableAlign) ? parsed.tableAlign : "left";
  templateDesigner.footerFontFamily = normalizeFontPreset(parsed?.footerFontFamily);
  templateDesigner.footerFontSize = Number(parsed?.footerFontSize || 12);
  templateDesigner.footerTextColor = parsed?.footerTextColor || "#64748b";
  const parsedColumns = filterRemovedTemplateColumns(
    Array.isArray(parsed?.columns) && parsed.columns.length ? parsed.columns : defaultTemplateColumns()
  );
  const parsedColumnKeys = new Set(parsedColumns.map((column) => column.key));
  const missingManagedColumns = TEMPLATE_SYSTEM_MANAGED_COLUMNS
    .filter((column) => !parsedColumnKeys.has(column.key))
    .map((column) => ({
        ...column,
        visible: true,
        fontSize: Number(templateDesigner.tableFontSize || 11)
      }));
  const columns = [
    ...missingManagedColumns.filter((column) => column.key === TEMPLATE_SYSTEM_SEQUENCE_COLUMN.key),
    ...parsedColumns,
    ...missingManagedColumns.filter((column) => column.key !== TEMPLATE_SYSTEM_SEQUENCE_COLUMN.key)
  ];
  templateDesigner.columns.splice(
    0,
    templateDesigner.columns.length,
    ...columns.map((column, index) => ({
      ...column,
      key: column.key || `custom-${index}`,
      label: column.label || column.key || `字段${index + 1}`,
      visible: column.visible !== false,
      fontSize: Number(column.fontSize || templateDesigner.tableFontSize || 11),
      order: getTemplateColumnOrder(column, index),
      width: Number(column.width || defaultTemplateColumnWidth(column.key)),
      ...normalizeTemplateColumnStyle(column)
    }))
  );
  sortTemplateColumnsByOrder();
  ensureAllTemplateColumns();
}

function editTemplate(item = selectedTemplate.value) {
  window.clearTimeout(templateAutosaveTimer);
  templateAutosaveApplying = true;
  Object.assign(templateForm, {
    id: item?.id || null,
    name: item?.name || "",
    format: "通用",
    description: item?.description || "",
    content: item?.content || ""
  });
  loadTemplateDesigner(item?.content || "");
  markTemplateSnapshot(templateForm);
  nextTick(() => {
    templateAutosaveApplying = false;
  });
}

async function openTemplateEditor(item = null) {
  window.clearTimeout(templateAutosaveTimer);
  templateModalOpen.value = true;
  templateEditorLoading.value = Boolean(item?.id && !item.contentLoaded && !item.content);
  editTemplate(item);
  if (item?.id) selectedTemplateId.value = item.id;
  try {
    if (item?.id && templateEditorLoading.value) {
      const fullItem = await ensureTemplateContent(item);
      editTemplate(fullItem);
      if (fullItem?.id) selectedTemplateId.value = fullItem.id;
    }
  } catch (error) {
    notify(error.message || "模板加载失败");
  } finally {
    templateEditorLoading.value = false;
  }
}

async function closeTemplateEditor() {
  window.clearTimeout(templateAutosaveTimer);
  templateEditorLoading.value = false;
  if (templateForm.id) {
    await autosaveTemplateDesignerContent({ force: true });
  }
  templateModalOpen.value = false;
}

function nextTemplateCopyName(name) {
  const baseName = `${name || "未命名模板"} 副本`;
  const names = new Set(templateRows.value.map((item) => item.name));
  if (!names.has(baseName)) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`)) index += 1;
  return `${baseName} ${index}`;
}

async function duplicateTemplate(item) {
  try {
    const sourceItem = await ensureTemplateContent(item);
    const payload = {
      name: nextTemplateCopyName(sourceItem.name),
      format: "通用",
      description: sourceItem.description || "",
      content: sourceItem.content || ""
    };
    const copied = await templatesApi.createTemplate(payload);
    templateRows.value = [copied, ...templateRows.value];
    selectedTemplateId.value = copied.id;
    openTemplateEditor(copied);
    notify(`已复制模板：${copied.name}`);
  } catch (error) {
    notify(error.message);
  }
}

function moveTemplateColumn(index, offset) {
  const target = index + offset;
  if (target < 0 || target >= templateDesigner.columns.length) return;
  const column = templateDesigner.columns[index];
  const targetColumn = templateDesigner.columns[target];
  if (!column || !targetColumn) return;
  const currentOrder = getTemplateColumnOrder(column, index);
  column.order = getTemplateColumnOrder(targetColumn, target);
  targetColumn.order = currentOrder;
  sortTemplateColumnsByOrder();
  syncFeeItemOrderFromTemplateColumns();
}

function moveTemplateColumnTo(index, rawPosition) {
  const nextPosition = Number.parseInt(rawPosition, 10);
  if (!Number.isFinite(nextPosition) || nextPosition < 1) return;
  const column = templateDesigner.columns[index];
  if (!column) return;
  column.order = nextPosition;
  sortTemplateColumnsByOrder();
  syncFeeItemOrderFromTemplateColumns();
}

function getTemplateColumnOrder(column, index = 0) {
  const value = Number.parseInt(column?.order, 10);
  return Number.isFinite(value) && value > 0 ? value : index + 1;
}

function getNextTemplateColumnOrder() {
  return templateDesigner.columns.reduce(
    (max, column, index) => Math.max(max, getTemplateColumnOrder(column, index)),
    0
  ) + 1;
}

function sortTemplateColumnsByOrder() {
  const sortedColumns = templateDesigner.columns
    .map((column, index) => ({ column, index, order: getTemplateColumnOrder(column, index) }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.column);
  templateDesigner.columns.splice(0, templateDesigner.columns.length, ...sortedColumns);
}

function addTemplateColumn() {
  templateDesigner.columns.push({
    key: `custom-${Date.now()}`,
    label: "自定义字段",
    visible: true,
    order: getNextTemplateColumnOrder(),
    fontSize: Number(templateDesigner.tableFontSize || 11),
    width: 86,
    ...normalizeTemplateColumnStyle()
  });
}

function buildTemplateOrderColumn(column, fallbackIndex = templateDesigner.columns.length) {
  if (isRemovedTemplateColumnKey(column?.key)) return null;
  return {
    key: column.key,
    label: column.label,
    visible: true,
    order: getTemplateColumnOrder(column, fallbackIndex),
    fontSize: Number(templateDesigner.tableFontSize || 11),
    width: Number(column.width || defaultTemplateColumnWidth(column.key)),
    ...normalizeTemplateColumnStyle(column || {})
  };
}

function addTemplateOrderColumn(column) {
  if (!column?.key || isRemovedTemplateColumnKey(column.key)) return;
  if (templateDesigner.columns.some((item) => item.key === column.key)) {
    const target = templateDesigner.columns.find((item) => item.key === column.key);
    if (target) target.visible = true;
    activeTemplateColumnKey.value = column.key;
    notify(`${column.label}已在表格明细列中`);
    return;
  }
  const nextColumn = buildTemplateOrderColumn(column);
  if (!nextColumn) return;
  templateDesigner.columns.push(nextColumn);
  sortTemplateColumnsByOrder();
  activeTemplateColumnKey.value = column.key;
  notify(`已添加订单字段：${column.label}`);
}

function syncOrderFieldsToTemplateColumns() {
  const existingKeys = new Set(templateDesigner.columns.map((column) => column.key));
  const items = TEMPLATE_ORDER_BASE_COLUMNS.filter((column) => !isRemovedTemplateColumnKey(column.key) && !existingKeys.has(column.key));
  if (items.length === 0) {
    notify("订单字段已同步，无新增字段");
    return;
  }
  templateDesigner.columns.push(...items.map((column, offset) => buildTemplateOrderColumn(column, templateDesigner.columns.length + offset)));
  sortTemplateColumnsByOrder();
  activeTemplateColumnKey.value = items[0].key;
  notify(`已同步 ${items.length} 个订单字段`);
}

function ensureAllTemplateColumns() {
  const existingKeys = new Set(templateDesigner.columns.map((column) => column.key));
  const fixedColumns = [
    ...defaultTemplateColumns(),
    ...TEMPLATE_ORDER_BASE_COLUMNS
  ];
  const missingFixedColumns = fixedColumns
    .filter((column) => column?.key && !isRemovedTemplateColumnKey(column.key) && !existingKeys.has(column.key))
    .map((column, offset) => ({
      ...buildTemplateOrderColumn(column, templateDesigner.columns.length + offset),
      visible: column.visible !== false,
      fontSize: Number(column.fontSize || templateDesigner.tableFontSize || 11)
    }));
  if (missingFixedColumns.length) {
    templateDesigner.columns.push(...missingFixedColumns);
  }
  sortTemplateColumnsByOrder();
  ensureAllFeeItemsInTemplateColumns();
}

function findTemplateFeeColumnForItem(item, columns = templateDesigner.columns) {
  return columns.find((column) =>
    column.feeItemId === item.id
    || column.feeName === item.name
    || column.label === item.name
    || column.key === `fee-item-${item.id}`
  ) || null;
}

function ensureAllFeeItemsInTemplateColumns() {
  const items = sortedFeeItemRows.value.filter((item) => item.name);
  if (items.length === 0) return;
  const existingFeeColumns = templateDesigner.columns.filter(isTemplateFeeItemColumn);
  const existingNonFeeColumns = templateDesigner.columns.filter((column) =>
    !isRemovedTemplateColumnKey(column.key) && !isTemplateFeeItemColumn(column)
  );
  const usedItemIds = new Set();
  const normalizedExistingFeeColumns = existingFeeColumns
    .map((column) => {
      const item = items.find((row) =>
        row.id === column.feeItemId
        || row.name === column.feeName
        || row.name === column.label
      );
      if (!item || usedItemIds.has(item.id)) return null;
      usedItemIds.add(item.id);
      return buildFeeItemTemplateColumn(item, column);
    })
    .filter(Boolean);
  const missingFeeColumns = items
    .filter((item) => !usedItemIds.has(item.id))
    .map((item, offset) => buildFeeItemTemplateColumn(item, null, templateDesigner.columns.length + offset));
  templateDesigner.columns.splice(
    0,
    templateDesigner.columns.length,
    ...existingNonFeeColumns,
    ...normalizedExistingFeeColumns,
    ...missingFeeColumns
  );
  sortTemplateColumnsByOrder();
}

function syncFeeItemsToTemplateColumns() {
  const items = sortedFeeItemRows.value.filter((item) => item.name);
  if (items.length === 0) {
    notify("暂无收费项目可同步");
    return;
  }
  const nonFeeColumns = templateDesigner.columns.filter((column) =>
    !isRemovedTemplateColumnKey(column.key) && !isTemplateFeeItemColumn(column)
  );
  const nextFeeColumns = items.map((item, offset) =>
    buildFeeItemTemplateColumn(item, findTemplateFeeColumnForItem(item), nonFeeColumns.length + offset)
  );
  templateDesigner.columns.splice(
    0,
    templateDesigner.columns.length,
    ...nonFeeColumns,
    ...nextFeeColumns
  );
  sortTemplateColumnsByOrder();
  notify(`已按收费项目顺序同步 ${nextFeeColumns.length} 个收费项目`);
}

function removeTemplateColumn(index) {
  templateDesigner.columns.splice(index, 1);
}

function updateTemplateTableFontSize(event) {
  const nextSize = Math.max(5, Math.min(22, Number(event?.target?.value || templateDesigner.tableFontSize || 11)));
  templateDesigner.tableFontSize = nextSize;
  templateDesigner.columns.forEach((column) => {
    column.fontSize = nextSize;
  });
}

function startTemplateColumnResize(event, column) {
  const sourceColumn = templateDesigner.columns.find((item) => item.key === column.key);
  if (!sourceColumn) return;
  showTemplateTableToolbar();
  templateColumnResize.active = true;
  templateColumnResize.key = sourceColumn.key;
  templateColumnResize.startX = event.clientX;
  templateColumnResize.startWidth = Number(sourceColumn.width || defaultTemplateColumnWidth(sourceColumn.key));
  event.currentTarget?.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", moveTemplateColumnResize);
  window.addEventListener("pointerup", stopTemplateColumnResize, { once: true });
  window.addEventListener("pointercancel", stopTemplateColumnResize, { once: true });
  window.addEventListener("mousemove", moveTemplateColumnResize);
  window.addEventListener("mouseup", stopTemplateColumnResize, { once: true });
}

function moveTemplateColumnResize(event) {
  if (!templateColumnResize.active) return;
  const sourceColumn = templateDesigner.columns.find((item) => item.key === templateColumnResize.key);
  if (!sourceColumn) return;
  const nextWidth = Math.round(templateColumnResize.startWidth + event.clientX - templateColumnResize.startX);
  sourceColumn.width = Math.max(36, Math.min(260, nextWidth));
}

function stopTemplateColumnResize() {
  const shouldAutosave = templateColumnResize.active;
  templateColumnResize.active = false;
  templateColumnResize.key = "";
  window.removeEventListener("pointermove", moveTemplateColumnResize);
  window.removeEventListener("mousemove", moveTemplateColumnResize);
  if (shouldAutosave) {
    autosaveTemplateDesignerContent();
  }
}

function setAllTemplateColumnsVisible(visible) {
  templateDesigner.columns.forEach((column) => {
    column.visible = visible;
  });
}

function setTemplatePreviewZoom(value) {
  templateDesigner.previewZoom = value === "fit" ? "fit" : Math.max(60, Math.min(160, Number(value || 100)));
}

function adjustTemplatePreviewZoom(delta) {
  const current = templateDesigner.previewZoom === "fit" ? 100 : Number(templateDesigner.previewZoom || 100);
  setTemplatePreviewZoom(current + delta);
}

function addHeaderTextItem() {
  const item = createTemplateTextItem("header", {
    id: `header-text-${Date.now()}`,
    text: "双击编辑文本",
    x: 40,
    y: 24,
    free: true
  });
  templateDesigner.headerTextItems.push(item);
  setTemplateVariableTarget("header", item.id);
  showTemplateTextToolbar("header", item.id);
  editingTemplateTextKey.value = templateTextItemKey("header", item.id);
  nextTick(() => {
    document
      .querySelector(`[data-template-text-key="${templateTextItemKey("header", item.id)}"] .template-free-text-editor`)
      ?.focus?.();
  });
  return item;
}

function addFooterTextItem() {
  const item = createTemplateTextItem("footer", {
    id: `footer-text-${Date.now()}`,
    text: "双击编辑文本",
    x: 18,
    y: Math.max(20, templatePagePixelHeight() - Number(templateDesigner.footerHeight || 70) + 8)
  });
  templateDesigner.footerTextItems.push(item);
  setTemplateVariableTarget("footer", item.id);
  showTemplateTextToolbar("footer", item.id);
  editingTemplateTextKey.value = templateTextItemKey("footer", item.id);
  return item;
}

function addFreeTemplateTextBox() {
  return addHeaderTextItem();
}

function removeHeaderTextItem(index) {
  const removed = templateDesigner.headerTextItems[index];
  templateDesigner.headerTextItems.splice(index, 1);
  if (removed?.id && activeTemplateVariableTarget.id === removed.id) {
    const fallback = templateDesigner.headerTextItems[0] || templateDesigner.footerTextItems[0];
    setTemplateVariableTarget(fallback?.id?.startsWith("footer-text-") ? "footer" : "header", fallback?.id || "");
  }
}

function removeFooterTextItem(index) {
  const removed = templateDesigner.footerTextItems[index];
  templateDesigner.footerTextItems.splice(index, 1);
  if (removed?.id && activeTemplateVariableTarget.id === removed.id) {
    const fallback = templateDesigner.footerTextItems[0] || templateDesigner.headerTextItems[0];
    setTemplateVariableTarget(fallback?.id?.startsWith("footer-text-") ? "footer" : "header", fallback?.id || "");
  }
}

function createTemplateTextItem(type = "header", overrides = {}) {
  const isFooter = type === "footer";
  return normalizeTemplateTextItem({
    id: `${type}-text-${Date.now()}`,
    text: "双击编辑文本",
    x: isFooter ? 18 : 40,
    y: isFooter ? Math.max(20, templatePagePixelHeight() - Number(templateDesigner.footerHeight || 70) + 8) : 24,
    width: 220,
    height: 48,
    fontFamily: isFooter ? templateDesigner.footerFontFamily : templateDesigner.headerFontFamily,
    fontSize: isFooter ? Number(templateDesigner.footerFontSize || 12) : Number(templateDesigner.headerFontSize || 14),
    color: isFooter ? templateDesigner.footerTextColor || "#64748b" : templateDesigner.headerTextColor || "#17233c",
    bold: false,
    align: "left",
    free: true,
    ...overrides
  }, type);
}

function setTemplateVariableTarget(type, id = "") {
  activeTemplateVariableTarget.type = type;
  activeTemplateVariableTarget.id = id;
}

function showTemplateTextToolbar(type, id = "") {
  setTemplateVariableTarget(type, id);
  templateTextToolbarOpen.value = !!id;
  templateTableToolbarOpen.value = false;
}

function showTemplateTableToolbar() {
  templateTextToolbarOpen.value = false;
  templateTableToolbarOpen.value = true;
  if (!activeTemplateTableSelection.type) {
    activeTemplateTableSelection.type = "table";
    activeTemplateTableSelection.rowIndex = null;
  }
}

function normalizeTemplateColumnStyle(column = {}) {
  const align = ["left", "center", "right"].includes(column.align) ? column.align : "";
  return {
    headerBgColor: column.headerBgColor || "",
    headerTextColor: column.headerTextColor || "",
    bodyBgColor: column.bodyBgColor || "",
    bodyTextColor: column.bodyTextColor || "",
    align,
    headerBold: typeof column.headerBold === "boolean" ? column.headerBold : "",
    bold: Boolean(column.bold)
  };
}

function selectTemplateColumn(column) {
  if (!column?.key) return;
  activeTemplateColumnKey.value = column.key;
  activeTemplateTableSelection.type = "column";
  activeTemplateTableSelection.rowIndex = null;
  showTemplateTableToolbar();
}

function toggleTemplateColumnSelection(column) {
  if (activeTemplateColumnKey.value === column?.key) {
    activeTemplateColumnKey.value = "";
    activeTemplateTableSelection.type = "table";
    activeTemplateTableSelection.rowIndex = null;
    showTemplateTableToolbar();
    return;
  }
  selectTemplateColumn(column);
}

function selectTemplateTableRow(type = "table", rowIndex = null) {
  activeTemplateColumnKey.value = "";
  activeTemplateTableSelection.type = type;
  activeTemplateTableSelection.rowIndex = rowIndex;
  showTemplateTableToolbar();
}

function templateTableSelectionLabel() {
  if (activeTemplateTableSelection.type === "header") return "表头行";
  if (activeTemplateTableSelection.type === "body") return `明细行 ${Number(activeTemplateTableSelection.rowIndex || 0) + 1}`;
  if (activeTemplateTableSelection.type === "total") return "合计行";
  if (activeTemplateColumnKey.value) {
    const column = templateDesigner.columns.find((item) => item.key === activeTemplateColumnKey.value);
    return column ? `字段：${column.label}` : "字段";
  }
  return "批量设置";
}

function templateHeaderCellClass(column = {}) {
  return {
    "is-active-template-column": activeTemplateColumnKey.value === column.key,
    "is-active-template-row": activeTemplateTableSelection.type === "header"
  };
}

function templateBodyCellClass(column = {}, row = {}, rowIndex = 0) {
  const isTotal = Boolean(row?.__total);
  return {
    "is-active-template-column": activeTemplateColumnKey.value === column.key,
    "is-active-template-row": isTotal
      ? activeTemplateTableSelection.type === "total"
      : activeTemplateTableSelection.type === "body" && activeTemplateTableSelection.rowIndex === rowIndex
  };
}

function templateColumnHeaderStyle(column = {}) {
  const align = column.align || templateDesigner.tableAlign || "left";
  return {
    fontSize: `${Number(column.fontSize || templateDesigner.tableFontSize || 11)}px`,
    textAlign: align,
    fontWeight: templateColumnHeaderBold(column) ? 700 : 400,
    background: column.headerBgColor || templateDesigner.tableHeaderBgColor,
    color: column.headerTextColor || templateDesigner.tableHeaderTextColor
  };
}

function templateColumnHeaderBold(column = {}) {
  if (column.headerBold === true) return true;
  if (column.headerBold === false) return false;
  return Boolean(templateDesigner.tableHeaderBold);
}

function templateColumnCellStyle(column = {}, row = {}) {
  const align = column.align || templateDesigner.tableAlign || "left";
  const isTotal = Boolean(row?.__total);
  return {
    fontSize: `${Number(column.fontSize || templateDesigner.tableFontSize || 11)}px`,
    textAlign: align,
    fontWeight: isTotal || column.bold || templateDesigner.tableBold ? 700 : 400,
    background: column.bodyBgColor || (isTotal ? templateDesigner.tableHeaderBgColor : undefined),
    color: column.bodyTextColor || templateDesigner.tableTextColor
  };
}

function resetTemplateColumnStyle(column = {}) {
  column.headerBgColor = "";
  column.headerTextColor = "";
  column.bodyBgColor = "";
  column.bodyTextColor = "";
  column.align = "";
  column.headerBold = "";
  column.bold = false;
}

function hideTemplateTextToolbar() {
  templateTextToolbarOpen.value = false;
  templateTableToolbarOpen.value = false;
}

function appendTemplateVariableText(currentText, variable) {
  const text = String(currentText || "").trimEnd();
  return text ? `${text} ${variable}` : variable;
}

function insertTemplateVariable(variable) {
  if (activeTemplateVariableTarget.type === "footer") {
    let item = templateDesigner.footerTextItems.find((textItem) => textItem.id === activeTemplateVariableTarget.id);
    if (!item) {
      if (!templateDesigner.footerTextItems.length) addFooterTextItem();
      item = templateDesigner.footerTextItems[0];
      if (item) setTemplateVariableTarget("footer", item.id);
    }
    if (item) item.text = appendTemplateVariableText(item.text, variable);
    return;
  }
  let item = templateDesigner.headerTextItems.find((textItem) => textItem.id === activeTemplateVariableTarget.id);
  if (!item) {
    if (!templateDesigner.headerTextItems.length) {
      addHeaderTextItem();
    }
    item = templateDesigner.headerTextItems[0];
    if (item) setTemplateVariableTarget("header", item.id);
  }
  if (!item) return;
  item.text = appendTemplateVariableText(item.text, variable);
}

function uploadTemplateLogo(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    notify("请上传图片文件");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    templateDesigner.logo = String(reader.result || "");
    templateDesigner.logoName = file.name;
    templateDesigner.logoWidth = Number(templateDesigner.logoWidth || 92);
    templateDesigner.logoHeight = Number(templateDesigner.logoHeight || 56);
    templateDesigner.logoFit = templateDesigner.logoFit === "cover" ? "cover" : "contain";
    templateDesigner.logoX = Number(templateDesigner.logoX || 18);
    templateDesigner.logoY = Number(templateDesigner.logoY || 12);
  };
  reader.readAsDataURL(file);
}

function clearTemplateLogo() {
  templateDesigner.logo = "";
  templateDesigner.logoName = "";
}

function startTemplateHeaderDrag(event, target = "header") {
  if (target === "logo" && !templateDesigner.logo) return;
  if (target.startsWith("header-text:")) {
    const id = target.slice("header-text:".length);
    promoteTemplateTextToFree("header", findTemplateTextItem("header", id));
    showTemplateTextToolbar("header", id);
  } else if (target.startsWith("footer-text:")) {
    const id = target.slice("footer-text:".length);
    promoteTemplateTextToFree("footer", findTemplateTextItem("footer", id));
    showTemplateTextToolbar("footer", id);
  } else {
    hideTemplateTextToolbar();
  }
  templateLogoDrag.active = true;
  templateLogoDrag.target = target;
  templateLogoDrag.startX = event.clientX;
  templateLogoDrag.startY = event.clientY;
  const textItem = target.startsWith("header-text:")
    ? templateDesigner.headerTextItems.find((item) => item.id === target.slice("header-text:".length))
    : target.startsWith("footer-text:")
      ? templateDesigner.footerTextItems.find((item) => item.id === target.slice("footer-text:".length))
    : null;
  templateLogoDrag.originX = Number(target === "logo" ? templateDesigner.logoX : textItem?.x ?? templateDesigner.headerX ?? 0);
  templateLogoDrag.originY = Number(target === "logo" ? templateDesigner.logoY : textItem?.y ?? templateDesigner.headerY ?? 0);
  event.currentTarget?.setPointerCapture?.(event.pointerId);
}

function moveTemplateHeaderItem(event) {
  if (!templateLogoDrag.active) return;
  const isTextTarget = templateLogoDrag.target.startsWith("header-text:") || templateLogoDrag.target.startsWith("footer-text:");
  const area = isTextTarget
    ? event.currentTarget?.closest?.(".template-a4-page")
    : event.currentTarget?.closest?.(".template-page-header, .template-page-footer");
  const itemWidth = templateLogoDrag.target === "logo"
    ? Number(templateDesigner.logoWidth || 92)
    : Number(event.currentTarget?.offsetWidth || 160);
  const itemHeight = templateLogoDrag.target === "logo"
    ? Number(templateDesigner.logoHeight || event.currentTarget?.offsetHeight || 56)
    : Number(event.currentTarget?.offsetHeight || 28);
  const maxX = Math.max(0, Number(area?.clientWidth || templatePagePixelWidth()) - itemWidth - 8);
  const maxY = Math.max(0, Number(area?.clientHeight || (isTextTarget ? templatePagePixelHeight() : templateDesigner.headerHeight || 92)) - itemHeight - 4);
  const nextX = templateLogoDrag.originX + event.clientX - templateLogoDrag.startX;
  const nextY = templateLogoDrag.originY + event.clientY - templateLogoDrag.startY;
  if (templateLogoDrag.target === "logo") {
    templateDesigner.logoX = Math.min(maxX, Math.max(0, Math.round(nextX)));
    templateDesigner.logoY = Math.min(maxY, Math.max(0, Math.round(nextY)));
  } else if (templateLogoDrag.target.startsWith("header-text:")) {
    const textItem = templateDesigner.headerTextItems.find((item) => item.id === templateLogoDrag.target.slice("header-text:".length));
    if (textItem) {
      textItem.x = Math.min(maxX, Math.max(0, Math.round(nextX)));
      textItem.y = Math.min(maxY, Math.max(0, Math.round(nextY)));
    }
  } else if (templateLogoDrag.target.startsWith("footer-text:")) {
    const textItem = templateDesigner.footerTextItems.find((item) => item.id === templateLogoDrag.target.slice("footer-text:".length));
    if (textItem) {
      textItem.x = Math.min(maxX, Math.max(0, Math.round(nextX)));
      textItem.y = Math.min(maxY, Math.max(0, Math.round(nextY)));
    }
  } else {
    templateDesigner.headerX = Math.min(maxX, Math.max(0, Math.round(nextX)));
    templateDesigner.headerY = Math.min(maxY, Math.max(0, Math.round(nextY)));
  }
}

function stopTemplateHeaderDrag() {
  templateLogoDrag.active = false;
  templateLogoDrag.target = "";
}

async function deleteTemplate(item) {
  try {
    await templatesApi.deleteTemplate(item.id);
    templateRows.value = templateRows.value.filter((row) => row.id !== item.id);
    editTemplate(exportTemplateRows.value[0]);
    notify("模板已删除");
  } catch (error) {
    notify(error.message);
  }
}

function editRule(item = selectedRule.value) {
  Object.assign(ruleForm, {
    id: item?.id || null,
    ruleType: item?.ruleType || "业务规则",
    name: item?.name || "",
    content: item?.content || "",
    enabled: item?.enabled ?? true
  });
}

async function saveRule() {
  try {
    const item = await masterDataApi.saveRule(ruleForm.id, ruleForm);
    ruleRows.value = ruleForm.id
      ? ruleRows.value.map((row) => row.id === item.id ? item : row)
      : [item, ...ruleRows.value];
    editRule(item);
    notify("规则已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteRule(item) {
  try {
    await masterDataApi.deleteRule(item.id);
    ruleRows.value = ruleRows.value.filter((row) => row.id !== item.id);
    editRule(ruleRows.value[0]);
    notify("规则已删除");
  } catch (error) {
    notify(error.message);
  }
}

function editMaster(item = selectedMaster.value) {
  Object.assign(masterForm, {
    id: item?.id || null,
    type: item?.type || "口岸",
    name: item?.name || "",
    value: item?.value || item?.name || "",
    sortOrder: Number(item?.sortOrder || 0)
  });
}

async function saveMaster() {
  try {
    const item = await masterDataApi.saveMasterData(masterForm.id, masterForm);
    masterRows.value = masterForm.id
      ? masterRows.value.map((row) => row.id === item.id ? item : row)
      : [item, ...masterRows.value];
    editMaster(item);
    notify("基础数据已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteMaster(item) {
  try {
    await masterDataApi.deleteMasterData(item.id);
    masterRows.value = masterRows.value.filter((row) => row.id !== item.id);
    editMaster(masterRows.value[0]);
    notify("基础数据已删除");
  } catch (error) {
    notify(error.message);
  }
}

function editAccount(item = selectedAccount.value) {
  const role = normalizeAccountRole(item?.role || "跟单员");
  Object.assign(accountForm, {
    id: item?.id || null,
    username: item?.username || "",
    displayName: item?.displayName || "",
    role,
    status: item?.status || "启用",
    hireDate: item?.hireDate || "",
    phone: item?.phone || "",
    email: item?.email || "",
    note: item?.note || "",
    password: "",
    passwordConfirm: "",
    permissionsText: permissionTextForRole(role)
  });
}

function validateAccountPassword(form, options = {}) {
  const nextPassword = form.password.trim();
  if (options.required && !nextPassword) {
    notify("新增账号必须填写登录密码");
    return null;
  }
  if (nextPassword || form.passwordConfirm) {
    if (nextPassword.length < 4) {
      notify("登录密码至少 4 位");
      return null;
    }
    if (nextPassword !== form.passwordConfirm) {
      notify("两次输入的登录密码不一致");
      return null;
    }
  }
  return nextPassword;
}

function accountPayloadFromForm(form, nextPassword) {
  return {
    ...form,
    passwordConfirm: undefined,
    password: nextPassword || undefined,
    role: normalizeAccountRole(form.role),
    permissions: permissionTextForRole(form.role).split(/[，,、]/).map((item) => item.trim()).filter(Boolean)
  };
}

function openAccountCreateModal() {
  Object.assign(accountCreateForm, blankAccountForm());
  accountCreateModalOpen.value = true;
}

function openAccountEditModal(item = selectedAccount.value) {
  if (!item?.id) {
    notify("请先选择要编辑的账号");
    return;
  }
  selectedAccountId.value = item.id;
  editAccount(item);
  accountEditModalOpen.value = true;
}

async function saveNewAccount() {
  try {
    const nextPassword = validateAccountPassword(accountCreateForm, { required: true });
    if (nextPassword === null) return;
    accountCreateSaving.value = true;
    const item = await accountsApi.createAccount(accountPayloadFromForm(accountCreateForm, nextPassword));
    accountRows.value = [item, ...accountRows.value];
    selectedAccountId.value = item.id;
    editAccount(item);
    accountCreateModalOpen.value = false;
    notify("账号已新增");
  } catch (error) {
    notify(error.message);
  } finally {
    accountCreateSaving.value = false;
  }
}

async function saveAccount() {
  try {
    if (!accountForm.id) {
      notify("请先选择要编辑的账号");
      return;
    }
    const nextPassword = validateAccountPassword(accountForm);
    if (nextPassword === null) return;
    accountEditSaving.value = true;
    const item = await accountsApi.updateAccount(accountForm.id, accountPayloadFromForm(accountForm, nextPassword));
    accountRows.value = accountRows.value.map((row) => row.id === item.id ? item : row);
    selectedAccountId.value = item.id;
    if (item.username === currentUsername.value) {
      setSessionAccount(item);
    }
    editAccount(item);
    accountEditModalOpen.value = false;
    notify("账号权限已保存");
  } catch (error) {
    notify(error.message);
  } finally {
    accountEditSaving.value = false;
  }
}

async function deleteAccount(item) {
  try {
    await accountsApi.deleteAccount(item.id);
    accountRows.value = accountRows.value.filter((row) => row.id !== item.id);
    editAccount(accountRows.value[0]);
    notify("账号已删除");
  } catch (error) {
    notify(error.message);
  }
}

async function refreshAuditLogs() {
  try {
    auditRows.value = await securityApi.listAuditLogs();
    notify("审计日志已刷新");
  } catch (error) {
    notify(error.message);
  }
}

async function copyTextToClipboard(text) {
  const content = String(text || "");
  if (!content.trim()) return false;
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(content);
      return true;
    }
  } catch {
    // Fall through to the textarea copy path for LAN http access.
  }

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
  return copied;
}

async function copyDispatchMessage() {
  const copied = await copyTextToClipboard(dispatchMessage.value);
  notify(copied ? "派车信息已复制" : "复制失败，请手动选中文本复制");
}

function parseContactRemarkPart(contact, label) {
  const pattern = new RegExp(`${label}：([^；]+)`);
  return String(contact?.remark || "").match(pattern)?.[1]?.trim() || "";
}

function contactAreaText(contact) {
  return contact?.area || parseContactRemarkPart(contact, "片区");
}

function contactAddressText(contact) {
  return contact?.address || parseContactRemarkPart(contact, "地址");
}

function resetContactForm(customer = selectedCustomer.value) {
  editingContactId.value = null;
  Object.assign(contactForm, {
    customerId: customer?.id || "",
    name: "",
    gender: "",
    title: "",
    mobile: "",
    phone: "",
    area: "",
    address: "",
    fax: "",
    email: "",
    wechat: "",
    qq: "",
    remark: ""
  });
}

function openContactModal(contact = null) {
  if (!selectedCustomer.value) {
    notify("请先选择客户");
    return;
  }
  if (contact) {
    editingContactId.value = contact.id;
    Object.assign(contactForm, {
      customerId: contact.customerId || selectedCustomer.value.id,
      name: contact.name || "",
      gender: contact.gender || "",
      title: contact.title || "",
      mobile: contact.mobile || "",
      phone: contact.phone || "",
      area: contactAreaText(contact),
      address: contactAddressText(contact),
      fax: contact.fax || "",
      email: contact.email || "",
      wechat: contact.wechat || "",
      qq: contact.qq || "",
      remark: contact.remark || ""
    });
  } else {
    resetContactForm(selectedCustomer.value);
  }
  contactModalOpen.value = true;
}

function resetContactRowDraft(contact = {}) {
  Object.assign(contactRowDraft, {
    name: contact.name || "",
    gender: contact.gender || "",
    title: contact.title || "",
    mobile: contact.mobile || "",
    phone: contact.phone || "",
    area: contact.area || "",
    address: contact.address || "",
    fax: contact.fax || "",
    email: contact.email || "",
    wechat: contact.wechat || "",
    qq: contact.qq || "",
    remark: contact.remark || ""
  });
}

function startNewContactRow() {
  if (!selectedCustomer.value) {
    notify("请先选择客户");
    return;
  }
  newContactRowActive.value = true;
  editingContactRowId.value = NEW_CONTACT_ROW_ID;
  contactAreaTree.open = false;
  resetContactRowDraft();
}

function startContactRowEdit(contact) {
  newContactRowActive.value = false;
  editingContactRowId.value = contact.id;
  contactAreaTree.open = false;
  resetContactRowDraft({
    ...contact,
    area: contactAreaText(contact),
    address: contactAddressText(contact)
  });
}

function cancelContactRowEdit() {
  editingContactRowId.value = null;
  newContactRowActive.value = false;
  contactAreaTree.open = false;
}

async function saveNewContactRow() {
  if (!selectedCustomer.value) {
    notify("请先选择客户");
    return;
  }
  const hasContent = Object.values(contactRowDraft).some((value) => String(value || "").trim());
  if (!hasContent) {
    notify("请先填写联系人信息");
    return;
  }
  try {
    const saved = await customersApi.createCustomerContact({
      ...contactRowDraft,
      customerId: selectedCustomer.value.id
    });
    customerContactRows.value = [...customerContactRows.value, saved];
    cancelContactRowEdit();
    notify("联系人已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function saveContactRow(contact) {
  try {
    const payload = {
      ...contact,
      ...contactRowDraft,
      customerId: contact.customerId || selectedCustomer.value?.id || ""
    };
    const saved = await customersApi.updateCustomerContact(contact.id, payload);
    customerContactRows.value = customerContactRows.value.map((item) => item.id === saved.id ? saved : item);
    editingContactRowId.value = null;
    notify("联系人已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function saveContact() {
  try {
    const payload = { ...contactForm, customerId: contactForm.customerId || selectedCustomer.value?.id || "" };
    const saved = editingContactId.value
      ? await customersApi.updateCustomerContact(editingContactId.value, payload)
      : await customersApi.createCustomerContact(payload);
    customerContactRows.value = editingContactId.value
      ? customerContactRows.value.map((item) => item.id === saved.id ? saved : item)
      : [saved, ...customerContactRows.value];
    contactModalOpen.value = false;
    notify("联系人已保存");
  } catch (error) {
    notify(error.message);
  }
}

async function deleteContact(contact) {
  try {
    await customersApi.deleteCustomerContact(contact.id);
    customerContactRows.value = customerContactRows.value.filter((item) => item.id !== contact.id);
    notify("联系人已删除");
  } catch (error) {
    notify(error.message);
  }
}

function handleCustomerDetailPrimaryAction() {
  if (!showCustomerDetailPrimaryAction.value) return;
  if (activeCustomerDetailTab.value === "联系人") {
    startNewContactRow();
  } else if (activeCustomerDetailTab.value === "外派费用规则") {
    prepareNewSupplierCostRule(false);
    supplierCostRuleFormOpen.value = true;
  } else {
    openOrderModal(selectedCustomer.value);
  }
}

function syncVehicleDriverTabFromRoute(routeKey) {
  if (routeKey === "vehicleDriver" || routeKey === "vehicleManage" || routeKey === "vehicle") {
    activeVehicleTab.value = "车辆管理";
  } else if (routeKey === "driverManage") {
    activeVehicleTab.value = "司机管理";
  }
}

function syncRouteFromHash() {
  const rawHash = location.hash || "#home";
  const routeKey = rawHash.replace("#", "").split("?")[0];
  const normalized = normalizeRoute(routeKey);
  const next = loggedIn.value && !canAccessModule(normalized) ? firstAccessibleModule.value : normalized;
  const partnerType = partnerTypeForCustomerRoute(routeKey);
  if (partnerType) {
    activePartnerType.value = partnerType;
  }
  if (rawHash === syncedHash && next === activeModule.value) {
    return;
  }
  syncVehicleDriverTabFromRoute(routeKey);
  syncedHash = rawHash;
  if (next !== activeModule.value) {
    closeTransientUi();
  }
  activeModule.value = next;
  scheduleDatabaseRefresh();
}

function syncRouteAndData() {
  syncRouteFromHash();
  scheduleDatabaseRefresh();
}

window.addEventListener("hashchange", syncRouteFromHash);
window.addEventListener("popstate", syncRouteFromHash);
window.addEventListener("focus", syncRouteAndData);

watch(activePartnerType, () => {
  selectedCustomerIds.value = [];
  selectedCustomerId.value = firstCustomerIdForActiveType();
  if (activeModule.value === "customers") {
    const hashTarget = customerRouteForPartnerType(activePartnerType.value);
    syncedHash = `#${hashTarget}`;
    if (location.hash !== syncedHash) location.hash = hashTarget;
  }
});

watch([activeCustomerDetailTab, selectedCustomerId], () => {
  selectedSupplierCostRuleKeys.value = selectedSupplierCostRuleKeys.value.filter((key) =>
    selectedSupplierCostRules.value.some((rule) => rule.key === key)
  );
  expandedSupplierCostGroupKeys.value = expandedSupplierCostGroupKeys.value.filter((key) =>
    supplierCostRuleGroupedRows.value.some((row) => row.level === 1 && row.key === key)
  );
  if (activeCustomerDetailTab.value === "订单管理") {
    selectedOrderNos.value = selectedOrderNos.value.filter((no) => selectedCustomerOrderNos.value.includes(no));
  }
  if (activeCustomerDetailTab.value === "附件管理") {
    loadCustomerFiles().catch((error) => notify(error.message));
  }
});

watch(selectedCustomerId, () => {
  supplierCostBatchOpen.value = false;
  supplierCostRuleFormOpen.value = false;
  editingSupplierCostRuleKey.value = "";
  cancelSupplierCostGroupEdit();
  cancelSupplierCostExtraEdit();
  selectedSupplierCostRuleKeys.value = [];
});

watch([activeVehicleTab, activeVehicleDetailTab, selectedVehiclePlate], () => {
  localStorage.setItem("hanye_vehicle_tab", activeVehicleTab.value);
  if (activeVehicleTab.value === "车辆管理" && activeVehicleDetailTab.value === "证件提醒") {
    loadVehicleFiles().catch((error) => notify(error.message));
  }
});

watch([activeVehicleTab, activeDriverDetailTab, selectedDriverId], () => {
  if (activeDriverDetailTab.value === "司机费用规则") {
    activeDriverDetailTab.value = "司机资料";
    return;
  }
  if (activeVehicleTab.value === "司机管理" && activeDriverDetailTab.value === "证件照片") {
    loadDriverFiles().catch((error) => notify(error.message));
  }
  if (activeVehicleTab.value === "司机管理" && activeDriverDetailTab.value === "预支/报销" && !driverAdjustmentForm.id) {
    resetDriverAdjustmentForm();
  }
});

watch(dispatchDate, () => {
  localStorage.setItem("hanye_dispatch_date", dispatchDate.value);
});

watch(dispatchPeriodFilter, () => {
  localStorage.setItem("hanye_dispatch_period_filter", dispatchPeriodFilter.value);
  loadDispatchPlansForCurrentFilter();
});

onMounted(async () => {
  syncRouteFromHash();
  if (loggedIn.value && canAccessModule("dispatchBoard")) loadDispatchPlansForCurrentFilter();
  window.setInterval(syncRouteFromHash, 1000);
  if (loggedIn.value) {
    await refreshCurrentAccount({ silent: true });
    if (loggedIn.value) {
      loadDatabaseData();
      if (canAccessModule("dispatchBoard")) loadDispatchPlansForCurrentFilter();
    }
  }
});

const dispatchSearchKeyword = ref('')
const normalizeDispatchSearchText = (value, seen = new Set()) => {
  if (value == null) return ''
  const valueType = typeof value
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => normalizeDispatchSearchText(item, seen)).join(' ')
  if (valueType === 'object') {
    if (seen.has(value)) return ''
    seen.add(value)
    return Object.values(value).map((item) => normalizeDispatchSearchText(item, seen)).join(' ')
  }
  return ''
}
const matchesDispatchSearchKeyword = (record) => {
  const keyword = dispatchSearchKeyword.value.trim().toLowerCase()
  if (!keyword) return true
  return normalizeDispatchSearchText(record).toLowerCase().includes(keyword)
}
const filterDispatchSearchRows = (rows) => {
  if (!dispatchSearchKeyword.value.trim()) return rows
  return (rows || []).filter(matchesDispatchSearchKeyword)
}

const searchedDispatchPlanRows = computed(() =>
  sortRowsByTable(filterDispatchSearchRows(dispatchStatusPoolRows.value), "dispatchBoard")
)

const searchedDispatchPlanTotalRows = computed(() =>
  filterDispatchSearchRows(dispatchPlanDisplayRows.value)
)

const activeOrderDetail = computed(() =>
  orderRows.value.find((order) => order.no === orderDetailNo.value) || null
);

const activeDispatchDetail = computed(() =>
  dispatchPlanDisplayRows.value.find((row) => row.id === dispatchDetailId.value) || null
);

function openOrderDetail(order) {
  if (!order?.no) return;
  orderDetailNo.value = order.no;
}

function closeOrderDetail() {
  orderDetailNo.value = "";
}

function openDispatchDetail(row) {
  if (!row?.id) return;
  dispatchDetailId.value = row.id;
}

function closeDispatchDetail() {
  dispatchDetailId.value = "";
}

function orderDetailDriverText(order = {}) {
  const names = [order.driver, order.hkDriver, order.mainlandDriver]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return names.length ? Array.from(new Set(names)).join(" / ") : "-";
}

function orderDetailFeeRows(order = {}) {
  return (Array.isArray(order.fees) ? order.fees : []).filter((fee) => fee?.name || Number(fee?.amount || 0));
}



</script>

<template>
  <div v-if="notice" class="toast">{{ notice }}</div>

  <section v-if="!loggedIn" class="login-page">
    <form class="login-card" @submit.prevent="login">
      <div>
        <p class="eyebrow">汉业管理系统</p>
        <h1>登录</h1>
      </div>
      <label>
        账号
        <input v-model.trim="loginForm.username" autocomplete="username" />
      </label>
      <label>
        密码
        <input v-model="loginForm.password" type="password" autocomplete="current-password" />
      </label>
      <button class="primary-btn" type="submit"><IconSvg name="lock" />登录系统</button>
      <p class="hint">初始管理员账号：admin / admin。登录后请及时修改密码。</p>
    </form>
  </section>

  <div v-else class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <button class="brand-home-button" type="button" @click="openModule('home')">
          <h1>汉业管理系统</h1>
        </button>
      </div>
      <nav class="nav">
        <section v-for="(items, group) in groupedModules" :key="group">
          <p class="nav-group">{{ group }}</p>
          <button
            v-for="item in items"
            :key="item.id"
            class="nav-item"
            :class="{ active: navItemActive(item) }"
            @click="openModule(item.id)"
          >
            <IconSvg :name="moduleIcon(item.id)" />
            <span>{{ item.label }}</span>
          </button>
        </section>
      </nav>
      <div class="sidebar-footer">
        <p class="db-status">{{ apiStatus }}</p>
        <section class="account-status-card" aria-label="账户登录状态">
          <div class="account-status-head">
            <span class="account-avatar"><IconSvg name="user" /></span>
            <div>
              <strong>{{ currentAccountLabel }}</strong>
              <span>{{ currentAccount.role || '司机' }}</span>
            </div>
          </div>
          <div class="account-action-grid">
            <button class="ghost-btn small" type="button" @click="openAccountSettings"><IconSvg name="user" />账号设置</button>
            <button class="ghost-btn small" type="button" @click="openAccountPasswordModal"><IconSvg name="lock" />修改密码</button>
          </div>
          <button class="ghost-btn logout-btn" type="button" @click="logout"><IconSvg name="close" />退出登录</button>
        </section>
      </div>
    </aside>

    <main class="main-panel">
      <section v-if="activeModule === 'home'" class="work-page home-page">
        <BusinessPage>
        <div class="home-hero">
          <div>
            <p class="eyebrow">主页面</p>
            <h2>今日工作看板</h2>
            <span>集中处理客户、新排车单和待确认订单。</span>
          </div>
          <div class="home-hero-actions">
            <button class="primary-btn" type="button" @click="openHomeCustomerCreate"><IconSvg name="plus" />新建客户</button>
            <button class="primary-btn" type="button" @click="openHomeDispatchCreate"><IconSvg name="truck" />新建排车单</button>
            <button class="ghost-btn" type="button" @click="openModule('orders')"><IconSvg name="list" />订单管理</button>
          </div>
        </div>

        <div class="home-kpi-grid">
          <button class="home-kpi-card" type="button" @click="openModule('customerList')">
            <span>客户总数</span>
            <strong>{{ customerRows.filter((item) => item.type === '客户').length }}</strong>
            <small>本月新增 {{ homeMonthlyNewCustomers.length }}</small>
          </button>
          <button class="home-kpi-card" type="button" @click="openModule('orders')">
            <span>今日订单</span>
            <strong>{{ homeTodayOrders.length }}</strong>
            <small>待处理 {{ homePendingOrders.length }}</small>
          </button>
          <button class="home-kpi-card" type="button" @click="openModule('dispatchBoard')">
            <span>今日排车</span>
            <strong>{{ dispatchPlanDisplayRows.length }}</strong>
            <small>待排 {{ dispatchUnplannedOrders.length }}</small>
          </button>
          <button class="home-kpi-card" type="button" @click="openModule('dispatchBoard')">
            <span>车辆来源</span>
            <strong>{{ homeDispatchOwnVehicleCount }} / {{ homeDispatchOutsourceCount }}</strong>
            <small>本公司 / 外派</small>
          </button>
        </div>

        <div class="home-board-grid">
          <section class="table-card home-board-card">
            <div class="home-board-head">
              <div>
                <strong>今日排车概览</strong>
                <span>{{ dispatchDate }} · 已排 {{ dispatchPlanDisplayRows.length }} 单</span>
              </div>
              <button class="ghost-btn small" type="button" @click="openModule('dispatchBoard')">查看排车表</button>
            </div>
            <div class="table-wrap">
              <table class="data-table compact">
                <thead>
                  <tr><th>序号</th><th>排车单号</th><th>客户</th><th>车牌</th><th>装车时间</th><th>状态</th></tr>
                </thead>
                <tbody>
                  <tr v-for="row in homeRecentDispatchRows" :key="row.id">
                    <td>{{ row.index + 1 }}</td>
                    <td>{{ row.dispatchNo || '-' }}</td>
                    <td>{{ row.order.customer || '-' }}</td>
                    <td>{{ row.plate || '待定' }}</td>
                    <td>{{ row.loadTime || '未定' }}</td>
                    <td>{{ row.order.no ? '已绑定订单' : '待确认订单' }}</td>
                  </tr>
                  <tr v-if="homeRecentDispatchRows.length === 0"><td colspan="6">今日暂无排车单，可从右上角新建。</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="table-card home-board-card">
            <div class="home-board-head">
              <div>
                <strong>最近客户</strong>
                <span>快速进入客户资料与订单管理</span>
              </div>
              <button class="ghost-btn small" type="button" @click="openModule('customerList')">客户</button>
            </div>
            <div class="home-customer-list">
              <button
                v-for="customer in homeRecentCustomers"
                :key="customer.id"
                type="button"
                class="home-customer-row"
                @click="activePartnerType = '客户'; selectedCustomerId = customer.id; openModule('customerList')"
              >
                <strong>{{ customer.name }}</strong>
                <span>{{ customer.id }} · {{ customer.city || '-' }} · {{ customer.term || '-' }}</span>
                <small>最近订单：{{ partnerRecentOrderDate(customer) || '-' }}</small>
              </button>
              <p v-if="homeRecentCustomers.length === 0" class="empty-state compact">暂无客户资料。</p>
            </div>
          </section>
        </div>
        </BusinessPage>
      </section>

      <section v-else-if="activeModule === 'customers'" class="work-page customer-page">
        <BusinessPage>
        <div class="toolbar customer-page-toolbar" @click="orderExportMenuOpen = false">
          <div class="customer-page-title">
            <h2>{{ activePartnerType }}资料</h2>
            <span>共 {{ visibleCustomers.length }} 个{{ activePartnerType }}</span>
          </div>
          <input
            v-model.trim="partnerSearch"
            class="search-input customer-page-search"
            :placeholder="`${activePartnerType}名称 / 税号 / 订单号 / 联系人 / 手机号`"
          />
          <div class="customer-toolbar-actions">
            <button class="ghost-btn" @click="toggleCustomerBatchSelection">
              <IconSvg name="checklist" />
              {{ selectedCustomerIds.length ? `已选 ${selectedCustomerIds.length} 项` : '批量管理' }}
            </button>
            <button class="ghost-btn" type="button" :title="selectedCustomerIds.length ? `查看已选 ${selectedCustomerIds.length} 项` : `查看当前${activePartnerType}列表`" @click="openCustomerListDetail">
              <IconSvg name="eye" />查看
            </button>
            <button class="ghost-btn" :disabled="!selectedCustomer" @click="deleteSelectedCustomer"><IconSvg name="trash" />删除管理</button>
            <button class="ghost-btn" @click="exportCustomers"><IconSvg name="download" />导出</button>
            <button class="primary-btn" :disabled="loading" @click="openPartnerCreateModal(activePartnerType)"><IconSvg name="plus" />新增{{ activePartnerType }}</button>
          </div>
        </div>

        <div class="split-workspace customer-split-workspace" :style="splitWorkspaceStyle('customer')">
          <div class="table-card">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" :checked="visibleCustomers.length > 0 && selectedCustomerIds.length === visibleCustomers.length" @change="selectedCustomerIds = $event.target.checked ? visibleCustomers.map((item) => item.id) : []" /></th>
                  <th v-for="column in [
                    { key: 'id', label: `${activePartnerType}编号` },
                    { key: 'name', label: `${activePartnerType}名称` },
                    { key: 'city', label: '城市' },
                    { key: 'term', label: '账期' },
                    { key: 'settlementCurrency', label: '结算币种' },
                    { key: 'receivableRMB', label: '应收人民币' },
                    { key: 'receivableHKD', label: '应收港币' },
                    { key: 'recentOrderDate', label: '最近订单日期' },
                    { key: 'createdAt', label: '创建日期' }
                  ]" :key="column.key" :class="['sortable', { sorted: tableSortDirection('customers', column.key) }]" @click="toggleTableSort('customers', column)">
                    <button class="table-sort-trigger" type="button">
                      <span>{{ column.label }}</span>
                      <span class="sort-mark">{{ tableSortDirection('customers', column.key) === 'asc' ? '↑' : tableSortDirection('customers', column.key) === 'desc' ? '↓' : '' }}</span>
                    </button>
                  </th>
                  <th class="icon-actions-head" title="操作" aria-label="操作"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in visibleCustomers"
                  :key="item.id"
                  :class="{ selected: selectedCustomer?.id === item.id }"
                  @click="selectedCustomerId = item.id"
                >
                  <td><input v-model="selectedCustomerIds" type="checkbox" :value="item.id" @click.stop /></td>
                  <td>{{ item.id }}</td>
                  <td>{{ item.name }}</td>
                  <td>{{ item.city }}</td>
                  <td>{{ item.term }}</td>
                  <td>{{ item.type === '客户' ? (item.settlementCurrency || '人民币结算') : '-' }}</td>
                  <td>人民币 {{ Number(item.receivableRMB || 0).toLocaleString() }}</td>
                  <td>港币 {{ Number(item.receivableHKD || 0).toLocaleString() }}</td>
                  <td>{{ partnerRecentOrderDate(item) }}</td>
                  <td>{{ item.createdAt }}</td>
                  <td><button class="icon-btn" @click.stop="openCustomerModal(item)"><IconSvg name="edit" />编辑</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            class="resizer customer-resizer"
            role="separator"
            aria-label="调整客户列表和详情高度"
            @mousedown="startSplitResize('customer', $event)"
            @touchstart.prevent="startSplitResize('customer', $event)"
          />

          <div class="detail-panel customer-detail-panel">
            <div class="tabs customer-detail-tabs">
              <button
                v-for="tab in customerDetailTabs"
                :key="tab"
                :class="{ active: activeCustomerDetailTab === tab }"
                @click="activeCustomerDetailTab = tab"
              >
                {{ tab }}
              </button>
              <button v-if="showCustomerDetailPrimaryAction" class="primary-btn small" :disabled="loading || !selectedCustomer" @click="handleCustomerDetailPrimaryAction">
                <IconSvg name="plus" />{{ customerDetailActionLabel }}
              </button>
              <button
                v-if="activeCustomerDetailTab === '外派费用规则'"
                class="ghost-btn small detail-tab-action-right"
                type="button"
                :disabled="!selectedCustomer"
                @click="toggleSupplierCostBatch"
              >
                <IconSvg name="checklist" />{{ supplierCostBatchOpen ? '收起批量' : '批量管理' }}
              </button>
            </div>
            <div class="empty-state" v-if="!selectedCustomer">请选择{{ activePartnerType }}</div>
            <div v-else-if="activeCustomerDetailTab === '外派费用规则'" class="driver-wage-rules-panel">
              <div class="supplier-cost-scope-banner">
                <strong>{{ selectedCustomer.name }}</strong>
                <span>当前外派费用只对该供应商生效，不影响其他供应商。</span>
              </div>
              <div class="supplier-cost-card-switch">
                <button
                  type="button"
                  :class="{ active: activeSupplierCostCard === 'base' }"
                  @click="activeSupplierCostCard = 'base'"
                >
                  <strong>吨位基础价</strong>
                </button>
                <button
                  type="button"
                  :class="{ active: activeSupplierCostCard === 'extra' }"
                  @click="activeSupplierCostCard = 'extra'"
                >
                  <strong>附加费用</strong>
                </button>
              </div>
              <form v-if="supplierCostBatchOpen" class="supplier-cost-batch-panel" @submit.prevent="saveSupplierCostRuleBatch">
                <div class="supplier-cost-batch-summary">
                  <strong>批量填价</strong>
                  <span>已选 {{ selectedSupplierCostRuleRows.length }} 项，本次 {{ supplierCostBatchTargetRows.length }} 项</span>
                  <small>空白不覆盖，选吨位后只改该吨位。</small>
                </div>
                <div class="supplier-cost-batch-controls">
                  <label>吨位
                    <select v-model="supplierCostRuleBatchForm.tonnage">
                      <option value="">已勾选全部</option>
                      <option v-for="item in TONNAGE_OPTIONS" :key="item">{{ item }}</option>
                    </select>
                  </label>
                  <label>基础 RMB<input v-model.trim="supplierCostRuleBatchForm.baseRMB" type="number" min="0" step="0.01" placeholder="不填则不改" /></label>
                  <label>基础 HKD<input v-model.trim="supplierCostRuleBatchForm.baseHKD" type="number" min="0" step="0.01" placeholder="不填则不改" /></label>
                  <label class="supplier-cost-batch-note">说明<input v-model.trim="supplierCostRuleBatchForm.note" placeholder="不填则不改" /></label>
                  <div class="supplier-cost-batch-actions">
                    <button class="primary-btn small" type="submit"><IconSvg name="save" />批量保存</button>
                    <button class="ghost-btn small" type="button" @click="resetSupplierCostRuleBatchForm">清空</button>
                  </div>
                </div>
              </form>
              <form v-if="supplierCostRuleFormOpen" class="driver-wage-rule-toolbar" @submit.prevent="saveSupplierCostRule">
                <label class="driver-rule-direction">方向
                  <select v-model="supplierCostRuleForm.direction">
                    <option>{{ SUPPLIER_COST_SHARED_DIRECTION }}</option>
                    <option v-for="item in DIRECTION_OPTIONS" :key="item">{{ item }}</option>
                  </select>
                </label>
                <label class="driver-rule-area">计价片区
                  <select v-model="supplierCostRuleForm.city" required>
                    <option value="">请选择片区</option>
                    <option v-for="area in supplierCostCityOptions" :key="area" :value="area">{{ area }}</option>
                  </select>
                </label>
                <label>吨位
                  <select v-model="supplierCostRuleForm.tonnage">
                    <option>3T</option><option>5T</option><option>8T</option><option>10T</option><option>12T</option><option>20尺柜</option><option>40尺柜</option>
                  </select>
                </label>
                <label class="driver-rule-currency">币种
                  <select v-model="supplierCostRuleForm.currency">
                    <option value="港币">HKD</option>
                    <option value="人民币">RMB</option>
                  </select>
                </label>
                <label>基础RMB<input v-model.number="supplierCostRuleForm.baseRMB" type="number" min="0" step="0.01" /></label>
                <label>基础HKD<input v-model.number="supplierCostRuleForm.baseHKD" type="number" min="0" step="0.01" /></label>
                <label>装货费 HKD<input v-model.number="supplierCostRuleForm.loadPerBoard" type="number" min="0" step="0.01" /></label>
                <label>卸货费 HKD<input v-model.number="supplierCostRuleForm.unloadPerBoard" type="number" min="0" step="0.01" /></label>
                <label>过海费 HKD<input v-model.number="supplierCostRuleForm.crossSeaFee" type="number" min="0" step="0.01" /></label>
                <label>加点费 HKD<input v-model.number="supplierCostRuleForm.addPointFee" type="number" min="0" step="0.01" /></label>
                <label>装货等候费 HKD<input v-model.number="supplierCostRuleForm.waitingPerHour" type="number" min="0" step="0.01" /></label>
                <label v-for="item in advanceFeeItemRows" :key="item.id">
                  {{ advanceFeeRateLabel(item) }}
                  <input :value="advanceFeeRateValue(supplierCostRuleForm.advanceFeeRates, item)" type="number" min="0" step="0.01" @input="setAdvanceFeeRate(supplierCostRuleForm.advanceFeeRates, item, $event.target.value)" />
                </label>
                <label class="driver-rule-note">说明<input v-model.trim="supplierCostRuleForm.note" placeholder="例如：外派深圳 10T HKD500/趟" /></label>
                <div class="driver-rule-actions">
                  <button class="primary-btn small" type="submit"><IconSvg name="save" />保存规则</button>
                  <button class="ghost-btn small" type="button" @click="prepareNewSupplierCostRule(false)">清空</button>
                </div>
              </form>
              <div v-show="activeSupplierCostCard === 'base'" class="table-wrap supplier-cost-rule-table-wrap">
                <table class="data-table compact driver-wage-rule-table supplier-cost-rule-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" :checked="allSupplierCostRulesSelected" @change="toggleAllSupplierCostRules" /></th>
                      <th>计价片区</th>
                      <th v-for="tonnage in TONNAGE_OPTIONS" :key="tonnage" class="supplier-tonnage-head">
                        <span>{{ tonnage }}</span>
                      </th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in supplierCostRuleGroupedRows"
                      :key="row.key"
                      :class="['supplier-cost-group-row', { 'is-child': row.level === 2, 'is-expanded': row.expanded, 'is-editing': isEditingSupplierCostGroup(row) }]"
                      title="双击整行编辑"
                      @dblclick="beginEditSupplierCostGroup(row)"
                    >
                      <td><input type="checkbox" :checked="supplierCostGroupSelected(row)" @click.stop @change="toggleSupplierCostGroupSelection(row)" /></td>
                      <td class="supplier-cost-tree-cell">
                        <span class="supplier-cost-tree-content">
                          <button v-if="row.hasChildren" class="tree-toggle-btn" type="button" @click.stop="toggleSupplierCostGroup(row)">{{ row.expanded ? '-' : '+' }}</button>
                          <span v-else class="tree-toggle-spacer"></span>
                          <span>{{ row.level === 1 ? row.level1 : row.level2 }}</span>
                        </span>
                      </td>
                      <td v-for="tonnage in TONNAGE_OPTIONS" :key="tonnage" class="supplier-tonnage-cell">
                        <template v-if="row.tonnageRules?.[tonnage]">
                          <div
                            v-if="isEditingSupplierCostGroup(row)"
                            class="supplier-row-editor"
                          >
                            <label class="supplier-price-edit-line">
                              <span>RMB</span>
                              <input
                                :value="supplierCostDraftValue(tonnage, 'RMB')"
                                type="number"
                                min="0"
                                step="0.01"
                                aria-label="基础RMB"
                                @input="setSupplierCostDraftValue(tonnage, 'RMB', $event.target.value)"
                                @keydown.enter.prevent="saveSupplierCostGroup(row)"
                              />
                            </label>
                            <label class="supplier-price-edit-line">
                              <span>HKD</span>
                              <input
                                :value="supplierCostDraftValue(tonnage, 'HKD')"
                                type="number"
                                min="0"
                                step="0.01"
                                aria-label="基础HKD"
                                @input="setSupplierCostDraftValue(tonnage, 'HKD', $event.target.value)"
                                @keydown.enter.prevent="saveSupplierCostGroup(row)"
                              />
                            </label>
                          </div>
                          <div v-else class="supplier-tonnage-rule">
                            <input
                              class="supplier-tonnage-check"
                              type="checkbox"
                              :checked="supplierCostRuleSelectionChecked(row.tonnageRules[tonnage])"
                              @click.stop
                              @change.stop="toggleSupplierCostRuleSelection(row.tonnageRules[tonnage])"
                            />
                            <button class="supplier-tonnage-content" type="button" @click.stop="beginEditSupplierCostGroup(row)">
                              <span
                                v-for="line in supplierCostRulePriceLines(row.tonnageRules[tonnage])"
                                :key="line.currency"
                                :class="['supplier-tonnage-price', { pending: !line.value }]"
                              >
                                <span class="supplier-tonnage-currency">{{ line.currency }}</span>
                                <span class="supplier-tonnage-amount">{{ line.value || '待填' }}</span>
                              </span>
                            </button>
                          </div>
                        </template>
                      </td>
                      <td class="supplier-cost-row-actions">
                        <span v-if="isEditingSupplierCostGroup(row)" class="table-row-actions">
                          <button class="icon-btn supplier-save-row-btn" type="button" title="保存" @click.stop="saveSupplierCostGroup(row)"><IconSvg name="save" />保存</button>
                          <button class="icon-btn" type="button" title="取消" @click.stop="cancelSupplierCostGroupEdit">×</button>
                        </span>
                        <button v-else class="icon-btn" type="button" title="编辑整行" @click.stop="beginEditSupplierCostGroup(row)"><IconSvg name="edit" /></button>
                      </td>
                    </tr>
                    <tr v-if="supplierCostRuleGroupedRows.length === 0"><td :colspan="TONNAGE_OPTIONS.length + 3">暂无同步片区，请先在运费模板维护目录</td></tr>
                  </tbody>
                </table>
              </div>
              <section v-show="activeSupplierCostCard === 'extra'" class="supplier-cost-extra-card">
                <div class="supplier-cost-extra-head">
                  <div>
                    <strong>附加费用规则</strong>
	                    <span>自动同步“收费项目”中类别为代垫的项目，按方向维护司机/供应商应付金额。</span>
                  </div>
                  <small>附加费用按方向逐项维护，不参与批量吨位调价。</small>
                </div>
                <div class="table-wrap supplier-cost-extra-table-wrap">
                  <table class="data-table compact supplier-cost-extra-table">
                    <thead>
                      <tr>
                        <th>方向</th>
                        <th v-for="item in advanceFeeItemRows" :key="item.id">{{ advanceFeeRateLabel(item) }}</th>
                        <th>说明</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="row in supplierCostExtraRows"
                        :key="row.key"
                        :class="['supplier-cost-extra-row', { 'is-editing': isEditingSupplierCostExtra(row) }]"
                      >
                        <td>{{ row.direction }}</td>
                        <td v-for="item in advanceFeeItemRows" :key="item.id" class="supplier-cost-fee" :class="{ pending: supplierCostExtraFeeValue(row, advanceFeeRateKey(item)) === '待填' }">
                          <input v-if="isEditingSupplierCostExtra(row)" :value="supplierCostExtraDraftValue(advanceFeeRateKey(item))" type="number" min="0" step="0.01" @input="setSupplierCostExtraDraftValue(advanceFeeRateKey(item), $event.target.value)" />
                          <template v-else>{{ supplierCostExtraFeeValue(row, advanceFeeRateKey(item)) }}</template>
                        </td>
                        <td class="supplier-cost-note">
                          <input v-if="isEditingSupplierCostExtra(row)" :value="supplierCostExtraDraftValue('note')" @input="setSupplierCostExtraDraftValue('note', $event.target.value)" />
                          <template v-else>{{ supplierCostExtraNote(row) }}</template>
                        </td>
                        <td class="supplier-cost-row-actions">
                          <span v-if="isEditingSupplierCostExtra(row)" class="table-row-actions">
                            <button class="icon-btn" type="button" title="保存" @click.stop="saveSupplierCostExtra(row)"><IconSvg name="save" /></button>
                            <button class="icon-btn" type="button" title="取消" @click.stop="cancelSupplierCostExtraEdit">×</button>
                          </span>
                          <button v-else class="icon-btn" type="button" title="编辑整行" @click.stop="beginEditSupplierCostExtra(row)"><IconSvg name="edit" /></button>
                        </td>
                      </tr>
	                      <tr v-if="supplierCostExtraRows.length === 0"><td :colspan="advanceFeeItemRows.length + 3">暂无同步规则，请先在运费模板维护目录</td></tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
            <div v-else-if="activeCustomerDetailTab === '订单管理'" class="customer-order-panel" @click="customerOrderExportMenuOpen = false">
              <div class="customer-order-toolbar">
                <span class="customer-order-count">已选 {{ selectedCustomerOrderCount }} 项 / 共 {{ selectedCustomerOrders.length }} 单</span>
                <button class="ghost-btn small" type="button" @click="auditSelectedCustomerOrders"><IconSvg name="check" />批量审核</button>
                <button class="ghost-btn small" type="button" @click="cancelSelectedCustomerAudits"><IconSvg name="refresh" />取消审核</button>
                <button class="ghost-btn small" type="button" @click="resetCustomerOrderColumnOrder"><IconSvg name="list" />恢复列序</button>
                <button class="ghost-btn small" type="button" @click="resetCustomerOrderColumnWidths"><IconSvg name="refresh" />恢复列宽</button>
                <button class="ghost-btn small" type="button" :title="selectedCustomerOrderCount ? `查看已选 ${selectedCustomerOrderCount} 单` : `查看当前${activePartnerType}订单`" @click="openOrderListDetail('customer')"><IconSvg name="eye" />查看</button>
                <span class="customer-order-export-wrap" @click.stop>
                  <button class="ghost-btn small" type="button" @click="toggleCustomerOrderExportMenu">
                    <IconSvg name="download" />导出<IconSvg name="chevronDown" />
	                  </button>
	                  <div v-if="customerOrderExportMenuOpen" class="customer-order-export-menu">
	                    <div class="order-export-menu-title">选择导出模板</div>
	                    <div v-for="template in orderExportTemplateOptions()" :key="template.id" class="order-export-template-row">
	                      <span :title="template.name">{{ template.name }}</span>
	                      <button type="button" title="导出 Excel" aria-label="导出 Excel" @click="exportCustomerOrders('excel', template)">Excel</button>
	                      <button type="button" title="导出 PDF" aria-label="导出 PDF" @click="exportCustomerOrders('pdf', template)">PDF</button>
	                    </div>
	                  </div>
                </span>
                <button class="danger-btn small" type="button" @click="deleteSelectedCustomerOrders"><IconSvg name="trash" />批量删除</button>
                <button class="ghost-btn small" type="button" @click="openRecycleBin"><IconSvg name="archive" />回收站</button>
              </div>
              <div class="customer-order-table-wrap">
              <table class="data-table compact customer-order-table" :style="customerOrderTableStyle()">
                <colgroup>
                  <col v-for="column in visibleCustomerOrderColumns" :key="column.key" :style="customerOrderColumnStyle(column.key)" />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      v-for="(column, index) in visibleCustomerOrderColumns"
                      :key="column.key"
                      :class="['resizable-th', { sortable: !['select', 'actions'].includes(column.key), sorted: tableSortDirection('customerOrders', column.key), 'sticky-managed-column': isCustomerOrderColumnFrozen(column) }]"
                      :style="customerOrderFrozenColumnStyle(column, index)"
                      @click="toggleTableSort('customerOrders', column)"
                    >
                      <input v-if="column.key === 'select'" type="checkbox" :checked="allSelectedCustomerOrdersChecked" @click.stop @change="toggleAllCustomerOrders($event.target.checked)" />
                      <span v-else-if="column.key === 'actions'" class="column-manager-wrap" @click.stop>
                        <button class="table-op icon-only column-manager-trigger" type="button" title="管理列表" aria-label="管理列表" @click="customerOrderColumnMenuOpen = !customerOrderColumnMenuOpen"><IconSvg name="list" /></button>
                        <div v-if="customerOrderColumnMenuOpen" class="column-manager-menu" @click.stop>
                          <div
                            v-for="menuColumn in customerOrderColumns.filter((item) => !item.locked)"
                            :key="menuColumn.key"
                            class="column-manager-row"
                            draggable="true"
                            @dragstart="startCustomerOrderColumnDrag(menuColumn, $event)"
                            @dragover.prevent
                            @dragenter.prevent="dropCustomerOrderColumn(menuColumn)"
                            @drop.prevent="dropCustomerOrderColumn(menuColumn)"
                          >
                            <span class="column-manager-drag"><IconSvg name="list" /></span>
                            <button
                              class="column-manager-check"
                              :class="{ checked: isCustomerOrderColumnVisible(menuColumn.key) }"
                              type="button"
                              title="显示/隐藏"
                              @click.stop.prevent="toggleCustomerOrderColumnVisible(menuColumn)"
                            ><IconSvg v-if="isCustomerOrderColumnVisible(menuColumn.key)" name="check" /></button>
                            <span>{{ menuColumn.label }}</span>
                            <button
                              :class="['icon-btn', 'icon-only', { active: isCustomerOrderColumnLocked(menuColumn) }]"
                              type="button"
                              :title="isCustomerOrderColumnLocked(menuColumn) ? '取消冻结' : '冻结列'"
                              @click.stop.prevent="toggleCustomerOrderColumnLock(menuColumn)"
                            ><IconSvg name="lock" /></button>
                            <button class="icon-btn icon-only" type="button" title="上移" @click.stop.prevent="moveCustomerOrderColumn(menuColumn, -1)"><IconSvg name="chevronUp" /></button>
                            <button class="icon-btn icon-only" type="button" title="下移" @click.stop.prevent="moveCustomerOrderColumn(menuColumn, 1)"><IconSvg name="chevronDown" /></button>
                          </div>
                        </div>
                      </span>
                      <button v-else class="table-sort-trigger" type="button">
                        <span>{{ column.label }}</span>
                        <span class="sort-mark">{{ tableSortDirection('customerOrders', column.key) === 'asc' ? '↑' : tableSortDirection('customerOrders', column.key) === 'desc' ? '↓' : '' }}</span>
                      </button>
                      <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startCustomerOrderColumnResize(column, $event)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="order in selectedCustomerOrders" :key="order.no">
                    <td
                      v-for="(column, index) in visibleCustomerOrderColumns"
                      :key="column.key"
                      :class="{ 'row-actions': column.key === 'actions', 'sticky-managed-column': isCustomerOrderColumnFrozen(column) }"
                      :style="customerOrderFrozenColumnStyle(column, index)"
                      :title="orderTableCellTitle(order, column.key)"
                    >
                      <input v-if="column.key === 'select'" type="checkbox" :checked="selectedOrderNos.includes(order.no)" @change="toggleCustomerOrderSelection(order.no, $event.target.checked)" />
                      <span v-else-if="column.key === 'status'" class="status-badge" :class="orderStatusClass(order.status)">{{ order.status }}</span>
                      <template v-else-if="column.key === 'actions'">
                      <button
                        v-if="order.status !== '已审核'"
                        :class="['icon-btn', 'icon-only', { success: canAuditOrder(order) }]"
                        type="button"
                        :title="orderAuditButtonTitle(order)"
                        aria-label="审核订单"
                        :disabled="!canAuditOrder(order)"
                        @click="auditOrder(order)"
                      ><IconSvg name="check" /></button>
                      <button v-else class="icon-btn icon-only" type="button" title="取消审核" aria-label="取消审核" @click="cancelAuditOrder(order)"><IconSvg name="refresh" /></button>
                      <button class="icon-btn icon-only" type="button" title="编辑订单" aria-label="编辑订单" @click="openOrderModal(selectedCustomer, order)"><IconSvg name="edit" /></button>
                      <button v-if="canDeleteOrder(order)" class="icon-btn icon-only danger" type="button" title="删除订单" aria-label="删除订单" @click="deleteOrder(order)"><IconSvg name="trash" /></button>
                      </template>
                      <template v-else>{{ customerOrderCellText(order, column.key) }}</template>
                    </td>
                  </tr>
                  <tr v-if="selectedCustomerOrders.length === 0">
                    <td :colspan="visibleCustomerOrderColumns.length">暂无订单</td>
                  </tr>
                </tbody>
              </table>
              </div>
            </div>
            <table v-else-if="activeCustomerDetailTab === '联系人'" class="data-table compact customer-contact-table">
              <colgroup>
                <col class="contact-name-col" />
                <col class="contact-gender-col" />
                <col class="contact-title-col" />
                <col class="contact-mobile-col" />
                <col class="contact-phone-col" />
                <col class="contact-area-col" />
                <col class="contact-address-col" />
                <col class="contact-fax-col" />
                <col class="contact-email-col" />
                <col class="contact-wechat-col" />
                <col class="contact-qq-col" />
                <col class="contact-remark-col" />
                <col class="contact-action-col" />
              </colgroup>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>性别</th>
                  <th>职位</th>
                  <th>手机</th>
                  <th>电话</th>
                  <th>片区</th>
                  <th>详细地址</th>
                  <th>传真</th>
                  <th>邮箱</th>
                  <th>微信</th>
                  <th>QQ</th>
                  <th>备注</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="contact in selectedCustomerContacts" :key="contact.id">
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.name" class="table-inline-input" />
                    <template v-else>{{ contact.name }}</template>
                  </td>
                  <td>
                    <select v-if="editingContactRowId === contact.id" v-model="contactRowDraft.gender" class="table-inline-input">
                      <option value=""></option>
                      <option>男</option>
                      <option>女</option>
                    </select>
                    <template v-else>{{ contact.gender }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.title" class="table-inline-input" />
                    <template v-else>{{ contact.title }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.mobile" class="table-inline-input" />
                    <template v-else>{{ contact.mobile }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.phone" class="table-inline-input" />
                    <template v-else>{{ contact.phone }}</template>
                  </td>
                  <td>
                    <span v-if="editingContactRowId === contact.id" class="contact-area-tree route-tree-wrap" @click.stop>
                      <button :class="['route-tree-trigger table-inline-tree-trigger', { 'is-empty': !contactRowDraft.area, active: contactAreaTree.open }]" type="button" @click="toggleContactAreaTree">
                        <span>{{ contactRowDraft.area || '点击选择片区' }}</span>
                        <IconSvg name="chevronDown" />
                      </button>
                      <div v-if="contactAreaTree.open" class="route-tree-dropdown contact-area-dropdown">
                        <div class="route-tree-panel">
                          <div class="route-tree-list">
                            <template v-for="level1 in contactAreaLevel1Options" :key="level1">
                              <button class="route-tree-node" :class="{ checked: contactAreaTree.level1 === level1 }" type="button" @click="selectContactAreaLevel(1, level1)">
                                <span class="tree-check" :class="{ checked: contactAreaTree.level1 === level1 }"><IconSvg v-if="contactAreaTree.level1 === level1" name="check" /></span>
                                <span>{{ level1 }}</span>
                              </button>
                              <div v-if="contactAreaTree.level1 === level1" class="route-tree-children">
                                <button v-for="level2 in contactAreaLevel2Options" :key="level2" class="route-tree-node level-2" :class="{ checked: contactAreaTree.level2 === level2 }" type="button" @click="selectContactAreaLevel(2, level2)">
                                  <span class="tree-check" :class="{ checked: contactAreaTree.level2 === level2 }"><IconSvg v-if="contactAreaTree.level2 === level2" name="check" /></span>
                                  <span>{{ level2 }}</span>
                                </button>
                                <div v-if="contactAreaTree.level2" class="route-tree-children">
                                  <button v-for="level3 in contactAreaLevel3Options" :key="level3" class="route-tree-node level-3" :class="{ checked: contactAreaTree.level3 === level3 }" type="button" @click="selectContactAreaLevel(3, level3)">
                                    <span class="tree-check" :class="{ checked: contactAreaTree.level3 === level3 }"><IconSvg v-if="contactAreaTree.level3 === level3" name="check" /></span>
                                    <span>{{ level3 }}</span>
                                  </button>
                                </div>
                              </div>
                            </template>
                            <p v-if="contactAreaLevel1Options.length === 0" class="route-tree-empty">暂无运费模板目录</p>
                          </div>
                          <div class="route-tree-actions">
                            <span>{{ contactAreaTreeValue || '未选择' }}</span>
                            <button class="primary-btn route-tree-confirm" type="button" @click="confirmContactAreaSelection">确认选择</button>
                          </div>
                        </div>
                      </div>
                    </span>
                    <template v-else>{{ contactAreaText(contact) }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.address" class="table-inline-input" />
                    <template v-else>{{ contactAddressText(contact) }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.fax" class="table-inline-input" />
                    <template v-else>{{ contact.fax }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.email" class="table-inline-input" />
                    <template v-else>{{ contact.email }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.wechat" class="table-inline-input" />
                    <template v-else>{{ contact.wechat }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.qq" class="table-inline-input" />
                    <template v-else>{{ contact.qq }}</template>
                  </td>
                  <td>
                    <input v-if="editingContactRowId === contact.id" v-model.trim="contactRowDraft.remark" class="table-inline-input" />
                    <template v-else>{{ contact.remark }}</template>
                  </td>
                  <td class="row-actions">
                    <template v-if="editingContactRowId === contact.id">
                      <button class="icon-btn icon-only" type="button" title="保存联系人" aria-label="保存联系人" @click="saveContactRow(contact)"><IconSvg name="save" /></button>
                      <button class="icon-btn icon-only" type="button" title="取消编辑" aria-label="取消编辑" @click="cancelContactRowEdit"><IconSvg name="close" /></button>
                    </template>
                    <template v-else>
                      <button class="icon-btn icon-only" type="button" title="编辑联系人" aria-label="编辑联系人" @click="startContactRowEdit(contact)"><IconSvg name="edit" /></button>
                      <button class="icon-btn icon-only danger" type="button" title="删除联系人" aria-label="删除联系人" @click="deleteContact(contact)"><IconSvg name="trash" /></button>
                    </template>
                  </td>
                </tr>
                <tr v-if="newContactRowActive" class="inline-new-row">
                  <td><input v-model.trim="contactRowDraft.name" class="table-inline-input" /></td>
                  <td>
                    <select v-model="contactRowDraft.gender" class="table-inline-input">
                      <option value=""></option>
                      <option>男</option>
                      <option>女</option>
                    </select>
                  </td>
                  <td><input v-model.trim="contactRowDraft.title" class="table-inline-input" /></td>
                  <td><input v-model.trim="contactRowDraft.mobile" class="table-inline-input" /></td>
                  <td><input v-model.trim="contactRowDraft.phone" class="table-inline-input" /></td>
                  <td>
                    <span class="contact-area-tree route-tree-wrap" @click.stop>
                      <button :class="['route-tree-trigger table-inline-tree-trigger', { 'is-empty': !contactRowDraft.area, active: contactAreaTree.open }]" type="button" @click="toggleContactAreaTree">
                        <span>{{ contactRowDraft.area || '点击选择片区' }}</span>
                        <IconSvg name="chevronDown" />
                      </button>
                      <div v-if="contactAreaTree.open" class="route-tree-dropdown contact-area-dropdown">
                        <div class="route-tree-panel">
                          <div class="route-tree-list">
                            <template v-for="level1 in contactAreaLevel1Options" :key="level1">
                              <button class="route-tree-node" :class="{ checked: contactAreaTree.level1 === level1 }" type="button" @click="selectContactAreaLevel(1, level1)">
                                <span class="tree-check" :class="{ checked: contactAreaTree.level1 === level1 }"><IconSvg v-if="contactAreaTree.level1 === level1" name="check" /></span>
                                <span>{{ level1 }}</span>
                              </button>
                              <div v-if="contactAreaTree.level1 === level1" class="route-tree-children">
                                <button v-for="level2 in contactAreaLevel2Options" :key="level2" class="route-tree-node level-2" :class="{ checked: contactAreaTree.level2 === level2 }" type="button" @click="selectContactAreaLevel(2, level2)">
                                  <span class="tree-check" :class="{ checked: contactAreaTree.level2 === level2 }"><IconSvg v-if="contactAreaTree.level2 === level2" name="check" /></span>
                                  <span>{{ level2 }}</span>
                                </button>
                                <div v-if="contactAreaTree.level2" class="route-tree-children">
                                  <button v-for="level3 in contactAreaLevel3Options" :key="level3" class="route-tree-node level-3" :class="{ checked: contactAreaTree.level3 === level3 }" type="button" @click="selectContactAreaLevel(3, level3)">
                                    <span class="tree-check" :class="{ checked: contactAreaTree.level3 === level3 }"><IconSvg v-if="contactAreaTree.level3 === level3" name="check" /></span>
                                    <span>{{ level3 }}</span>
                                  </button>
                                </div>
                              </div>
                            </template>
                            <p v-if="contactAreaLevel1Options.length === 0" class="route-tree-empty">暂无运费模板目录</p>
                          </div>
                          <div class="route-tree-actions">
                            <span>{{ contactAreaTreeValue || '未选择' }}</span>
                            <button class="primary-btn route-tree-confirm" type="button" @click="confirmContactAreaSelection">确认选择</button>
                          </div>
                        </div>
                      </div>
                    </span>
                  </td>
                  <td><input v-model.trim="contactRowDraft.address" class="table-inline-input" /></td>
                  <td><input v-model.trim="contactRowDraft.fax" class="table-inline-input" /></td>
                  <td><input v-model.trim="contactRowDraft.email" class="table-inline-input" /></td>
                  <td><input v-model.trim="contactRowDraft.wechat" class="table-inline-input" /></td>
                  <td><input v-model.trim="contactRowDraft.qq" class="table-inline-input" /></td>
                  <td><input v-model.trim="contactRowDraft.remark" class="table-inline-input" /></td>
                  <td class="row-actions">
                    <button class="icon-btn icon-only" type="button" title="保存联系人" aria-label="保存联系人" @click="saveNewContactRow"><IconSvg name="save" /></button>
                    <button class="icon-btn icon-only" type="button" title="取消新增" aria-label="取消新增" @click="cancelContactRowEdit"><IconSvg name="close" /></button>
                  </td>
                </tr>
                <tr v-if="selectedCustomerContacts.length === 0 && !newContactRowActive">
                  <td colspan="13">暂无联系人</td>
                </tr>
              </tbody>
            </table>
            <div v-else-if="activeCustomerDetailTab === '附件管理'" class="file-panel">
              <div class="file-toolbar">
                <label class="file-upload-btn">
                  上传附件
                  <input type="file" :accept="FILE_UPLOAD_ACCEPT" @change="uploadCustomerFile" />
                </label>
                <span class="hint">客户合同、资质、往来附件会保存到 OSS 附件库。</span>
              </div>
              <table class="data-table compact">
                <thead><tr><th>来源</th><th>订单号</th><th>分类</th><th>文件名</th><th>大小</th><th>上传时间</th><th>操作</th></tr></thead>
                <tbody>
                  <tr v-for="file in customerFileRows" :key="file.id">
                    <td>{{ file.sourceLabel || (file.entityType === 'order' ? '订单附件' : '客户附件') }}</td>
                    <td>{{ file.orderNo || '' }}</td>
                    <td>{{ file.category || '' }}</td>
                    <td>{{ file.filename }}</td>
                    <td>{{ fileSizeText(file.size) }}</td>
                    <td>{{ file.createdAt }}</td>
                    <td class="row-actions">
                      <button class="icon-btn" @click="openStoredFile(file, 'preview')"><IconSvg name="eye" />预览</button>
                      <button class="icon-btn" @click="openStoredFile(file, 'download')"><IconSvg name="download" />下载</button>
                      <button class="icon-btn danger" @click="deleteFile(file, customerFileRows)"><IconSvg name="trash" />删除</button>
                    </td>
                  </tr>
                  <tr v-if="customerFileRows.length === 0"><td colspan="7">暂无附件</td></tr>
                </tbody>
              </table>
            </div>
            <div v-else-if="activeCustomerDetailTab === '开票信息'" class="info-grid invoice-info-grid">
              <span>发票抬头</span><strong>{{ selectedCustomer?.invoice?.title || selectedCustomer?.name || '-' }}</strong>
              <span>开票税号</span><strong>{{ selectedCustomer?.invoice?.taxNo || selectedCustomer?.taxNo || '-' }}</strong>
              <span>开户银行</span><strong>{{ selectedCustomer?.invoice?.bank || '-' }}</strong>
              <span>银行账号</span><strong>{{ selectedCustomer?.invoice?.account || '-' }}</strong>
              <span>地址电话</span><strong>{{ selectedCustomer?.invoice?.addressPhone || '-' }}</strong>
              <span>公司地址</span><strong>{{ selectedCustomer?.address || '-' }}</strong>
              <span v-if="selectedCustomer?.type === '客户'">结算币种</span><strong v-if="selectedCustomer?.type === '客户'">{{ selectedCustomer?.settlementCurrency || '人民币结算' }}</strong>
            </div>
            <div v-else-if="activeCustomerDetailTab === '相关费用'" class="info-grid">
              <span>订单数</span><strong>{{ selectedCustomerOrders.length }}</strong>
              <span>应收港币</span><strong>港币 {{ money(selectedCustomerOrders.reduce((sum, item) => sum + Number(item.receivableHKD || 0), 0)) }}</strong>
              <span>应收人民币</span><strong>人民币 {{ money(selectedCustomerOrders.reduce((sum, item) => sum + Number(item.receivableRMB || 0), 0)) }}</strong>
            </div>
            <table v-else-if="activeCustomerDetailTab === '相关对账'" class="data-table compact">
              <thead><tr><th>订单号</th><th>日期</th><th>应收港币</th><th>应收人民币</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="order in selectedCustomerOrders" :key="order.no"><td>{{ order.no }}</td><td>{{ order.date }}</td><td>港币 {{ money(order.receivableHKD) }}</td><td>人民币 {{ money(order.receivableRMB) }}</td><td>{{ order.status }}</td></tr>
                <tr v-if="selectedCustomerOrders.length === 0"><td colspan="5">暂无对账数据</td></tr>
              </tbody>
            </table>
            <table v-else-if="activeCustomerDetailTab === '变更记录'" class="data-table compact">
              <thead><tr><th>时间</th><th>操作</th><th>说明</th></tr></thead>
              <tbody>
                <tr v-for="item in auditRows.filter((row) => row.entityId === selectedCustomer?.id || String(row.detail || '').includes(selectedCustomer?.name || ''))" :key="item.id"><td>{{ item.createdAt }}</td><td>{{ item.action }}</td><td>{{ item.detail }}</td></tr>
                <tr v-if="auditRows.filter((row) => row.entityId === selectedCustomer?.id || String(row.detail || '').includes(selectedCustomer?.name || '')).length === 0"><td colspan="3">暂无变更记录</td></tr>
              </tbody>
            </table>
            <div v-else class="placeholder-panel compact">
              {{ activeCustomerDetailTab }} 暂无数据，可在后续按字段继续细化。
            </div>
          </div>
        </div>
        </BusinessPage>
      </section>

      <section v-else-if="activeModule === 'orders'" class="work-page order-page">
        <BusinessPage>
        <div class="order-period-row">
          <div class="statement-date-selects order-period-controls">
            <div class="segmented compact-segmented order-date-segmented">
              <button
                v-for="item in ORDER_DATE_FILTERS"
                :key="item.key"
                type="button"
                :class="{ active: orderDateFilter === item.key }"
                @click="orderDateFilter = item.key"
              >{{ item.label }}</button>
            </div>
            <span v-if="orderDateFilter === 'custom'" class="order-custom-date-range">
              <label>开始<input v-model="orderCustomDateStart" type="date" /></label>
              <label>结束<input v-model="orderCustomDateEnd" type="date" /></label>
            </span>
            <span class="finance-period-chip">当前范围：{{ orderDateRangeLabel }}</span>
          </div>
        </div>
        <div class="toolbar order-page-toolbar">
          <div class="order-filter-group">
            <select v-model="orderCustomerFilter" class="order-customer-filter" title="客户筛选">
              <option value="">全部客户</option>
              <option v-for="customerName in orderCustomerFilterOptions" :key="customerName" :value="customerName">{{ customerName }}</option>
            </select>
            <select v-model="orderBusinessFilter" class="order-small-filter" title="业务类型">
              <option value="">全部业务</option>
              <option>运输</option>
              <option>报关</option>
              <option>运输+报关</option>
            </select>
            <select v-model="orderStatusFilter" class="order-small-filter" title="状态">
              <option value="">全部状态</option>
              <option>待确认</option>
              <option>已签收</option>
              <option>已审核</option>
              <option>缺票据</option>
              <option>费用待确认</option>
            </select>
          </div>
          <div class="order-action-group">
            <button class="primary-btn" :disabled="loading" @click="openOrderModal()"><IconSvg name="plus" />新建订单</button>
            <button class="ghost-btn order-icon-btn" title="批量审核" aria-label="批量审核" @click="auditPendingOrders"><IconSvg name="check" /><span class="sr-only">批量审核</span></button>
            <button class="ghost-btn order-icon-btn" title="取消审核" aria-label="取消审核" @click="cancelSelectedAudits"><IconSvg name="refresh" /><span class="sr-only">取消审核</span></button>
            <button class="ghost-btn small" type="button" @click="resetOrderColumnOrder"><IconSvg name="list" />恢复列序</button>
            <button class="ghost-btn small" type="button" @click="resetOrderColumnWidths"><IconSvg name="refresh" />恢复列宽</button>
            <span class="order-export-wrap" @click.stop>
              <button class="ghost-btn order-icon-btn order-export-trigger" type="button" title="导出" aria-label="导出" @click="toggleOrderExportMenu">
                <IconSvg name="download" /><span class="sr-only">导出</span><IconSvg name="chevronDown" />
              </button>
              <div v-if="orderExportMenuOpen" class="order-export-menu">
                <div class="order-export-menu-title">选择导出模板</div>
                <div class="order-export-exchange">
                  <select v-model="orderExportExchangeMode" title="合计换算方向">
                    <option value="">合计不换算</option>
                    <option value="hkd-to-rmb">HKD合计转RMB</option>
                    <option value="rmb-to-hkd">RMB合计转HKD</option>
                  </select>
                  <input
                    v-model="orderExportExchangeRate"
                    type="number"
                    min="0"
                    step="0.0001"
                    inputmode="decimal"
                    placeholder="1HKD=?RMB"
                    title="汇率：1 港币等于多少人民币"
                  />
                </div>
                <div v-for="template in orderExportTemplateOptions()" :key="template.id" class="order-export-template-row">
                  <span :title="template.name">{{ template.name }}</span>
                  <button type="button" title="导出 Excel" aria-label="导出 Excel" @click="exportOrdersByFormat('excel', template)">Excel</button>
                  <button type="button" title="导出 PDF" aria-label="导出 PDF" @click="exportOrdersByFormat('pdf', template)">PDF</button>
                </div>
              </div>
            </span>
            <button class="ghost-btn order-icon-btn" type="button" :title="selectedOrderNos.length ? `查看已选 ${selectedOrderNos.length} 条` : '查看当前筛选列表'" aria-label="查看订单列表" @click="openOrderListDetail">
              <IconSvg name="eye" /><span class="sr-only">查看</span>
            </button>
            <button class="danger-btn order-icon-btn" title="批量删除" aria-label="批量删除" @click="deleteSelectedOrders"><IconSvg name="trash" /><span class="sr-only">批量删除</span></button>
            <button class="ghost-btn order-icon-btn" title="回收站" aria-label="回收站" @click="openRecycleBin"><IconSvg name="archive" /><span class="sr-only">回收站</span></button>
          </div>
        </div>
        <div class="table-card full-height order-table-card">
          <div class="order-table-scroll">
            <table class="data-table compact order-table" :style="orderTableStyle()">
              <colgroup>
                <col v-for="column in visibleOrderColumns" :key="column.key" :style="orderColumnStyle(column.key)" />
              </colgroup>
              <thead>
                <tr>
                  <th
                    v-for="(column, index) in visibleOrderColumns"
                    :key="column.key"
                    :class="['resizable-th', { sortable: !['select', 'actions'].includes(column.key), sorted: tableSortDirection('orders', column.key), 'sticky-managed-column': isOrderColumnFrozen(column), 'sticky-order-right-column': isOrderRightStickyColumn(column), 'order-full-cell': isOrderFullDisplayColumn(column), 'order-driver-cell': column.key === 'driver' }]"
                    :style="orderStickyColumnStyle(column, index)"
                    @click="toggleTableSort('orders', column)"
                  >
                    <input v-if="column.key === 'select'" type="checkbox" :checked="filteredOrders.length > 0 && selectedOrderNos.length === filteredOrders.length" @click.stop @change="selectedOrderNos = $event.target.checked ? filteredOrders.map((item) => item.no) : []" />
                    <span v-else-if="column.key === 'actions'" class="column-manager-wrap" @click.stop>
                      <button class="table-op icon-only column-manager-trigger" type="button" title="管理列表" aria-label="管理列表" @click="orderColumnMenuOpen = !orderColumnMenuOpen"><IconSvg name="list" /></button>
                      <div v-if="orderColumnMenuOpen" class="column-manager-menu" @click.stop>
                        <div
                          v-for="menuColumn in orderColumns.filter((item) => !item.locked && !isOrderRightStickyColumn(item))"
                          :key="menuColumn.key"
                          class="column-manager-row"
                          draggable="true"
                          @dragstart="startOrderColumnDrag(menuColumn, $event)"
                          @dragover.prevent
                          @dragenter.prevent="dropOrderColumn(menuColumn)"
                          @drop.prevent="dropOrderColumn(menuColumn)"
                        >
                          <span class="column-manager-drag"><IconSvg name="list" /></span>
                          <button
                            class="column-manager-check"
                            :class="{ checked: isOrderColumnVisible(menuColumn.key) }"
                            type="button"
                            title="显示/隐藏"
                            @click.stop.prevent="toggleOrderColumnVisible(menuColumn)"
                          ><IconSvg v-if="isOrderColumnVisible(menuColumn.key)" name="check" /></button>
                          <span>{{ menuColumn.label }}</span>
                          <button
                            :class="['icon-btn', 'icon-only', { active: isOrderColumnLocked(menuColumn) }]"
                            type="button"
                            :title="isOrderColumnLocked(menuColumn) ? '取消冻结' : '冻结列'"
                            @click.stop.prevent="toggleOrderColumnLock(menuColumn)"
                          ><IconSvg name="lock" /></button>
                          <button class="icon-btn icon-only" type="button" title="上移" @click.stop.prevent="moveOrderColumn(menuColumn, -1)"><IconSvg name="chevronUp" /></button>
                          <button class="icon-btn icon-only" type="button" title="下移" @click.stop.prevent="moveOrderColumn(menuColumn, 1)"><IconSvg name="chevronDown" /></button>
                        </div>
                      </div>
                    </span>
                    <button v-else class="table-sort-trigger" type="button">
                      <span>{{ column.label }}</span>
                      <span class="sort-mark">{{ tableSortDirection('orders', column.key) === 'asc' ? '↑' : tableSortDirection('orders', column.key) === 'desc' ? '↓' : '' }}</span>
                    </button>
                    <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startOrderColumnResize(column, $event)"></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="order in filteredOrders"
                  :key="order.no"
                  :class="{ selected: selectedOrderRowNo === order.no }"
                  @click="selectedOrderRowNo = selectedOrderRowNo === order.no ? '' : order.no"
                  @dblclick="openOrderDetail(order)"
                >
                  <td
                    v-for="(column, index) in visibleOrderColumns"
                    :key="column.key"
                    :class="{ 'row-actions': column.key === 'actions', 'sticky-managed-column': isOrderColumnFrozen(column), 'sticky-order-right-column': isOrderRightStickyColumn(column), 'order-full-cell': isOrderFullDisplayColumn(column), 'order-driver-cell': column.key === 'driver' }"
                    :style="orderStickyColumnStyle(column, index)"
                    :title="orderTableCellTitle(order, column.key)"
                  >
                    <input v-if="column.key === 'select'" v-model="selectedOrderNos" type="checkbox" :value="order.no" @click.stop @dblclick.stop />
                    <span v-else-if="column.key === 'status'" class="status-badge" :class="orderStatusClass(order.status)">{{ order.status }}</span>
                    <template v-else-if="column.key === 'actions'">
                      <button
                        v-if="order.status !== '已审核'"
                        :class="['icon-btn', { success: canAuditOrder(order) }]"
                        type="button"
                        :title="orderAuditButtonTitle(order)"
                        :disabled="!canAuditOrder(order)"
                        @click.stop="auditOrder(order)"
                        @dblclick.stop
                      ><IconSvg name="check" />审核</button>
                      <button v-else class="icon-btn" @click.stop="cancelAuditOrder(order)" @dblclick.stop><IconSvg name="refresh" />取消审核</button>
                      <button class="icon-btn" @click.stop="openOrderModal(null, order)" @dblclick.stop><IconSvg name="edit" />编辑</button>
                      <button v-if="canDeleteOrder(order)" class="icon-btn icon-only danger" type="button" title="删除订单" aria-label="删除订单" @click.stop="deleteOrder(order)" @dblclick.stop><IconSvg name="trash" /></button>
                    </template>
                    <button v-else-if="column.key === 'no'" class="table-link-btn" type="button" @click.stop="openOrderDetail(order)">{{ orderCellText(order, column.key) }}</button>
                    <template v-else>{{ orderCellText(order, column.key) }}</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="order-summary-bar">
            <span>合计 {{ filteredOrders.length }} 条</span>
            <strong>港币 {{ filteredOrders.reduce((sum, item) => sum + Number(item.receivableHKD || 0), 0).toLocaleString() }}</strong>
            <strong>人民币 {{ filteredOrders.reduce((sum, item) => sum + Number(item.receivableRMB || 0), 0).toLocaleString() }}</strong>
          </div>
        </div>
        </BusinessPage>
      </section>

      <section v-else-if="activeModule === 'dispatchBoard'" class="work-page dispatch-page">
        <VehicleDriverPage>
        <div class="toolbar dispatch-toolbar">
          <label class="dispatch-search-field">
            <input
              v-model.trim="dispatchSearchKeyword"
              type="search"
              placeholder="搜索排车号 / 车牌 / 公司名"
            />
            <button
              v-if="dispatchSearchKeyword"
              type="button"
              class="dispatch-search-clear"
              aria-label="清空搜索"
              @click="dispatchSearchKeyword = ''"
            >
              x
            </button>
          </label>

          <div class="statement-date-selects period-filter-controls dispatch-period-controls">
            <div class="segmented compact-segmented dispatch-date-segmented">
              <button
                v-for="item in DISPATCH_DATE_FILTERS"
                :key="item.key"
                type="button"
                :class="{ active: dispatchPeriodFilter === item.key }"
                @click="setDispatchDateFilter(item.key)"
              >{{ item.label }}</button>
            </div>
            <span v-if="dispatchPeriodFilter === 'custom'" class="dispatch-custom-date-range">
              <label>开始<input :value="dispatchCustomDateStart" type="date" @change="setDispatchCustomDateStart($event.target.value)" /></label>
              <label>结束<input :value="dispatchCustomDateEnd" type="date" @change="setDispatchCustomDateEnd($event.target.value)" /></label>
            </span>
            <span class="finance-period-chip">当前范围：{{ dispatchDateFilterLabel() }}</span>
          </div>

          <div class="dispatch-actions">
            <button class="primary-btn" type="button" @click="openDispatchModal"><IconSvg name="plus" />新建排车单</button>
          </div>
        </div>

        <div class="dispatch-summary-row">
          <span class="dispatch-toolbar-stat">
            <span>当前排车</span>
            <strong>{{ searchedDispatchPlanTotalRows.length }}</strong>
          </span>
        </div>

        <div class="dispatch-status-pool">
          <button
            v-for="item in dispatchStatusPoolItems"
            :key="item.status"
            type="button"
            :class="[dispatchStatusClass(item.status), { active: activeDispatchStatusPool === item.status }]"
            @click="activeDispatchStatusPool = item.status"
          >
            <span>{{ item.status }}</span>
            <strong>{{ item.count }}</strong>
          </button>
        </div>

        <div class="dispatch-layout">
          <section class="table-card dispatch-panel dispatch-plan-panel">
            <div class="dispatch-panel-head">
              <div class="dispatch-panel-actions">
                <button class="ghost-btn small" type="button" @click="toggleAllDispatchPlanSelection(!allDispatchPlanRowsSelected)">
                  <IconSvg name="checklist" />{{ selectedDispatchPlanRows.length ? `已选 ${selectedDispatchPlanRows.length} 单` : '批量管理' }}
                </button>
                <button class="ghost-btn small" type="button" :disabled="!selectedDispatchPlanRows.length || loading" @click="duplicateSelectedDispatchRows">
                  <IconSvg name="copy" />复制排车单
                </button>
                <button class="ghost-btn small" type="button" @click="copyDispatchPlanText">
                  <IconSvg name="sparkles" />生成派车信息
                </button>
                <button class="ghost-btn small" type="button" :title="selectedDispatchPlanRows.length ? `查看已选 ${selectedDispatchPlanRows.length} 单` : '查看当前排车列表'" @click="openDispatchListDetail">
                  <IconSvg name="eye" />查看
                </button>
                <button class="ghost-btn small" type="button" @click="exportDispatchPlanRows">
                  <IconSvg name="download" />导出
                </button>
                <label class="data-table-density-select dispatch-density-select">行密度
                  <select :value="dataTableDensity" @change="setDataTableDensity($event.target.value)">
                    <option v-for="item in dataTableDensityOptions" :key="item.key" :value="item.key">{{ item.label }}</option>
                  </select>
                </label>
                <details class="data-table-column-menu dispatch-column-menu">
                  <summary class="ghost-btn small">
                    <IconSvg name="columns" />列
                    <span>{{ visibleDispatchTableColumns.length }}/{{ dispatchTableColumns.length }}</span>
                  </summary>
                  <div class="data-table-column-popover">
                    <label v-for="column in dispatchTableColumns" :key="column.key" :class="{ disabled: column.locked }">
                      <input
                        type="checkbox"
                        :checked="dispatchTableColumnVisibility[column.key] !== false"
                        :disabled="column.locked"
                        @change="setDataTableColumnVisible('dispatch_board', dispatchTableColumnVisibility, column, $event.target.checked)"
                      />
                      {{ column.label }}
                    </label>
                  </div>
                </details>
                <button class="ghost-btn small" type="button" @click="saveDispatchPlan">
                  <IconSvg name="save" />保存
                </button>
              </div>
            </div>
            <div class="table-wrap">
              <datalist id="dispatchVehiclePlates">
                <option v-for="vehicle in vehicleRows" :key="vehicle.plate" :value="vehicle.plate">{{ vehicle.plate }} · {{ vehicle.type }}</option>
              </datalist>
              <table :class="['data-table compact managed-data-table dispatch-table', dataTableDensityClass()]">
                <colgroup>
                  <col
                    v-for="column in visibleDispatchTableColumns"
                    :key="column.key"
                    :style="dataTableColumnStyle(dispatchTableColumnWidths, column.key)"
                  />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      v-for="column in visibleDispatchTableColumns"
                      :key="column.key"
                      :class="['resizable-th', { 'dispatch-sequence-head': column.key === 'sequence', sortable: !['sequence', 'actions'].includes(column.key), sorted: tableSortDirection('dispatchBoard', column.key) }]"
                      @click="toggleTableSort('dispatchBoard', column)"
                    >
                      <template v-if="column.key === 'sequence'">
                        <label class="dispatch-select-label">
                          <input type="checkbox" class="table-check" :checked="allDispatchPlanRowsSelected" @click.stop @change="toggleAllDispatchPlanSelection($event.target.checked)" />
                          <span>{{ column.label }}</span>
                        </label>
                      </template>
                      <span v-else-if="column.key === 'actions'" class="column-manager-wrap" @click.stop>
                        <button class="table-op icon-only column-manager-trigger" type="button" title="管理列表" aria-label="管理列表" @click="dispatchColumnMenuOpen = !dispatchColumnMenuOpen"><IconSvg name="list" /></button>
                        <div v-if="dispatchColumnMenuOpen" class="column-manager-menu" @click.stop>
                          <button
                            v-for="menuColumn in dispatchTableColumns.filter((item) => !item.locked)"
                            :key="menuColumn.key"
                            type="button"
                            draggable="true"
                            @click.stop.prevent="toggleDispatchColumnVisible(menuColumn)"
                            @dragstart="startDispatchColumnDrag(menuColumn, $event)"
                            @dragover.prevent
                            @dragenter.prevent="dropDispatchColumn(menuColumn)"
                            @drop.prevent="dropDispatchColumn(menuColumn)"
                          >
                            <span class="column-manager-drag"><IconSvg name="list" /></span>
                            <span class="column-manager-check" :class="{ checked: isDispatchColumnVisible(menuColumn.key) }"><IconSvg v-if="isDispatchColumnVisible(menuColumn.key)" name="check" /></span>
                            <span>{{ menuColumn.label }}</span>
                          </button>
                        </div>
                      </span>
                      <button v-else class="table-sort-trigger" type="button">
                        <span>{{ column.label }}</span>
                        <span class="sort-mark">{{ tableSortDirection('dispatchBoard', column.key) === 'asc' ? '↑' : tableSortDirection('dispatchBoard', column.key) === 'desc' ? '↓' : '' }}</span>
                      </button>
                      <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startDataTableColumnResize('dispatch_board', dispatchTableColumnWidths, column, $event)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in searchedDispatchPlanRows" :key="row.id" @click="openDispatchDetail(row)">
                    <td
                      v-for="column in visibleDispatchTableColumns"
                      :key="column.key"
                      :class="{
                        'dispatch-sequence-cell': column.key === 'sequence',
                        'dispatch-load-time-cell': column.key === 'loadTime',
                        'dispatch-no-cell': column.key === 'dispatchNo',
                        'dispatch-customer-cell': column.key === 'customer',
                        'dispatch-driver-cell': column.key === 'driver',
                        'dispatch-route-cell': column.key === 'route',
                        'dispatch-source-cell': column.key === 'vehicleSource',
                        'row-actions dispatch-row-actions': column.key === 'actions'
                      }"
                      :title="column.key === 'customer' ? row.order.customer : column.key === 'route' ? `${row.order.loading || ''} → ${row.order.unloading || ''}` : column.key === 'vehicleSource' ? dispatchVehicleSourceText(row) : ''"
                    >
                      <template v-if="column.key === 'sequence'">
                        <label class="dispatch-select-label">
                          <input type="checkbox" class="table-check" :checked="selectedDispatchPlanIds.includes(row.id)" @click.stop @change="toggleDispatchPlanSelection(row.id, $event.target.checked)" />
                          <strong>{{ row.displayIndex + 1 }}</strong>
                        </label>
                      </template>
                      <template v-else-if="column.key === 'loadTime'">
                        <div class="dispatch-load-time-field">
                          <span class="dispatch-load-date">{{ row.order.date || row.date || dispatchDate }}</span>
                          <select v-model="dispatchPlanRows[row.index].loadTime" class="dispatch-time-input" title="装车时间" @click.stop @change="handleDispatchRowLoadTimeChange(row)">
                            <option value="">未定</option>
                            <option v-for="time in DISPATCH_LOAD_TIME_OPTIONS" :key="time" :value="time">{{ time }}</option>
                          </select>
                        </div>
                      </template>
                      <template v-else-if="column.key === 'dispatchNo'">
                        <strong>{{ row.dispatchNo }}</strong>
                        <small v-if="row.order.no">{{ row.order.no }}</small>
                        <small v-else>未绑定订单</small>
                      </template>
                      <template v-else-if="column.key === 'customer'">{{ row.order.customer || "-" }}</template>
                      <template v-else-if="column.key === 'plate'">
                        <input v-model.trim="dispatchPlanRows[row.index].plate" list="dispatchVehiclePlates" placeholder="车牌" @click.stop @input="handleDispatchPlateInput(row)" />
                      </template>
                      <template v-else-if="column.key === 'driver'">
                        <select
                          v-if="row.status === '已派车'"
                          v-model="dispatchPlanRows[row.index].driver"
	                          class="dispatch-driver-select"
	                          title="指派司机"
	                          @click.stop
	                          @change="handleDispatchDriverChange(row)"
	                        >
                          <option value="">未指派</option>
                          <option v-for="driver in dispatchDriverOptions" :key="driver.id" :value="driver.name">{{ dispatchDriverLabel(driver) }}</option>
                        </select>
                        <template v-else>{{ dispatchDriverText(row) }}</template>
                      </template>
                      <template v-else-if="column.key === 'port'">{{ row.order.port || "-" }}</template>
                      <template v-else-if="column.key === 'direction'">{{ row.order.direction || "-" }}</template>
                      <template v-else-if="column.key === 'tonnage'">{{ row.order.tonnage || "-" }}</template>
                      <template v-else-if="column.key === 'quantity'">{{ row.order.quantity || "-" }}</template>
                      <template v-else-if="column.key === 'weight'">{{ row.order.weight || "-" }}</template>
                      <template v-else-if="column.key === 'route'">{{ dispatchOrderRouteText(row.order) }}</template>
                      <template v-else-if="column.key === 'vehicleSource'">{{ dispatchVehicleSourceText(row) }}</template>
                      <template v-else-if="column.key === 'status'">
                        <select v-model="dispatchPlanRows[row.index].status" :class="['dispatch-status-select', dispatchStatusClass(dispatchPlanRows[row.index].status)]" @click.stop @change="handleDispatchStatusChange(row)">
                          <option v-for="status in dispatchStatusOptionsForRow(row)" :key="status" :value="status">{{ status }}</option>
                        </select>
                      </template>
                      <template v-else-if="column.key === 'note'">
                        <input v-model.trim="dispatchPlanRows[row.index].note" placeholder="备注" @click.stop @input="saveDispatchPlan({ silent: true })" />
                      </template>
                      <template v-else-if="column.key === 'actions'">
                        <button class="icon-btn icon-only" type="button" title="编辑排车单" @click.stop="openEditDispatchPlanRow(row)"><IconSvg name="edit" /></button>
                        <button class="icon-btn icon-only" type="button" title="上移" @click.stop="moveDispatchPlanRow(row.index, -1)"><IconSvg name="chevronUp" /></button>
                        <button class="icon-btn icon-only" type="button" title="下移" @click.stop="moveDispatchPlanRow(row.index, 1)"><IconSvg name="chevronDown" /></button>
                        <button class="icon-btn danger icon-only" type="button" title="移除" @click.stop="removeDispatchPlanRow(row.index)"><IconSvg name="trash" /></button>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="searchedDispatchPlanRows.length === 0"><td :colspan="visibleDispatchTableColumns.length">暂无排车计划，请从左侧加入订单</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
        </VehicleDriverPage>
      </section>

      <section v-else-if="activeModule === 'vehicleDriver'" class="work-page">
        <VehicleDriverPage>
        <div class="toolbar vehicle-driver-toolbar">
          <div class="vehicle-driver-title">
            <p class="eyebrow">车辆司机</p>
            <h2>{{ activeVehicleTab }}</h2>
          </div>
          <input v-model.trim="vehicleDriverSearch" class="search-input vehicle-driver-search" placeholder="车牌 / 司机 / 证件 / 备注" />
          <div class="vehicle-driver-actions">
            <button class="ghost-btn" @click="toggleVehicleDriverBatchSelection">
              <IconSvg name="checklist" />
              {{ selectedVehicleDriverCount ? `已选 ${selectedVehicleDriverCount} 项` : '批量管理' }}
            </button>
            <button class="ghost-btn" type="button" :title="selectedVehicleDriverCount ? `查看已选 ${selectedVehicleDriverCount} 项` : `查看当前${activeVehicleTab}`" @click="openVehicleDriverListDetail">
              <IconSvg name="eye" />查看
            </button>
            <button class="ghost-btn" @click="deleteSelectedVehicleDriver"><IconSvg name="trash" />删除管理</button>
            <button class="ghost-btn" @click="exportVehicleDriver"><IconSvg name="download" />导出</button>
            <button class="primary-btn" @click="activeVehicleTab === '车辆管理' ? openVehicleModal() : openDriverModal()">
              <IconSvg name="plus" />新增{{ activeVehicleTab === '车辆管理' ? '车辆' : '司机' }}
            </button>
          </div>
        </div>

        <div class="split-workspace vehicle-split-workspace" :style="splitWorkspaceStyle('vehicle')">
          <div v-if="activeVehicleTab === '车辆管理'" class="table-card">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" :checked="visibleVehicles.length > 0 && selectedVehiclePlates.length === visibleVehicles.length" @change="selectedVehiclePlates = $event.target.checked ? visibleVehicles.map((item) => item.plate) : []" /></th>
                  <th v-for="column in [
                    { key: 'plate', label: '车牌' },
                    { key: 'brand', label: '品牌' },
                    { key: 'model', label: '型号' },
                    { key: 'type', label: '车型' },
                    { key: 'mainlandInsuranceDate', label: '大陆保险' },
                    { key: 'hkInsuranceDate', label: '香港保险' },
                    { key: 'status', label: '状态' },
                    { key: 'monthlyCost', label: '本月费用' }
                  ]" :key="column.key" :class="['sortable', { sorted: tableSortDirection('vehicles', column.key) }]" @click="toggleTableSort('vehicles', column)">
                    <button class="table-sort-trigger" type="button">
                      <span>{{ column.label }}</span>
                      <span class="sort-mark">{{ tableSortDirection('vehicles', column.key) === 'asc' ? '↑' : tableSortDirection('vehicles', column.key) === 'desc' ? '↓' : '' }}</span>
                    </button>
                  </th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in visibleVehicles"
                  :key="item.plate"
                  :class="{ selected: selectedVehicle?.plate === item.plate }"
                  @click="selectedVehiclePlate = item.plate"
                >
                  <td><input v-model="selectedVehiclePlates" type="checkbox" :value="item.plate" @click.stop /></td>
                  <td>{{ item.plate }}</td>
                  <td>{{ item.brand }}</td>
                  <td>{{ item.model }}</td>
                  <td>{{ item.type }}</td>
                  <td>{{ item.mainlandInsuranceDate }}</td>
                  <td>{{ item.hkInsuranceDate }}</td>
                  <td>{{ item.status }}</td>
                  <td>HKD {{ Number(item.monthlyCost || 0).toLocaleString() }}</td>
                  <td><button class="icon-btn" @click.stop="openVehicleModal(item)"><IconSvg name="edit" />编辑</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-else class="table-card">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" :checked="visibleDrivers.length > 0 && selectedDriverIds.length === visibleDrivers.length" @change="selectedDriverIds = $event.target.checked ? visibleDrivers.map((item) => item.id) : []" /></th>
                  <th v-for="column in [
                    { key: 'type', label: '类型' },
                    { key: 'name', label: '司机' },
                    { key: 'phone', label: '电话' },
                    { key: 'license', label: '驾驶证' },
                    { key: 'expireAt', label: '证件到期' },
                    { key: 'status', label: '状态' }
                  ]" :key="column.key" :class="['sortable', { sorted: tableSortDirection('drivers', column.key) }]" @click="toggleTableSort('drivers', column)">
                    <button class="table-sort-trigger" type="button">
                      <span>{{ column.label }}</span>
                      <span class="sort-mark">{{ tableSortDirection('drivers', column.key) === 'asc' ? '↑' : tableSortDirection('drivers', column.key) === 'desc' ? '↓' : '' }}</span>
                    </button>
                  </th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in visibleDrivers"
                  :key="item.id"
                  :class="{ selected: selectedDriver?.id === item.id }"
                  @click="selectedDriverId = item.id"
                >
                  <td><input v-model="selectedDriverIds" type="checkbox" :value="item.id" @click.stop /></td>
                  <td>{{ item.type || "香港司机" }}</td>
                  <td>{{ item.name }}</td>
                  <td>{{ item.phone }}</td>
                  <td>{{ item.license }}</td>
                  <td>{{ item.expireAt }}</td>
                  <td>{{ item.status }}</td>
                  <td><button class="icon-btn" @click.stop="openDriverModal(item)"><IconSvg name="edit" />编辑</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            class="resizer vehicle-resizer"
            role="separator"
            aria-label="调整车辆司机列表和详情高度"
            @mousedown="startSplitResize('vehicle', $event)"
            @touchstart.prevent="startSplitResize('vehicle', $event)"
          />

          <div class="detail-panel">
            <template v-if="activeVehicleTab === '车辆管理'">
              <div class="tabs">
                <button :class="{ active: activeVehicleDetailTab === '车辆资料' }" @click="activeVehicleDetailTab = '车辆资料'">车辆资料</button>
                <button :class="{ active: activeVehicleDetailTab === '证件提醒' }" @click="activeVehicleDetailTab = '证件提醒'">证件提醒</button>
                <button :class="{ active: activeVehicleDetailTab === '费用记录' }" @click="activeVehicleDetailTab = '费用记录'">费用记录</button>
                <button :class="{ active: activeVehicleDetailTab === '维修保养' }" @click="activeVehicleDetailTab = '维修保养'">维修保养</button>
                <button :class="{ active: activeVehicleDetailTab === '关联订单' }" @click="activeVehicleDetailTab = '关联订单'">关联订单</button>
                <div v-if="activeVehicleDetailTab === '关联订单'" class="related-order-filter tabs-date-filter">
                  <button
                    v-for="item in RELATED_ORDER_DATE_FILTERS"
                    :key="item.key"
                    :class="{ active: vehicleRelatedOrderDateFilter === item.key }"
                    @click="vehicleRelatedOrderDateFilter = item.key"
                  >{{ item.label }}</button>
                </div>
              </div>
              <div v-if="activeVehicleDetailTab === '车辆资料'" class="info-grid">
                <span>车牌</span><strong>{{ selectedVehicle?.plate }}</strong>
                <span>品牌</span><strong>{{ selectedVehicle?.brand }}</strong>
                <span>型号</span><strong>{{ selectedVehicle?.model }}</strong>
                <span>车型</span><strong>{{ selectedVehicle?.type }}</strong>
                <span>大陆保险到期</span><strong>{{ selectedVehicle?.mainlandInsuranceDate }}</strong>
                <span>香港保险到期</span><strong>{{ selectedVehicle?.hkInsuranceDate }}</strong>
                <span>保养提醒</span><strong>{{ selectedVehicle?.maintenanceReminder }}</strong>
                <span>备注</span><strong>{{ selectedVehicle?.note }}</strong>
              </div>
              <div v-else-if="activeVehicleDetailTab === '证件提醒'" class="file-panel">
                <table class="data-table compact">
                  <thead><tr><th>证件/保险</th><th>到期日期</th><th>提醒规则</th><th>状态</th></tr></thead>
                  <tbody>
                    <tr><td>大陆保险</td><td>{{ selectedVehicle?.mainlandInsuranceDate || '-' }}</td><td>{{ selectedVehicle?.insuranceReminder || '-' }}</td><td>{{ selectedVehicle?.status || '-' }}</td></tr>
                    <tr><td>香港保险</td><td>{{ selectedVehicle?.hkInsuranceDate || '-' }}</td><td>{{ selectedVehicle?.insuranceReminder || '-' }}</td><td>{{ selectedVehicle?.status || '-' }}</td></tr>
                    <tr><td>大陆年审</td><td>{{ selectedVehicle?.mainlandReviewDate || '-' }}</td><td>{{ selectedVehicle?.insuranceReminder || '-' }}</td><td>{{ selectedVehicle?.status || '-' }}</td></tr>
                    <tr><td>香港年审</td><td>{{ selectedVehicle?.hkReviewDate || '-' }}</td><td>{{ selectedVehicle?.insuranceReminder || '-' }}</td><td>{{ selectedVehicle?.status || '-' }}</td></tr>
                  </tbody>
                </table>
                <div class="file-toolbar">
                  <label class="file-upload-btn"><IconSvg name="upload" />上传证件/保险单<input type="file" :accept="FILE_UPLOAD_ACCEPT" @change="uploadVehicleFile" /></label>
                  <span class="hint">每年保险单、年审资料都可保存，支持预览和下载。</span>
                </div>
                <table class="data-table compact">
                  <thead><tr><th>文件名</th><th>大小</th><th>上传时间</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-for="file in vehicleFileRows" :key="file.id">
                      <td>{{ file.filename }}</td><td>{{ fileSizeText(file.size) }}</td><td>{{ file.createdAt }}</td>
                      <td class="row-actions"><button class="icon-btn" @click="openStoredFile(file, 'preview')"><IconSvg name="eye" />预览</button><button class="icon-btn" @click="openStoredFile(file, 'download')"><IconSvg name="download" />下载</button><button class="icon-btn danger" @click="deleteFile(file, vehicleFileRows)"><IconSvg name="trash" />删除</button></td>
                    </tr>
                    <tr v-if="vehicleFileRows.length === 0"><td colspan="4">暂无证件附件</td></tr>
                  </tbody>
                </table>
              </div>
              <div v-else-if="activeVehicleDetailTab === '费用记录'" class="vehicle-detail-expense-panel">
                <div class="related-order-summary">
                  <span>费用记录 {{ selectedVehicleExpenses.length }} 条</span>
                  <strong>{{ moneyPairDisplay(selectedVehicleExpenseTotal.hkd, selectedVehicleExpenseTotal.rmb) }}</strong>
                </div>
                <table class="data-table compact">
                  <thead><tr><th>名称</th><th>类型</th><th>时间</th><th>金额</th><th>分摊说明</th><th>备注</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-for="item in selectedVehicleExpenses" :key="item.id">
                      <td>{{ item.name || vehicleExpenseTypeLabel(item.type) }}</td>
                      <td>{{ vehicleExpenseTypeLabel(item.type) }}</td>
                      <td>{{ vehicleExpenseDateText(item) }}</td>
                      <td>{{ currencyCodeDisplay(item.currency) }} {{ money(item.amount) }}</td>
                      <td>{{ vehicleExpenseAllocationText(item) }}</td>
                      <td>{{ item.note || "-" }}</td>
                      <td class="row-actions">
                        <button class="icon-btn icon-only" type="button" title="编辑费用" aria-label="编辑费用" @click="openVehicleExpenseModal(item)"><IconSvg name="edit" /></button>
                        <button class="icon-btn icon-only danger" type="button" title="删除费用" aria-label="删除费用" @click="deleteVehicleExpense(item)"><IconSvg name="trash" /></button>
                      </td>
                    </tr>
                    <tr v-if="selectedVehicleExpenses.length === 0"><td colspan="7">暂无费用记录</td></tr>
                  </tbody>
                </table>
              </div>
              <table v-else-if="activeVehicleDetailTab === '维修保养'" class="data-table compact">
                <thead><tr><th>保养提醒</th><th>状态</th><th>备注</th></tr></thead>
                <tbody><tr><td>{{ selectedVehicle?.maintenanceReminder || '-' }}</td><td>{{ selectedVehicle?.status || '-' }}</td><td>{{ selectedVehicle?.note || '-' }}</td></tr></tbody>
              </table>
              <div v-else class="related-order-panel">
                <table class="data-table compact related-order-table vehicle-related-order-table">
                  <colgroup>
                    <col
                      v-for="column in relatedVehicleOrderColumns"
                      :key="column.key"
                      :style="relatedOrderColumnStyle(relatedVehicleOrderColumnWidths, column.key)"
                    />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        v-for="column in relatedVehicleOrderColumns"
                        :key="column.key"
                        :class="['resizable-th', 'sortable', { sorted: tableSortDirection('relatedVehicleOrders', column.key) }]"
                        @click="toggleTableSort('relatedVehicleOrders', column)"
                      >
                        <button class="table-sort-trigger" type="button">
                          <span>{{ column.label }}</span>
                          <span class="sort-mark">{{ tableSortDirection('relatedVehicleOrders', column.key) === 'asc' ? '↑' : tableSortDirection('relatedVehicleOrders', column.key) === 'desc' ? '↓' : '' }}</span>
                        </button>
                        <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startRelatedVehicleOrderColumnResize(column, $event)"></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="order in selectedVehicleOrders" :key="order.no"><td>{{ order.no }}</td><td>{{ order.date }}</td><td class="related-order-customer-cell" :title="order.customer">{{ order.customer }}</td><td class="related-order-route-cell" :title="`${order.loading} → ${order.unloading}`">{{ relatedOrderRouteText(order) }}</td><td>{{ order.status }}</td></tr>
                    <tr v-if="selectedVehicleOrders.length === 0"><td :colspan="relatedVehicleOrderColumns.length">暂无关联订单</td></tr>
                  </tbody>
                </table>
              </div>
            </template>

            <template v-else>
              <div class="tabs">
                <button :class="{ active: activeDriverDetailTab === '司机资料' }" @click="activeDriverDetailTab = '司机资料'">司机资料</button>
                <button :class="{ active: activeDriverDetailTab === '证件照片' }" @click="activeDriverDetailTab = '证件照片'">证件照片</button>
                <button :class="{ active: activeDriverDetailTab === '关联订单' }" @click="activeDriverDetailTab = '关联订单'">关联订单</button>
                <button :class="{ active: activeDriverDetailTab === '预支/报销' }" @click="activeDriverDetailTab = '预支/报销'">预支/报销</button>
                <div v-if="activeDriverDetailTab === '关联订单'" class="related-order-filter tabs-date-filter">
                  <button
                    v-for="item in RELATED_ORDER_DATE_FILTERS"
                    :key="item.key"
                    :class="{ active: driverRelatedOrderDateFilter === item.key }"
                    @click="driverRelatedOrderDateFilter = item.key"
                  >{{ item.label }}</button>
                </div>
              </div>
              <div v-if="activeDriverDetailTab === '司机资料'" class="info-grid">
                <span>类型</span><strong>{{ selectedDriver?.type || "香港司机" }}</strong>
                <span>姓名</span><strong>{{ selectedDriver?.name }}</strong>
                <span>电话</span><strong>{{ selectedDriver?.phone }}</strong>
                <span>身份证号</span><strong>{{ selectedDriver?.idNo }}</strong>
                <span>驾驶证</span><strong>{{ selectedDriver?.license }}</strong>
                <span>生日</span><strong>{{ selectedDriver?.birthday }}</strong>
                <span>入职日期</span><strong>{{ selectedDriver?.hireDate }}</strong>
                <span>离职日期</span><strong>{{ selectedDriver?.leaveDate }}</strong>
                <span>证件到期</span><strong>{{ selectedDriver?.expireAt }}</strong>
                <span>状态</span><strong>{{ selectedDriver?.status }}</strong>
                <span>备注</span><strong>{{ selectedDriver?.note }}</strong>
              </div>
              <div v-else-if="activeDriverDetailTab === '证件照片'" class="file-panel">
                <div class="file-toolbar">
                  <label class="file-upload-btn"><IconSvg name="upload" />上传司机证件<input type="file" :accept="FILE_UPLOAD_ACCEPT" @change="uploadDriverFile" /></label>
                  <span class="hint">驾驶证、身份证、港澳证等文件会保存到 OSS 附件库。</span>
                </div>
                <table class="data-table compact">
                  <thead><tr><th>文件名</th><th>大小</th><th>上传时间</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-for="file in driverFileRows" :key="file.id">
                      <td>{{ file.filename }}</td><td>{{ fileSizeText(file.size) }}</td><td>{{ file.createdAt }}</td>
                      <td class="row-actions"><button class="icon-btn" @click="openStoredFile(file, 'preview')"><IconSvg name="eye" />预览</button><button class="icon-btn" @click="openStoredFile(file, 'download')"><IconSvg name="download" />下载</button><button class="icon-btn danger" @click="deleteFile(file, driverFileRows)"><IconSvg name="trash" />删除</button></td>
                    </tr>
                    <tr v-if="driverFileRows.length === 0"><td colspan="4">暂无司机证件</td></tr>
                  </tbody>
                </table>
              </div>
              <div v-else-if="activeDriverDetailTab === '关联订单'" class="related-order-panel">
                <div class="related-order-summary">
                  <span>本月 {{ selectedDriverMonthOrders.length }} 单</span>
                  <strong>本月趟费 HKD {{ money(selectedDriverMonthTripFeeTotal) }}</strong>
                  <span>当前筛选 {{ selectedDriverOrders.length }} 单</span>
                  <strong>筛选合计 HKD {{ money(selectedDriverTripFeeTotal) }}</strong>
                </div>
                <table class="data-table compact related-order-table driver-related-order-table">
                  <colgroup>
                    <col
                      v-for="column in relatedDriverOrderColumns"
                      :key="column.key"
                      :style="relatedOrderColumnStyle(relatedDriverOrderColumnWidths, column.key)"
                    />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        v-for="column in relatedDriverOrderColumns"
                        :key="column.key"
                        :class="['resizable-th', 'sortable', { sorted: tableSortDirection('relatedDriverOrders', column.key) }]"
                        @click="toggleTableSort('relatedDriverOrders', column)"
                      >
                        <button class="table-sort-trigger" type="button">
                          <span>{{ column.label }}</span>
                          <span class="sort-mark">{{ tableSortDirection('relatedDriverOrders', column.key) === 'asc' ? '↑' : tableSortDirection('relatedDriverOrders', column.key) === 'desc' ? '↓' : '' }}</span>
                        </button>
                        <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startRelatedDriverOrderColumnResize(column, $event)"></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="order in selectedDriverOrders" :key="order.no">
                      <td>{{ order.no }}</td>
                      <td>{{ order.date }}</td>
                      <td class="related-order-customer-cell" :title="order.customer">{{ order.customer }}</td>
                      <td class="related-order-route-cell" :title="`${order.loading} → ${order.unloading}`">{{ relatedOrderRouteText(order) }}</td>
                      <td>{{ normalizeTransportMode(order.transportMode || '单司机') || '-' }}</td>
                      <td>HKD {{ money(driverBaseTripFee(order)) }}</td>
                      <td>HKD {{ money(driverExtraTripFee(order, 'loadPerBoard')) }}</td>
                      <td>HKD {{ money(driverExtraTripFee(order, 'unloadPerBoard')) }}</td>
                      <td>HKD {{ money(driverExtraTripFee(order, 'crossSeaFee')) }}</td>
                      <td>HKD {{ money(driverExtraTripFee(order, 'addPointFee')) }}</td>
                      <td>HKD {{ money(driverExtraTripFee(order, 'waitingPerHour')) }}</td>
                      <td>{{ moneyPair(driverCustomerTripAdjustBreakdown(order).hkd, driverCustomerTripAdjustBreakdown(order).rmb) }}</td>
                      <td><strong>HKD {{ money(driverPayableTripFee(order)) }}</strong></td>
                      <td>{{ order.status }}</td>
                    </tr>
                    <tr v-if="selectedDriverOrders.length === 0"><td :colspan="relatedDriverOrderColumns.length">暂无关联订单</td></tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="driver-adjustment-panel">
                <form class="driver-adjustment-toolbar" @submit.prevent="saveDriverAdjustment">
                  <label>日期<input v-model="driverAdjustmentForm.date" type="date" required /></label>
                  <label>类型
                    <select v-model="driverAdjustmentForm.type">
                      <option v-for="item in DRIVER_ADJUSTMENT_TYPES" :key="item">{{ item }}</option>
                    </select>
                  </label>
                  <label>币种
                    <select v-model="driverAdjustmentForm.currency">
                      <option value="港币">HKD</option>
                      <option value="人民币">RMB</option>
                    </select>
                  </label>
                  <label>金额<input v-model.number="driverAdjustmentForm.amount" type="number" min="0" step="0.01" required /></label>
                  <label>状态
                    <select v-model="driverAdjustmentForm.status">
                      <option v-for="item in DRIVER_ADJUSTMENT_STATUS_OPTIONS" :key="item">{{ item }}</option>
                    </select>
                  </label>
                  <label class="span-2">备注<input v-model.trim="driverAdjustmentForm.note" placeholder="例如：停车费票据待补" /></label>
                  <button class="primary-btn small" type="submit"><IconSvg name="save" />{{ driverAdjustmentForm.id ? '保存修改' : '新增记录' }}</button>
                  <button v-if="driverAdjustmentForm.id" class="ghost-btn small" type="button" @click="resetDriverAdjustmentForm">取消编辑</button>
                </form>
                <table class="data-table compact">
                  <thead><tr><th>日期</th><th>类型</th><th>金额</th><th>状态</th><th>备注</th><th>操作</th></tr></thead>
                  <tbody>
                    <tr v-for="item in selectedDriverAdjustments" :key="item.id">
                      <td>{{ item.date }}</td>
                      <td>{{ item.type }}</td>
                      <td>{{ currencyCodeDisplay(item.currency) }} {{ money(item.amount) }}</td>
                      <td>{{ item.status }}</td>
                      <td>{{ item.note }}</td>
                      <td class="row-actions">
                        <button class="icon-btn icon-only" title="编辑" aria-label="编辑" @click="editDriverAdjustment(item)"><IconSvg name="edit" /></button>
                        <button class="icon-btn icon-only danger" title="删除" aria-label="删除" @click="deleteDriverAdjustment(item)"><IconSvg name="trash" /></button>
                      </td>
                    </tr>
                    <tr v-if="selectedDriverAdjustments.length === 0"><td colspan="6">暂无预支/报销记录</td></tr>
                  </tbody>
                </table>
              </div>
            </template>
          </div>
        </div>
        </VehicleDriverPage>
      </section>

      <section v-else-if="isVehicleExpenseModule(activeModule)" class="work-page vehicle-expense-page">
        <VehicleDriverPage>
        <div class="toolbar vehicle-driver-toolbar">
          <div class="vehicle-driver-title">
            <p class="eyebrow">车辆司机</p>
            <h2>{{ activeVehicleExpenseConfig.title }}</h2>
          </div>
          <input
            v-model.trim="vehicleDriverSearch"
            class="search-input vehicle-driver-search"
            :placeholder="activeVehicleExpenseConfig.type === 'annual' ? '车牌 / 年份 / 备注' : '车牌 / 时间 / 名称 / 备注'"
          />
          <div class="vehicle-driver-actions">
            <button class="ghost-btn" type="button" @click="exportVehicleExpenses"><IconSvg name="download" />导出</button>
            <button class="primary-btn" type="button" @click="openVehicleExpenseModal()">
              <IconSvg name="plus" />{{ activeVehicleExpenseConfig.addLabel }}
            </button>
          </div>
        </div>

        <div class="table-card full-height vehicle-expense-card">
          <div class="data-table-toolbar vehicle-expense-summary">
            <div class="data-table-tool-group">
              <strong class="data-table-title">{{ activeVehicleExpenseConfig.title }}</strong>
              <span>共 {{ visibleVehicleExpenses.length }} 条</span>
            </div>
            <div v-if="activeVehicleExpenseConfig.type !== 'annual'" class="statement-date-selects period-filter-controls vehicle-expense-period-controls">
              <strong class="vehicle-expense-period-label">查看月份</strong>
              <label>年份
                <select :value="periodFilterYear('vehicleExpenses')" @change="setPeriodFilterYear('vehicleExpenses', $event.target.value)">
                  <option v-for="year in periodYearOptions('vehicleExpenses')" :key="year" :value="year">{{ year }}年</option>
                </select>
              </label>
              <label>月份
                <select :value="periodFilterMonth('vehicleExpenses')" @change="setPeriodFilterMonth('vehicleExpenses', $event.target.value)">
                  <option v-for="item in PERIOD_MONTH_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
                </select>
              </label>
              <span class="finance-period-chip">当前范围：{{ periodFilterLabelByScope('vehicleExpenses') }}</span>
            </div>
            <span v-else class="finance-period-chip">年费按月进入车辆利润</span>
          </div>
          <div class="table-wrap">
            <table class="data-table compact vehicle-expense-table">
              <thead>
                <tr>
                  <th
                    v-for="column in [
                      { key: 'name', label: '名称' },
                      { key: 'plate', label: '车牌' },
                      { key: 'date', label: activeVehicleExpenseConfig.type === 'annual' ? '年份' : '时间' },
                      { key: 'currency', label: '币种' },
                      { key: 'amount', label: '金额' },
                      { key: 'allocation', label: '分摊说明' },
                      { key: 'note', label: '备注' },
                      { key: 'actions', label: '操作' }
                    ]"
                    :key="column.key"
                    :class="['sortable', { sorted: tableSortDirection('vehicleExpenses', column.key) }]"
                    @click="toggleTableSort('vehicleExpenses', column)"
                  >
                    <button v-if="column.key !== 'actions'" class="table-sort-trigger" type="button">
                      <span>{{ column.label }}</span>
                      <span class="sort-mark">{{ tableSortDirection('vehicleExpenses', column.key) === 'asc' ? '↑' : tableSortDirection('vehicleExpenses', column.key) === 'desc' ? '↓' : '' }}</span>
                    </button>
                    <span v-else>{{ column.label }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in visibleVehicleExpenses" :key="item.id">
                  <td>{{ item.name || activeVehicleExpenseConfig.defaultName || vehicleExpenseTypeLabel(item.type) }}</td>
                  <td>{{ item.plate }}</td>
                  <td>{{ vehicleExpenseDateText(item) }}</td>
                  <td>{{ currencyCodeDisplay(item.currency) }}</td>
                  <td>{{ money(item.amount) }}</td>
                  <td>{{ vehicleExpenseAllocationText(item) }}</td>
                  <td>{{ item.note || "-" }}</td>
                  <td class="row-actions">
                    <button class="icon-btn icon-only" type="button" title="编辑费用" aria-label="编辑费用" @click="openVehicleExpenseModal(item)"><IconSvg name="edit" /></button>
                    <button class="icon-btn icon-only danger" type="button" title="删除费用" aria-label="删除费用" @click="deleteVehicleExpense(item)"><IconSvg name="trash" /></button>
                  </td>
                </tr>
                <tr v-if="visibleVehicleExpenses.length === 0"><td colspan="8">暂无{{ activeVehicleExpenseConfig.title }}记录</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        </VehicleDriverPage>
      </section>

      <section v-else-if="activeModule === 'financeWages'" class="work-page finance-page finance-wage-page">
        <FinanceCenterPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">财务中心</p>
            <h2>工资统计</h2>
          </div>
        </div>
        <div class="finance-filter-bar">
          <div class="statement-date-selects period-filter-controls">
            <div class="segmented statement-mode-tabs">
              <button
                v-for="mode in PERIOD_FILTER_MODES"
                :key="mode.key"
                type="button"
                :class="{ active: periodFilterMode('finance') === mode.key }"
                @click="setPeriodFilterMode('finance', mode.key)"
              >{{ mode.label }}</button>
            </div>
            <label v-if="periodFilterMode('finance') !== 'all'">年份
              <select :value="periodFilterYear('finance')" @change="setPeriodFilterYear('finance', $event.target.value)">
                <option v-for="year in periodYearOptions('finance')" :key="year" :value="year">{{ year }}年</option>
              </select>
            </label>
            <label v-if="periodFilterMode('finance') === 'month'">月份
              <select :value="periodFilterMonth('finance')" @change="setPeriodFilterMonth('finance', $event.target.value)">
                <option v-for="item in PERIOD_MONTH_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
          </div>
          <div class="segmented finance-card-tabs">
            <button type="button" :class="{ active: activeFinanceWageCard === 'wages' }" @click="activeFinanceWageCard = 'wages'">工资明细</button>
            <button type="button" :class="{ active: activeFinanceWageCard === 'routeAdjust' }" @click="activeFinanceWageCard = 'routeAdjust'">路线扣减规则</button>
          </div>
          <span class="finance-period-chip">当前期间：{{ financeDateRangeLabel() }}</span>
        </div>
        <div v-if="activeFinanceWageCard === 'wages'" class="finance-summary-grid">
          <div class="finance-summary-card"><span>统计期间</span><strong>{{ financeDateRangeLabel() }}</strong></div>
          <div class="finance-summary-card"><span>司机人数</span><strong>{{ financeWageRows.length }}</strong></div>
          <div class="finance-summary-card"><span>关联订单</span><strong>{{ financeSummary.orderCount }}</strong></div>
          <div class="finance-summary-card"><span>司机应付</span><strong>{{ moneyPair(financeSummary.driverPayableHKD, financeSummary.driverPayableRMB) }}</strong></div>
          <div class="finance-summary-card"><span>司机代垫</span><strong>{{ moneyPair(financeSummary.driverAdvanceHKD, financeSummary.driverAdvanceRMB) }}</strong></div>
          <div class="finance-summary-card"><span>预支/报销</span><strong>{{ moneyPair(financeWageRows.reduce((sum, row) => sum + row.adjustments, 0), financeWageRows.reduce((sum, row) => sum + row.adjustmentsRMB, 0)) }}</strong></div>
          <div class="finance-summary-card"><span>供应商代垫</span><strong>{{ moneyPair(financeSummary.supplierAdvanceHKD, financeSummary.supplierAdvanceRMB) }}</strong></div>
          <div class="finance-summary-card"><span>外派应付</span><strong>{{ moneyPair(financeSummary.supplierPayableHKD, financeSummary.supplierPayableRMB) }}</strong></div>
        </div>
        <div v-if="activeFinanceWageCard === 'wages'" class="table-card finance-table-card finance-wage-card">
          <div class="data-table-toolbar">
            <div class="data-table-tool-group">
              <strong class="data-table-title">工资明细 · {{ financeDateRangeLabel() }}</strong>
              <button class="ghost-btn small" type="button" @click="exportFinanceWages()"><IconSvg name="download" />导出当前表</button>
              <label class="data-table-density-select">行密度
                <select :value="dataTableDensity" @change="setDataTableDensity($event.target.value)">
                  <option v-for="item in dataTableDensityOptions" :key="item.key" :value="item.key">{{ item.label }}</option>
                </select>
              </label>
            </div>
            <details class="data-table-column-menu">
              <summary class="ghost-btn small">
                <IconSvg name="columns" />列
                <span>{{ visibleFinanceWageTableColumns.length }}/{{ financeWageTableColumns.length }}</span>
              </summary>
              <div class="data-table-column-popover">
                <label v-for="column in financeWageTableColumns" :key="column.key" :class="{ disabled: column.locked }">
                  <input
                    type="checkbox"
                    :checked="financeWageTableColumnVisibility[column.key] !== false"
                    :disabled="column.locked"
                    @change="setDataTableColumnVisible('finance_wages', financeWageTableColumnVisibility, column, $event.target.checked)"
                  />
                  {{ column.label }}
                </label>
              </div>
            </details>
          </div>
          <div class="finance-wage-table-scroll">
          <table :class="['data-table compact managed-data-table finance-wage-table', dataTableDensityClass()]">
            <colgroup>
              <col
                v-for="column in visibleFinanceWageTableColumns"
                :key="column.key"
                :style="dataTableColumnStyle(financeWageTableColumnWidths, column.key)"
              />
            </colgroup>
            <thead>
              <tr>
                <th
                  v-for="column in visibleFinanceWageTableColumns"
                  :key="column.key"
                  :class="['resizable-th', { sortable: column.key !== 'actions', sorted: tableSortDirection('financeWages', column.key) }]"
                  @click="toggleTableSort('financeWages', column)"
                >
                  <button v-if="column.key !== 'actions'" class="table-sort-trigger" type="button">
                    <span>{{ column.label }}</span>
                    <span class="sort-mark">{{ tableSortDirection('financeWages', column.key) === 'asc' ? '↑' : tableSortDirection('financeWages', column.key) === 'desc' ? '↓' : '' }}</span>
                  </button>
                  <template v-else>{{ column.label }}</template>
                  <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startDataTableColumnResize('finance_wages', financeWageTableColumnWidths, column, $event)"></span>
                </th>
              </tr>
            </thead>
            <tbody>
	              <template v-for="row in financeWageRows" :key="row.driver.id">
	                <tr @click="openFinanceWageDetail(row)">
	                  <td v-for="column in visibleFinanceWageTableColumns" :key="column.key">
	                    <template v-if="column.key === 'driver'">{{ row.driver.name }}</template>
	                    <template v-else-if="column.key === 'type'">{{ row.driver.type || '香港司机' }}</template>
	                    <template v-else-if="column.key === 'orderCount'">{{ row.orderCount }}</template>
	                    <template v-else-if="column.key === 'tripFee'">{{ moneyPair(row.payable, row.payableRMB) }}</template>
	                    <template v-else-if="column.key === 'advanceFee'">{{ moneyPair(row.advanceFee, row.advanceFeeRMB) }}</template>
	                    <template v-else-if="column.key === 'adjustments'">{{ moneyPair(row.adjustments, row.adjustmentsRMB) }}</template>
	                    <template v-else-if="column.key === 'total'"><strong>{{ moneyPair(row.total, row.totalRMB) }}</strong></template>
	                    <template v-else-if="column.key === 'status'">{{ row.driver.status || '-' }}</template>
	                    <template v-else-if="column.key === 'actions'">
	                      <button class="icon-btn icon-only" type="button" title="导出此司机核对数据" aria-label="导出此司机核对数据" @click.stop="exportFinanceWageRow(row)"><IconSvg name="download" /></button>
	                    </template>
	                  </td>
	                </tr>
	              </template>
              <tr v-if="financeWageRows.length === 0"><td :colspan="visibleFinanceWageTableColumns.length">暂无工资统计数据</td></tr>
            </tbody>
          </table>
          </div>
        </div>
        <div v-else class="table-card finance-tool-card">
          <div class="table-card-head">
            <div>
              <strong>司机路线扣减规则</strong>
              <span>本公司车辆命中指定客户、司机和路线时，趟费自动调整</span>
            </div>
          </div>
          <form class="route-adjust-form" @submit.prevent="addDriverRouteAdjustRule">
            <label>客户
              <select v-model="driverRouteAdjustForm.customerName">
                <option value="">不限客户</option>
                <option v-for="item in customerRows.filter((customer) => customer.type === '客户')" :key="item.id" :value="item.name">{{ item.name }}</option>
              </select>
            </label>
            <div class="route-adjust-driver-picker">
              <span>适用司机</span>
              <button class="route-adjust-driver-trigger" type="button" @click="routeAdjustDriverPickerOpen = !routeAdjustDriverPickerOpen">
                <span>{{ routeAdjustDriverPickerLabel() }}</span>
                <IconSvg name="chevronDown" />
              </button>
              <div v-if="routeAdjustDriverPickerOpen" class="route-adjust-driver-menu">
                <div class="route-adjust-driver-actions">
                  <button class="ghost-btn small" type="button" @click="driverRouteAdjustForm.driverIds = []">全部司机</button>
                  <button class="ghost-btn small" type="button" @click="driverRouteAdjustForm.driverIds = driverRows.map((item) => item.id)">全选</button>
                </div>
                <div class="route-adjust-driver-options">
                  <label v-for="item in driverRows" :key="item.id">
                    <input v-model="driverRouteAdjustForm.driverIds" type="checkbox" :value="item.id" />
                    <span>{{ item.name }} · {{ item.type }}</span>
                  </label>
                </div>
              </div>
            </div>
            <label>运输模式
              <select v-model="driverRouteAdjustForm.transportMode">
                <option value="">全部模式</option>
                <option v-for="mode in TRANSPORT_MODE_OPTIONS" :key="mode" :value="mode">{{ mode }}</option>
              </select>
            </label>
            <label>装货地
              <select v-model="driverRouteAdjustForm.loading">
                <option value="">选择客户地址/地址本</option>
                <option v-for="item in routeAdjustAddressOptions" :key="`load-${item.key}`" :value="item.value">
                  {{ item.source }} · {{ item.value }}{{ item.meta ? ` · ${item.meta}` : '' }}
                </option>
              </select>
            </label>
            <label>卸货地
              <select v-model="driverRouteAdjustForm.unloading">
                <option value="">选择客户地址/地址本</option>
                <option v-for="item in routeAdjustAddressOptions" :key="`unload-${item.key}`" :value="item.value">
                  {{ item.source }} · {{ item.value }}{{ item.meta ? ` · ${item.meta}` : '' }}
                </option>
              </select>
            </label>
            <label>币种
              <select v-model="driverRouteAdjustForm.currency">
                <option value="港币">HKD</option>
                <option value="人民币">RMB</option>
              </select>
            </label>
            <label v-if="driverRouteAdjustForm.currency === '人民币'">调整RMB<input v-model.number="driverRouteAdjustForm.amountRMB" type="number" step="0.01" /></label>
            <label v-else>调整HKD<input v-model.number="driverRouteAdjustForm.amountHKD" type="number" step="0.01" /></label>
            <label>说明<input v-model.trim="driverRouteAdjustForm.note" placeholder="例如：指定路线减 50" /></label>
            <button class="primary-btn small" type="submit"><IconSvg name="save" />保存规则</button>
          </form>
          <div class="finance-compact-table-wrap">
            <table class="data-table compact">
              <thead><tr><th>客户</th><th>司机</th><th>运输模式</th><th>装货</th><th>卸货</th><th>调整</th><th>说明</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="rule in driverRouteAdjustRules" :key="rule.id">
                  <td>{{ rule.customerName || '不限' }}</td>
                  <td>{{ Array.isArray(rule.driverNames) && rule.driverNames.length ? rule.driverNames.join('、') : (rule.driverName || '全部司机') }}</td>
                  <td>{{ normalizeTransportMode(rule.transportMode || '') || '全部' }}</td>
                  <td>{{ rule.loading || '不限' }}</td>
                  <td>{{ rule.unloading || '不限' }}</td>
                  <td>{{ moneyPair(rule.amountHKD || 0, rule.amountRMB || 0) }}</td>
                  <td>{{ rule.note || '-' }}</td>
                  <td><button class="icon-btn icon-only danger" type="button" title="删除" @click="removeDriverRouteAdjustRule(rule)"><IconSvg name="trash" /></button></td>
                </tr>
                <tr v-if="driverRouteAdjustRules.length === 0"><td colspan="8">暂无路线扣减规则</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        </FinanceCenterPage>
      </section>

      <section v-else-if="activeModule === 'financeCostCenter'" class="work-page finance-page cost-center-page">
        <FinanceCenterPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">财务中心</p>
            <h2>成本中心</h2>
          </div>
          <button class="primary-btn small" type="button" @click="openCostCenterRuleModal()">
            <IconSvg name="plus" />增加成本规则
          </button>
        </div>

        <div class="cost-center-source-grid">
          <button
            v-for="source in FEE_ITEM_COST_SOURCE_OPTIONS"
            :key="source"
            type="button"
            :class="['cost-center-source-card', { active: activeCostCenterSource === source }]"
            @click="setActiveCostCenterSource(source)"
          >
            <span>{{ source }}</span>
            <strong>{{ costCenterFeeItemsForSource(source).length }} 个收费项目</strong>
          </button>
        </div>

        <div class="cost-center-card">
          <p v-if="activeCostCenterFeeItems.length === 0" class="cost-center-empty-hint">暂无成本列，请先在运费模板的收费项目中勾选成本来源“{{ activeCostCenterSource }}”。</p>
          <div class="table-wrap cost-center-table-wrap">
            <table class="data-table compact cost-center-table">
              <thead>
                <tr>
	                  <th>{{ activeCostCenterEntityLabel }}</th>
	                  <th>装货地</th>
	                  <th>卸货地</th>
	                  <th v-for="item in activeCostCenterFeeItems" :key="item.id">{{ costCenterFeeItemLabel(item) }}</th>
	                  <th>备注</th>
	                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in activeCostCenterRuleRows" :key="row.id">
	                  <td>{{ costCenterRuleEntityDisplay(row) }}</td>
	                  <td>{{ row.origin || "-" }}</td>
	                  <td>{{ row.destination || "-" }}</td>
	                  <td v-for="item in activeCostCenterFeeItems" :key="item.id">{{ money(costCenterRuleRowValue(row, item)) }}</td>
	                  <td>{{ row.note || "-" }}</td>
                  <td class="row-actions">
                    <button class="icon-btn" type="button" @click="openCostCenterRuleModal(row)"><IconSvg name="edit" />编辑</button>
                    <button class="icon-btn danger" type="button" @click="deleteCostCenterRule(row)"><IconSvg name="trash" />删除</button>
	                  </td>
	                </tr>
	                <tr v-if="activeCostCenterRuleRows.length === 0"><td :colspan="activeCostCenterFeeItems.length + 5">暂无成本规则</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="costCenterRuleModalOpen" class="modal-backdrop" @click.self="closeCostCenterRuleModal">
          <form class="modal-card compact-modal cost-center-rule-modal" @submit.prevent="saveCostCenterRule">
            <div class="modal-head">
              <div>
                <p class="eyebrow">{{ costCenterRuleForm.source }}</p>
                <h2>{{ costCenterRuleForm.id ? '编辑成本规则' : '增加成本规则' }}</h2>
              </div>
              <button class="icon-btn" type="button" @click="closeCostCenterRuleModal"><IconSvg name="close" />关闭</button>
            </div>
            <div class="modal-body cost-center-rule-body">
              <div class="cost-center-rule-grid">
                <label v-if="costCenterRuleForm.source === '供应商'">{{ costCenterRuleEntityLabel }}
                  <select v-model="costCenterRuleForm.entityRefId" required @change="syncCostCenterRuleEntityName">
                    <option value="">请选择供应商</option>
                    <option v-for="supplier in costCenterSupplierOptions" :key="supplier.id" :value="costCenterEntityOptionId(supplier)">
                      {{ supplier.name }}
                    </option>
                  </select>
                </label>
                <label v-else-if="costCenterRuleForm.source === '司机'">{{ costCenterRuleEntityLabel }}
                  <select v-model="costCenterRuleForm.entityRefId" required @change="syncCostCenterRuleEntityName">
                    <option value="">请选择司机</option>
                    <option v-for="driver in costCenterDriverOptions" :key="driver.id" :value="costCenterEntityOptionId(driver)">
                      {{ driver.name }}{{ driver.type ? ` · ${driver.type}` : '' }}
                    </option>
                  </select>
                </label>
                <label v-else>{{ costCenterRuleEntityLabel }}
                  <input v-model.trim="costCenterRuleForm.entityName" required :placeholder="costCenterRuleForm.source === '其他平台' ? '请输入平台名称' : '请输入费用名称'" />
                </label>
                <div class="cost-center-route-field">
                  <span>装货地</span>
                  <div class="cost-center-route-picker route-tree-wrap" @click.stop>
                    <button
                      :class="['route-tree-trigger cost-center-route-trigger', { 'is-empty': !costCenterRouteValue('origin'), active: isCostCenterRoutePickerOpen('origin') }]"
                      type="button"
                      @click="toggleCostCenterRoutePicker('origin')"
                    >
                      <span>{{ costCenterRouteValue('origin') || '请选择装货地' }}</span>
                      <IconSvg name="chevronDown" />
                    </button>
                    <div v-if="isCostCenterRoutePickerOpen('origin')" class="route-tree-dropdown cost-center-route-dropdown">
                      <div class="route-tree-panel">
                        <div class="route-tree-list">
                          <template v-for="level1 in costCenterRouteLevel1Options" :key="`origin-${level1}`">
                            <button class="route-tree-node" :class="{ checked: costCenterRouteLevel1Value('origin') === level1 }" type="button" @click="selectCostCenterRouteLevel1('origin', level1)">
                              <span class="tree-check" :class="{ checked: costCenterRouteLevel1Value('origin') === level1 }"><IconSvg v-if="costCenterRouteLevel1Value('origin') === level1" name="check" /></span>
                              <span>{{ level1 }}</span>
                            </button>
                          </template>
                          <p v-if="costCenterRouteLevel1Options.length === 0" class="route-tree-empty">暂无运费模板目录</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="cost-center-route-field">
                  <span>卸货地</span>
                  <div class="cost-center-route-picker route-tree-wrap" @click.stop>
                    <button
                      :class="['route-tree-trigger cost-center-route-trigger', { 'is-empty': !costCenterRouteValue('destination'), active: isCostCenterRoutePickerOpen('destination') }]"
                      type="button"
                      @click="toggleCostCenterRoutePicker('destination')"
                    >
                      <span>{{ costCenterRouteValue('destination') || '请选择卸货地' }}</span>
                      <IconSvg name="chevronDown" />
                    </button>
                    <div v-if="isCostCenterRoutePickerOpen('destination')" class="route-tree-dropdown cost-center-route-dropdown">
                      <div class="route-tree-panel">
                        <div class="route-tree-list">
                          <template v-for="level1 in costCenterRouteLevel1Options" :key="`destination-${level1}`">
                            <button class="route-tree-node" :class="{ checked: costCenterRouteLevel1Value('destination') === level1 }" type="button" @click="selectCostCenterRouteLevel1('destination', level1)">
                              <span class="tree-check" :class="{ checked: costCenterRouteLevel1Value('destination') === level1 }"><IconSvg v-if="costCenterRouteLevel1Value('destination') === level1" name="check" /></span>
                              <span>{{ level1 }}</span>
                            </button>
                          </template>
                          <p v-if="costCenterRouteLevel1Options.length === 0" class="route-tree-empty">暂无运费模板目录</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
	              </div>
              <div v-if="costCenterRuleFeeItems.length" class="cost-center-rule-cost-grid">
                <label v-for="item in costCenterRuleFeeItems" :key="item.id">
                  {{ costCenterFeeItemLabel(item) }}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    :value="costCenterRuleValue(item)"
                    @input="setCostCenterRuleValue(item, $event.target.value)"
                  />
                </label>
              </div>
              <p v-else class="cost-center-empty-hint">暂无成本项目</p>
              <label class="cost-center-rule-note">备注<input v-model.trim="costCenterRuleForm.note" placeholder="可选" /></label>
            </div>
            <div class="modal-actions">
              <button class="ghost-btn" type="button" @click="closeCostCenterRuleModal">取消</button>
              <button class="primary-btn" type="submit" :disabled="costCenterRuleSaving">
                <IconSvg name="save" />{{ costCenterRuleSaving ? '保存中' : '保存' }}
              </button>
            </div>
          </form>
        </div>
        </FinanceCenterPage>
      </section>

      <section v-else-if="activeModule === 'financeCosts'" class="work-page finance-page">
        <FinanceCenterPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">财务中心</p>
            <h2>对账单管理</h2>
          </div>
        </div>
        <div class="finance-filter-bar">
          <div class="statement-date-selects">
            <div class="segmented statement-mode-tabs">
              <button
                v-for="mode in STATEMENT_PERIOD_MODES"
                :key="mode.key"
                type="button"
                :class="{ active: statementPeriodMode === mode.key }"
                @click="setStatementPeriodMode(mode.key)"
              >{{ mode.label }}</button>
            </div>
            <label v-if="statementPeriodMode !== 'all'">年份
              <select v-model="statementSelectedYear">
                <option v-for="year in statementYearOptions" :key="year" :value="year">{{ year }}年</option>
              </select>
            </label>
            <label v-if="statementPeriodMode === 'month'">月份
              <select v-model="statementSelectedMonth">
                <option v-for="item in statementMonthOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
          </div>
          <span class="finance-period-chip">当前范围：{{ statementMonthRangeLabel() }}</span>
        </div>
        <div class="finance-summary-grid">
          <div class="finance-summary-card"><span>订单数</span><strong>{{ statementSummary.orderCount }}</strong></div>
          <div class="finance-summary-card"><span>应收港币</span><strong>HKD {{ money(statementSummary.receivableHKD) }}</strong></div>
          <div class="finance-summary-card"><span>应收人民币</span><strong>RMB {{ money(statementSummary.receivableRMB) }}</strong></div>
          <div class="finance-summary-card"><span>外派成本</span><strong>{{ moneyPair(statementSummary.supplierPayableHKD, statementSummary.supplierPayableRMB) }}</strong></div>
        </div>
        <div class="finance-insight-grid statement-customer-section" @click="closeStatementExportMenu">
          <div class="table-card finance-tool-card statement-customer-card">
            <div class="table-card-head">
              <div>
                <strong>客户账单列表</strong>
                <span>{{ statementMonthRangeLabel() }} · 当期有订单客户</span>
              </div>
            </div>
            <table class="data-table compact statement-customer-table">
              <thead><tr><th>排名</th><th>客户</th><th>结算类别</th><th>汇率</th><th>份数</th><th>港币</th><th>人民币</th><th>操作</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="(row, index) in statementCustomerRows" :key="row.customer">
                  <td>{{ index + 1 }}</td>
                  <td>{{ row.customer }}</td>
                  <td><span class="statement-settlement-chip" :class="{ hkd: statementCustomerSettlementCurrency(row) === '港币' }">{{ statementCustomerSettlementCurrency(row) }}</span></td>
                  <td>
                    <input
                      class="statement-exchange-rate-input"
                      type="number"
                      min="0"
                      step="0.0001"
                      :value="statementCustomerExchangeRate(row)"
                      @click.stop
                      @input="setStatementCustomerExchangeRate(row, $event.target.value)"
                      @change="setStatementCustomerExchangeRate(row, $event.target.value)"
                    />
                  </td>
                  <td>{{ row.count }}</td>
                  <td>HKD {{ money(row.hkd) }}</td>
                  <td>RMB {{ money(row.rmb) }}</td>
                  <td class="row-actions statement-customer-actions">
                    <span class="order-export-wrap statement-export-wrap" @click.stop>
                      <button class="primary-btn small" type="button" @click="openStatementCustomerExportMenu(row)">
                        <IconSvg name="download" />导出对账单<IconSvg name="chevronDown" />
                      </button>
                    </span>
                  </td>
                  <td>
                    <select
                      v-if="statementDownloadRecordForCustomerRow(row)"
                      class="statement-status-select"
                      :class="statementDownloadStatusClass(statementCustomerStatementStatus(row))"
                      :value="statementCustomerStatementStatus(row)"
                      @click.stop
                      @change.stop="updateCustomerStatementStatus(row, $event.target.value)"
                    >
                      <option v-for="status in STATEMENT_DOWNLOAD_STATUS_OPTIONS" :key="status" :value="status">{{ status }}</option>
                    </select>
                    <span v-else class="statement-status-text">未导出</span>
                  </td>
                </tr>
                <tr v-if="statementCustomerRows.length === 0"><td colspan="9">暂无客户账单</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="table-card finance-table-card">
          <table class="data-table compact">
            <thead><tr><th>项目</th><th>数量</th><th>港币</th><th>人民币</th><th>说明</th></tr></thead>
            <tbody>
              <tr><td>订单应收</td><td>{{ statementSummary.orderCount }}</td><td>HKD {{ money(statementSummary.receivableHKD) }}</td><td>RMB {{ money(statementSummary.receivableRMB) }}</td><td>按订单应收金额汇总</td></tr>
              <tr><td>司机工资</td><td>{{ statementWageRows.length }}</td><td>HKD {{ money(statementSummary.driverPayableHKD) }}</td><td>RMB {{ money(statementSummary.driverPayableRMB) }}</td><td>按司机费用规则、订单代垫和预支/报销汇总</td></tr>
              <tr><td>外派车辆成本</td><td>{{ statementSummary.outsourcedOrderCount }}</td><td>HKD {{ money(statementSummary.supplierPayableHKD) }}</td><td>RMB {{ money(statementSummary.supplierPayableRMB) }}</td><td>供应商规则应付，未匹配规则时用外派车辆代垫兜底</td></tr>
            </tbody>
          </table>
        </div>
        <Teleport to="body">
          <div
            v-if="activeModule === 'financeCosts' && statementExportMenuOpen && activeStatementExportCustomerRow"
            class="modal-backdrop statement-export-backdrop"
            @click.self="closeStatementExportMenu"
          >
            <section class="modal-card compact-modal statement-export-dialog">
              <div class="modal-head">
                <div>
                  <h2>导出对账单</h2>
                  <p class="modal-subtitle">{{ activeStatementExportCustomerRow.customer }}</p>
                </div>
                <button type="button" class="icon-btn" @click="closeStatementExportMenu"><IconSvg name="close" />关闭</button>
              </div>
              <div class="statement-export-dialog-meta">
                <span>客户对账单</span>
                <span>汇总：{{ statementCustomerSettlementCurrency(activeStatementExportCustomerRow) }}</span>
                <span>汇率：{{ statementCustomerExchangeRate(activeStatementExportCustomerRow) }}</span>
              </div>
              <div class="statement-export-template-list">
                <div v-for="template in orderExportTemplateOptions()" :key="template.id" class="statement-export-template-row">
                  <span :title="template.name">{{ template.name }}</span>
                  <button type="button" title="导出 Excel" aria-label="导出 Excel" @click="exportStatementByFormat('excel', template)">Excel</button>
                  <button type="button" title="导出 PDF" aria-label="导出 PDF" @click="exportStatementByFormat('pdf', template)">PDF</button>
                </div>
              </div>
            </section>
          </div>
        </Teleport>
        </FinanceCenterPage>
      </section>

      <section v-else-if="activeModule === 'financeDaily'" class="work-page finance-page">
        <FinanceCenterPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">财务中心</p>
            <h2>日常收支</h2>
          </div>
        </div>
        <div class="finance-filter-bar">
          <div class="statement-date-selects period-filter-controls">
            <div class="segmented statement-mode-tabs">
              <button
                v-for="mode in PERIOD_FILTER_MODES"
                :key="mode.key"
                type="button"
                :class="{ active: periodFilterMode('finance') === mode.key }"
                @click="setPeriodFilterMode('finance', mode.key)"
              >{{ mode.label }}</button>
            </div>
            <label v-if="periodFilterMode('finance') !== 'all'">年份
              <select :value="periodFilterYear('finance')" @change="setPeriodFilterYear('finance', $event.target.value)">
                <option v-for="year in periodYearOptions('finance')" :key="year" :value="year">{{ year }}年</option>
              </select>
            </label>
            <label v-if="periodFilterMode('finance') === 'month'">月份
              <select :value="periodFilterMonth('finance')" @change="setPeriodFilterMonth('finance', $event.target.value)">
                <option v-for="item in PERIOD_MONTH_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
          </div>
          <span class="finance-period-chip">当前范围：{{ financeDateRangeLabel() }}</span>
        </div>
        <div class="finance-summary-grid">
          <div class="finance-summary-card"><span>应收港币</span><strong>HKD {{ money(financeSummary.receivableHKD) }}</strong></div>
          <div class="finance-summary-card"><span>应付港币</span><strong>HKD {{ money(financeSummary.driverPayableHKD + financeSummary.supplierPayableHKD) }}</strong></div>
          <div class="finance-summary-card"><span>港币差额</span><strong>HKD {{ money(financeSummary.receivableHKD - financeSummary.driverPayableHKD - financeSummary.supplierPayableHKD) }}</strong></div>
          <div class="finance-summary-card"><span>人民币应收</span><strong>RMB {{ money(financeSummary.receivableRMB) }}</strong></div>
        </div>
        <div class="table-card finance-table-card">
          <table class="data-table compact">
            <thead><tr><th>日常项</th><th>当前口径</th><th>金额</th><th>备注</th></tr></thead>
            <tbody>
              <tr><td>客户应收</td><td>当前范围订单</td><td>HKD {{ money(financeSummary.receivableHKD) }} / RMB {{ money(financeSummary.receivableRMB) }}</td><td>来自订单管理</td></tr>
              <tr><td>司机工资</td><td>当前范围司机</td><td>{{ moneyPair(financeSummary.driverPayableHKD, financeSummary.driverPayableRMB) }}</td><td>来自司机费用规则、订单代垫和预支/报销</td></tr>
              <tr><td>外派成本</td><td>当前范围外派订单</td><td>{{ moneyPair(financeSummary.supplierPayableHKD, financeSummary.supplierPayableRMB) }}</td><td>供应商规则应付，未匹配规则时用外派车辆代垫兜底</td></tr>
            </tbody>
          </table>
        </div>
        </FinanceCenterPage>
      </section>

      <section v-else-if="activeModule === 'bossDashboard'" class="work-page finance-page boss-page">
        <BossCenterPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">老板中心</p>
            <h2>老板看板</h2>
          </div>
        </div>
        <div class="finance-filter-bar">
          <div class="statement-date-selects period-filter-controls">
            <div class="segmented statement-mode-tabs">
              <button
                v-for="mode in PERIOD_FILTER_MODES"
                :key="mode.key"
                type="button"
                :class="{ active: periodFilterMode('boss') === mode.key }"
                @click="setPeriodFilterMode('boss', mode.key)"
              >{{ mode.label }}</button>
            </div>
            <label v-if="periodFilterMode('boss') !== 'all'">年份
              <select :value="periodFilterYear('boss')" @change="setPeriodFilterYear('boss', $event.target.value)">
                <option v-for="year in periodYearOptions('boss')" :key="year" :value="year">{{ year }}年</option>
              </select>
            </label>
            <label v-if="periodFilterMode('boss') === 'month'">月份
              <select :value="periodFilterMonth('boss')" @change="setPeriodFilterMonth('boss', $event.target.value)">
                <option v-for="item in PERIOD_MONTH_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
          </div>
          <span class="finance-period-chip">当前范围：{{ periodFilterLabelByScope('boss') }}</span>
        </div>
        <div class="finance-summary-grid">
          <div v-for="item in bossDashboardKpiRows" :key="item.label" class="finance-summary-card boss-kpi-card">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <span>{{ item.note }}</span>
          </div>
        </div>
        <div class="finance-insight-grid boss-insight-grid">
          <div class="table-card finance-tool-card">
            <div class="table-card-head">
              <div>
                <strong>公司利润趋势</strong>
                <span>按月汇总运输、报关、车辆成本和公司支出</span>
              </div>
            </div>
            <table class="data-table compact">
              <thead><tr><th>月份</th><th>运输收入</th><th>报关收入</th><th>净利润</th><th>利润率</th></tr></thead>
              <tbody>
                <tr v-for="row in bossCompanyProfitDisplayRows" :key="row.period">
                  <td>{{ row.period }}</td>
                  <td>{{ row.transportRevenue }}</td>
                  <td>{{ row.customsRevenue }}</td>
                  <td><strong>{{ row.netProfit }}</strong></td>
                  <td>{{ row.margin }}</td>
                </tr>
                <tr v-if="bossCompanyProfitDisplayRows.length === 0"><td colspan="5">暂无利润数据</td></tr>
              </tbody>
            </table>
          </div>
          <div class="table-card finance-tool-card">
            <div class="table-card-head">
              <div>
                <strong>客户利润贡献</strong>
                <span>按客户维度查看收入、利润和毛利率</span>
              </div>
            </div>
            <table class="data-table compact">
              <thead><tr><th>客户</th><th>订单</th><th>收入</th><th>利润</th><th>毛利率</th></tr></thead>
              <tbody>
                <tr v-for="row in bossCustomerProfitDisplayRows" :key="row.customer">
                  <td>{{ row.customer }}</td>
                  <td>{{ row.orderCount }}</td>
                  <td>{{ row.revenue }}</td>
                  <td><strong>{{ row.profit }}</strong></td>
                  <td>{{ row.margin }}</td>
                </tr>
                <tr v-if="bossCustomerProfitDisplayRows.length === 0"><td colspan="5">暂无客户利润数据</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="table-card finance-table-card">
          <div class="table-card-head">
            <div>
              <strong>车辆利润排名</strong>
              <span>按单车净利润排序</span>
            </div>
          </div>
          <table class="data-table compact">
            <thead><tr><th>排名</th><th>车牌</th><th>司机</th><th>单司机订单数</th><th>中港运费收入</th><th>净利润</th><th>净利润（RMB）</th><th>利润率</th></tr></thead>
            <tbody>
              <tr v-for="(row, index) in bossVehicleProfitDisplayRows" :key="row.plate">
                <td>{{ index + 1 }}</td>
                <td>{{ row.plate }}</td>
                <td>{{ row.driver }}</td>
                <td>{{ row.orderCount }}</td>
                <td>{{ row.revenue }}</td>
                <td><strong>{{ row.profit }}</strong></td>
                <td><strong>{{ row.profitRMBEquivalent }}</strong></td>
                <td>{{ row.margin }}</td>
              </tr>
              <tr v-if="bossVehicleProfitDisplayRows.length === 0"><td colspan="8">暂无车辆利润数据</td></tr>
            </tbody>
          </table>
        </div>
        </BossCenterPage>
      </section>

      <section v-else-if="activeModule === 'bossCompanyProfit'" class="work-page finance-page boss-page">
        <BossCenterPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">老板中心</p>
            <h2>公司利润</h2>
          </div>
        </div>
        <div class="finance-filter-bar">
          <div class="statement-date-selects period-filter-controls">
            <div class="segmented statement-mode-tabs">
              <button
                v-for="mode in PERIOD_FILTER_MODES"
                :key="mode.key"
                type="button"
                :class="{ active: periodFilterMode('boss') === mode.key }"
                @click="setPeriodFilterMode('boss', mode.key)"
              >{{ mode.label }}</button>
            </div>
            <label v-if="periodFilterMode('boss') !== 'all'">年份
              <select :value="periodFilterYear('boss')" @change="setPeriodFilterYear('boss', $event.target.value)">
                <option v-for="year in periodYearOptions('boss')" :key="year" :value="year">{{ year }}年</option>
              </select>
            </label>
            <label v-if="periodFilterMode('boss') === 'month'">月份
              <select :value="periodFilterMonth('boss')" @change="setPeriodFilterMonth('boss', $event.target.value)">
                <option v-for="item in PERIOD_MONTH_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
          </div>
          <span class="finance-period-chip">当前范围：{{ periodFilterLabelByScope('boss') }}</span>
        </div>
        <div class="finance-summary-grid">
          <div class="finance-summary-card"><span>运输收入</span><strong>{{ bossCompanyProfitSummary.transportRevenue }}</strong></div>
          <div class="finance-summary-card"><span>报关收入</span><strong>{{ bossCompanyProfitSummary.customsRevenue }}</strong></div>
          <div class="finance-summary-card"><span>净利润</span><strong>{{ bossCompanyProfitSummary.netProfit }}</strong></div>
          <div class="finance-summary-card"><span>利润率</span><strong>{{ bossCompanyProfitSummary.margin }}</strong></div>
        </div>
        <div class="table-card finance-table-card">
          <table class="data-table compact boss-data-table">
            <thead><tr><th>月份</th><th>运输收入</th><th>报关收入</th><th>车辆成本</th><th>公司支出</th><th>净利润</th><th>利润率</th></tr></thead>
            <tbody>
              <tr v-for="row in bossCompanyProfitDisplayRows" :key="row.period">
                <td>{{ row.period }}</td>
                <td>{{ row.transportRevenue }}</td>
                <td>{{ row.customsRevenue }}</td>
                <td>{{ row.vehicleCost }}</td>
                <td>{{ row.expenses }}</td>
                <td><strong>{{ row.netProfit }}</strong></td>
                <td>{{ row.margin }}</td>
              </tr>
              <tr v-if="bossCompanyProfitDisplayRows.length === 0"><td colspan="7">暂无公司利润数据</td></tr>
            </tbody>
          </table>
        </div>
        </BossCenterPage>
      </section>

      <section v-else-if="activeModule === 'bossVehicleProfit'" class="work-page finance-page boss-page">
        <BossCenterPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">老板中心</p>
            <h2>车辆利润</h2>
          </div>
        </div>
        <div class="finance-filter-bar">
          <div class="statement-date-selects period-filter-controls">
            <div class="segmented statement-mode-tabs">
              <button
                v-for="mode in PERIOD_FILTER_MODES"
                :key="mode.key"
                type="button"
                :class="{ active: periodFilterMode('boss') === mode.key }"
                @click="setPeriodFilterMode('boss', mode.key)"
              >{{ mode.label }}</button>
            </div>
            <label v-if="periodFilterMode('boss') !== 'all'">年份
              <select :value="periodFilterYear('boss')" @change="setPeriodFilterYear('boss', $event.target.value)">
                <option v-for="year in periodYearOptions('boss')" :key="year" :value="year">{{ year }}年</option>
              </select>
            </label>
            <label v-if="periodFilterMode('boss') === 'month'">月份
              <select :value="periodFilterMonth('boss')" @change="setPeriodFilterMonth('boss', $event.target.value)">
                <option v-for="item in PERIOD_MONTH_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <label>当月汇率
              <input
                class="boss-vehicle-rate-input"
                type="number"
                min="0"
                step="0.0001"
                :value="bossVehicleExchangeRate"
                @input="setBossVehicleExchangeRate($event.target.value)"
                @change="flushBossVehicleExchangeRateSave"
              />
            </label>
          </div>
          <span class="finance-period-chip">当前范围：{{ periodFilterLabelByScope('boss') }}</span>
        </div>
        <div class="finance-summary-grid">
          <div class="finance-summary-card"><span>车辆数量</span><strong>{{ bossVehicleProfitDisplayRows.length }}</strong></div>
          <div class="finance-summary-card"><span>最高利润车辆</span><strong>{{ bossTopVehicleProfitRow.plate }}</strong></div>
          <div class="finance-summary-card"><span>最高单车利润</span><strong>{{ bossTopVehicleProfitRow.profit }}</strong></div>
          <div class="finance-summary-card"><span>最高利润率</span><strong>{{ bossTopVehicleProfitRow.margin }}</strong></div>
        </div>
        <div class="table-card finance-table-card boss-vehicle-profit-card">
          <div class="boss-vehicle-profit-table-wrap">
            <table class="data-table compact boss-data-table boss-vehicle-profit-table">
              <thead>
                <tr>
                  <th>车牌</th>
                  <th>司机</th>
                  <th>单司机订单数</th>
                  <th>中港运费收入</th>
                  <th>单司机订单利润</th>
                  <th>加油费</th>
                  <th>维修费</th>
                  <th>保险费</th>
                  <th>年审费</th>
                  <th>牌头费</th>
	                  <th>其他支出</th>
	                  <th class="sticky-profit-col">净利润</th>
	                  <th class="sticky-profit-rmb-col">净利润（RMB）</th>
	                  <th class="sticky-margin-col">利润率</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in bossVehicleProfitDisplayRows" :key="row.plate">
                  <td>{{ row.plate }}</td>
                  <td>{{ row.driver }}</td>
                  <td>{{ row.orderCount }}</td>
                  <td>{{ row.revenue }}</td>
                  <td>{{ row.orderProfit }}</td>
                  <td>{{ row.fuelExpense }}</td>
                  <td>{{ row.repairExpense }}</td>
                  <td>{{ row.insuranceExpense }}</td>
                  <td>{{ row.reviewExpense }}</td>
                  <td>{{ row.plateHeadExpense }}</td>
	                  <td>{{ row.vehicleOtherExpense }}</td>
	                  <td class="sticky-profit-col"><strong>{{ row.profit }}</strong></td>
	                  <td class="sticky-profit-rmb-col"><strong>{{ row.profitRMBEquivalent }}</strong></td>
	                  <td class="sticky-margin-col">{{ row.margin }}</td>
	                </tr>
	                <tr v-if="bossVehicleProfitDisplayRows.length === 0"><td colspan="14">暂无车辆利润数据</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        </BossCenterPage>
      </section>

      <section v-else-if="activeModule === 'customsBusiness'" class="work-page finance-page customs-business-page">
        <BusinessPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">业务</p>
            <h2>报关业务</h2>
          </div>
          <div class="section-actions">
            <button class="primary-btn" type="button" @click="openCustomsBusinessModal"><IconSvg name="plus" />新增报关业务</button>
          </div>
        </div>
        <div class="finance-filter-bar centered-period-bar">
          <div class="statement-date-selects period-filter-controls">
            <div class="segmented statement-mode-tabs">
              <button
                v-for="mode in PERIOD_FILTER_MODES"
                :key="mode.key"
                type="button"
                :class="{ active: periodFilterMode('customsBusiness') === mode.key }"
                @click="setPeriodFilterMode('customsBusiness', mode.key)"
              >{{ mode.label }}</button>
            </div>
            <label v-if="periodFilterMode('customsBusiness') !== 'all'">年份
              <select :value="periodFilterYear('customsBusiness')" @change="setPeriodFilterYear('customsBusiness', $event.target.value)">
                <option v-for="year in periodYearOptions('customsBusiness')" :key="year" :value="year">{{ year }}年</option>
              </select>
            </label>
            <label v-if="periodFilterMode('customsBusiness') === 'month'">月份
              <select :value="periodFilterMonth('customsBusiness')" @change="setPeriodFilterMonth('customsBusiness', $event.target.value)">
                <option v-for="item in PERIOD_MONTH_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
            <span class="finance-period-chip">当前范围：{{ periodFilterLabelByScope('customsBusiness') }}</span>
          </div>
        </div>
        <div class="finance-summary-grid">
          <div class="finance-summary-card"><span>当前范围记录</span><strong>{{ customsBusinessSummary.count }}</strong></div>
          <div class="finance-summary-card"><span>报关票数</span><strong>{{ customsBusinessSummary.declarationCount }}</strong></div>
          <div class="finance-summary-card"><span>应收合计</span><strong>RMB {{ money(customsBusinessSummary.revenue) }}</strong></div>
          <div class="finance-summary-card"><span>单票均额</span><strong>RMB {{ money(customsBusinessSummary.count ? customsBusinessSummary.revenue / customsBusinessSummary.count : 0) }}</strong></div>
        </div>
        <div class="table-card finance-table-card">
          <table class="data-table compact boss-data-table customs-business-table">
            <thead><tr><th>日期</th><th>报关单号</th><th>六联单号</th><th>公司</th><th>进出口</th><th>品名项数</th><th>续页</th><th>报关费</th><th>续页费</th><th>舱单费</th><th>报检费</th><th>查验费</th><th>其他费用</th><th>合计</th><th>备注</th></tr></thead>
            <tbody>
              <tr v-for="row in customsBusinessRows" :key="row.id">
                <td>{{ row.date }}</td>
                <td>{{ row.declarationNo }}</td>
                <td>{{ row.sixSheetNo }}</td>
                <td>{{ row.company }}</td>
                <td>{{ row.direction }}</td>
                <td>{{ row.itemCount || '' }}</td>
                <td>{{ row.pageCount || '' }}</td>
                <td>{{ money(row.customsFee) }}</td>
                <td>{{ money(row.pageFee) }}</td>
                <td>{{ money(row.manifestFee) }}</td>
                <td>{{ money(row.inspectionFee) }}</td>
                <td>{{ money(row.checkFee) }}</td>
                <td>{{ money(row.otherFee) }}</td>
                <td><strong>{{ money(row.total) }}</strong></td>
                <td>{{ row.remark }}</td>
              </tr>
              <tr v-if="customsBusinessRows.length === 0"><td colspan="15">暂无报关业务</td></tr>
            </tbody>
          </table>
        </div>
        </BusinessPage>
      </section>

      <section v-else-if="activeModule === 'bossCompanyExpenses'" class="work-page finance-page boss-page">
        <BossCenterPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">老板中心</p>
            <h2>公司支出</h2>
          </div>
        </div>
        <div class="finance-filter-bar">
          <div class="statement-date-selects period-filter-controls">
            <div class="segmented statement-mode-tabs">
              <button
                v-for="mode in PERIOD_FILTER_MODES"
                :key="mode.key"
                type="button"
                :class="{ active: periodFilterMode('boss') === mode.key }"
                @click="setPeriodFilterMode('boss', mode.key)"
              >{{ mode.label }}</button>
            </div>
            <label v-if="periodFilterMode('boss') !== 'all'">年份
              <select :value="periodFilterYear('boss')" @change="setPeriodFilterYear('boss', $event.target.value)">
                <option v-for="year in periodYearOptions('boss')" :key="year" :value="year">{{ year }}年</option>
              </select>
            </label>
            <label v-if="periodFilterMode('boss') === 'month'">月份
              <select :value="periodFilterMonth('boss')" @change="setPeriodFilterMonth('boss', $event.target.value)">
                <option v-for="item in PERIOD_MONTH_OPTIONS" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </label>
          </div>
          <span class="finance-period-chip">当前范围：{{ periodFilterLabelByScope('boss') }}</span>
        </div>
        <div class="finance-summary-grid">
          <div class="finance-summary-card"><span>当前范围支出</span><strong>RMB {{ money(bossCompanyExpenseSummary.total) }}</strong></div>
          <div class="finance-summary-card"><span>已入账</span><strong>RMB {{ money(bossCompanyExpenseSummary.posted) }}</strong></div>
          <div class="finance-summary-card"><span>待复核</span><strong>RMB {{ money(bossCompanyExpenseSummary.pending) }}</strong></div>
          <div class="finance-summary-card"><span>最大支出项</span><strong>{{ bossCompanyExpenseSummary.topCategory }}</strong></div>
        </div>
        <div class="table-card finance-table-card">
          <table class="data-table compact boss-data-table">
            <thead><tr><th>月份</th><th>支出类别</th><th>金额</th><th>状态</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="row in bossCompanyExpenseDisplayRows" :key="`${row.date}-${row.category}`">
                <td>{{ row.date }}</td>
                <td>{{ row.category }}</td>
                <td><strong>{{ row.amount }}</strong></td>
                <td>{{ row.status }}</td>
                <td>{{ row.note }}</td>
              </tr>
              <tr v-if="bossCompanyExpenseDisplayRows.length === 0"><td colspan="5">暂无公司支出数据</td></tr>
            </tbody>
          </table>
        </div>
        </BossCenterPage>
      </section>

      <section v-else-if="activeModule === 'freight'" class="work-page">
        <SystemConfigPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">运费模板</p>
            <h2>运费报价</h2>
          </div>
        </div>
        <div class="freight-single-workspace">
        <div class="table-card freight-template-board">
          <div class="table-card-head freight-template-head">
            <div class="segmented freight-direction-tabs">
              <button
                :class="{ active: freightPanelTab !== '收费项目' }"
                @click="switchFreightDirection()"
              >报价</button>
              <button
                :class="{ active: freightPanelTab === '收费项目' }"
                @click="freightPanelTab = '收费项目'"
              >收费项目</button>
            </div>
            <button v-if="freightPanelTab === '收费项目'" class="primary-btn small" @click="startNewFeeItem()"><IconSvg name="plus" />新增项目</button>
          </div>
          <template v-if="freightPanelTab !== '收费项目'">
          <div v-if="freightQuoteView === FREIGHT_QUOTE_ROOT_VIEW" class="freight-quote-template-list">
            <button
              v-for="item in freightQuoteTemplateRows"
              :key="item.key"
              type="button"
              class="freight-quote-template-card"
              @click="openFreightQuoteTemplate(item)"
            >
              <span class="freight-quote-template-icon"><IconSvg :name="item.icon" /></span>
              <span class="freight-quote-template-copy">
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </span>
              <span class="freight-quote-template-meta">
                <b>{{ item.countLabel }}</b>
                <span>{{ item.priceLabel }}</span>
              </span>
            </button>
          </div>
          <div v-else-if="freightQuoteView === FREIGHT_QUOTE_CUSTOMERS_VIEW" class="freight-customer-template-list">
            <div class="freight-directory-summary">
              <button class="ghost-btn small" type="button" @click="openFreightQuoteRoot"><IconSvg name="back" />返回模板类型</button>
              <strong>客户运费报价模板</strong>
              <span>选择客户后进入独立报价模板；未录入客户报价时目录和价格为空。</span>
            </div>
            <div class="table-wrap freight-customer-template-wrap">
              <table class="data-table compact freight-customer-template-table">
                <thead>
                  <tr><th>客户</th><th>联系人</th><th>城市</th><th>客户报价</th><th>操作</th></tr>
                </thead>
                <tbody>
                  <tr
                    v-for="customer in freightCustomerRows"
                    :key="customer.id"
                    class="freight-customer-template-row"
                    @dblclick="openCustomerFreightQuoteTemplate(customer)"
                  >
                    <td><strong>{{ customer.name }}</strong></td>
                    <td>{{ customer.contact || customer.mobile || '-' }}</td>
                    <td>{{ customer.city || customer.province || '-' }}</td>
                    <td>{{ freightRateCountForCustomer(customer) }} 条</td>
                    <td class="row-actions">
                      <button class="ghost-btn small" type="button" @click.stop="openCustomerFreightQuoteTemplate(customer)" @dblclick.stop><IconSvg name="list" />打开</button>
                    </td>
                  </tr>
                  <tr v-if="freightCustomerRows.length === 0"><td colspan="5">暂无客户资料</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <template v-else>
          <div class="freight-directory-actions">
            <div class="freight-directory-toolbar-main">
              <button class="ghost-btn small" type="button" @click="activeFreightQuoteType === CUSTOMER_FREIGHT_QUOTE_TYPE ? openCustomerFreightQuoteList() : openFreightQuoteRoot()"><IconSvg name="back" />返回</button>
              <div class="segmented freight-level-tabs">
                <button
                  v-for="item in FREIGHT_DIRECTORY_LEVELS"
                  :key="item.value"
                  type="button"
                  :class="{ active: freightDirectoryLevel === item.value }"
                  @click="setFreightDirectoryLevel(item.value)"
                >{{ item.label }}</button>
              </div>
	            </div>
	            <div class="freight-directory-create">
	              <button v-if="freightDirectoryLevel === 'level1'" class="ghost-btn small" type="button" @click="prepareFreightDirectory(1)"><IconSvg name="plus" />新增一级目录</button>
	              <button v-else-if="freightDirectoryLevel === 'level2'" class="ghost-btn small" type="button" @click="prepareFreightDirectory(2)"><IconSvg name="plus" />新增二级目录</button>
	              <button v-else class="ghost-btn small" type="button" @click="prepareFreightDirectory(3)"><IconSvg name="plus" />新增三级目录</button>
	            </div>
          
              <div class="freight-batch-dropdown" @click.stop>
                <button type="button" class="ghost-btn small" @click="showFreightBatchPanel = !showFreightBatchPanel">
                  <span class="material-symbols-rounded">price_change</span>
                  批量改价
                </button>
                <div v-if="showFreightBatchPanel" class="freight-batch-popover">
<div class="freight-batch-toolbar">
            <strong>已选 {{ selectedVisibleFreightGroups.length }} 项</strong>
            <label>吨位
              <select v-model="freightBatchForm.tonnage">
                <option v-for="item in TONNAGE_OPTIONS" :key="item">{{ item }}</option>
              </select>
            </label>
            <label>RMB
              <input v-model="freightBatchForm.rmbAmount" type="number" min="0" placeholder="留空不改" />
            </label>
            <label>HKD
              <input v-model="freightBatchForm.hkdAmount" type="number" min="0" placeholder="留空不改" />
            </label>
            <button class="primary-btn small" type="button" @click="applyFreightBatchPrice"><IconSvg name="check" />批量改价</button>
            <button class="ghost-btn danger small" type="button" @click="deleteSelectedFreightGroups"><IconSvg name="trash" />批量删除</button>
            <button class="ghost-btn small" type="button" @click="selectAllVisibleFreightGroups">选择当前列表</button>
            <button class="ghost-btn small" type="button" @click="clearFreightGroupSelection">清空选择</button>
          </div>
                </div>
              </div>
</div>
          <div class="freight-directory-summary">
            <strong>{{ activeFreightQuoteTitle }} / {{ freightDirectoryMeta.label }}</strong>
            <span>{{ freightFixedEndpointText }}；一级看城市、二级看片区、三级看具体目录。批量改价只写入已勾选目录。</span>
          </div>
          <div v-if="freightDirectoryLevel !== 'level1'" class="freight-parent-filters">
            <label>所属一级
              <select v-model="freightParentLevel1" @change="clearFreightGroupSelection">
                <option v-for="item in freightLevel1Options" :key="item">{{ item }}</option>
              </select>
            </label>
            <label v-if="freightDirectoryLevel === 'level3'">所属二级
              <select v-model="freightParentLevel2" @change="clearFreightGroupSelection">
                <option v-for="item in freightLevel2Options" :key="item">{{ item }}</option>
              </select>
            </label>
          </div>
	          
          <div class="table-wrap freight-rate-matrix-wrap">
            <table class="data-table compact freight-rate-matrix">
              <thead>
                <tr>
                  <th>
                    <label class="table-check-label">
                      <input
                        type="checkbox"
                        class="table-check"
                        :checked="allVisibleFreightGroupsSelected"
                        @change="toggleAllVisibleFreightGroups($event.target.checked)"
                      />
                      <span>选择</span>
                    </label>
                  </th>
                  <th>{{ freightDirectoryMeta.primary }}</th>
	                  <th v-for="tonnage in TONNAGE_OPTIONS" :key="tonnage">{{ tonnage }}</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="freightDirectoryCreator.open" class="is-row-editing freight-directory-new-row">
                  <td></td>
                  <td class="freight-directory-main">
                    <input
                      v-model.trim="freightDirectoryCreator.name"
                      class="table-inline-input"
                      :placeholder="`输入${freightDirectoryMeta.primary}`"
                      autofocus
                    />
                  </td>
                  <td v-for="tonnage in TONNAGE_OPTIONS" :key="tonnage">
                    <div class="freight-rate-edit-cell" @click.stop>
                      <label>
                        <span>RMB</span>
                        <input v-model.number="freightDirectoryCreator.drafts[tonnage].rmbAmount" type="number" min="0" title="RMB" aria-label="RMB" />
                      </label>
                      <label>
                        <span>HKD</span>
                        <input v-model.number="freightDirectoryCreator.drafts[tonnage].hkdAmount" type="number" min="0" title="HKD" aria-label="HKD" />
                      </label>
                    </div>
                  </td>
                  <td class="row-actions">
                    <button class="icon-btn icon-only" title="保存" aria-label="保存" @click.stop="saveFreightDirectoryCreate">
                      <IconSvg name="save" />
                    </button>
                    <button class="icon-btn icon-only" title="取消" aria-label="取消" @click.stop="cancelFreightDirectoryCreate">
                      <IconSvg name="close" />
                    </button>
                  </td>
                </tr>
                <tr
	                  v-for="group in visibleFreightRateDisplayGroups"
	                  :key="group.key"
	                  :class="{ selected: Object.values(group.rates).some((item) => item.id === selectedFreightRateId), 'is-row-editing': isEditingFreightGroup(group) }"
	                >
                  <td>
                    <input
                      type="checkbox"
                      class="table-check"
                      :checked="isFreightGroupSelected(group)"
                      @click.stop
                      @change="toggleFreightGroupSelection(group, $event.target.checked)"
                    />
                  </td>
	                  <td class="freight-directory-main">
	                    <button
                        v-if="canEnterFreightGroup(group)"
                        class="freight-directory-link"
                        type="button"
                        @click.stop="enterFreightGroup(group)"
                      >{{ group.primaryLabel }}</button>
                      <strong v-else>{{ group.primaryLabel }}</strong>
	                  </td>
	                  <td v-for="tonnage in TONNAGE_OPTIONS" :key="tonnage">
                    <div v-if="isEditingFreightGroup(group)" class="freight-rate-edit-cell" @click.stop>
                      <label>
                        <span>RMB</span>
                        <input v-model.number="freightRowEditor.drafts[tonnage].rmbAmount" type="number" min="0" title="RMB" aria-label="RMB" />
                      </label>
                      <label>
                        <span>HKD</span>
                        <input v-model.number="freightRowEditor.drafts[tonnage].hkdAmount" type="number" min="0" title="HKD" aria-label="HKD" />
                      </label>
                    </div>
                    <div v-else class="rate-cell">
                      <template v-if="group.rates[tonnage]">
                        <span><b>RMB</b>{{ Number(group.rates[tonnage].rmbAmount || 0).toLocaleString() }}</span>
                        <span><b>HKD</b>{{ Number(group.rates[tonnage].hkdAmount || 0).toLocaleString() }}</span>
                      </template>
                      <span v-else>-</span>
                    </div>
	                  </td>
	                  <td class="row-actions">
                      <template v-if="isEditingFreightGroup(group)">
                        <button class="icon-btn icon-only" title="保存" aria-label="保存" @click.stop="saveFreightGroupRowEdit(group)">
                          <IconSvg name="save" />
                        </button>
                        <button class="icon-btn icon-only" title="取消" aria-label="取消" @click.stop="cancelFreightGroupRowEdit">
                          <IconSvg name="close" />
                        </button>
                      </template>
                      <template v-else>
	                    <button class="icon-btn icon-only" title="编辑" aria-label="编辑" @click.stop="beginFreightGroupRowEdit(group)">
	                      <IconSvg name="edit" />
                    </button>
                    <button class="icon-btn danger icon-only" title="删除目录" aria-label="删除目录" @click.stop="deleteFreightGroup(group)"><IconSvg name="trash" /></button>
                      </template>
                  </td>
                </tr>
	                <tr v-if="visibleFreightRateDisplayGroups.length === 0 && !freightDirectoryCreator.open"><td :colspan="TONNAGE_OPTIONS.length + 3">暂无运费模板</td></tr>
              </tbody>
            </table>
          </div>
          </template>
          </template>
          <template v-else>
          <div class="fee-item-board">
          <h3 class="subsection-title">收费项目管理</h3>
          <form v-if="feeItemFormOpen" class="freight-template-toolbar fee-item-toolbar" :class="{ 'is-editing-record': feeItemForm.id }" @submit.prevent="saveFeeItem">
            <label>类别<select v-model="feeItemForm.category"><option>正常</option><option>代垫</option></select></label>
            <label class="wide">项目名称<input ref="feeItemNameInput" v-model.trim="feeItemForm.name" placeholder="名称唯一，不可重复" /></label>
            <div class="fee-cost-source-field">
              <span>成本来源</span>
              <details class="fee-cost-source-select">
                <summary>{{ feeItemCostSourceText(feeItemForm) }}</summary>
                <div class="fee-cost-source-options">
                  <label v-for="source in FEE_ITEM_COST_SOURCE_OPTIONS" :key="source">
                    <input v-model="feeItemForm.costSources" type="checkbox" :value="source" @change="ensureFeeItemCostSources(feeItemForm)" />
                    <span>{{ source }}</span>
                  </label>
                </div>
              </details>
            </div>
            <label>币种<select v-model="feeItemForm.currency"><option value="港币">HKD</option><option value="人民币">RMB</option></select></label>
            <label>默认金额<input v-model.number="feeItemForm.defaultAmount" type="number" min="0" /></label>
            <label>默认归属<select v-model="feeItemForm.defaultDriverRole"><option v-for="role in FEE_DRIVER_ROLE_OPTIONS" :key="role" :value="role">{{ FEE_DRIVER_ROLE_LABELS[role] }}</option></select></label>
            <button class="primary-btn small"><IconSvg name="save" />保存项目</button>
            <button class="ghost-btn small" type="button" @click="closeFeeItemForm">取消</button>
          </form>
          <div class="table-wrap fee-item-table-wrap">
            <table class="fee-item-table">
              <thead>
                <tr>
                  <th>序号</th>
                  <th>排序</th>
	                  <th>类别</th>
	                  <th>项目名称</th>
                    <th>成本来源</th>
		                  <th>币种</th>
		                  <th>默认金额</th>
		                  <th>默认归属</th>
	                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(item, index) in sortedFeeItemRows"
                  :key="item.id"
                  draggable="true"
                  :class="{ selected: selectedFeeItem?.id === item.id, 'is-dragging': draggedFeeItemId === item.id }"
                  @dragstart="startFeeItemDrag(item)"
                  @dragover.prevent
                  @drop.prevent="dropFeeItem(item)"
                  @dragend="endFeeItemDrag"
                  @click="selectFeeItem(item)"
                  @dblclick="selectFeeItem(item)"
                >
                  <td class="sequence-cell">{{ index + 1 }}</td>
                  <td class="drag-handle-cell">
                    <button class="icon-btn icon-only fee-item-drag-handle" type="button" title="拖动排序" aria-label="拖动排序" @click.stop>
                      <IconSvg name="list" />
                    </button>
                  </td>
                  <td>
                    <select v-if="editingFeeItemRowId === item.id" v-model="feeItemRowDraft.category" class="table-inline-input">
                      <option>正常</option>
                      <option>代垫</option>
                    </select>
                    <template v-else>{{ item.category }}</template>
                  </td>
                  <td>
                    <input v-if="editingFeeItemRowId === item.id" v-model.trim="feeItemRowDraft.name" class="table-inline-input" />
                    <template v-else>{{ item.name }}</template>
                  </td>
                  <td>
                    <details v-if="editingFeeItemRowId === item.id" class="fee-cost-source-select compact" @click.stop @dblclick.stop>
                      <summary>{{ feeItemCostSourceText(feeItemRowDraft) }}</summary>
                      <div class="fee-cost-source-options">
                        <label v-for="source in FEE_ITEM_COST_SOURCE_OPTIONS" :key="source">
                          <input v-model="feeItemRowDraft.costSources" type="checkbox" :value="source" @change="ensureFeeItemCostSources(feeItemRowDraft)" />
                          <span>{{ source }}</span>
                        </label>
                      </div>
                    </details>
                    <template v-else>{{ feeItemCostSourceText(item) }}</template>
                  </td>
                  <td>
                    <select v-if="editingFeeItemRowId === item.id" v-model="feeItemRowDraft.currency" class="table-inline-input">
                      <option value="港币">HKD</option>
                      <option value="人民币">RMB</option>
                    </select>
                    <template v-else>{{ currencyCodeDisplay(item.currency) }}</template>
                  </td>
	                  <td>
	                    <input v-if="editingFeeItemRowId === item.id" v-model.number="feeItemRowDraft.defaultAmount" type="number" min="0" class="table-inline-input" />
	                    <template v-else>{{ Number(item.defaultAmount || 0).toLocaleString() }}</template>
	                  </td>
	                  <td>
	                    <select v-if="editingFeeItemRowId === item.id" v-model="feeItemRowDraft.defaultDriverRole" class="table-inline-input">
	                      <option v-for="role in FEE_DRIVER_ROLE_OPTIONS" :key="role" :value="role">{{ FEE_DRIVER_ROLE_LABELS[role] }}</option>
	                    </select>
	                    <template v-else>{{ FEE_DRIVER_ROLE_LABELS[item.defaultDriverRole || ''] }}</template>
	                  </td>
                  <td class="row-actions">
                    <template v-if="editingFeeItemRowId === item.id">
                      <button class="icon-btn icon-only" title="保存" aria-label="保存" @click.stop="saveFeeItemRow(item)"><IconSvg name="save" /></button>
                      <button class="icon-btn icon-only" title="取消" aria-label="取消" @click.stop="cancelFeeItemRowEdit"><IconSvg name="close" /></button>
                    </template>
                    <template v-else>
                      <button class="icon-btn icon-only" title="编辑" aria-label="编辑" @click.stop="startFeeItemRowEdit(item)"><IconSvg name="edit" /></button>
                      <button class="icon-btn icon-only danger" title="删除" aria-label="删除" @click.stop="deleteFeeItem(item)"><IconSvg name="trash" /></button>
                    </template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
          </template>
        </div>
        </div>
        </SystemConfigPage>
      </section>

      <section v-else-if="activeModule === 'templates'" class="work-page">
        <SystemConfigPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">模板中心</p>
            <h2>导出模板管理</h2>
          </div>
          <button class="primary-btn" @click="openTemplateEditor(null)"><IconSvg name="plus" />新增模板</button>
        </div>
        <div class="module-grid">
          <div class="table-card">
            <table class="template-list-table">
              <colgroup>
                <col class="template-name-col" />
                <col class="template-format-col" />
                <col class="template-desc-col" />
                <col class="template-actions-col" />
              </colgroup>
              <thead><tr><th>模板名称</th><th>适用导出</th><th>用途</th><th>操作</th></tr></thead>
              <tbody>
                <tr
                  v-for="item in exportTemplateRows"
                  :key="item.id"
                  :class="{ selected: selectedTemplate?.id === item.id }"
                  @click="selectedTemplateId = item.id"
                >
                  <td>{{ item.name }}</td>
                  <td>{{ templateFormatLabel(item) }}</td>
                  <td>{{ item.description }}</td>
                  <td class="row-actions">
                    <button class="icon-btn icon-only" title="编辑" aria-label="编辑" @click.stop="openTemplateEditor(item)"><IconSvg name="edit" /></button>
                    <button class="icon-btn icon-only" title="复制模板" aria-label="复制模板" @click.stop="duplicateTemplate(item)"><IconSvg name="copy" /></button>
                    <button class="icon-btn icon-only danger" title="删除" aria-label="删除" @click.stop="deleteTemplate(item)"><IconSvg name="trash" /></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        </SystemConfigPage>
      </section>

      <section v-else-if="activeModule === 'master'" class="work-page">
        <SystemConfigPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">基础数据</p>
            <h2>口岸、吨位、账期、城市等字典</h2>
          </div>
          <button class="primary-btn" @click="editMaster(null)"><IconSvg name="plus" />新增基础数据</button>
        </div>
        <div class="module-grid two-columns">
          <div class="table-card">
            <table>
              <thead><tr><th>类型</th><th>名称</th><th>值</th><th>排序</th><th>操作</th></tr></thead>
              <tbody>
                <tr
                  v-for="item in masterRows"
                  :key="item.id"
                  :class="{ selected: selectedMaster?.id === item.id }"
                  @click="selectedMasterId = item.id; editMaster(item)"
                >
                  <td>{{ item.type }}</td>
                  <td>{{ item.name }}</td>
                  <td>{{ item.value }}</td>
                  <td>{{ item.sortOrder }}</td>
                  <td class="row-actions">
                    <button class="icon-btn" @click.stop="editMaster(item)"><IconSvg name="edit" />编辑</button>
                    <button class="icon-btn danger" @click.stop="deleteMaster(item)"><IconSvg name="trash" />删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <form class="edit-card" @submit.prevent="saveMaster">
            <h3>{{ masterForm.id ? '编辑基础数据' : '新增基础数据' }}</h3>
            <label>类型<select v-model="masterForm.type"><option>口岸</option><option>吨位</option><option>账期</option><option>城市</option><option>订单状态</option></select></label>
            <label>名称<input v-model.trim="masterForm.name" /></label>
            <label>值<input v-model.trim="masterForm.value" /></label>
            <label>排序<input v-model.number="masterForm.sortOrder" type="number" /></label>
            <button class="primary-btn"><IconSvg name="save" />保存基础数据</button>
          </form>
        </div>
        </SystemConfigPage>
      </section>

      <section v-else-if="activeModule === 'accounts'" class="work-page">
        <SystemConfigPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">权限账号</p>
            <h2>系统账号与功能权限</h2>
          </div>
          <button class="primary-btn" @click="openAccountCreateModal"><IconSvg name="userPlus" />新增账号</button>
        </div>
        <div class="module-grid">
          <div class="table-card">
            <table class="account-table">
              <colgroup>
                <col class="account-username-col" />
                <col class="account-name-col" />
                <col class="account-hire-col" />
                <col class="account-role-col" />
                <col class="account-status-col" />
                <col class="account-permissions-col" />
                <col class="account-actions-col" />
              </colgroup>
              <thead><tr><th>账号</th><th>姓名</th><th>入职日期</th><th>部门</th><th>状态</th><th>权限</th><th class="account-actions-header">操作</th></tr></thead>
              <tbody>
                <tr
                  v-for="item in accountRows"
                  :key="item.id"
                  :class="{ selected: selectedAccount?.id === item.id }"
                  @click="selectedAccountId = item.id"
                >
                  <td>{{ item.username }}</td>
                  <td>{{ item.displayName }}</td>
                  <td>{{ item.hireDate || '-' }}</td>
                  <td>{{ item.role }}</td>
                  <td>{{ item.status }}</td>
                  <td class="account-permissions" :title="item.permissions?.join('、') || ''">{{ item.permissions?.join('、') }}</td>
                  <td class="row-actions account-actions">
                    <button class="icon-btn" @click.stop="openAccountEditModal(item)"><IconSvg name="edit" />编辑</button>
                    <button class="icon-btn danger" @click.stop="deleteAccount(item)"><IconSvg name="trash" />删除</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        </SystemConfigPage>
      </section>

      <section v-else-if="activeModule === 'security'" class="work-page">
        <SystemConfigPage>
        <div class="section-head">
          <div>
            <p class="eyebrow">数据安全</p>
            <h2>数据库、备份、回收站和文件归档</h2>
          </div>
          <div class="toolbar-actions security-actions">
            <button class="primary-btn" @click="exportLocalBackup"><IconSvg name="download" />立即备份</button>
            <button class="ghost-btn" @click="showRestoreNotice"><IconSvg name="upload" />恢复/导入</button>
            <button class="ghost-btn" @click="openRecycleBin"><IconSvg name="archive" />回收站</button>
            <button class="ghost-btn" @click="refreshAuditLogs"><IconSvg name="refresh" />刷新审计日志</button>
          </div>
        </div>
        <div class="cards-grid security-policy-list">
          <article class="policy-card security-policy-item">
            <h3>正式数据进数据库</h3>
            <p>客户、订单、车辆、司机、运费模板、权限账号全部由后端 API 写入数据库，浏览器不再作为正式数据源。</p>
          </article>
          <article class="policy-card security-policy-item">
            <h3>自动备份</h3>
            <p>服务器每日自动备份 PostgreSQL 数据库，并建议同步到异地存储。</p>
          </article>
          <article class="policy-card security-policy-item">
            <h3>回收站</h3>
            <p>删除进入回收站，60 天内可恢复，超期再由服务器定时清理。</p>
          </article>
          <article class="policy-card security-policy-item">
            <h3>文件归档</h3>
            <p>保险单、订单附件、单据图片保存到 OSS 附件库，并提供预览、下载、上传人和上传时间记录。</p>
          </article>
        </div>
        <div class="table-card audit-table">
          <table>
            <thead><tr><th>时间</th><th>操作</th><th>对象</th><th>关联记录</th><th>说明</th></tr></thead>
            <tbody>
              <tr v-for="item in auditRows" :key="item.id">
                <td>{{ formatAuditTime(item.createdAt) }}</td>
                <td>{{ auditActionText(item.action) }}</td>
                <td>{{ auditEntityText(item.entityType) }}</td>
                <td>{{ auditRecordText(item) }}</td>
                <td>{{ item.detail }}</td>
              </tr>
              <tr v-if="auditRows.length === 0"><td colspan="5">暂无审计记录</td></tr>
            </tbody>
          </table>
        </div>
        </SystemConfigPage>
      </section>

      <div v-if="activeFinanceWageDetailRow" class="modal-backdrop finance-wage-detail-backdrop" @click.self="closeFinanceWageDetail">
        <section class="modal-card finance-wage-detail-modal">
          <div class="modal-head">
            <div>
              <h2>{{ activeFinanceWageDetailRow.driver.name }} · 工资订单明细</h2>
              <p class="modal-subtitle">
                {{ financeDateRangeLabel() }} · {{ activeFinanceWageDetailRow.orderCount }} 单 · 趟费 {{ moneyPair(activeFinanceWageDetailRow.payable, activeFinanceWageDetailRow.payableRMB) }} · 代垫 {{ moneyPair(activeFinanceWageDetailRow.advanceFee, activeFinanceWageDetailRow.advanceFeeRMB) }} · 应付 {{ moneyPair(activeFinanceWageDetailRow.total, activeFinanceWageDetailRow.totalRMB) }}
              </p>
            </div>
            <div class="modal-detail-actions">
              <details class="data-table-column-menu">
                <summary class="ghost-btn small">
                  <IconSvg name="columns" />列
                  <span>{{ visibleFinanceWageDetailColumns(activeFinanceWageDetailRow).length }}/{{ financeWageDetailColumns(activeFinanceWageDetailRow).length }}</span>
                </summary>
                <div class="data-table-column-popover finance-wage-detail-column-popover">
                  <label v-for="column in orderedFinanceWageDetailColumns(activeFinanceWageDetailRow)" :key="column.key">
                    <input
                      type="checkbox"
                      :checked="financeWageDetailColumnVisibility[column.key] !== false"
                      @change="setFinanceWageDetailColumnVisible(column, $event.target.checked)"
                    />
                    <span>{{ column.label }}</span>
                    <button
                      :class="['icon-btn', 'icon-only', { active: isFinanceWageDetailColumnLocked(column) }]"
                      type="button"
                      :title="isFinanceWageDetailColumnLocked(column) ? '取消锁定' : '锁定到左侧'"
                      :disabled="column.key === 'no'"
                      @click.prevent="toggleFinanceWageDetailColumnLock(column)"
                    ><IconSvg name="lock" /></button>
                    <button class="icon-btn icon-only" type="button" title="上移" @click.prevent="moveFinanceWageDetailColumn(column, -1)"><IconSvg name="chevronUp" /></button>
                    <button class="icon-btn icon-only" type="button" title="下移" @click.prevent="moveFinanceWageDetailColumn(column, 1)"><IconSvg name="chevronDown" /></button>
                  </label>
                </div>
              </details>
              <button class="ghost-btn small" type="button" @click="resetFinanceWageDetailColumnOrder"><IconSvg name="list" />恢复列序</button>
              <button class="ghost-btn small" type="button" @click="resetFinanceWageDetailColumnWidths(activeFinanceWageDetailRow)"><IconSvg name="refresh" />恢复列宽</button>
              <button class="ghost-btn small" type="button" @click="exportFinanceWageRow(activeFinanceWageDetailRow)"><IconSvg name="download" />导出</button>
              <button type="button" class="icon-btn" @click="closeFinanceWageDetail"><IconSvg name="close" />关闭</button>
            </div>
          </div>
          <div class="modal-body finance-wage-detail-body">
            <div class="nested-table-scroll finance-wage-detail-scroll">
              <table class="data-table compact nested-data-table finance-wage-detail-table">
                <colgroup>
                  <col
                    v-for="column in visibleFinanceWageDetailColumns(activeFinanceWageDetailRow)"
                    :key="column.key"
                    :style="dataTableColumnStyle(financeWageDetailColumnWidths, column.key)"
                  />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      v-for="(column, index) in visibleFinanceWageDetailColumns(activeFinanceWageDetailRow)"
                      :key="column.key"
                      :class="['resizable-th', 'sortable', { sorted: tableSortDirection('financeWageDetail', column.key), 'sticky-first-column': index === 0 }]"
                      :style="financeWageDetailStickyColumnStyle(activeFinanceWageDetailRow, column, index)"
                      @click="toggleTableSort('financeWageDetail', column)"
                    >
                      <button class="table-sort-trigger" type="button">
                        <span>{{ column.label }}</span>
                        <span class="sort-mark">{{ tableSortDirection('financeWageDetail', column.key) === 'asc' ? '↑' : tableSortDirection('financeWageDetail', column.key) === 'desc' ? '↓' : '' }}</span>
                      </button>
                      <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startDataTableColumnResize('finance_wage_detail', financeWageDetailColumnWidths, column, $event)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="order in sortedFinanceWageDetailOrders(activeFinanceWageDetailRow)"
                    :key="order.no"
                    :class="{ selected: selectedFinanceWageDetailOrderNo === order.no }"
                    @click="selectedFinanceWageDetailOrderNo = selectedFinanceWageDetailOrderNo === order.no ? '' : order.no"
                  >
                    <td
                      v-for="(column, index) in visibleFinanceWageDetailColumns(activeFinanceWageDetailRow)"
                      :key="column.key"
                      :class="{ 'nested-fee-detail-cell': column.feeName, 'sticky-first-column': index === 0 }"
                      :style="financeWageDetailStickyColumnStyle(activeFinanceWageDetailRow, column, index)"
                    >
                      <button
                        v-if="column.key === 'no'"
                        class="table-link-btn"
                        type="button"
                        @click.stop="openFinanceWageDetailOrderEdit(order)"
                      >{{ financeWageDetailCellValue(order, column, activeFinanceWageDetailRow) }}</button>
                      <template v-else>{{ financeWageDetailCellValue(order, column, activeFinanceWageDetailRow) }}</template>
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td
                      v-for="(column, index) in visibleFinanceWageDetailColumns(activeFinanceWageDetailRow)"
                      :key="column.key"
                      :class="{ 'sticky-first-column': index === 0 }"
                      :style="financeWageDetailStickyColumnStyle(activeFinanceWageDetailRow, column, index)"
                    >{{ financeWageDetailFooterValue(column, activeFinanceWageDetailRow) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>
      </div>

      <OrderDetailModal
        :order="activeOrderDetail"
        :fee-role-labels="FEE_DRIVER_ROLE_LABELS"
        :currency-code-display="currencyCodeDisplay"
        :money="money"
        :normalize-transport-mode="normalizeTransportMode"
        :order-detail-driver-text="orderDetailDriverText"
        :order-status-class="orderStatusClass"
        :order-detail-fee-rows="orderDetailFeeRows"
        @edit="openOrderModal(null, $event)"
        @close="closeOrderDetail"
      />

      <div v-if="orderListDetailOpen" class="modal-backdrop full-detail-backdrop" @click.self="closeOrderListDetail">
        <section class="modal-card full-detail-modal">
          <div class="modal-head">
            <div>
              <h2>订单查看列表</h2>
              <p class="modal-subtitle">
                {{ orderListDetailSubtitle }}
              </p>
            </div>
            <div class="modal-detail-actions">
              <details class="data-table-column-menu">
                <summary class="ghost-btn small">
                  <IconSvg name="columns" />列
                  <span>{{ orderListDetailColumns.length }}/{{ orderListDetailManageColumns.length }}</span>
                </summary>
                <div class="data-table-column-popover finance-wage-detail-column-popover order-list-detail-column-popover">
                  <label
                    v-for="column in orderListDetailManageColumns"
                    :key="column.key"
                    :class="{ disabled: column.locked || isOrderRightStickyColumn(column) }"
                  >
                    <input
                      type="checkbox"
                      :checked="isOrderColumnVisible(column.key)"
                      :disabled="column.locked || isOrderRightStickyColumn(column)"
                      @change="toggleOrderColumnVisible(column)"
                    />
                    <span>{{ column.label }}</span>
                    <button
                      :class="['icon-btn', 'icon-only', { active: isOrderColumnLocked(column) }]"
                      type="button"
                      :title="isOrderColumnLocked(column) ? '取消锁定' : '锁定到左侧'"
                      :disabled="column.locked || isOrderRightStickyColumn(column)"
                      @click.prevent="toggleOrderColumnLock(column)"
                    ><IconSvg name="lock" /></button>
                    <button class="icon-btn icon-only" type="button" title="上移" :disabled="column.locked || isOrderRightStickyColumn(column)" @click.prevent="moveOrderColumn(column, -1)"><IconSvg name="chevronUp" /></button>
                    <button class="icon-btn icon-only" type="button" title="下移" :disabled="column.locked || isOrderRightStickyColumn(column)" @click.prevent="moveOrderColumn(column, 1)"><IconSvg name="chevronDown" /></button>
                  </label>
                </div>
              </details>
              <button class="ghost-btn small" type="button" @click="resetOrderColumnOrder"><IconSvg name="list" />恢复列序</button>
              <button class="ghost-btn small" type="button" @click="resetOrderColumnWidths"><IconSvg name="refresh" />恢复列宽</button>
              <button class="ghost-btn small" type="button" @click="orderListDetailScope === 'customer' ? exportCustomerOrders('excel') : exportOrdersByFormat('excel')"><IconSvg name="download" />导出</button>
              <button type="button" class="icon-btn" @click="closeOrderListDetail"><IconSvg name="close" />关闭</button>
            </div>
          </div>
          <div class="modal-body full-detail-body">
            <div class="nested-table-scroll order-list-detail-scroll">
              <table class="data-table compact order-table order-list-detail-table" :style="orderTableStyle()">
                <colgroup>
                  <col v-for="column in orderListDetailColumns" :key="column.key" :style="orderColumnStyle(column.key)" />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      v-for="(column, index) in orderListDetailColumns"
                      :key="column.key"
                      :class="['resizable-th', { sortable: column.key !== 'actions', sorted: tableSortDirection('orders', column.key), 'sticky-managed-column': isOrderColumnFrozen(column), 'sticky-order-right-column': isOrderRightStickyColumn(column), 'order-full-cell': isOrderFullDisplayColumn(column), 'order-driver-cell': column.key === 'driver' }]"
                      :style="orderStickyColumnStyle(column, index)"
                      @click="toggleTableSort('orders', column)"
                    >
                      <span v-if="column.key === 'actions'" class="table-sort-trigger">{{ column.label }}</span>
                      <button v-else class="table-sort-trigger" type="button">
                        <span>{{ column.label }}</span>
                        <span class="sort-mark">{{ tableSortDirection('orders', column.key) === 'asc' ? '↑' : tableSortDirection('orders', column.key) === 'desc' ? '↓' : '' }}</span>
                      </button>
                      <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startOrderColumnResize(column, $event)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="order in orderListDetailRows" :key="order.no" @dblclick="openOrderDetail(order)">
                    <td
                      v-for="(column, index) in orderListDetailColumns"
                      :key="column.key"
                      :class="{ 'row-actions': column.key === 'actions', 'sticky-managed-column': isOrderColumnFrozen(column), 'sticky-order-right-column': isOrderRightStickyColumn(column), 'order-full-cell': isOrderFullDisplayColumn(column), 'order-driver-cell': column.key === 'driver' }"
                      :style="orderStickyColumnStyle(column, index)"
                      :title="orderTableCellTitle(order, column.key)"
                    >
                      <span v-if="column.key === 'status'" class="status-badge" :class="orderStatusClass(order.status)">{{ order.status }}</span>
                      <template v-else-if="column.key === 'actions'">
                        <button class="icon-btn" type="button" @click.stop="openOrderDetail(order)"><IconSvg name="eye" />查看</button>
                        <button class="icon-btn" type="button" @click.stop="openOrderModal(null, order)"><IconSvg name="edit" />编辑</button>
                      </template>
                      <button v-else-if="column.key === 'no'" class="table-link-btn" type="button" @click.stop="openOrderDetail(order)">{{ orderCellText(order, column.key) }}</button>
                      <template v-else>{{ orderCellText(order, column.key) || '-' }}</template>
                    </td>
                  </tr>
                  <tr v-if="orderListDetailRows.length === 0"><td :colspan="orderListDetailColumns.length">暂无订单</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div v-if="customerListDetailOpen" class="modal-backdrop full-detail-backdrop" @click.self="closeCustomerListDetail">
        <section class="modal-card full-detail-modal">
          <div class="modal-head">
            <div>
              <h2>{{ activePartnerType }}查看列表</h2>
              <p class="modal-subtitle">
                {{ selectedCustomerIds.length ? `已选 ${customerListDetailRows.length} 项` : `当前筛选 ${customerListDetailRows.length} 项` }}
              </p>
            </div>
            <div class="modal-detail-actions">
              <details class="data-table-column-menu">
                <summary class="ghost-btn small">
                  <IconSvg name="columns" />列
                  <span>{{ visibleCustomerListDetailColumns.length }}/{{ customerListDetailColumns.length }}</span>
                </summary>
                <div class="data-table-column-popover finance-wage-detail-column-popover">
                  <label v-for="column in customerListDetailColumns" :key="column.key" :class="{ disabled: column.locked }">
                    <input
                      type="checkbox"
                      :checked="dataTableColumnVisible(customerListDetailColumnVisibility, column.key)"
                      :disabled="column.locked"
                      @change="setDataTableColumnVisible('customer_list_detail', customerListDetailColumnVisibility, column, $event.target.checked)"
                    />
                    <span>{{ column.label }}</span>
                    <button class="icon-btn icon-only" type="button" title="上移" :disabled="column.locked" @click.prevent="moveDataTableColumnByOffset(customerListDetailColumns, 'customer_list_detail', column, -1)"><IconSvg name="chevronUp" /></button>
                    <button class="icon-btn icon-only" type="button" title="下移" :disabled="column.locked" @click.prevent="moveDataTableColumnByOffset(customerListDetailColumns, 'customer_list_detail', column, 1)"><IconSvg name="chevronDown" /></button>
                  </label>
                </div>
              </details>
              <button class="ghost-btn small" type="button" @click="resetDataTableColumnOrder(customerListDetailColumns, 'customer_list_detail')"><IconSvg name="list" />恢复列序</button>
              <button class="ghost-btn small" type="button" @click="resetDataTableColumnWidths('customer_list_detail', customerListDetailColumns, customerListDetailColumnWidths)"><IconSvg name="refresh" />恢复列宽</button>
              <button class="ghost-btn small" type="button" @click="exportCustomers"><IconSvg name="download" />导出</button>
              <button type="button" class="icon-btn" @click="closeCustomerListDetail"><IconSvg name="close" />关闭</button>
            </div>
          </div>
          <div class="modal-body full-detail-body">
            <div class="nested-table-scroll order-list-detail-scroll">
              <table class="data-table compact order-list-detail-table">
                <colgroup>
                  <col v-for="column in visibleCustomerListDetailColumns" :key="column.key" :style="dataTableColumnStyle(customerListDetailColumnWidths, column.key)" />
                </colgroup>
                <thead>
                  <tr>
                    <th v-for="column in visibleCustomerListDetailColumns" :key="column.key" class="resizable-th">
                      <span>{{ column.label }}</span>
                      <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startDataTableColumnResize('customer_list_detail', customerListDetailColumnWidths, column, $event)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in customerListDetailRows" :key="item.id" @dblclick="selectedCustomerId = item.id; closeCustomerListDetail()">
                    <td v-for="column in visibleCustomerListDetailColumns" :key="column.key" :class="{ 'row-actions': column.key === 'actions' }">
                      <template v-if="column.key === 'actions'">
                        <button class="icon-btn" type="button" @click="selectedCustomerId = item.id; closeCustomerListDetail()"><IconSvg name="eye" />查看</button>
                        <button class="icon-btn" type="button" @click="openCustomerModal(item)"><IconSvg name="edit" />编辑</button>
                      </template>
                      <template v-else>{{ customerListDetailCellText(item, column.key) }}</template>
                    </td>
                  </tr>
                  <tr v-if="customerListDetailRows.length === 0"><td :colspan="visibleCustomerListDetailColumns.length">暂无{{ activePartnerType }}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div v-if="dispatchListDetailOpen" class="modal-backdrop full-detail-backdrop" @click.self="closeDispatchListDetail">
        <section class="modal-card full-detail-modal">
          <div class="modal-head">
            <div>
              <h2>排车查看列表</h2>
              <p class="modal-subtitle">
                {{ selectedDispatchPlanRows.length ? `已选 ${dispatchListDetailRows.length} 单` : `当前列表 ${dispatchListDetailRows.length} 单` }}
              </p>
            </div>
            <div class="modal-detail-actions">
              <details class="data-table-column-menu">
                <summary class="ghost-btn small">
                  <IconSvg name="columns" />列
                  <span>{{ visibleDispatchTableColumns.length }}/{{ dispatchTableColumns.length }}</span>
                </summary>
                <div class="data-table-column-popover finance-wage-detail-column-popover">
                  <label v-for="column in dispatchTableColumns" :key="column.key" :class="{ disabled: column.locked }">
                    <input
                      type="checkbox"
                      :checked="dataTableColumnVisible(dispatchTableColumnVisibility, column.key)"
                      :disabled="column.locked"
                      @change="setDataTableColumnVisible('dispatch_board', dispatchTableColumnVisibility, column, $event.target.checked)"
                    />
                    <span>{{ column.label }}</span>
                    <button class="icon-btn icon-only" type="button" title="上移" :disabled="column.locked" @click.prevent="moveDataTableColumnByOffset(dispatchTableColumns, 'dispatch_board', column, -1)"><IconSvg name="chevronUp" /></button>
                    <button class="icon-btn icon-only" type="button" title="下移" :disabled="column.locked" @click.prevent="moveDataTableColumnByOffset(dispatchTableColumns, 'dispatch_board', column, 1)"><IconSvg name="chevronDown" /></button>
                  </label>
                </div>
              </details>
              <button class="ghost-btn small" type="button" @click="resetDataTableColumnOrder(dispatchTableColumns, 'dispatch_board')"><IconSvg name="list" />恢复列序</button>
              <button class="ghost-btn small" type="button" @click="resetDataTableColumnWidths('dispatch_board', dispatchTableColumns, dispatchTableColumnWidths)"><IconSvg name="refresh" />恢复列宽</button>
              <button class="ghost-btn small" type="button" @click="exportDispatchPlanRows"><IconSvg name="download" />导出</button>
              <button type="button" class="icon-btn" @click="closeDispatchListDetail"><IconSvg name="close" />关闭</button>
            </div>
          </div>
          <div class="modal-body full-detail-body">
            <div class="nested-table-scroll order-list-detail-scroll">
              <table class="data-table compact order-list-detail-table">
                <colgroup>
                  <col v-for="column in visibleDispatchTableColumns" :key="column.key" :style="dataTableColumnStyle(dispatchTableColumnWidths, column.key)" />
                </colgroup>
                <thead>
                  <tr>
                    <th v-for="column in visibleDispatchTableColumns" :key="column.key" class="resizable-th">
                      <span>{{ column.label }}</span>
                      <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startDataTableColumnResize('dispatch_board', dispatchTableColumnWidths, column, $event)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in dispatchListDetailRows" :key="row.id" @dblclick="closeDispatchListDetail(); openDispatchDetail(row)">
                    <td v-for="column in visibleDispatchTableColumns" :key="column.key" :class="{ 'row-actions': column.key === 'actions' }">
                      <template v-if="column.key === 'dispatchNo'">
                        <strong>{{ row.dispatchNo || '-' }}</strong>
                        <small v-if="row.order?.no">{{ row.order.no }}</small>
                      </template>
                      <template v-else-if="column.key === 'actions'">
                        <button class="icon-btn" type="button" @click="closeDispatchListDetail(); openDispatchDetail(row)"><IconSvg name="eye" />查看</button>
                        <button class="icon-btn" type="button" @click="closeDispatchListDetail(); openEditDispatchPlanRow(row)"><IconSvg name="edit" />编辑</button>
                      </template>
                      <template v-else>{{ dispatchListDetailCellText(row, column.key) }}</template>
                    </td>
                  </tr>
                  <tr v-if="dispatchListDetailRows.length === 0"><td :colspan="visibleDispatchTableColumns.length">暂无排车单</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div v-if="vehicleDriverListDetailOpen" class="modal-backdrop full-detail-backdrop" @click.self="closeVehicleDriverListDetail">
        <section class="modal-card full-detail-modal">
          <div class="modal-head">
            <div>
              <h2>{{ activeVehicleTab }}查看列表</h2>
              <p class="modal-subtitle">
                {{ selectedVehicleDriverCount ? `已选 ${vehicleDriverListDetailRows.length} 项` : `当前筛选 ${vehicleDriverListDetailRows.length} 项` }}
              </p>
            </div>
            <div class="modal-detail-actions">
              <details class="data-table-column-menu">
                <summary class="ghost-btn small">
                  <IconSvg name="columns" />列
                  <span v-if="activeVehicleTab === '车辆管理'">{{ visibleVehicleListDetailColumns.length }}/{{ vehicleListDetailColumns.length }}</span>
                  <span v-else>{{ visibleDriverListDetailColumns.length }}/{{ driverListDetailColumns.length }}</span>
                </summary>
                <div v-if="activeVehicleTab === '车辆管理'" class="data-table-column-popover finance-wage-detail-column-popover">
                  <label v-for="column in vehicleListDetailColumns" :key="column.key" :class="{ disabled: column.locked }">
                    <input
                      type="checkbox"
                      :checked="dataTableColumnVisible(vehicleListDetailColumnVisibility, column.key)"
                      :disabled="column.locked"
                      @change="setDataTableColumnVisible('vehicle_list_detail', vehicleListDetailColumnVisibility, column, $event.target.checked)"
                    />
                    <span>{{ column.label }}</span>
                    <button class="icon-btn icon-only" type="button" title="上移" :disabled="column.locked" @click.prevent="moveDataTableColumnByOffset(vehicleListDetailColumns, 'vehicle_list_detail', column, -1)"><IconSvg name="chevronUp" /></button>
                    <button class="icon-btn icon-only" type="button" title="下移" :disabled="column.locked" @click.prevent="moveDataTableColumnByOffset(vehicleListDetailColumns, 'vehicle_list_detail', column, 1)"><IconSvg name="chevronDown" /></button>
                  </label>
                </div>
                <div v-else class="data-table-column-popover finance-wage-detail-column-popover">
                  <label v-for="column in driverListDetailColumns" :key="column.key" :class="{ disabled: column.locked }">
                    <input
                      type="checkbox"
                      :checked="dataTableColumnVisible(driverListDetailColumnVisibility, column.key)"
                      :disabled="column.locked"
                      @change="setDataTableColumnVisible('driver_list_detail', driverListDetailColumnVisibility, column, $event.target.checked)"
                    />
                    <span>{{ column.label }}</span>
                    <button class="icon-btn icon-only" type="button" title="上移" :disabled="column.locked" @click.prevent="moveDataTableColumnByOffset(driverListDetailColumns, 'driver_list_detail', column, -1)"><IconSvg name="chevronUp" /></button>
                    <button class="icon-btn icon-only" type="button" title="下移" :disabled="column.locked" @click.prevent="moveDataTableColumnByOffset(driverListDetailColumns, 'driver_list_detail', column, 1)"><IconSvg name="chevronDown" /></button>
                  </label>
                </div>
              </details>
              <button
                class="ghost-btn small"
                type="button"
                @click="activeVehicleTab === '车辆管理' ? resetDataTableColumnOrder(vehicleListDetailColumns, 'vehicle_list_detail') : resetDataTableColumnOrder(driverListDetailColumns, 'driver_list_detail')"
              ><IconSvg name="list" />恢复列序</button>
              <button
                class="ghost-btn small"
                type="button"
                @click="activeVehicleTab === '车辆管理' ? resetDataTableColumnWidths('vehicle_list_detail', vehicleListDetailColumns, vehicleListDetailColumnWidths) : resetDataTableColumnWidths('driver_list_detail', driverListDetailColumns, driverListDetailColumnWidths)"
              ><IconSvg name="refresh" />恢复列宽</button>
              <button class="ghost-btn small" type="button" @click="exportVehicleDriver"><IconSvg name="download" />导出</button>
              <button type="button" class="icon-btn" @click="closeVehicleDriverListDetail"><IconSvg name="close" />关闭</button>
            </div>
          </div>
          <div class="modal-body full-detail-body">
            <div class="nested-table-scroll order-list-detail-scroll">
              <table v-if="activeVehicleTab === '车辆管理'" class="data-table compact order-list-detail-table">
                <colgroup>
                  <col v-for="column in visibleVehicleListDetailColumns" :key="column.key" :style="dataTableColumnStyle(vehicleListDetailColumnWidths, column.key)" />
                </colgroup>
                <thead>
                  <tr>
                    <th v-for="column in visibleVehicleListDetailColumns" :key="column.key" class="resizable-th">
                      <span>{{ column.label }}</span>
                      <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startDataTableColumnResize('vehicle_list_detail', vehicleListDetailColumnWidths, column, $event)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in vehicleDriverListDetailRows" :key="item.plate" @dblclick="selectedVehiclePlate = item.plate; closeVehicleDriverListDetail()">
                    <td v-for="column in visibleVehicleListDetailColumns" :key="column.key" :class="{ 'row-actions': column.key === 'actions' }">
                      <template v-if="column.key === 'actions'">
                        <button class="icon-btn" type="button" @click="selectedVehiclePlate = item.plate; closeVehicleDriverListDetail()"><IconSvg name="eye" />查看</button>
                        <button class="icon-btn" type="button" @click="openVehicleModal(item)"><IconSvg name="edit" />编辑</button>
                      </template>
                      <template v-else>{{ vehicleListDetailCellText(item, column.key) }}</template>
                    </td>
                  </tr>
                  <tr v-if="vehicleDriverListDetailRows.length === 0"><td :colspan="visibleVehicleListDetailColumns.length">暂无车辆</td></tr>
                </tbody>
              </table>
              <table v-else class="data-table compact order-list-detail-table">
                <colgroup>
                  <col v-for="column in visibleDriverListDetailColumns" :key="column.key" :style="dataTableColumnStyle(driverListDetailColumnWidths, column.key)" />
                </colgroup>
                <thead>
                  <tr>
                    <th v-for="column in visibleDriverListDetailColumns" :key="column.key" class="resizable-th">
                      <span>{{ column.label }}</span>
                      <span class="column-resize-handle" title="拖动调整列宽" @click.stop @pointerdown="startDataTableColumnResize('driver_list_detail', driverListDetailColumnWidths, column, $event)"></span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in vehicleDriverListDetailRows" :key="item.id" @dblclick="selectedDriverId = item.id; closeVehicleDriverListDetail()">
                    <td v-for="column in visibleDriverListDetailColumns" :key="column.key" :class="{ 'row-actions': column.key === 'actions' }">
                      <template v-if="column.key === 'actions'">
                        <button class="icon-btn" type="button" @click="selectedDriverId = item.id; closeVehicleDriverListDetail()"><IconSvg name="eye" />查看</button>
                        <button class="icon-btn" type="button" @click="openDriverModal(item)"><IconSvg name="edit" />编辑</button>
                      </template>
                      <template v-else>{{ driverListDetailCellText(item, column.key) }}</template>
                    </td>
                  </tr>
                  <tr v-if="vehicleDriverListDetailRows.length === 0"><td :colspan="visibleDriverListDetailColumns.length">暂无司机</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div v-if="activeDispatchDetail" class="modal-backdrop full-detail-backdrop" @click.self="closeDispatchDetail">
        <section class="modal-card full-detail-modal">
          <div class="modal-head">
            <div>
              <h2>{{ activeDispatchDetail.dispatchNo || '-' }} · 排车明细</h2>
              <p class="modal-subtitle">{{ activeDispatchDetail.order.customer || activeDispatchDetail.customer || '-' }} · {{ activeDispatchDetail.order.date || activeDispatchDetail.date || dispatchDate }} · {{ activeDispatchDetail.status || '-' }}</p>
            </div>
            <div class="modal-detail-actions">
              <button class="ghost-btn small" type="button" @click="openEditDispatchPlanRow(activeDispatchDetail)"><IconSvg name="edit" />编辑</button>
              <button type="button" class="icon-btn" @click="closeDispatchDetail"><IconSvg name="close" />关闭</button>
            </div>
          </div>
          <div class="modal-body full-detail-body">
            <div class="detail-section-grid">
              <section class="detail-section">
                <h3>排车信息</h3>
                <dl class="detail-dl">
                  <dt>排车单号</dt><dd>{{ activeDispatchDetail.dispatchNo || '-' }}</dd>
                  <dt>订单号</dt><dd>{{ activeDispatchDetail.order.no || activeDispatchDetail.orderNo || '-' }}</dd>
                  <dt>装车日期</dt><dd>{{ activeDispatchDetail.order.date || activeDispatchDetail.date || dispatchDate }}</dd>
                  <dt>装车时间</dt><dd>{{ activeDispatchDetail.loadTime || '-' }}</dd>
                  <dt>排车状态</dt><dd>{{ activeDispatchDetail.status || '-' }}</dd>
                  <dt>备注</dt><dd>{{ activeDispatchDetail.note || '-' }}</dd>
                </dl>
              </section>
              <section class="detail-section">
                <h3>车辆司机</h3>
                <dl class="detail-dl">
                  <dt>车辆来源</dt><dd>{{ dispatchVehicleSourceText(activeDispatchDetail) }}</dd>
                  <dt>车牌</dt><dd>{{ activeDispatchDetail.plate || '-' }}</dd>
                  <dt>司机</dt><dd>{{ activeDispatchDetail.driver || '-' }}</dd>
                  <dt>运输模式</dt><dd>{{ normalizeTransportMode(activeDispatchDetail.transportMode || activeDispatchDetail.order.transportMode || '') || '-' }}</dd>
                  <dt>香港司机</dt><dd>{{ activeDispatchDetail.hkDriver || activeDispatchDetail.driver || activeDispatchDetail.order.hkDriver || activeDispatchDetail.order.driver || '-' }}</dd>
                  <dt>大陆骑师</dt><dd>{{ activeDispatchDetail.mainlandDriver || activeDispatchDetail.order.mainlandDriver || '-' }}</dd>
                  <dt>外派供应商</dt><dd>{{ activeDispatchDetail.supplier || activeDispatchDetail.order.supplier || '-' }}</dd>
                </dl>
              </section>
              <section class="detail-section detail-section-wide">
                <h3>运输订单</h3>
                <dl class="detail-dl detail-dl-wide">
                  <dt>客户</dt><dd>{{ activeDispatchDetail.order.customer || activeDispatchDetail.customer || '-' }}</dd>
                  <dt>口岸/方向</dt><dd>{{ [activeDispatchDetail.order.port, activeDispatchDetail.order.direction].filter(Boolean).join(' / ') || '-' }}</dd>
                  <dt>吨位/件数/重量</dt><dd>{{ [activeDispatchDetail.order.tonnage, activeDispatchDetail.order.quantity, activeDispatchDetail.order.weight].filter(Boolean).join(' / ') || '-' }}</dd>
                  <dt>装卸路线</dt><dd>{{ dispatchOrderRouteText(activeDispatchDetail.order) }}</dd>
                </dl>
              </section>
            </div>
            <section class="detail-section">
              <h3>订单费用</h3>
              <div class="table-wrap detail-table-wrap">
                <table class="data-table compact">
                  <thead><tr><th>序号</th><th>项目</th><th>数量</th><th>金额</th><th>归属司机</th><th>备注</th></tr></thead>
                  <tbody>
                    <tr v-for="(fee, index) in orderDetailFeeRows(activeDispatchDetail.order)" :key="`${fee.name}-${index}`">
                      <td>{{ index + 1 }}</td>
                      <td>{{ fee.name || '-' }}</td>
                      <td>{{ Number(fee.quantity || 0) || '-' }}</td>
                      <td>{{ currencyCodeDisplay(fee.currency || '港币') }} {{ money(fee.amount) }}</td>
                      <td>{{ fee.driverName || FEE_DRIVER_ROLE_LABELS[fee.driverRole] || '-' }}</td>
                      <td>{{ fee.remark || '-' }}</td>
                    </tr>
                    <tr v-if="orderDetailFeeRows(activeDispatchDetail.order).length === 0"><td colspan="6">暂无费用明细</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </div>

      <div v-if="templateModalOpen" class="modal-backdrop">
        <form class="modal-card template-edit-modal" @submit.prevent="saveTemplate">
          <div class="modal-head">
            <h2>{{ templateForm.id ? '编辑模板' : '新增模板' }}</h2>
            <button type="button" class="icon-btn" @click="closeTemplateEditor"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body template-designer-body">
            <div v-if="templateEditorLoading" class="template-loading-banner">
              正在加载模板内容，请稍候...
            </div>
            <div class="template-designer-toolbar">
              <label>模板名称
                <input v-model.trim="templateForm.name" placeholder="请输入模板名称" required />
              </label>
              <label>纸张方向
                <select v-model="templateDesigner.orientation">
                  <option value="portrait">A4 竖向</option>
                  <option value="landscape">A4 横向</option>
                  <option value="fluid">不限制宽度</option>
                </select>
              </label>
              <label class="template-description-field">用途说明
                <input v-model.trim="templateForm.description" placeholder="例如：订单导出、运输明细、客户对账" />
              </label>
            </div>

            <div class="template-designer-layout">
              <div class="template-page-wrap">
                <div class="template-preview-tools">
                  <div v-if="templateTextToolbarOpen && activeTemplateTextItem" class="template-inline-text-toolbar">
                    <strong>文本工具</strong>
                    <span class="template-inline-target">文本框</span>
                    <label>字体
                      <select v-model="activeTemplateTextItem.fontFamily">
                        <option v-for="font in FONT_PRESETS" :key="font.value" :value="font.value">{{ font.label }}</option>
                      </select>
                    </label>
                    <label>字号
                      <input v-model.number="activeTemplateTextItem.fontSize" type="number" min="8" max="32" />
                    </label>
                    <label>宽度
                      <input v-model.number="activeTemplateTextItem.width" type="number" min="80" max="520" />
                    </label>
                    <label>颜色
                      <input v-model="activeTemplateTextItem.color" type="color" />
                    </label>
                    <label class="template-toolbar-toggle">
                      <input v-model="activeTemplateTextItem.bold" type="checkbox" />
                      加粗
                    </label>
                    <div class="template-align-tools" aria-label="文本对齐">
                      <button
                        v-for="alignOption in [
                          { value: 'left', icon: 'alignLeft', label: '左对齐' },
                          { value: 'center', icon: 'alignCenter', label: '居中' },
                          { value: 'right', icon: 'alignRight', label: '右对齐' }
                        ]"
                        :key="alignOption.value"
                        type="button"
                        :class="['icon-btn icon-only', { active: activeTemplateTextItem.align === alignOption.value }]"
                        :title="alignOption.label"
                        :aria-label="alignOption.label"
                        @click="activeTemplateTextItem.align = alignOption.value"
                      >
                        <IconSvg :name="alignOption.icon" />
                      </button>
                    </div>
                  </div>
                  <div v-else-if="templateTableToolbarOpen" class="template-inline-text-toolbar template-inline-table-toolbar">
                    <strong>表格工具</strong>
                    <span class="template-inline-target">{{ templateTableSelectionLabel() }}</span>
                    <label>字体
                      <select v-model="templateDesigner.tableFontFamily">
                        <option v-for="font in FONT_PRESETS" :key="font.value" :value="font.value">{{ font.label }}</option>
                      </select>
                    </label>
                    <label>字号
                      <input v-model.number="templateDesigner.tableFontSize" type="number" min="5" max="22" @input="updateTemplateTableFontSize" />
                    </label>
                    <label>明细文字
                      <input v-model="templateDesigner.tableTextColor" type="color" />
                    </label>
                    <label>表头文字
                      <input v-model="templateDesigner.tableHeaderTextColor" type="color" />
                    </label>
                    <label>表头底色
                      <input v-model="templateDesigner.tableHeaderBgColor" type="color" />
                    </label>
                    <label>边框
                      <input v-model="templateDesigner.tableBorderColor" type="color" />
                    </label>
                    <label>线宽
                      <input v-model.number="templateDesigner.tableBorderWidth" type="number" min="0" max="6" step="0.5" />
                    </label>
                    <label class="template-toolbar-toggle">
                      <input v-model="templateDesigner.tableHeaderBold" type="checkbox" />
                      表头加粗
                    </label>
                    <label class="template-toolbar-toggle">
                      <input v-model="templateDesigner.tableBold" type="checkbox" />
                      明细加粗
                    </label>
                    <div class="template-align-tools" aria-label="表格对齐">
                      <button
                        v-for="alignOption in [
                          { value: 'left', icon: 'alignLeft', label: '左对齐' },
                          { value: 'center', icon: 'alignCenter', label: '居中' },
                          { value: 'right', icon: 'alignRight', label: '右对齐' }
                        ]"
                        :key="alignOption.value"
                        type="button"
                        :class="['icon-btn icon-only', { active: templateDesigner.tableAlign === alignOption.value }]"
                        :title="alignOption.label"
                        :aria-label="alignOption.label"
                        @click="templateDesigner.tableAlign = alignOption.value"
                      >
                        <IconSvg :name="alignOption.icon" />
                      </button>
                    </div>
                  </div>
                  <div class="template-zoom-tools">
                    <button type="button" class="ghost-btn small" @click="setTemplatePreviewZoom('fit')">适应</button>
                    <button type="button" class="ghost-btn small" @click="setTemplatePreviewZoom(100)">100%</button>
                    <button type="button" class="icon-btn icon-only" title="缩小" aria-label="缩小" @click="adjustTemplatePreviewZoom(-10)"><IconSvg name="minus" /></button>
                    <span class="template-zoom-status">{{ templateDesigner.previewZoom === 'fit' ? '适应窗口' : `${templateDesigner.previewZoom}%` }}</span>
                    <button type="button" class="icon-btn icon-only" title="放大" aria-label="放大" @click="adjustTemplatePreviewZoom(10)"><IconSvg name="plus" /></button>
                  </div>
                </div>
                <div class="template-preview-viewport" :style="templatePreviewViewportStyle">
                  <div class="template-preview-canvas">
                    <div :class="['template-a4-page', templateDesigner.orientation]" :style="templatePreviewStyle" @pointerdown="hideTemplateTextToolbar">
                  <section
                    class="template-page-header"
                    :style="{
                      height: `${templateDesigner.headerHeight}px`,
                      fontFamily: fontPresetStack(templateDesigner.headerFontFamily),
                      fontSize: `${templateDesigner.headerFontSize}px`
                    }"
                  >
                    <div
                      v-if="templateDesigner.logo"
                      class="template-page-logo-frame"
                      :style="{
                        width: `${templateDesigner.logoWidth}px`,
                        height: `${templateDesigner.logoHeight}px`,
                        left: `${templateDesigner.logoX}px`,
                        top: `${templateDesigner.logoY}px`
                      }"
                      @pointerdown.prevent.stop="startTemplateHeaderDrag($event, 'logo')"
                      @pointermove.prevent.stop="moveTemplateHeaderItem"
                      @pointerup.prevent.stop="stopTemplateHeaderDrag"
                      @pointercancel.prevent.stop="stopTemplateHeaderDrag"
                    >
                      <img
                        :src="templateDesigner.logo"
                        :alt="templateDesigner.logoName || 'logo'"
                        class="template-page-logo"
                        :style="{ objectFit: templateDesigner.logoFit === 'cover' ? 'cover' : 'contain' }"
                      />
                    </div>
                  </section>
                  <section class="template-page-table" @pointerdown.stop="showTemplateTableToolbar">
                    <table
                      :style="{
                        fontFamily: fontPresetStack(templateDesigner.tableFontFamily),
                        fontSize: `${templateDesigner.tableFontSize}px`,
                        color: templateDesigner.tableTextColor,
                        fontWeight: templateDesigner.tableBold ? 700 : 400,
                        textAlign: templateDesigner.tableAlign,
                        '--template-table-border-color': templateDesigner.tableBorderColor,
                        '--template-table-border-width': `${templateDesigner.tableBorderWidth}px`,
                        '--template-table-header-bg': templateDesigner.tableHeaderBgColor,
                        '--template-table-header-color': templateDesigner.tableHeaderTextColor,
                        ...templatePreviewTableStyle
                      }"
                    >
                      <colgroup>
                        <col v-for="column in templateDesignerColumns" :key="`col-${column.key}`" :style="{ width: `${column.width}px` }" />
                      </colgroup>
                      <thead>
                        <tr @click.stop="selectTemplateTableRow('header')">
                          <th
                            v-for="column in templateDesignerColumns"
                            :key="column.key"
                            :class="templateHeaderCellClass(column)"
                            :style="templateColumnHeaderStyle(column)"
                          >
                            <span class="template-table-header-label">{{ templateColumnBaseLabel(column) }}</span>
                            <span v-if="templateColumnCurrencyLabel(column)" class="template-table-header-currency">{{ templateColumnCurrencyLabel(column) }}</span>
                            <span
                              class="template-column-resize-handle"
                              title="拖动调整列宽"
                              @pointerdown.prevent.stop="startTemplateColumnResize($event, column)"
                              @mousedown.prevent.stop="startTemplateColumnResize($event, column)"
                            ></span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="(row, rowIndex) in templatePreviewRows"
                          :key="row.no || `preview-row-${rowIndex}`"
                          :class="{ 'template-total-row': row.__total }"
                          @click.stop="selectTemplateTableRow(row.__total ? 'total' : 'body', rowIndex)"
                        >
                          <td
                            v-for="column in templateDesignerColumns"
                            :key="`${row.no || rowIndex}-${column.key}`"
                            :class="templateBodyCellClass(column, row, rowIndex)"
                            :style="templateColumnCellStyle(column, row)"
                          >{{ templatePreviewCellValue(row, column, rowIndex) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </section>
                  <section
                    class="template-page-footer"
                    :style="{
                      height: `${templateDesigner.footerHeight}px`,
                      fontFamily: fontPresetStack(templateDesigner.footerFontFamily),
                      fontSize: `${templateDesigner.footerFontSize}px`
                    }"
                  >
                  </section>
                  <div class="template-free-text-layer" aria-label="文本框图层">
                    <div
                      v-for="entry in templatePageTextEntries"
                      :key="entry.key"
                      :data-template-text-key="entry.key"
                      :class="[
                        'template-free-text-box',
                        {
                          'is-active': activeTemplateVariableTarget.type === entry.type && activeTemplateVariableTarget.id === entry.item.id,
                          'is-editing': isTemplateTextEditing(entry.type, entry.item.id)
                        }
                      ]"
                      :style="templateTextItemStyle(entry)"
                      @pointerdown.prevent.stop="startTemplateHeaderDrag($event, `${entry.type}-text:${entry.item.id}`)"
                      @pointermove.prevent.stop="moveTemplateHeaderItem"
                      @pointerup.prevent.stop="stopTemplateHeaderDrag"
                      @pointercancel.prevent.stop="stopTemplateHeaderDrag"
                      @dblclick.stop="editTemplateTextBox(entry.type, entry.item.id)"
                    >
                      <textarea
                        v-if="isTemplateTextEditing(entry.type, entry.item.id)"
                        class="template-free-text-editor"
                        :value="entry.item.text"
                        @input="updateTemplateTextItem(entry.type, entry.item.id, $event.target.value)"
                        @pointerdown.stop
                        @dblclick.stop
                        @blur="finishTemplateTextEdit"
                        @keydown.esc.prevent="finishTemplateTextEdit"
                      ></textarea>
                      <pre v-else>{{ entry.item.text }}</pre>
                      <button
                        class="template-free-text-delete"
                        type="button"
                        title="删除文本框"
                        aria-label="删除文本框"
                        @pointerdown.stop
                        @click.stop="removeTemplateTextBox(entry.type, entry.item.id)"
                      >×</button>
                      <span
                        class="template-text-resize-handle"
                        title="拖动调整文本框大小"
                        @pointerdown.prevent.stop="startTemplateTextResize($event, entry.type, entry.item.id)"
                        @pointermove.prevent.stop="moveTemplateTextResize"
                        @pointerup.prevent.stop="stopTemplateTextResize"
                        @pointercancel.prevent.stop="stopTemplateTextResize"
                      ></span>
                    </div>
                  </div>
	                  </div>
	                </div>
	              </div>
	            </div>

	            <aside class="template-property-panel">
                <section class="template-panel-section">
                  <div class="template-logo-tools">
                    <strong>Logo</strong>
                    <label class="ghost-btn small template-logo-upload">
                      <IconSvg name="upload" />上传
                      <input type="file" accept="image/*" @change="uploadTemplateLogo" />
                    </label>
                    <button v-if="templateDesigner.logo" class="ghost-btn small danger" type="button" @click="clearTemplateLogo">
                      <IconSvg name="trash" />移除
                    </button>
                    <span v-if="templateDesigner.logoName" class="template-logo-name">{{ templateDesigner.logoName }}</span>
                  </div>
                  <label v-if="templateDesigner.logo">Logo 宽度
                    <input v-model.number="templateDesigner.logoWidth" type="range" min="48" max="180" />
                  </label>
                  <label v-if="templateDesigner.logo">Logo 高度
                    <input v-model.number="templateDesigner.logoHeight" type="range" min="28" max="120" />
                  </label>
                  <label v-if="templateDesigner.logo">裁切方式
                    <select v-model="templateDesigner.logoFit">
                      <option value="contain">完整显示</option>
                      <option value="cover">填满裁切</option>
                    </select>
                  </label>
                  <span v-if="templateDesigner.logo" class="template-logo-hint">可拖动 Logo 裁切框位置，填满裁切会隐藏超出部分</span>
                </section>
                <div class="template-variable-panel">
                  <div class="template-column-head">
                    <strong>变量</strong>
                    <span>插入到文本框</span>
                  </div>
                  <div v-for="group in TEMPLATE_VARIABLES" :key="group.group" class="template-variable-group">
                    <span>{{ group.group }}</span>
                    <button
                      v-for="item in group.items"
                      :key="item.value"
                      class="template-variable-chip"
                      type="button"
                      :title="item.value"
                      @click="insertTemplateVariable(item.value)"
                    >
                      {{ item.label }}
                    </button>
                  </div>
                </div>
                <section class="template-panel-section template-textbox-panel">
                  <button class="primary-btn small template-add-textbox-btn" type="button" @click="addFreeTemplateTextBox">
                    <IconSvg name="plus" />
                    添加文本框
                  </button>
                </section>
                <div class="template-column-editor">
                  <div class="template-column-head">
                    <strong>表格明细列</strong>
                    <div class="template-column-actions">
                      <button class="ghost-btn small" type="button" @click="setAllTemplateColumnsVisible(true)">全选</button>
                      <button class="ghost-btn small" type="button" @click="setAllTemplateColumnsVisible(false)">取消</button>
                      <button class="ghost-btn small" type="button" @click="addTemplateColumn"><IconSvg name="plus" />字段</button>
                    </div>
                  </div>
                  <div class="template-order-field-palette" aria-label="可添加的订单字段">
                    <span>订单字段</span>
                    <button
                      v-for="field in TEMPLATE_ORDER_BASE_COLUMNS"
                      :key="field.key"
                      type="button"
                      @click="addTemplateOrderColumn(field)"
                    >
                      {{ field.label }}
                    </button>
                  </div>
                  <div class="template-column-list">
	                    <div
                        v-for="(column, index) in templateDesigner.columns"
                        :key="column.key"
                        :class="['template-column-row', { 'is-editing': activeTemplateColumnKey === column.key }]"
                        @click="toggleTemplateColumnSelection(column)"
                      >
	                      <div class="template-column-main">
	                        <input v-model="column.visible" type="checkbox" :aria-label="`${column.label}是否显示`" @click.stop />
                          <input
                            class="template-column-order"
                            type="number"
                            min="1"
                            step="1"
                            :value="getTemplateColumnOrder(column, index)"
                            title="输入任意正整数调整列位置，数字越大越靠后"
                            aria-label="输入序号调整列位置"
                            @click.stop
                            @keydown.enter.prevent.stop="moveTemplateColumnTo(index, $event.target.value)"
                            @change.stop="moveTemplateColumnTo(index, $event.target.value)"
                          />
	                        <input v-if="activeTemplateColumnKey === column.key" v-model.trim="column.label" class="template-column-name" @click.stop />
                          <button v-else class="template-column-display" type="button">{{ column.label }}</button>
	                        <button class="icon-btn icon-only move-up" type="button" title="上移" aria-label="上移" @click.stop="moveTemplateColumn(index, -1)"><IconSvg name="chevronUp" /></button>
	                        <button class="icon-btn icon-only" type="button" title="下移" aria-label="下移" @click.stop="moveTemplateColumn(index, 1)"><IconSvg name="chevronDown" /></button>
                          <button
                            v-if="activeTemplateColumnKey === column.key"
                            class="icon-btn icon-only template-column-collapse"
                            type="button"
                            title="收起编辑"
                            aria-label="收起编辑"
                            @click.stop="activeTemplateColumnKey = ''"
                          >
                            <IconSvg name="chevronDown" />
                          </button>
	                      </div>
	                      <div v-if="activeTemplateColumnKey === column.key" class="template-column-controls">
	                        <label>字号<input v-model.number="column.fontSize" class="template-column-size" type="number" min="5" max="22" title="字段字号" /></label>
	                        <label>宽度<input v-model.number="column.width" class="template-column-width" type="number" min="36" max="260" step="1" title="字段宽度" /></label>
	                        <label>表头底色<input class="template-column-color" type="color" :value="column.headerBgColor || templateDesigner.tableHeaderBgColor" title="表头底色" @input="column.headerBgColor = $event.target.value" /></label>
	                        <label>表头文字<input class="template-column-color" type="color" :value="column.headerTextColor || templateDesigner.tableHeaderTextColor" title="表头文字颜色" @input="column.headerTextColor = $event.target.value" /></label>
	                        <label>内容底色<input class="template-column-color" type="color" :value="column.bodyBgColor || '#ffffff'" title="内容底色" @input="column.bodyBgColor = $event.target.value" /></label>
	                        <label>内容文字<input class="template-column-color" type="color" :value="column.bodyTextColor || templateDesigner.tableTextColor" title="内容文字颜色" @input="column.bodyTextColor = $event.target.value" /></label>
	                        <label>
                            对齐
                            <select v-model="column.align" title="列对齐方式">
                              <option value="">跟随表格</option>
                              <option value="left">左对齐</option>
                              <option value="center">居中</option>
                              <option value="right">右对齐</option>
                            </select>
                          </label>
                          <label>
                            表头粗细
                            <select v-model="column.headerBold" title="单列表头字体粗细">
                              <option value="">跟随表头</option>
                              <option :value="true">加粗</option>
                              <option :value="false">常规</option>
                            </select>
                          </label>
                          <label class="template-column-check"><input v-model="column.bold" type="checkbox" />明细加粗</label>
                          <div class="template-column-style-actions">
                            <button class="ghost-btn small" type="button" @click.stop="resetTemplateColumnStyle(column)">清样式</button>
	                          <button class="icon-btn icon-only danger" type="button" title="删除" aria-label="删除" @click.stop="removeTemplateColumn(index)"><IconSvg name="trash" /></button>
                          </div>
	                      </div>
                    </div>
                  </div>
                </div>
            </aside>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" @click="closeTemplateEditor">取消</button>
            <button class="primary-btn" type="submit" :disabled="templateEditorLoading"><IconSvg name="save" />保存模板</button>
          </div>
        </form>
      </div>

      <div v-if="customerModalOpen" class="modal-backdrop">
        <form class="modal-card compact-modal customer-edit-modal" @submit.prevent="saveCustomer">
          <div class="modal-head">
            <h2>
              {{ editingCustomerId ? '编辑资料' : `新增${customerForm.type}资料` }}
              <span class="order-title-meta">{{ customerModalTitleId }}</span>
            </h2>
            <button type="button" class="icon-btn" @click="customerModalOpen = false"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body">
            <div class="customer-modal-tabs">
              <div class="detail-tab-list">
                <button type="button" class="tab-btn active">客户资料</button>
              </div>
            </div>
            <div class="form-grid customer-form-grid">
              <label class="span-2">公司名称<input v-model.trim="customerForm.name" placeholder="请输入公司名称" /></label>
              <label class="span-2">税号<input v-model.trim="customerForm.invoiceTax" placeholder="纳税人识别号" /></label>
              <label>开户行<input v-model.trim="customerForm.invoiceBank" placeholder="开户银行" /></label>
              <label>银行账号<input v-model.trim="customerForm.invoiceAccount" placeholder="银行账号" /></label>
              <label class="span-2">地址<input v-model.trim="customerForm.address" placeholder="公司详细地址" /></label>
              <label>电话<input v-model.trim="customerForm.invoiceAddressPhone" placeholder="开票电话 / 联系电话" /></label>
              <label>省份
                <select v-model="customerForm.province" @change="handleCustomerProvinceChange">
                  <option value=""></option>
                  <option v-for="province in provinceOptions" :key="province" :value="province">{{ province }}</option>
                </select>
              </label>
              <label>城市
                <select v-model="customerForm.city">
                  <option value=""></option>
                  <option v-for="city in availableCustomerCities" :key="city" :value="city">{{ city }}</option>
                </select>
              </label>
              <label>账期
                <select v-model="customerForm.term">
                  <option value=""></option>
                  <option>现结</option>
                  <option>月结30天</option>
                  <option>月结45天</option>
                  <option>月结60天</option>
                </select>
              </label>
              <label v-if="customerForm.type === '客户'">结算币种
                <select v-model="customerForm.settlementCurrency">
                  <option>人民币结算</option>
                  <option>港币结算</option>
                </select>
              </label>
              <label class="span-6">复制文本识别
                <textarea
                  v-model.trim="customerForm.invoicePasteText"
                  rows="4"
                  placeholder="粘贴开票资料文本，例如：公司名称、税号、开户行、账号、地址电话"
                  @input="applyCustomerInvoicePaste"
                  @paste="setTimeout(applyCustomerInvoicePaste, 0)"
                ></textarea>
              </label>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" @click="customerModalOpen = false">取消</button>
            <button class="primary-btn" :disabled="loading"><IconSvg name="save" />保存资料</button>
          </div>
        </form>
      </div>

      <div v-if="contactModalOpen" class="modal-backdrop">
        <form class="modal-card compact-modal" @submit.prevent="saveContact">
          <div class="modal-head">
            <h2>{{ editingContactId ? '编辑联系人' : '新建联系人' }}</h2>
            <button type="button" class="icon-btn" @click="contactModalOpen = false"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body">
            <div class="form-grid customer-form-grid">
              <label>姓名<input v-model.trim="contactForm.name" placeholder="联系人姓名" /></label>
              <label>性别<select v-model="contactForm.gender"><option value=""></option><option>男</option><option>女</option></select></label>
              <label>职位<input v-model.trim="contactForm.title" placeholder="职位" /></label>
              <label>手机<input v-model.trim="contactForm.mobile" placeholder="手机" /></label>
              <label>电话<input v-model.trim="contactForm.phone" placeholder="电话" /></label>
              <label>片区<input v-model.trim="contactForm.area" placeholder="片区" /></label>
              <label>详细地址<input v-model.trim="contactForm.address" placeholder="详细地址" /></label>
              <label>传真<input v-model.trim="contactForm.fax" placeholder="传真" /></label>
              <label>邮箱<input v-model.trim="contactForm.email" placeholder="邮箱" /></label>
              <label>微信<input v-model.trim="contactForm.wechat" placeholder="微信" /></label>
              <label>QQ<input v-model.trim="contactForm.qq" placeholder="QQ" /></label>
              <label class="span-3">备注<input v-model.trim="contactForm.remark" placeholder="备注" /></label>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" @click="contactModalOpen = false">取消</button>
            <button class="primary-btn" type="submit"><IconSvg name="save" />保存联系人</button>
          </div>
        </form>
      </div>

      <div v-if="dispatchModalOpen" class="modal-backdrop">
        <form class="modal-card compact-modal dispatch-edit-modal" @click="dispatchCustomerPickerOpen = false" @submit.prevent="saveManualDispatchPlanRow">
          <div class="modal-head">
            <h2>{{ editingDispatchRowId ? '编辑排车单' : copyingDispatchRowId ? '复制排车单' : '新建排车单' }} <span class="order-title-meta">排车单号：{{ dispatchModalNo }}</span></h2>
            <button type="button" class="icon-btn" @click="closeDispatchModal"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body">
            <datalist id="dispatchPlateOptions">
              <option v-for="vehicle in vehicleRows" :key="vehicle.plate" :value="vehicle.plate">{{ vehicle.type }}</option>
            </datalist>
            <div class="dispatch-date-picker-row">
              <label>排车日期<input v-model="dispatchForm.date" type="date" /></label>
            </div>
            <div class="form-grid dispatch-form-grid">
              <label>经营单位
                <span class="searchable-select dispatch-searchable-select" @click.stop>
                  <input
                    v-model.trim="dispatchCustomerKeyword"
                    placeholder="搜索客户编号 / 名称 / 联系人"
                    @focus="dispatchCustomerPickerOpen = true"
                    @input="dispatchForm.customer = dispatchCustomerKeyword; dispatchForm.customerId = ''; dispatchCustomerPickerOpen = true"
                  />
                  <div v-if="dispatchCustomerPickerOpen" class="searchable-select-dropdown dispatch-customer-dropdown">
                    <button
                      v-for="customer in dispatchCustomerOptions"
                      :key="customer.id"
                      type="button"
                      :class="{ active: customer.name === dispatchForm.customer }"
                      @click="selectDispatchCustomer(customer)"
                    >
                      <strong>{{ customer.name }}</strong>
                      <span>{{ customer.type }} · {{ customer.id }}</span>
                    </button>
                    <p v-if="dispatchCustomerOptions.length === 0">没有匹配经营单位</p>
                  </div>
                </span>
              </label>
              <label>车辆来源<select v-model="dispatchForm.vehicleSource" @change="handleDispatchVehicleSourceChange"><option value=""></option><option>本公司车辆</option><option>外派车辆</option></select></label>
              <label v-if="dispatchForm.vehicleSource === '本公司车辆'">车牌
                <select v-model="dispatchForm.plate">
                  <option value=""></option>
                  <option v-for="vehicle in vehicleRows" :key="vehicle.plate" :value="vehicle.plate">
                    {{ vehicle.plate }} · {{ vehicle.type || vehicle.model || vehicle.brand || '车辆' }}
                  </option>
                </select>
              </label>
              <label v-else>车牌<input v-model.trim="dispatchForm.plate" placeholder="外派车牌/待定" /></label>
              <label>口岸<select v-model="dispatchForm.port"><option value=""></option><option>深圳湾海关</option><option>莲塘海关</option><option>文锦渡海关</option><option>大桥海关</option></select></label>
              <label>进出口<select v-model="dispatchForm.direction"><option value=""></option><option>出口</option><option>进口</option></select></label>
              <label>吨位<select v-model="dispatchForm.tonnage"><option value=""></option><option>3T</option><option>5T</option><option>8T</option><option>10T</option><option>12T</option><option>20尺柜</option><option>40尺柜</option></select></label>
              <label>件数/板数<input v-model.trim="dispatchForm.quantity" placeholder="例如：20件 / 4板" /></label>
              <label>重量<input v-model.trim="dispatchForm.weight" placeholder="例如：1200kg" /></label>
              <label>装车时间
                <select v-model="dispatchForm.loadTime" @change="handleDispatchFormLoadTimeChange">
                  <option value="">未定</option>
                  <option v-for="time in DISPATCH_LOAD_TIME_OPTIONS" :key="time" :value="time">{{ time }}</option>
                </select>
              </label>
              <label v-if="dispatchForm.vehicleSource === '外派车辆'">外派供应商<select v-model="dispatchForm.supplier"><option value=""></option><option v-for="customer in customerRows.filter((item) => item.type === '供应商')" :key="customer.id" :value="customer.name">{{ customer.name }}</option></select></label>
              <label class="span-2">装货地
                <span class="location-input-row dispatch-location-row" @click.stop>
                  <input v-model.trim="dispatchForm.loading" placeholder="例如：深圳 / 南山区" />
                  <button class="table-op icon-only address-book-trigger" type="button" title="地址本列表" aria-label="地址本列表" @click.stop="openDispatchLocationPicker('loading')"><IconSvg name="contacts" /></button>
                </span>
              </label>
              <label class="span-2">卸货地
                <span class="location-input-row dispatch-location-row" @click.stop>
                  <input v-model.trim="dispatchForm.unloading" placeholder="例如：香港 / 沙田区" />
                  <button class="table-op icon-only address-book-trigger" type="button" title="地址本列表" aria-label="地址本列表" @click.stop="openDispatchLocationPicker('unloading')"><IconSvg name="contacts" /></button>
                </span>
              </label>
              <label class="span-2">备注<input v-model.trim="dispatchForm.note" placeholder="备注" /></label>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" @click="closeDispatchModal">取消</button>
            <button class="primary-btn" type="submit"><IconSvg name="save" />保存排车单</button>
          </div>
        </form>
        <div v-if="locationPicker.open && locationPicker.owner === 'dispatch'" class="modal-backdrop nested-modal-backdrop" @click.self="closeLocationPicker" @click.stop>
          <section class="modal-card compact-modal address-picker-modal">
            <div class="modal-head">
              <div>
                <p class="eyebrow">客户联系人</p>
                <h2>{{ locationPickerTitle }}</h2>
              </div>
              <button type="button" class="icon-btn" @click="closeLocationPicker"><IconSvg name="close" />关闭</button>
            </div>
            <div class="modal-body address-picker-body is-address-book">
              <div class="address-book-manager">
                <div class="address-book-toolbar">
                  <label>搜索地址
                    <input v-model.trim="locationPicker.keyword" placeholder="联系人 / 电话 / 详细地址 / 备注" />
                  </label>
                  <span>已选 {{ selectedAddressBookIds.length }} 项</span>
                  <button class="ghost-btn small" type="button" @click="toggleAllAddressBookSelection(!allVisibleAddressBookSelected)">
                    {{ allVisibleAddressBookSelected ? '取消全选' : '全选' }}
                  </button>
                  <button class="ghost-btn danger small" type="button" @click="deleteSelectedAddressBookEntries"><IconSvg name="trash" />批量删除</button>
                  <button class="primary-btn small" type="button" @click="startNewAddressBookEntry"><IconSvg name="plus" />新建地址</button>
                </div>
                <div v-if="addressBookFormOpen" class="address-book-form">
                  <label>片区
                    <span class="address-book-area-tree route-tree-wrap" @click.stop>
                      <button :class="['route-tree-trigger', { 'is-empty': !addressBookForm.area, active: addressBookAreaTree.open }]" type="button" @click="toggleAddressBookAreaTree">
                        <span>{{ addressBookForm.area || '点击选择片区' }}</span>
                        <IconSvg name="chevronDown" />
                      </button>
                      <div v-if="addressBookAreaTree.open" class="route-tree-dropdown address-book-area-dropdown">
                        <div class="route-tree-panel">
                          <div class="route-tree-list">
                            <template v-for="level1 in addressBookAreaLevel1Options" :key="level1">
                              <button class="route-tree-node" :class="{ checked: addressBookAreaTree.level1 === level1 }" type="button" @click="selectAddressBookAreaLevel(1, level1)">
                                <span class="tree-check" :class="{ checked: addressBookAreaTree.level1 === level1 }"><IconSvg v-if="addressBookAreaTree.level1 === level1" name="check" /></span>
                                <span>{{ level1 }}</span>
                              </button>
                              <div v-if="addressBookAreaTree.level1 === level1" class="route-tree-children">
                                <button v-for="level2 in addressBookAreaLevel2Options" :key="level2" class="route-tree-node level-2" :class="{ checked: addressBookAreaTree.level2 === level2 }" type="button" @click="selectAddressBookAreaLevel(2, level2)">
                                  <span class="tree-check" :class="{ checked: addressBookAreaTree.level2 === level2 }"><IconSvg v-if="addressBookAreaTree.level2 === level2" name="check" /></span>
                                  <span>{{ level2 }}</span>
                                </button>
                                <div v-if="addressBookAreaTree.level2" class="route-tree-children">
                                  <button v-for="level3 in addressBookAreaLevel3Options" :key="level3" class="route-tree-node level-3" :class="{ checked: addressBookAreaTree.level3 === level3 }" type="button" @click="selectAddressBookAreaLevel(3, level3)">
                                    <span class="tree-check" :class="{ checked: addressBookAreaTree.level3 === level3 }"><IconSvg v-if="addressBookAreaTree.level3 === level3" name="check" /></span>
                                    <span>{{ level3 }}</span>
                                  </button>
                                </div>
                              </div>
                            </template>
                            <p v-if="addressBookAreaLevel1Options.length === 0" class="route-tree-empty">暂无运费模板目录</p>
                          </div>
                          <div class="route-tree-actions">
                            <span>{{ addressBookAreaTreeValue || '未选择' }}</span>
                            <button class="primary-btn route-tree-confirm" type="button" @click="confirmAddressBookAreaSelection">确认选择</button>
                          </div>
                        </div>
                      </div>
                    </span>
                  </label>
                  <label>联系人<input v-model.trim="addressBookForm.contact" placeholder="联系人" /></label>
                  <label>电话<input v-model.trim="addressBookForm.phone" placeholder="电话 / 手机" /></label>
                  <label>详细地址<input v-model.trim="addressBookForm.address" placeholder="详细地址" /></label>
                  <label>备注<input v-model.trim="addressBookForm.note" placeholder="楼栋、门牌、仓库名" /></label>
                  <button class="primary-btn" type="button" @click="saveAddressBookEntry"><IconSvg name="save" />{{ editingAddressBookId ? '保存修改' : '保存到联系人' }}</button>
                  <button class="ghost-btn" type="button" @click="resetAddressBookForm">清空</button>
                </div>
              </div>
              <div class="table-wrap address-picker-table-wrap">
                <table class="data-table compact">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          class="table-check"
                          :checked="allVisibleAddressBookSelected"
                          @change="toggleAllAddressBookSelection($event.target.checked)"
                        />
                      </th>
                      <th>片区</th>
                      <th>联系人</th>
                      <th>电话</th>
                      <th>详细地址</th>
                      <th>备注</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="option in addressBookListOptions" :key="option.key" @dblclick="applyAddressBookEntry(option)">
                      <td>
                        <input
                          v-if="option.source === '联系人'"
                          type="checkbox"
                          class="table-check"
                          :checked="selectedAddressBookIds.includes(option.id)"
                          @click.stop
                          @change="toggleAddressBookSelection(option.id, $event.target.checked)"
                        />
                      </td>
                      <td>{{ option.area || '-' }}</td>
                      <td>{{ option.contact || '-' }}</td>
                      <td>{{ option.phone || '-' }}</td>
                      <td class="address-picker-value">{{ option.address || option.value }}</td>
                      <td>{{ option.note || '-' }}</td>
                      <td class="row-actions">
                        <button class="icon-btn icon-only" type="button" title="使用地址" aria-label="使用地址" @click="applyAddressBookEntry(option)"><IconSvg name="check" /></button>
                        <button v-if="option.source === '联系人'" class="icon-btn icon-only" type="button" title="编辑地址" aria-label="编辑地址" @click="editAddressBookEntry(option)"><IconSvg name="edit" /></button>
                        <button v-if="option.source === '联系人'" class="icon-btn icon-only danger" type="button" title="删除地址" aria-label="删除地址" @click="deleteAddressBookEntry(option.id)"><IconSvg name="trash" /></button>
                      </td>
                    </tr>
                    <tr v-if="addressBookListOptions.length === 0">
                      <td colspan="7">暂无地址，请先选择经营单位，或在上方新建地址。</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="address-picker-hint">地址来自当前经营单位的联系人；新建地址会同步到该客户联系人资料。双击或点勾选图标可使用地址。</p>
            </div>
          </section>
        </div>
      </div>

      <div v-if="dispatchDuplicateModalOpen" class="modal-backdrop">
        <section class="modal-card compact-modal dispatch-copy-modal">
          <div class="modal-head">
            <h2>复制排车单 <span class="order-title-meta">已选 {{ dispatchDuplicateDraftRows.length }} 单</span></h2>
            <button type="button" class="icon-btn" @click="closeDispatchDuplicateModal"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body">
            <datalist id="dispatchDuplicatePlateOptions">
              <option v-for="vehicle in vehicleRows" :key="vehicle.plate" :value="vehicle.plate">{{ vehicle.type || vehicle.model || vehicle.brand || '车辆' }}</option>
            </datalist>
            <p class="modal-helper-text">请先核对复制内容，点击保存后才会生成新的排车单和待确认订单。</p>
            <div class="table-wrap dispatch-copy-table-wrap">
              <table class="data-table compact">
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>原排车单</th>
                    <th>经营单位</th>
                    <th>车牌</th>
                    <th>装车时间</th>
                    <th>口岸</th>
                    <th>吨位</th>
                    <th>件数/板数</th>
                    <th>装卸</th>
                    <th>排车状态</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, index) in dispatchDuplicateDraftRows" :key="row.id">
                    <td>{{ index + 1 }}</td>
                    <td>
                      <strong>{{ row.sourceDispatchNo || '-' }}</strong>
                      <small>{{ row.sourceOrderNo || '-' }}</small>
                    </td>
                    <td>{{ row.customer || '-' }}</td>
                    <td><input v-model.trim="row.plate" list="dispatchDuplicatePlateOptions" placeholder="车牌" /></td>
                    <td>
                      <select v-model="row.loadTime" @change="handleDispatchDuplicateLoadTimeChange(row)">
                        <option value="">未定</option>
                        <option v-for="time in DISPATCH_LOAD_TIME_OPTIONS" :key="time" :value="time">{{ time }}</option>
                      </select>
                    </td>
                    <td>{{ row.port || '-' }}</td>
                    <td>{{ row.tonnage || '-' }}</td>
                    <td>{{ row.quantity || '-' }}</td>
                    <td>{{ dispatchOrderRouteText(row) }}</td>
                    <td>
                      <select v-model="row.status" :class="['dispatch-status-select', dispatchStatusClass(row.status)]">
                        <option v-for="status in dispatchStatusOptionsForRow(row)" :key="status" :value="status">{{ status }}</option>
                      </select>
                    </td>
                    <td><input v-model.trim="row.note" placeholder="备注" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" @click="closeDispatchDuplicateModal">取消</button>
            <button type="button" class="primary-btn" :disabled="loading || !dispatchDuplicateDraftRows.length" @click="saveDuplicateDispatchRows"><IconSvg name="save" />保存复制</button>
          </div>
        </section>
      </div>

      <OrderModal
        :open="orderModalOpen"
        :editing="Boolean(editingOrderNo)"
        :customer="orderForm.customer"
        :order-no="orderModalTitleNo"
        :loading="loading"
        @close="orderModalOpen = false"
        @submit="saveOrder"
        @panel-click="dispatchMessageOpen = false; loadFeeTemplateMenuOpen = false; closeRouteTreeDropdown(); orderCustomerPickerOpen = false"
      >
          <div class="modal-body">
            <div class="form-grid order-compact-grid order-layout-grid">
              <label class="order-compact-field hidden-order-customer">经营单位
                <span class="searchable-select" @click.stop>
                  <input
                    v-model.trim="orderCustomerKeyword"
                    placeholder="输入经营单位 / 编号搜索"
                    @focus="openOrderCustomerPicker"
                    @input="orderCustomerPickerOpen = true"
                  />
                  <div v-if="orderCustomerPickerOpen" class="searchable-select-dropdown">
                    <button
                      v-for="customer in orderCustomerOptions"
                      :key="customer.id"
                      type="button"
                      :class="{ active: customer.id === orderForm.customerId }"
                      @click="selectOrderCustomer(customer)"
                    >
                      <strong>{{ customer.name }}</strong>
                      <span>{{ customer.id }}</span>
                    </button>
                    <p v-if="orderCustomerOptions.length === 0">没有匹配经营单位</p>
                  </div>
                </span>
              </label>
              <label class="order-compact-field">排车单号<input v-model.trim="orderForm.dispatchNo" placeholder="例如：PC20260001" /></label>
              <label class="order-compact-field">业务类型<select v-model="orderForm.businessType" @change="handleOrderBusinessTypeChange"><option value=""></option><option>运输</option><option>报关</option><option>运输+报关</option></select></label>
              <label class="order-compact-field">口岸<select v-model="orderForm.port"><option value=""></option><option>深圳湾海关</option><option>莲塘海关</option><option>文锦渡海关</option><option>大桥海关</option></select></label>
              <label class="order-compact-field">进出口<select v-model="orderForm.direction" @change="handleOrderDirectionChange"><option value=""></option><option>出口</option><option>进口</option></select></label>
              <label v-if="orderHasTransportFields" class="order-compact-field">吨位<select v-model="orderForm.tonnage" @change="scheduleAutoFreightSync"><option value=""></option><option>3T</option><option>5T</option><option>8T</option><option>10T</option><option>12T</option><option>20尺柜</option><option>40尺柜</option></select></label>
              <label class="order-compact-field">币种<select v-model="orderForm.currency" @change="scheduleAutoFreightSync"><option value=""></option><option value="港币">HKD</option><option value="人民币">RMB</option></select></label>
              <label class="order-compact-field">件数/板数<input v-model.trim="orderForm.quantity" inputmode="text" placeholder="例如：20件 / 4板" @input="scheduleAutoFreightSync" /></label>
              <label v-if="orderHasTransportFields" class="order-compact-field">重量<input v-model.trim="orderForm.weight" placeholder="例如：1200kg" /></label>
              <label v-if="orderHasCustomsFields" class="order-compact-field">报关单号<input v-model.trim="orderForm.customsNo" placeholder="报关单号" /></label>
              <label v-if="orderHasCustomsFields" class="order-compact-field">消费使用单位<input v-model.trim="orderForm.customsUnit" placeholder="消费使用单位" /></label>
              <label v-if="orderHasCustomsFields" class="order-compact-field">品名项数<input v-model.number="orderForm.customsItemCount" type="number" min="0" placeholder="例如：5" /></label>
              <label v-if="orderHasCustomsFields" class="order-compact-field">续页数量<input v-model.number="orderForm.customsPageCount" type="number" min="0" placeholder="例如：1" /></label>
              <label v-if="orderHasTransportFields" class="order-compact-field">车辆来源<select v-model="orderForm.vehicleSource" @change="handleOrderVehicleSourceChange"><option value=""></option><option>本公司车辆</option><option>外派车辆</option></select></label>
              <label v-if="orderHasTransportFields && orderUsesOwnVehicle" class="order-compact-field">车牌
                <select v-model="orderForm.plate">
                  <option value=""></option>
                  <option v-for="vehicle in vehicleRows" :key="vehicle.plate" :value="vehicle.plate">{{ vehicle.plate }}</option>
                </select>
              </label>
              <label v-if="orderHasTransportFields && orderUsesOwnVehicle" class="order-compact-field">运输模式
                <select v-model="orderForm.transportMode" @change="handleOrderTransportModeChange">
                  <option value=""></option>
                  <option v-for="mode in TRANSPORT_MODE_OPTIONS" :key="mode">{{ mode }}</option>
                </select>
              </label>
              <label v-if="orderHasTransportFields && orderUsesOwnVehicle && !orderUsesRelayDrivers" class="order-compact-field">香港司机
                <select v-model="orderForm.driver">
                  <option value=""></option>
                  <option v-for="driver in hongKongDriverOptions.length ? hongKongDriverOptions : driverRows" :key="driver.id" :value="driver.name">{{ driver.name }}</option>
                </select>
              </label>
              <label v-if="orderHasTransportFields && orderUsesRelayDrivers" class="order-compact-field">香港司机
                <select v-model="orderForm.hkDriver">
                  <option value=""></option>
                  <option v-for="driver in hongKongDriverOptions.length ? hongKongDriverOptions : driverRows" :key="driver.id" :value="driver.name">{{ driver.name }}</option>
                </select>
              </label>
              <label v-if="orderHasTransportFields && orderUsesRelayDrivers && !orderUsesDomesticTransfer" class="order-compact-field">大陆骑师
                <select v-model="orderForm.mainlandDriver">
                  <option value=""></option>
                  <option v-for="driver in mainlandDriverOptions.length ? mainlandDriverOptions : driverRows" :key="driver.id" :value="driver.name">{{ driver.name }}</option>
                </select>
              </label>
              <label v-if="orderHasTransportFields && orderUsesDomesticTransfer" class="order-compact-field">国内车牌号
                <input v-model.trim="orderForm.mainlandDriver" placeholder="例如：粤B12345" />
              </label>
              <label v-if="orderHasTransportFields && orderUsesOutsourcedVehicle" class="order-compact-field">外派供应商<select v-model="orderForm.supplier"><option value=""></option><option v-for="customer in customerRows.filter((item) => item.type === '供应商')" :key="customer.id" :value="customer.name">{{ customer.name }}</option></select></label>
              <label v-if="orderHasTransportFields" class="order-compact-field order-location-field order-location-wide">装货地
                <span class="location-input-row route-tree-wrap" @click.stop>
                  <button :class="['route-tree-trigger', { 'is-empty': !orderForm.loading, active: routeTreeDropdown.open && routeTreeDropdown.target === 'loading' }]" type="button" title="选择运费模板片区" @click="toggleRouteTreeDropdown('loading')">
                    <span>{{ orderForm.loading || '点击选择片区' }}</span>
                    <IconSvg name="chevronDown" />
                  </button>
                  <button class="table-op icon-only address-book-trigger" type="button" title="地址本列表" aria-label="地址本列表" @click.stop="closeRouteTreeDropdown(); openLocationPicker('loading', 'addressBook')"><IconSvg name="contacts" /></button>
                  <div v-if="routeTreeDropdown.open && routeTreeDropdown.target === 'loading'" class="route-tree-dropdown">
                    <div class="route-tree-panel">
                      <div class="route-tree-list">
                        <template v-for="level1 in routeTreeLevel1Options" :key="level1">
                          <button class="route-tree-node" :class="{ checked: routeTreeDropdown.level1 === level1 }" type="button" @click="selectRouteTreeLevel(1, level1)">
                            <span class="tree-check" :class="{ checked: routeTreeDropdown.level1 === level1 }"><IconSvg v-if="routeTreeDropdown.level1 === level1" name="check" /></span>
                            <span>{{ level1 }}</span>
                          </button>
                          <div v-if="routeTreeDropdown.level1 === level1" class="route-tree-children">
                            <button v-for="level2 in routeTreeLevel2Options" :key="level2" class="route-tree-node level-2" :class="{ checked: routeTreeDropdown.level2 === level2 }" type="button" @click="selectRouteTreeLevel(2, level2)">
                              <span class="tree-check" :class="{ checked: routeTreeDropdown.level2 === level2 }"><IconSvg v-if="routeTreeDropdown.level2 === level2" name="check" /></span>
                              <span>{{ level2 }}</span>
                            </button>
                            <div v-if="routeTreeDropdown.level2" class="route-tree-children">
                              <button v-for="level3 in routeTreeLevel3Options" :key="level3" class="route-tree-node level-3" :class="{ checked: routeTreeDropdown.level3 === level3 }" type="button" @click="selectRouteTreeLevel(3, level3)">
                                <span class="tree-check" :class="{ checked: routeTreeDropdown.level3 === level3 }"><IconSvg v-if="routeTreeDropdown.level3 === level3" name="check" /></span>
                                <span>{{ level3 }}</span>
                              </button>
                            </div>
                          </div>
                        </template>
                        <p v-if="routeTreeLevel1Options.length === 0" class="route-tree-empty">{{ routeTreeEmptyText }}</p>
                      </div>
                      <div class="route-tree-actions">
                        <span>{{ routeTreeValue || '未选择' }}</span>
                        <button class="primary-btn route-tree-confirm" type="button" @click="confirmRouteTreeSelection">确认选择</button>
                      </div>
                    </div>
                  </div>
                </span>
              </label>
              <label v-if="orderHasTransportFields" class="order-compact-field order-location-field order-location-wide">卸货地
                <span class="location-input-row route-tree-wrap" @click.stop>
                  <button :class="['route-tree-trigger', { 'is-empty': !orderForm.unloading, active: routeTreeDropdown.open && routeTreeDropdown.target === 'unloading' }]" type="button" title="选择运费模板片区" @click="toggleRouteTreeDropdown('unloading')">
                    <span>{{ orderForm.unloading || '点击选择片区' }}</span>
                    <IconSvg name="chevronDown" />
                  </button>
                  <button class="table-op icon-only address-book-trigger" type="button" title="地址本列表" aria-label="地址本列表" @click.stop="closeRouteTreeDropdown(); openLocationPicker('unloading', 'addressBook')"><IconSvg name="contacts" /></button>
                  <div v-if="routeTreeDropdown.open && routeTreeDropdown.target === 'unloading'" class="route-tree-dropdown">
                    <div class="route-tree-panel">
                      <div class="route-tree-list">
                        <template v-for="level1 in routeTreeLevel1Options" :key="level1">
                          <button class="route-tree-node" :class="{ checked: routeTreeDropdown.level1 === level1 }" type="button" @click="selectRouteTreeLevel(1, level1)">
                            <span class="tree-check" :class="{ checked: routeTreeDropdown.level1 === level1 }"><IconSvg v-if="routeTreeDropdown.level1 === level1" name="check" /></span>
                            <span>{{ level1 }}</span>
                          </button>
                          <div v-if="routeTreeDropdown.level1 === level1" class="route-tree-children">
                            <button v-for="level2 in routeTreeLevel2Options" :key="level2" class="route-tree-node level-2" :class="{ checked: routeTreeDropdown.level2 === level2 }" type="button" @click="selectRouteTreeLevel(2, level2)">
                              <span class="tree-check" :class="{ checked: routeTreeDropdown.level2 === level2 }"><IconSvg v-if="routeTreeDropdown.level2 === level2" name="check" /></span>
                              <span>{{ level2 }}</span>
                            </button>
                            <div v-if="routeTreeDropdown.level2" class="route-tree-children">
                              <button v-for="level3 in routeTreeLevel3Options" :key="level3" class="route-tree-node level-3" :class="{ checked: routeTreeDropdown.level3 === level3 }" type="button" @click="selectRouteTreeLevel(3, level3)">
                                <span class="tree-check" :class="{ checked: routeTreeDropdown.level3 === level3 }"><IconSvg v-if="routeTreeDropdown.level3 === level3" name="check" /></span>
                                <span>{{ level3 }}</span>
                              </button>
                            </div>
                          </div>
                        </template>
                        <p v-if="routeTreeLevel1Options.length === 0" class="route-tree-empty">{{ routeTreeEmptyText }}</p>
                      </div>
                      <div class="route-tree-actions">
                        <span>{{ routeTreeValue || '未选择' }}</span>
                        <button class="primary-btn route-tree-confirm" type="button" @click="confirmRouteTreeSelection">确认选择</button>
                      </div>
                    </div>
                  </div>
                </span>
              </label>
              <label class="order-compact-field">订单日期<input v-model="orderForm.date" type="date" /></label>
              <label class="order-compact-field">状态<select v-model="orderForm.status"><option v-for="status in ORDER_STATUS_OPTIONS" :key="status">{{ status }}</option></select></label>
              <label class="order-compact-field order-compact-field-wide">备注<input v-model.trim="orderForm.remark" placeholder="订单备注" /></label>
              <div v-if="orderHasTransportFields" class="order-toggle-input">
                <label class="order-switch-field"><input v-model="orderForm.tripNoEnabled" type="checkbox" /><span>车次号</span></label>
                <input v-if="orderForm.tripNoEnabled" v-model.trim="orderForm.tripNo" placeholder="请输入车次号" />
              </div>
              <div v-if="orderHasTransportFields" class="order-toggle-input">
                <label class="order-switch-field"><input v-model="orderForm.sixSheetEnabled" type="checkbox" /><span>六联单号</span></label>
                <input v-if="orderForm.sixSheetEnabled" v-model.trim="orderForm.sixSheetNo" placeholder="请输入六联单号" />
              </div>
            </div>

            <div class="detail-tab-head order-detail-head">
              <div class="detail-tab-list">
                <button class="tab-btn" :class="{ active: activeOrderDetailTab === '收费项目' }" type="button" @click="activeOrderDetailTab = '收费项目'">收费项目</button>
                <button class="tab-btn" :class="{ active: activeOrderDetailTab === '订单附件' }" type="button" @click="activeOrderDetailTab = '订单附件'; loadOrderFiles().catch((error) => notify(error.message))">订单附件</button>
              </div>
              <div v-if="orderAttachmentUploadStatus" class="upload-status-pill" :class="`is-${orderAttachmentUploadTone}`" aria-live="polite">
                <span class="upload-status-dot" aria-hidden="true"></span>
                <span>{{ orderAttachmentUploadStatus }}</span>
              </div>
              <div class="modal-detail-actions">
                <div v-if="orderHasTransportFields" class="dispatch-popover-wrap" @click.stop>
                  <button class="ghost-btn" type="button" @click="dispatchMessageOpen = !dispatchMessageOpen"><IconSvg name="sparkles" />生成派车信息</button>
                  <div v-if="dispatchMessageOpen" class="dispatch-popover">
                    <div class="popover-head">
                      <strong>派车信息</strong>
                      <button class="ghost-btn small" type="button" @click="copyDispatchMessage"><IconSvg name="copy" />复制</button>
                    </div>
                    <textarea :value="dispatchMessage" readonly rows="9" />
                  </div>
                </div>
                <div class="template-load-wrap" @click.stop>
                  <span class="template-load-split">
                    <button class="ghost-btn" type="button" @click="loadLatestOrderTemplate">
                      <IconSvg name="refresh" />载入模板
                    </button>
                    <button class="ghost-btn template-load-arrow" type="button" title="选择模板" aria-label="选择模板" @click="loadFeeTemplateMenuOpen = !loadFeeTemplateMenuOpen">
                      <IconSvg name="chevronDown" />
                    </button>
                  </span>
                  <div v-if="loadFeeTemplateMenuOpen" class="template-load-menu">
                    <button class="template-load-option template-load-last" type="button" @click="loadLatestOrderTemplate">
                      <span class="template-load-row-icon"><IconSvg name="refresh" /></span>
                      <span class="template-load-text">
                        <strong>载入最后一个订单模板</strong>
                        <span>{{ latestOrderTemplateSource ? `${latestOrderTemplateSource.no} · ${latestOrderTemplateSource.date || '-'}` : '暂无可载入订单' }}</span>
                      </span>
                    </button>
                    <div v-for="(item, index) in orderFreightTemplateOptions" :key="item.id" class="template-load-option-row">
                      <button class="template-load-option" type="button" @click="loadSavedFeeTemplate(item)">
                        <span class="template-load-row-index">{{ index + 1 }}</span>
                        <span class="template-load-text">
                          <strong>{{ item.name }}</strong>
                          <span>{{ item.description || '订单运费模板' }}</span>
                        </span>
                        <span class="template-load-date">{{ String(item.updatedAt || item.createdAt || '').slice(0, 10) || '-' }}</span>
                      </button>
                      <button class="icon-btn icon-only" type="button" title="编辑模板" aria-label="编辑模板" @click.stop="editSavedFeeTemplate(item)"><IconSvg name="edit" /></button>
                      <button class="icon-btn icon-only" type="button" title="删除模板" aria-label="删除模板" @click.stop="deleteSavedFeeTemplate(item)"><IconSvg name="trash" /></button>
                    </div>
                    <button class="template-load-option template-load-default" type="button" @click="loadFeeTemplate">
                      <span class="template-load-row-icon"><IconSvg name="sparkles" /></span>
                      <span class="template-load-text">
                        <strong>默认收费项目</strong>
                        <span>按当前运费模板和收费项目自动生成</span>
                      </span>
                    </button>
                    <p v-if="orderFreightTemplateOptions.length === 0" class="template-load-empty">暂无已保存模板</p>
                  </div>
                </div>
                <button v-if="orderHasTransportFields" class="ghost-btn" type="button" @click="openSaveFreightTemplateModal"><IconSvg name="save" />保存运费模板</button>
              </div>
            </div>

            <div v-if="activeOrderDetailTab === '收费项目'" class="fee-table-wrap">
              <table class="data-table compact invoice-fee-table">
                <thead>
                  <tr>
                    <th class="invoice-seq-col">序号</th>
                    <th class="invoice-name-col">项目名称</th>
                    <th class="invoice-category-col">类别</th>
	                    <th class="invoice-qty-col">数量</th>
	                    <th class="invoice-price-col">单价</th>
	                    <th class="invoice-amount-col">金额</th>
	                    <th class="invoice-driver-col">归属司机</th>
	                    <th class="invoice-remark-col">备注</th>
	                    <th class="invoice-actions-col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(fee, index) in orderFees" :key="index">
                    <td>{{ index + 1 }}</td>
	                    <td>
	                      <div class="fee-name-picker">
                        <select :value="fee.feeItemId || feeItemRows.find((item) => item.name === fee.name)?.id || ''" @change="fillFeeFromItem(fee, $event.target.value)">
	                          <option value="">请选择项目</option>
	                          <option v-for="item in sortedFeeItemRows" :key="item.id" :value="item.id">{{ item.name }}</option>
	                        </select>
	                        <button class="table-op icon-only" type="button" aria-label="设置收费项目" title="设置收费项目" @click.stop="openFeeItemManager(index)"><IconSvg name="edit" /></button>
                        <label
                          v-if="editingOrderNo && fee.name"
                          class="fee-row-upload"
                          :class="{ 'is-uploading': orderAttachmentUploading }"
                          title="上传此收费项目的单据"
                        >
                          <IconSvg name="paperclip" />
                          <input type="file" :accept="FILE_UPLOAD_ACCEPT" :disabled="orderAttachmentUploading" @change="uploadOrderFeeFile(fee, index, $event)" />
                        </label>
                        <button
                          v-else
                          class="fee-row-upload is-disabled"
                          type="button"
                          title="保存订单并选择收费项目后可上传"
                          @click="notify(!editingOrderNo ? '请先保存订单，再上传收费项目附件' : '请先选择收费项目，再上传附件')"
                        >
                          <IconSvg name="paperclip" />
                        </button>
	                      </div>
                      <div class="fee-row-attachments">
                        <span
                          v-for="file in feeAttachmentRows(fee, index)"
                          :key="file.id"
                          class="fee-row-file-chip"
                        >
                          {{ file.filename }}
                          <button type="button" title="预览" @click="openStoredFile(file, 'preview')"><IconSvg name="eye" /></button>
                          <button type="button" title="下载" @click="openStoredFile(file, 'download')"><IconSvg name="download" /></button>
                          <button type="button" title="删除" @click="deleteFile(file, orderAttachmentRows)"><IconSvg name="trash" /></button>
                        </span>
                      </div>
	                      <input v-model.trim="fee.name" type="hidden" />
	                    </td>
                    <td class="invoice-category-cell"><span class="fee-category-badge" :class="{ advance: feeCategoryLabel(fee) === '代垫' }">{{ feeCategoryLabel(fee) }}</span></td>
                    <td><input v-model.number="fee.quantity" type="number" min="0" @input="syncFeeAmountFromUnitPrice(fee)" /></td>
                    <td class="invoice-price-cell"><input v-model.number="fee.unitPrice" type="number" min="0" step="0.01" @input="syncFeeAmountFromUnitPrice(fee)" /></td>
	                    <td class="invoice-amount-cell">
	                      <label class="fee-money-input">
	                        <input v-model.trim="fee.amount" type="number" min="0" @input="markFeeAmountManual(fee)" />
	                        <select v-model="fee.currency"><option value=""></option><option value="港币">HKD</option><option value="人民币">RMB</option></select>
	                      </label>
	                    </td>
	                    <td>
	                      <div v-if="isAdvanceFee(fee)" class="fee-driver-cell">
	                        <select v-model="fee.driverRole">
	                          <option v-for="role in FEE_DRIVER_ROLE_OPTIONS" :key="role" :value="role">{{ FEE_DRIVER_ROLE_LABELS[role] }}</option>
	                        </select>
	                        <select v-if="fee.driverRole === '手动指定'" v-model="fee.driverName">
	                          <option value="">请选择</option>
	                          <option v-for="name in orderFeeDriverOptions()" :key="name" :value="name">{{ name }}</option>
	                        </select>
	                      </div>
	                      <span v-else class="muted-cell">-</span>
	                    </td>
	                    <td class="invoice-remark-cell"><input v-model.trim="fee.remark" placeholder="备注" /></td>
                    <td class="invoice-actions-cell">
                      <span class="op-group">
                        <button v-if="index === orderFees.length - 1" class="table-op icon-only" type="button" aria-label="新增行" @click="addFeeRow"><IconSvg name="plus" /></button>
                        <button v-if="orderFees.length > 1" class="table-op icon-only" type="button" aria-label="删除行" @click="removeFeeRow(index)"><IconSvg name="minus" /></button>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <OrderAttachmentPanel
              v-else
              :order-no="editingOrderNo"
              :files="orderAttachmentRows"
              :uploading="orderAttachmentUploading"
              :accept="FILE_UPLOAD_ACCEPT"
              :format-size="fileSizeText"
              @upload="uploadOrderFile"
              @disabled-upload="notify('请先保存订单，再上传附件')"
              @preview="openStoredFile($event, 'preview')"
              @download="openStoredFile($event, 'download')"
              @delete="deleteFile($event, orderAttachmentRows)"
              @recycle="openAttachmentRecycleBin"
            />

            <div class="order-modal-total">
              <strong>合计</strong>
              <span>港币 {{ Number(orderTotals.hkd || 0).toLocaleString() }} / 人民币 {{ Number(orderTotals.rmb || 0).toLocaleString() }}</span>
            </div>
          </div>

        <template #after>
        <div v-if="locationPicker.open" class="modal-backdrop nested-modal-backdrop" @click.self="closeLocationPicker" @click.stop>
          <section class="modal-card compact-modal address-picker-modal">
            <div class="modal-head">
              <div>
                <p class="eyebrow">{{ locationPicker.mode === 'addressBook' ? '客户联系人' : '运费模板一二三级目录' }}</p>
                <h2>{{ locationPickerTitle }}</h2>
              </div>
              <button type="button" class="icon-btn" @click="closeLocationPicker"><IconSvg name="close" />关闭</button>
            </div>
            <div class="modal-body address-picker-body" :class="{ 'is-address-book': locationPicker.mode === 'addressBook' }">
              <div v-if="locationPicker.mode === 'template'" class="template-location-picker">
                <label>一级目录
                  <select v-model="locationPicker.level1" @change="handleTemplateLocationLevelChange(1)">
                    <option value="">请选择一级目录</option>
                    <option v-for="item in templateLocationLevel1Options" :key="item" :value="item">{{ item }}</option>
                  </select>
                </label>
                <label>二级目录
                  <select v-model="locationPicker.level2" :disabled="!locationPicker.level1 || templateLocationLevel2Options.length === 0" @change="handleTemplateLocationLevelChange(2)">
                    <option value="">请选择二级目录</option>
                    <option v-for="item in templateLocationLevel2Options" :key="item" :value="item">{{ item }}</option>
                  </select>
                </label>
                <label>三级目录
                  <select v-model="locationPicker.level3" :disabled="!locationPicker.level2 || templateLocationLevel3Options.length === 0" @change="handleTemplateLocationLevelChange(3)">
                    <option value="">请选择三级目录</option>
                    <option v-for="item in templateLocationLevel3Options" :key="item" :value="item">{{ item }}</option>
                  </select>
                </label>
                <label class="template-location-detail">详细地址
                  <input v-model.trim="locationPicker.detail" placeholder="可选：楼栋、门牌、仓库名" @keyup.enter="applyTemplateLocationSelection" />
                </label>
                <button class="primary-btn" type="button" @click="applyTemplateLocationSelection">确定</button>
              </div>
              <div v-else class="address-book-manager">
                <div class="address-book-toolbar">
                  <label>搜索地址
                    <input v-model.trim="locationPicker.keyword" placeholder="联系人 / 电话 / 详细地址 / 备注" />
                  </label>
                  <span>已选 {{ selectedAddressBookIds.length }} 项</span>
                  <button class="ghost-btn small" type="button" @click="toggleAllAddressBookSelection(!allVisibleAddressBookSelected)">
                    {{ allVisibleAddressBookSelected ? '取消全选' : '全选' }}
                  </button>
                  <button class="ghost-btn danger small" type="button" @click="deleteSelectedAddressBookEntries"><IconSvg name="trash" />批量删除</button>
                  <button class="primary-btn small" type="button" @click="startNewAddressBookEntry"><IconSvg name="plus" />新建地址</button>
                </div>
                <div v-if="addressBookFormOpen" class="address-book-form">
                  <label>片区
                    <span class="address-book-area-tree route-tree-wrap" @click.stop>
                      <button :class="['route-tree-trigger', { 'is-empty': !addressBookForm.area, active: addressBookAreaTree.open }]" type="button" @click="toggleAddressBookAreaTree">
                        <span>{{ addressBookForm.area || '点击选择片区' }}</span>
                        <IconSvg name="chevronDown" />
                      </button>
                      <div v-if="addressBookAreaTree.open" class="route-tree-dropdown address-book-area-dropdown">
                        <div class="route-tree-panel">
                          <div class="route-tree-list">
                            <template v-for="level1 in addressBookAreaLevel1Options" :key="level1">
                              <button class="route-tree-node" :class="{ checked: addressBookAreaTree.level1 === level1 }" type="button" @click="selectAddressBookAreaLevel(1, level1)">
                                <span class="tree-check" :class="{ checked: addressBookAreaTree.level1 === level1 }"><IconSvg v-if="addressBookAreaTree.level1 === level1" name="check" /></span>
                                <span>{{ level1 }}</span>
                              </button>
                              <div v-if="addressBookAreaTree.level1 === level1" class="route-tree-children">
                                <button v-for="level2 in addressBookAreaLevel2Options" :key="level2" class="route-tree-node level-2" :class="{ checked: addressBookAreaTree.level2 === level2 }" type="button" @click="selectAddressBookAreaLevel(2, level2)">
                                  <span class="tree-check" :class="{ checked: addressBookAreaTree.level2 === level2 }"><IconSvg v-if="addressBookAreaTree.level2 === level2" name="check" /></span>
                                  <span>{{ level2 }}</span>
                                </button>
                                <div v-if="addressBookAreaTree.level2" class="route-tree-children">
                                  <button v-for="level3 in addressBookAreaLevel3Options" :key="level3" class="route-tree-node level-3" :class="{ checked: addressBookAreaTree.level3 === level3 }" type="button" @click="selectAddressBookAreaLevel(3, level3)">
                                    <span class="tree-check" :class="{ checked: addressBookAreaTree.level3 === level3 }"><IconSvg v-if="addressBookAreaTree.level3 === level3" name="check" /></span>
                                    <span>{{ level3 }}</span>
                                  </button>
                                </div>
                              </div>
                            </template>
                            <p v-if="addressBookAreaLevel1Options.length === 0" class="route-tree-empty">暂无运费模板目录</p>
                          </div>
                          <div class="route-tree-actions">
                            <span>{{ addressBookAreaTreeValue || '未选择' }}</span>
                            <button class="primary-btn route-tree-confirm" type="button" @click="confirmAddressBookAreaSelection">确认选择</button>
                          </div>
                        </div>
                      </div>
                    </span>
                  </label>
                  <label>联系人<input v-model.trim="addressBookForm.contact" placeholder="联系人" /></label>
                  <label>电话<input v-model.trim="addressBookForm.phone" placeholder="电话 / 手机" /></label>
                  <label>详细地址<input v-model.trim="addressBookForm.address" placeholder="详细地址" /></label>
                  <label>备注<input v-model.trim="addressBookForm.note" placeholder="楼栋、门牌、仓库名" /></label>
                  <button class="primary-btn" type="button" @click="saveAddressBookEntry"><IconSvg name="save" />{{ editingAddressBookId ? '保存修改' : '保存到联系人' }}</button>
                  <button class="ghost-btn" type="button" @click="resetAddressBookForm">清空</button>
                </div>
              </div>
              <div v-if="locationPicker.mode !== 'addressBook'" class="address-picker-current">
                <strong>{{ locationPicker.mode === 'addressBook' ? '客户联系人地址' : '片区来自运费模板目录' }}</strong>
                <span>当前条件：{{ orderForm.direction || "未选进出口" }} / {{ orderForm.tonnage || "未选吨位" }} / {{ orderForm.currency ? currencyCodeDisplay(orderForm.currency) : "未选币种" }}</span>
                <span>{{ locationPicker.mode === 'addressBook' ? '选择地址会写入装卸货地，联系人和电话会进入订单草稿。' : (templateLocationValue || '请先选择一级目录') }}</span>
              </div>
              <div v-if="locationPicker.mode === 'addressBook'" class="table-wrap address-picker-table-wrap">
                <table class="data-table compact">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          class="table-check"
                          :checked="allVisibleAddressBookSelected"
                          @change="toggleAllAddressBookSelection($event.target.checked)"
                        />
                      </th>
                      <th>片区</th>
                      <th>联系人</th>
                      <th>电话</th>
                      <th>详细地址</th>
                      <th>备注</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="option in addressBookListOptions" :key="option.key" @dblclick="applyAddressBookEntry(option)">
                      <td>
                        <input
                          v-if="option.source === '联系人'"
                          type="checkbox"
                          class="table-check"
                          :checked="selectedAddressBookIds.includes(option.id)"
                          @click.stop
                          @change="toggleAddressBookSelection(option.id, $event.target.checked)"
                        />
                      </td>
                      <td>{{ option.area || '-' }}</td>
                      <td>
                        {{ option.contact || '-' }}
                      </td>
                      <td>{{ option.phone || '-' }}</td>
                      <td class="address-picker-value">
                        {{ option.address || option.value }}
                      </td>
                      <td>{{ option.note || '-' }}</td>
                      <td class="row-actions">
                        <button class="icon-btn icon-only" type="button" title="使用地址" aria-label="使用地址" @click="applyAddressBookEntry(option)"><IconSvg name="check" /></button>
                        <button v-if="option.source === '联系人'" class="icon-btn icon-only" type="button" title="编辑地址" aria-label="编辑地址" @click="editAddressBookEntry(option)"><IconSvg name="edit" /></button>
                        <button v-if="option.source === '联系人'" class="icon-btn icon-only danger" type="button" title="删除地址" aria-label="删除地址" @click="deleteAddressBookEntry(option.id)"><IconSvg name="trash" /></button>
                        <button v-else class="icon-btn icon-only danger" type="button" title="删除历史地址" aria-label="删除历史地址" @click="hideHistoricalAddress(option)"><IconSvg name="trash" /></button>
                      </td>
                    </tr>
                    <tr v-if="addressBookListOptions.length === 0">
                      <td colspan="7">暂无地址，可在上方新建地址。</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p class="address-picker-hint">{{ locationPicker.mode === 'addressBook' ? '地址来自当前客户联系人；新建或编辑会同步到该客户的联系人资料。双击或点勾选图标可使用地址。' : '一级选中后会展开二级，二级选中后会展开三级；不需要细分时可只选一级或二级。' }}</p>
            </div>
          </section>
        </div>
        <div v-if="saveFreightTemplateModalOpen" class="modal-backdrop nested-modal-backdrop" @click.self="closeSaveFreightTemplateModal" @click.stop>
          <form class="modal-card compact-modal" @submit.prevent="saveCurrentFeesAsTemplate">
            <div class="modal-head">
              <div>
                <p class="eyebrow">运费模板</p>
                <h2>保存运费模板</h2>
              </div>
              <button type="button" class="icon-btn" @click="closeSaveFreightTemplateModal"><IconSvg name="close" />关闭</button>
            </div>
            <div class="modal-body">
              <div class="form-grid">
                <label class="span-4">模板名称
                  <input v-model.trim="freightTemplateNameForm.name" autofocus placeholder="例如：深圳南山区 3T 人民币" />
                </label>
              </div>
              <p class="muted">保存当前订单的口岸、进出口、吨位、币种、装卸货地和收费项目，后续可按模板名称管理和复用。</p>
            </div>
            <div class="modal-actions">
              <button type="button" class="ghost-btn" @click="closeSaveFreightTemplateModal">取消</button>
              <button class="primary-btn" type="submit"><IconSvg name="save" />保存模板</button>
            </div>
          </form>
        </div>
        </template>
      </OrderModal>

      <div v-if="feeItemManagerOpen" class="modal-backdrop nested-modal-backdrop" @click.self="closeFeeItemManager">
        <section class="modal-card compact-modal fee-item-manager-modal">
          <div class="modal-head">
            <div>
              <p class="eyebrow">收费项目</p>
              <h2>收费项目管理</h2>
            </div>
            <div class="modal-detail-actions">
              <button type="button" class="primary-btn small" @click="startNewFeeItem({ silent: true })"><IconSvg name="plus" />新增项目</button>
              <button type="button" class="icon-btn" @click="closeFeeItemManager"><IconSvg name="close" />关闭</button>
            </div>
          </div>
          <div class="modal-body fee-item-manager-body">
            <form v-if="feeItemFormOpen" class="freight-template-toolbar fee-item-toolbar" :class="{ 'is-editing-record': feeItemForm.id }" @submit.prevent="saveFeeItem">
              <label>类别<select v-model="feeItemForm.category"><option>正常</option><option>代垫</option></select></label>
              <label class="wide">项目名称<input ref="feeItemNameInput" v-model.trim="feeItemForm.name" placeholder="名称唯一，不可重复" /></label>
              <div class="fee-cost-source-field">
                <span>成本来源</span>
                <details class="fee-cost-source-select">
                  <summary>{{ feeItemCostSourceText(feeItemForm) }}</summary>
                  <div class="fee-cost-source-options">
                    <label v-for="source in FEE_ITEM_COST_SOURCE_OPTIONS" :key="source">
                      <input v-model="feeItemForm.costSources" type="checkbox" :value="source" @change="ensureFeeItemCostSources(feeItemForm)" />
                      <span>{{ source }}</span>
                    </label>
                  </div>
                </details>
              </div>
              <label>币种<select v-model="feeItemForm.currency"><option value="港币">HKD</option><option value="人民币">RMB</option></select></label>
              <label>默认金额<input v-model.number="feeItemForm.defaultAmount" type="number" min="0" /></label>
              <label>默认归属<select v-model="feeItemForm.defaultDriverRole"><option v-for="role in FEE_DRIVER_ROLE_OPTIONS" :key="role" :value="role">{{ FEE_DRIVER_ROLE_LABELS[role] }}</option></select></label>
              <button class="primary-btn small"><IconSvg name="save" />保存项目</button>
              <button class="ghost-btn small" type="button" @click="closeFeeItemForm">取消</button>
            </form>
            <div class="table-wrap fee-item-table-wrap modal-fee-item-table-wrap">
              <table class="fee-item-table">
                <thead>
                  <tr>
                    <th>序号</th>
                    <th>排序</th>
	                    <th>类别</th>
	                    <th>项目名称</th>
                      <th>成本来源</th>
		                    <th>币种</th>
		                    <th>默认金额</th>
		                    <th>默认归属</th>
	                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                  v-for="(item, index) in sortedFeeItemRows"
                  :key="item.id"
                  title="双击选择收费项目"
                  draggable="true"
                  :class="{ selected: selectedFeeItem?.id === item.id, 'is-dragging': draggedFeeItemId === item.id }"
                  @dragstart="startFeeItemDrag(item)"
                  @dragover.prevent
                  @drop.prevent="dropFeeItem(item)"
                  @dragend="endFeeItemDrag"
                  @click="selectFeeItem(item)"
                  @dblclick="chooseFeeItemForOrder(item)"
                >
                    <td class="sequence-cell">{{ index + 1 }}</td>
                    <td class="drag-handle-cell">
                      <button class="icon-btn icon-only fee-item-drag-handle" type="button" title="拖动排序" aria-label="拖动排序" @click.stop>
                        <IconSvg name="list" />
                      </button>
                    </td>
                    <td>
                      <select v-if="editingFeeItemRowId === item.id" v-model="feeItemRowDraft.category" class="table-inline-input">
                        <option>正常</option>
                        <option>代垫</option>
                      </select>
                      <template v-else>{{ item.category }}</template>
                    </td>
                    <td>
                      <input v-if="editingFeeItemRowId === item.id" v-model.trim="feeItemRowDraft.name" class="table-inline-input" />
                      <template v-else>{{ item.name }}</template>
                    </td>
                    <td>
                      <details v-if="editingFeeItemRowId === item.id" class="fee-cost-source-select compact" @click.stop @dblclick.stop>
                        <summary>{{ feeItemCostSourceText(feeItemRowDraft) }}</summary>
                        <div class="fee-cost-source-options">
                          <label v-for="source in FEE_ITEM_COST_SOURCE_OPTIONS" :key="source">
                            <input v-model="feeItemRowDraft.costSources" type="checkbox" :value="source" @change="ensureFeeItemCostSources(feeItemRowDraft)" />
                            <span>{{ source }}</span>
                          </label>
                        </div>
                      </details>
                      <template v-else>{{ feeItemCostSourceText(item) }}</template>
                    </td>
                    <td>
                      <select v-if="editingFeeItemRowId === item.id" v-model="feeItemRowDraft.currency" class="table-inline-input">
                        <option value="港币">HKD</option>
                        <option value="人民币">RMB</option>
                      </select>
                      <template v-else>{{ currencyCodeDisplay(item.currency) }}</template>
                    </td>
	                    <td>
	                      <input v-if="editingFeeItemRowId === item.id" v-model.number="feeItemRowDraft.defaultAmount" type="number" min="0" class="table-inline-input" />
	                      <template v-else>{{ Number(item.defaultAmount || 0).toLocaleString() }}</template>
	                    </td>
	                    <td>
	                      <select v-if="editingFeeItemRowId === item.id" v-model="feeItemRowDraft.defaultDriverRole" class="table-inline-input">
	                        <option v-for="role in FEE_DRIVER_ROLE_OPTIONS" :key="role" :value="role">{{ FEE_DRIVER_ROLE_LABELS[role] }}</option>
	                      </select>
	                      <template v-else>{{ FEE_DRIVER_ROLE_LABELS[item.defaultDriverRole || ''] }}</template>
	                    </td>
                    <td class="row-actions">
                      <template v-if="editingFeeItemRowId === item.id">
                        <button class="icon-btn icon-only" title="保存" aria-label="保存" @click.stop="saveFeeItemRow(item)"><IconSvg name="save" /></button>
                        <button class="icon-btn icon-only" title="取消" aria-label="取消" @click.stop="cancelFeeItemRowEdit"><IconSvg name="close" /></button>
                      </template>
                      <template v-else>
                        <button class="icon-btn icon-only" title="编辑" aria-label="编辑" @click.stop="startFeeItemRowEdit(item)"><IconSvg name="edit" /></button>
                        <button class="icon-btn icon-only danger" title="删除" aria-label="删除" @click.stop="deleteFeeItem(item)"><IconSvg name="trash" /></button>
                      </template>
                    </td>
                  </tr>
	                  <tr v-if="sortedFeeItemRows.length === 0">
		                    <td colspan="9" class="empty-action-cell">
                      <span>暂无收费项目</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      <div v-if="vehicleModalOpen" class="modal-backdrop">
        <form class="modal-card" @submit.prevent="saveVehicle">
          <div class="modal-head">
            <h2>{{ editingVehiclePlate ? '编辑车辆' : '新增车辆' }}</h2>
            <button type="button" class="icon-btn" @click="vehicleModalOpen = false"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <label>车牌<input v-model.trim="vehicleForm.plate" placeholder="粤Z1234港" /></label>
              <label>车辆品牌<input v-model.trim="vehicleForm.brand" /></label>
              <label>型号<input v-model.trim="vehicleForm.model" /></label>
              <label>车型<select v-model="vehicleForm.type"><option>3T</option><option>5T</option><option>8T</option><option>10T</option><option>12T</option><option>20尺柜</option><option>40尺柜</option></select></label>
              <label>购车日期<input v-model="vehicleForm.purchaseDate" type="date" /></label>
              <label>出厂日期<input v-model="vehicleForm.factoryDate" type="date" /></label>
              <label>大陆年审日期<input v-model="vehicleForm.mainlandReviewDate" type="date" /></label>
              <label>香港年审日期<input v-model="vehicleForm.hkReviewDate" type="date" /></label>
              <label>大陆保险到期<input v-model="vehicleForm.mainlandInsuranceDate" type="date" /></label>
              <label>香港保险到期<input v-model="vehicleForm.hkInsuranceDate" type="date" /></label>
              <label>保险到期提醒<input v-model.trim="vehicleForm.insuranceReminder" /></label>
              <label class="vehicle-insurance-upload">大陆保险单据
                <span class="vehicle-insurance-row">
                  <span class="file-upload-btn compact"><IconSvg name="paperclip" />上传<input type="file" :accept="FILE_UPLOAD_ACCEPT" @change="uploadVehicleInsuranceFile('大陆保险单据', $event)" /></span>
                  <span v-for="file in vehicleInsuranceFiles('大陆保险单据')" :key="file.id" class="fee-row-file-chip">
                    {{ file.filename }}
                    <button type="button" title="预览" @click="openStoredFile(file, 'preview')"><IconSvg name="eye" /></button>
                    <button type="button" title="删除" @click="deleteFile(file, vehicleFileRows)"><IconSvg name="trash" /></button>
                  </span>
                </span>
              </label>
              <label class="vehicle-insurance-upload">香港保险单据
                <span class="vehicle-insurance-row">
                  <span class="file-upload-btn compact"><IconSvg name="paperclip" />上传<input type="file" :accept="FILE_UPLOAD_ACCEPT" @change="uploadVehicleInsuranceFile('香港保险单据', $event)" /></span>
                  <span v-for="file in vehicleInsuranceFiles('香港保险单据')" :key="file.id" class="fee-row-file-chip">
                    {{ file.filename }}
                    <button type="button" title="预览" @click="openStoredFile(file, 'preview')"><IconSvg name="eye" /></button>
                    <button type="button" title="删除" @click="deleteFile(file, vehicleFileRows)"><IconSvg name="trash" /></button>
                  </span>
                </span>
              </label>
              <label>保养提醒<input v-model.trim="vehicleForm.maintenanceReminder" /></label>
              <label>证件状态<select v-model="vehicleForm.status"><option>正常</option><option>香港保险7天后到期</option><option>证件到期</option><option>费用异常</option></select></label>
              <label>本月费用<input v-model.number="vehicleForm.monthlyCost" type="number" min="0" /></label>
              <label class="span-2">备注<input v-model.trim="vehicleForm.note" /></label>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" @click="vehicleModalOpen = false">取消</button>
            <button class="primary-btn" :disabled="loading"><IconSvg name="save" />保存车辆</button>
          </div>
        </form>
      </div>

      <div v-if="driverModalOpen" class="modal-backdrop">
        <form class="modal-card compact-modal" @submit.prevent="saveDriver">
          <div class="modal-head">
            <h2>{{ editingDriverId ? '编辑司机' : '新增司机' }}</h2>
            <button type="button" class="icon-btn" @click="driverModalOpen = false"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <label>类型<input v-model.trim="driverForm.type" list="driver-type-options" placeholder="香港司机 / 大陆骑师" /></label>
              <datalist id="driver-type-options">
                <option v-for="type in driverTypeOptions" :key="type" :value="type" />
              </datalist>
              <label>姓名<input v-model.trim="driverForm.name" /></label>
              <label>电话<input v-model.trim="driverForm.phone" /></label>
              <label>身份证号<input v-model.trim="driverForm.idNo" @input="syncDriverBirthdayFromIdNo" /></label>
              <label>驾驶证<input v-model.trim="driverForm.license" /></label>
              <label>生日<input v-model="driverForm.birthday" type="date" /></label>
              <label>入职日期<input v-model="driverForm.hireDate" type="date" /></label>
              <label>离职日期<input v-model="driverForm.leaveDate" type="date" /></label>
              <label>证件到期<input v-model="driverForm.expireAt" type="date" /></label>
              <label>状态<select v-model="driverForm.status"><option>正常</option><option>30天内到期</option><option>资料待补</option></select></label>
              <label class="span-2">备注<input v-model.trim="driverForm.note" /></label>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" @click="driverModalOpen = false">取消</button>
            <button class="primary-btn" :disabled="loading"><IconSvg name="save" />保存司机</button>
          </div>
        </form>
      </div>

      <div v-if="vehicleExpenseModalOpen" class="modal-backdrop" @click.self="vehicleExpenseModalOpen = false">
        <form class="modal-card compact-modal vehicle-expense-modal" @submit.prevent="saveVehicleExpense">
          <div class="modal-head">
            <div>
              <p class="eyebrow">车辆支出</p>
              <h2>{{ editingVehicleExpenseId ? '编辑费用' : activeVehicleExpenseConfig.addLabel }}</h2>
            </div>
            <button type="button" class="icon-btn" @click="vehicleExpenseModalOpen = false"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body">
            <div class="form-grid vehicle-expense-form-grid">
              <label v-if="vehicleExpenseForm.type === 'annual'">费用类型
                <select v-model="vehicleExpenseForm.name" required>
                  <option v-for="name in VEHICLE_ANNUAL_EXPENSE_NAMES" :key="name" :value="name">{{ name }}</option>
                </select>
              </label>
              <label v-else-if="vehicleExpenseForm.type === 'other'">名称
                <input v-model.trim="vehicleExpenseForm.name" placeholder="例如：停车费、过路费" required />
              </label>
              <label v-else>费用类型
                <input v-model.trim="vehicleExpenseForm.name" readonly />
              </label>
              <label>车牌
                <select v-model="vehicleExpenseForm.plate" required>
                  <option value="">请选择车牌</option>
                  <option v-for="vehicle in vehicleRows" :key="vehicle.plate" :value="vehicle.plate">{{ vehicle.plate }} · {{ vehicle.type || '车辆' }}</option>
                </select>
              </label>
              <label v-if="vehicleExpenseForm.type === 'annual'">年份
                <select v-model.number="vehicleExpenseForm.year" required>
                  <option v-for="year in vehicleExpenseYearOptions()" :key="year" :value="year">{{ year }}年</option>
                </select>
              </label>
              <label v-else>时间
                <input v-model="vehicleExpenseForm.date" type="date" required />
              </label>
              <label>币种
                <select v-model="vehicleExpenseForm.currency">
                  <option value="人民币">RMB</option>
                  <option value="港币">HKD</option>
                </select>
              </label>
              <label>费用
                <input v-model.number="vehicleExpenseForm.amount" type="number" min="0.01" step="0.01" required />
              </label>
              <label class="span-2">备注
                <input v-model.trim="vehicleExpenseForm.note" placeholder="票据号、供应商或说明" />
              </label>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" @click="vehicleExpenseModalOpen = false">取消</button>
            <button class="primary-btn" type="submit" :disabled="vehicleExpenseSaving || vehicleRows.length === 0">
              <IconSvg name="save" />{{ vehicleExpenseSaving ? '保存中' : '保存费用' }}
            </button>
          </div>
        </form>
      </div>

	    <div v-if="recycleModalOpen" class="modal-backdrop">
	      <section class="modal-card compact-modal">
        <div class="modal-head">
          <h2>订单回收站</h2>
            <button type="button" class="icon-btn" @click="recycleModalOpen = false"><IconSvg name="close" />关闭</button>
          </div>
          <div class="modal-body">
            <table>
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>客户</th>
                  <th>日期</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="order in recycleRows" :key="order.no">
                  <td>{{ order.no }}</td>
                  <td>{{ order.customer }}</td>
                  <td>{{ order.date }}</td>
                  <td>{{ order.status }}</td>
                  <td><button class="icon-btn success" @click="restoreOrder(order)"><IconSvg name="restore" />恢复</button></td>
                </tr>
                <tr v-if="recycleRows.length === 0">
                  <td colspan="5">暂无回收站数据</td>
                </tr>
              </tbody>
            </table>
        </div>
	      </section>
	    </div>

	    <div v-if="customsBusinessModalOpen" class="modal-backdrop">
	      <form class="modal-card compact-modal customs-business-modal" @submit.prevent="saveCustomsBusiness">
	        <div class="modal-head">
	          <h2>
	            新增报关业务
	            <span class="order-title-meta">{{ customsBusinessForm.date }}</span>
	          </h2>
	          <button type="button" class="icon-btn" @click="customsBusinessModalOpen = false"><IconSvg name="close" />关闭</button>
	        </div>
	        <div class="form-grid customs-business-form-grid">
	          <label>日期<input v-model="customsBusinessForm.date" type="date" /></label>
	          <label>报关单号<input v-model.trim="customsBusinessForm.declarationNo" /></label>
	          <label>六联单号<input v-model.trim="customsBusinessForm.sixSheetNo" /></label>
	          <label class="span-2">公司<input v-model.trim="customsBusinessForm.company" /></label>
	          <label>进出口<select v-model="customsBusinessForm.direction"><option value=""></option><option>进口</option><option>出口</option><option>金二出口</option><option>香港报关</option></select></label>
	          <label>品名项数<input v-model.number="customsBusinessForm.itemCount" type="number" min="0" step="1" /></label>
	          <label>续页<input v-model.number="customsBusinessForm.pageCount" type="number" min="0" step="1" /></label>
	          <label>报关费<input v-model.number="customsBusinessForm.customsFee" type="number" min="0" step="0.01" /></label>
	          <label>续页费<input v-model.number="customsBusinessForm.pageFee" type="number" min="0" step="0.01" /></label>
	          <label>舱单费<input v-model.number="customsBusinessForm.manifestFee" type="number" min="0" step="0.01" /></label>
	          <label>报检费<input v-model.number="customsBusinessForm.inspectionFee" type="number" min="0" step="0.01" /></label>
	          <label>查验费<input v-model.number="customsBusinessForm.checkFee" type="number" min="0" step="0.01" /></label>
	          <label>其他费用<input v-model.number="customsBusinessForm.otherFee" type="number" min="0" step="0.01" /></label>
	          <label>合计<input :value="money(customsBusinessFormTotal)" readonly /></label>
	          <label class="span-4">备注<textarea v-model.trim="customsBusinessForm.remark" rows="3" /></label>
	        </div>
	        <div class="modal-actions">
	          <button type="button" class="ghost-btn" @click="customsBusinessModalOpen = false">取消</button>
	          <button type="submit" class="primary-btn" :disabled="customsBusinessSaving"><IconSvg name="save" />{{ customsBusinessSaving ? '保存中' : '保存报关业务' }}</button>
	        </div>
	      </form>
	    </div>

	    <div v-if="accountCreateModalOpen" class="modal-backdrop">
	      <form class="modal-card compact-modal account-create-modal" @submit.prevent="saveNewAccount">
        <div class="modal-head">
          <h2>
            新增账号
            <span class="order-title-meta">创建新的系统登录账号</span>
          </h2>
          <button type="button" class="icon-btn" @click="accountCreateModalOpen = false"><IconSvg name="close" />关闭</button>
        </div>
        <div class="form-grid account-create-grid">
          <label>账号<input v-model.trim="accountCreateForm.username" autocomplete="off" /></label>
          <label>姓名<input v-model.trim="accountCreateForm.displayName" autocomplete="name" /></label>
          <label>登录密码<input v-model.trim="accountCreateForm.password" type="password" autocomplete="new-password" placeholder="新增账号必须填写" /></label>
          <label>确认密码<input v-model.trim="accountCreateForm.passwordConfirm" type="password" autocomplete="new-password" placeholder="再次输入新密码" /></label>
          <label>部门<select v-model="accountCreateForm.role"><option v-for="role in ACCOUNT_ROLES" :key="role">{{ role }}</option></select></label>
          <label>入职日期<input v-model="accountCreateForm.hireDate" type="date" /></label>
          <label>手机号<input v-model.trim="accountCreateForm.phone" inputmode="tel" /></label>
          <label>邮箱<input v-model.trim="accountCreateForm.email" type="email" /></label>
          <label>状态<select v-model="accountCreateForm.status"><option>启用</option><option>停用</option></select></label>
          <label class="span-2">备注<textarea v-model.trim="accountCreateForm.note" rows="3" placeholder="账号说明、交接备注等" /></label>
          <label class="span-2">权限<textarea v-model.trim="accountCreateForm.permissionsText" rows="4" readonly /></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="ghost-btn" @click="accountCreateModalOpen = false">取消</button>
          <button type="submit" class="primary-btn" :disabled="accountCreateSaving"><IconSvg name="save" />{{ accountCreateSaving ? '保存中' : '创建账号' }}</button>
        </div>
      </form>
    </div>

    <div v-if="accountEditModalOpen" class="modal-backdrop">
      <form class="modal-card compact-modal account-edit-modal" @submit.prevent="saveAccount">
        <div class="modal-head">
          <h2>
            编辑账号
            <span class="order-title-meta">{{ accountForm.username || '当前账号' }}</span>
          </h2>
          <button type="button" class="icon-btn" @click="accountEditModalOpen = false"><IconSvg name="close" />关闭</button>
        </div>
        <div class="form-grid account-edit-grid">
          <label>账号<input v-model.trim="accountForm.username" /></label>
          <label>姓名<input v-model.trim="accountForm.displayName" /></label>
          <label>登录密码<input v-model.trim="accountForm.password" type="password" autocomplete="new-password" placeholder="留空表示不修改" /></label>
          <label>确认密码<input v-model.trim="accountForm.passwordConfirm" type="password" autocomplete="new-password" placeholder="再次输入新密码" /></label>
          <label>部门<select v-model="accountForm.role"><option v-for="role in ACCOUNT_ROLES" :key="role">{{ role }}</option></select></label>
          <label>入职日期<input v-model="accountForm.hireDate" type="date" /></label>
          <label>手机号<input v-model.trim="accountForm.phone" inputmode="tel" /></label>
          <label>邮箱<input v-model.trim="accountForm.email" type="email" /></label>
          <label>状态<select v-model="accountForm.status"><option>启用</option><option>停用</option></select></label>
          <label class="span-2">备注<textarea v-model.trim="accountForm.note" rows="3" placeholder="账号说明、交接备注等" /></label>
          <label class="span-2">权限<textarea v-model.trim="accountForm.permissionsText" rows="4" readonly /></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="ghost-btn" @click="editAccount(selectedAccount)">重置</button>
          <button type="submit" class="primary-btn" :disabled="accountEditSaving"><IconSvg name="save" />{{ accountEditSaving ? '保存中' : '保存账号' }}</button>
        </div>
      </form>
    </div>

    <div v-if="accountProfileModalOpen" class="modal-backdrop">
      <form class="modal-card compact-modal account-profile-modal" @submit.prevent="saveAccountProfile">
        <div class="modal-head">
          <h2>
            账号设置
            <span class="order-title-meta">{{ currentAccount.username || '当前账号' }}</span>
          </h2>
          <button type="button" class="icon-btn" @click="accountProfileModalOpen = false"><IconSvg name="close" />关闭</button>
        </div>
        <div class="account-profile-summary">
          <span class="account-avatar account-avatar-large"><IconSvg name="user" /></span>
          <div>
            <strong>{{ currentAccountLabel }}</strong>
            <span>{{ currentAccount.role || '司机' }}</span>
          </div>
        </div>
        <div class="form-grid account-profile-grid">
          <label>账号<input :value="currentAccount.username" readonly /></label>
          <label>角色<input :value="currentAccount.role" readonly /></label>
          <label>姓名<input v-model.trim="accountProfileForm.displayName" autocomplete="name" /></label>
          <label>手机号<input v-model.trim="accountProfileForm.phone" inputmode="tel" autocomplete="tel" /></label>
          <label class="span-2">邮箱<input v-model.trim="accountProfileForm.email" type="email" autocomplete="email" /></label>
          <label class="span-2">备注<textarea v-model.trim="accountProfileForm.note" rows="4" placeholder="联系方式补充、交接备注等" /></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="ghost-btn" @click="accountProfileModalOpen = false">取消</button>
          <button type="submit" class="primary-btn" :disabled="accountProfileSaving"><IconSvg name="save" />{{ accountProfileSaving ? '保存中' : '保存设置' }}</button>
        </div>
      </form>
    </div>

    <div v-if="accountPasswordModalOpen" class="modal-backdrop">
      <form class="modal-card compact-modal account-password-modal" @submit.prevent="saveAccountPassword">
        <div class="modal-head">
          <h2>
            修改密码
            <span class="order-title-meta">{{ currentAccountLabel }}</span>
          </h2>
          <button type="button" class="icon-btn" @click="accountPasswordModalOpen = false"><IconSvg name="close" />关闭</button>
        </div>
        <div class="form-grid account-password-grid">
          <label class="span-2">原密码<input v-model="accountPasswordForm.current" type="password" autocomplete="current-password" /></label>
          <label class="span-2">新密码<input v-model="accountPasswordForm.next" type="password" autocomplete="new-password" /></label>
          <label class="span-2">确认新密码<input v-model="accountPasswordForm.confirm" type="password" autocomplete="new-password" /></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="ghost-btn" @click="accountPasswordModalOpen = false">取消</button>
          <button type="submit" class="primary-btn" :disabled="accountPasswordSaving"><IconSvg name="save" />{{ accountPasswordSaving ? '保存中' : '保存密码' }}</button>
        </div>
      </form>
    </div>

    <div v-if="attachmentRecycleModalOpen" class="modal-backdrop">
      <section class="modal-card compact-modal attachment-recycle-modal">
        <div class="modal-head">
          <h2>
            附件回收站
            <span class="order-title-meta">{{ editingOrderNo || '当前订单' }}</span>
          </h2>
          <button type="button" class="icon-btn" @click="attachmentRecycleModalOpen = false"><IconSvg name="close" />关闭</button>
        </div>
        <div class="modal-body">
          <table class="data-table compact">
            <thead>
              <tr>
                <th>分类</th>
                <th>文件名</th>
                <th>大小</th>
                <th>上传时间</th>
                <th>删除时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="file in attachmentRecycleRows" :key="file.id">
                <td>{{ file.category || '订单附件' }}</td>
                <td>{{ file.filename }}</td>
                <td>{{ fileSizeText(file.size) }}</td>
                <td>{{ file.createdAt }}</td>
                <td>{{ file.deletedAt }}</td>
                <td class="row-actions">
                  <button class="icon-btn success" type="button" @click="restoreFile(file)"><IconSvg name="restore" />恢复</button>
                  <button class="icon-btn danger" type="button" @click="purgeFile(file)"><IconSvg name="trash" />彻底删除</button>
                </td>
              </tr>
              <tr v-if="attachmentRecycleRows.length === 0">
                <td colspan="6">暂无已删除附件</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <FilePreviewModal
      :open="filePreviewOpen"
      :file="previewFile"
      :endpoint="fileEndpoint"
      @download="openStoredFile($event, 'download')"
      @close="closeFilePreview"
    />
    </main>
  </div>
</template>
