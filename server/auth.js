import crypto from "node:crypto";

export const ACCOUNT_ROLES = ["司机", "跟单员", "财务", "管理员"];

const ROLE_LEVELS = {
  司机: 1,
  跟单员: 2,
  财务: 3,
  管理员: 4
};

const BOSS_MODULES = [
  "bossDashboard",
  "bossCompanyProfit",
  "bossVehicleProfit",
  "bossSupplierProfit",
  "bossCompanyExpenses"
];

const VEHICLE_EXPENSE_MODULES = [
  "vehicleFuelExpenses",
  "vehicleRepairExpenses",
  "vehicleAnnualExpenses",
  "vehicleOtherExpenses"
];

const ALL_MODULES = [
  "home",
  "customers",
  "dispatchBoard",
  "orders",
  "customsBusiness",
  "vehicleDriver",
  ...VEHICLE_EXPENSE_MODULES,
  "financeWages",
  "financeCosts",
  "financeSupplierStatements",
  "financeCustomsStatements",
  "financeCostCenter",
  "financeDaily",
  ...BOSS_MODULES,
  "freight",
  "templates",
  "master",
  "security",
  "accounts"
];

const BUSINESS_MODULES = ["home", "customers", "dispatchBoard", "orders", "customsBusiness"];
const VEHICLE_DRIVER_MODULES = ["vehicleDriver", ...VEHICLE_EXPENSE_MODULES];
const FINANCE_WAGE_MODULES = ["financeWages"];
const FINANCE_MODULES = ["financeCosts", "financeSupplierStatements", "financeCustomsStatements", "financeCostCenter", "financeDaily"];
const SYSTEM_MODULES = ["freight", "templates", "master", "security", "accounts"];

export const ROLE_ALLOWED_MODULES = {
  管理员: ALL_MODULES,
  财务: [...BUSINESS_MODULES, ...VEHICLE_DRIVER_MODULES, ...FINANCE_WAGE_MODULES, ...FINANCE_MODULES],
  跟单员: [...BUSINESS_MODULES, ...VEHICLE_DRIVER_MODULES, ...FINANCE_MODULES],
  司机: [...VEHICLE_DRIVER_MODULES, ...FINANCE_MODULES]
};

const MODULE_LABELS = {
  home: "首页看板",
  customers: "客户/供应商",
  orders: "订单管理",
  customsBusiness: "报关业务",
  vehicleDriver: "车辆司机",
  vehicleFuelExpenses: "加油费管理",
  vehicleRepairExpenses: "维修费管理",
  vehicleAnnualExpenses: "保险年审牌头费",
  vehicleOtherExpenses: "其他支出",
  dispatchBoard: "排车表",
  financeWages: "司机工资统计",
  financeCosts: "客户对账单",
  financeSupplierStatements: "供应商对账单",
  financeCustomsStatements: "报关对账单",
  financeCostCenter: "成本中心",
  financeDaily: "日常收支",
  bossDashboard: "老板看板",
  bossCompanyProfit: "公司利润",
  bossVehicleProfit: "车辆利润",
  bossSupplierProfit: "供应商利润",
  bossCompanyExpenses: "公司级收支",
  freight: "运费模板",
  templates: "模板中心",
  master: "基础数据",
  security: "数据安全",
  accounts: "权限账号"
};

export function normalizeAccountRole(value = "") {
  const text = String(value || "").trim();
  if (ACCOUNT_ROLES.includes(text)) return text;
  if (/管理员|老板|超级|高级/.test(text)) return "管理员";
  if (/财务|会计|出纳/.test(text)) return "财务";
  if (/司机|驾驶/.test(text)) return "司机";
  if (/跟单|操作|员工/.test(text)) return "跟单员";
  return "跟单员";
}

export function roleLevelFor(role = "") {
  return ROLE_LEVELS[normalizeAccountRole(role)] || ROLE_LEVELS["司机"];
}

export function allowedModulesForRole(role = "") {
  return [...(ROLE_ALLOWED_MODULES[normalizeAccountRole(role)] || ROLE_ALLOWED_MODULES["司机"])];
}

export function accountPermissionsForRole(role = "") {
  return allowedModulesForRole(role).map((moduleId) => MODULE_LABELS[moduleId] || moduleId);
}

export function canAccessModule(role = "", moduleId = "") {
  return allowedModulesForRole(role).includes(moduleId);
}

export function isSystemModule(moduleId = "") {
  return SYSTEM_MODULES.includes(moduleId);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(password, storedHash = "") {
  const [algorithm, salt, storedKey] = String(storedHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !storedKey) return false;
  const key = crypto.scryptSync(String(password || ""), salt, 64);
  const stored = Buffer.from(storedKey, "hex");
  return stored.length === key.length && crypto.timingSafeEqual(stored, key);
}
