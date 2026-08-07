export const SESSION_LOGIN_KEY = "hanye_session_login";
export const SESSION_USER_KEY = "hanye_session_user";
export const SESSION_TOKEN_KEY = "hanye_session_token";
export const SESSION_ACCOUNT_KEY = "hanye_session_account";
export const SESSION_EXPIRES_KEY = "hanye_session_expires_at";
export const ACCOUNT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LEGACY_STATEMENT_DOWNLOAD_ROWS_KEY = "hanye_statement_download_rows";
export const LEGACY_DRIVER_ROUTE_ADJUST_RULES_KEY = "hanye_driver_route_adjust_rules";
export const STATEMENT_CUSTOMER_EXCHANGE_RATES_KEY = "hanye_statement_customer_exchange_rates";
export const STATEMENT_CUSTOMER_UNRECEIVED_AMOUNTS_KEY = "hanye_statement_customer_unreceived_amounts";
export const STATEMENT_DEFAULT_EXCHANGE_RATE = "0.88";

export const ROUTE_ALIASES = {
  customer: "customers",
  customerList: "customers",
  supplier: "customers",
  supplierList: "customers",
  suppliers: "customers",
  vehicleManage: "vehicleDriver",
  driverManage: "vehicleDriver",
  vehicle: "vehicleDriver",
  dispatch: "dispatchBoard",
  dispatchBoard: "dispatchBoard",
  finance: "financeWages",
  financeCustomsStatements: "financeCustomsStatements",
  customsStatements: "financeCustomsStatements",
  customsStatement: "financeCustomsStatements",
  boss: "bossDashboard",
  bossCenter: "bossDashboard",
  bossCustomsProfit: "customsBusiness",
  customs: "customsBusiness",
  customsBusiness: "customsBusiness"
};

export const ACCOUNT_ROLES = ["司机", "跟单员", "财务", "管理员"];
export const VEHICLE_EXPENSE_MODULES = [
  "vehicleFuelExpenses",
  "vehicleRepairExpenses",
  "vehicleAnnualExpenses",
  "vehicleOtherExpenses"
];
export const VEHICLE_DRIVER_MODULES = ["vehicleDriver", ...VEHICLE_EXPENSE_MODULES];
export const BOSS_CENTER_MODULES = [
  "bossDashboard",
  "bossCompanyProfit",
  "bossVehicleProfit",
  "bossCompanyExpenses"
];
export const FINANCE_CENTER_MODULES = ["financeWages", "financeCosts", "financeSupplierStatements", "financeCustomsStatements", "financeCostCenter", "financeDaily"];
export const BUSINESS_MODULES = ["home", "customers", "dispatchBoard", "orders", "customsBusiness"];
export const SYSTEM_CONFIG_MODULES = ["freight", "templates", "master", "security", "accounts"];
export const ROLE_ALLOWED_MODULES = {
  管理员: [
    ...BUSINESS_MODULES,
    ...VEHICLE_DRIVER_MODULES,
    ...FINANCE_CENTER_MODULES,
    ...BOSS_CENTER_MODULES,
    ...SYSTEM_CONFIG_MODULES
  ],
  财务: [...BUSINESS_MODULES, ...VEHICLE_DRIVER_MODULES, ...FINANCE_CENTER_MODULES, ...SYSTEM_CONFIG_MODULES],
  跟单员: [...BUSINESS_MODULES, ...VEHICLE_DRIVER_MODULES, ...SYSTEM_CONFIG_MODULES],
  司机: VEHICLE_DRIVER_MODULES
};
export const ROLE_PERMISSION_LABELS = {
  管理员: "全部权限",
  财务: "业务、车辆司机、财务中心、系统配置",
  跟单员: "业务、车辆司机、系统配置",
  司机: "车辆司机"
};

export const MODULES = [
  { id: "home", label: "首页看板", group: "业务" },
  { id: "customerList", label: "客户", group: "业务" },
  { id: "supplierList", label: "供应商", group: "业务" },
  { id: "dispatchBoard", label: "排车表", group: "业务" },
  { id: "orders", label: "订单管理", group: "业务" },
  { id: "customsBusiness", label: "报关业务", group: "业务" },
  { id: "vehicleManage", label: "车辆管理", group: "车辆司机" },
  { id: "driverManage", label: "司机管理", group: "车辆司机" },
  { id: "vehicleFuelExpenses", label: "加油费管理", group: "车辆司机" },
  { id: "vehicleRepairExpenses", label: "维修费管理", group: "车辆司机" },
  { id: "vehicleAnnualExpenses", label: "保险年审牌头费", group: "车辆司机" },
  { id: "vehicleOtherExpenses", label: "其他支出", group: "车辆司机" },
  { id: "financeWages", label: "工资统计", group: "财务中心" },
  { id: "financeCosts", label: "客户对账单", group: "财务中心" },
  { id: "financeSupplierStatements", label: "供应商对账单", group: "财务中心" },
  { id: "financeCustomsStatements", label: "报关对账单", group: "财务中心" },
  { id: "financeCostCenter", label: "成本中心", group: "财务中心" },
  { id: "financeDaily", label: "日常收支", group: "财务中心" },
  { id: "bossDashboard", label: "老板看板", group: "老板中心" },
  { id: "bossCompanyProfit", label: "公司利润", group: "老板中心" },
  { id: "bossVehicleProfit", label: "车辆利润", group: "老板中心" },
  { id: "bossCompanyExpenses", label: "公司级收支", group: "老板中心" },
  { id: "freight", label: "运费模板", group: "系统配置" },
  { id: "templates", label: "模板中心", group: "系统配置" },
  { id: "master", label: "基础数据", group: "系统配置" },
  { id: "security", label: "数据安全", group: "系统配置" },
  { id: "accounts", label: "权限账号", group: "系统配置" }
];

export const VEHICLE_EXPENSE_CONFIGS = [
  { moduleId: "vehicleFuelExpenses", type: "fuel", title: "加油费管理", addLabel: "增加加油费", defaultName: "加油费", timeLabel: "时间" },
  { moduleId: "vehicleRepairExpenses", type: "repair", title: "维修费管理", addLabel: "增加维修费", defaultName: "维修费", timeLabel: "时间" },
  { moduleId: "vehicleAnnualExpenses", type: "annual", title: "保险年审牌头费", addLabel: "增加保险年审牌头费", defaultName: "保险费", timeLabel: "年份" },
  { moduleId: "vehicleOtherExpenses", type: "other", title: "其他支出", addLabel: "增加其他支出", defaultName: "", timeLabel: "时间" }
];
export const VEHICLE_EXPENSE_CONFIG_BY_MODULE = Object.fromEntries(VEHICLE_EXPENSE_CONFIGS.map((item) => [item.moduleId, item]));
export const VEHICLE_EXPENSE_CONFIG_BY_TYPE = Object.fromEntries(VEHICLE_EXPENSE_CONFIGS.map((item) => [item.type, item]));
export const VEHICLE_ANNUAL_EXPENSE_NAMES = ["保险费", "年审费", "牌头费"];

export const AUDIT_ACTION_LABELS = {
  create: "新增",
  update: "修改",
  update_status: "修改状态",
  delete: "删除",
  restore: "恢复",
  purge: "彻底删除",
  export: "导出",
  upload: "上传",
  download: "下载",
  preview: "预览",
  audit: "审核",
  sync: "同步",
  reject_upload: "拒绝上传"
};
export const AUDIT_ENTITY_LABELS = {
  account: "账号",
  account_password: "账号密码",
  account_profile: "账号资料",
  address_book: "地址簿",
  address_history: "历史地址",
  customer: "客户",
  customer_contact: "客户联系人",
  customs_business: "报关业务",
  dispatch_plan: "排车计划",
  driver: "司机",
  driver_adjustment: "司机预支/报销",
  driver_route_adjust_rule: "司机路线扣减规则",
  driver_wage_rule: "司机工资规则",
  cost_center_rate: "成本中心",
  fee_item: "收费项目",
  fee_item_order: "收费项目顺序",
  file: "文件",
  freight_rate: "运费模板",
  master_data: "基础数据",
  order: "订单",
  rule: "规则",
  statement: "对账单",
  template: "模板",
  vehicle: "车辆",
  vehicle_expense: "车辆支出"
};
export const AUDIT_RECORD_PREFIXES = {
  account: "账号ID",
  account_password: "账号ID",
  account_profile: "账号ID",
  address_book: "地址ID",
  address_history: "地址标识",
  customer: "客户编号",
  customer_contact: "联系人ID",
  dispatch_plan: "排车日期",
  driver: "司机ID",
  driver_adjustment: "预支/报销ID",
  driver_route_adjust_rule: "扣减规则ID",
  driver_wage_rule: "工资规则ID",
  cost_center_rate: "成本行ID",
  fee_item: "收费项目ID",
  fee_item_order: "调整范围",
  file: "文件ID",
  freight_rate: "模板ID",
  master_data: "基础数据ID",
  order: "订单号",
  rule: "规则ID",
  statement: "对账记录",
  template: "模板ID",
  vehicle: "车牌",
  vehicle_expense: "支出ID"
};

export const TONNAGE_OPTIONS = ["3T", "5T", "8T", "10T", "12T", "20尺柜", "40尺柜"];
export const DIRECTION_OPTIONS = ["出口", "进口"];
export const SHARED_DIRECTION = "进出口通用";
export const FREIGHT_QUOTE_TAB = "报价";
export const FREIGHT_QUOTE_ROOT_VIEW = "root";
export const FREIGHT_QUOTE_CUSTOMERS_VIEW = "customers";
export const FREIGHT_QUOTE_MATRIX_VIEW = "matrix";
export const PUBLIC_FREIGHT_QUOTE_TYPE = "public";
export const CUSTOMER_FREIGHT_QUOTE_TYPE = "customer";
export const SUPPLIER_COST_SHARED_DIRECTION = SHARED_DIRECTION;
export const TRANSPORT_MODE_OPTIONS = ["单司机", "双司机", "口岸转国内车"];
export const DISPATCH_STATUS_OPTIONS = ["预排", "已派车", "通关中", "已签收", "异常滞留"];
export const DISPATCH_PLAN_DEFAULT_STATUS = "预排";
export const DISPATCH_LOCKED_STATUS = "通关中";
export const FEE_DRIVER_ROLE_OPTIONS = ["", "香港司机", "大陆骑师", "跟随订单司机", "手动指定"];
export const FEE_DRIVER_ROLE_LABELS = {
  "": "未指定",
  香港司机: "香港司机",
  大陆骑师: "大陆骑师",
  跟随订单司机: "跟随订单司机",
  手动指定: "手动指定"
};
export const FEE_ITEM_CATEGORY_OPTIONS = ["正常", "代垫", "公司自费"];
export const FEE_ITEM_COST_SOURCE_OPTIONS = ["供应商", "香港司机", "大陆骑师", "公司自费"];
export const DISPATCH_STATUS_TO_ORDER_STATUS = {
  预排: "预排",
  待预排: "预排",
  已派车: "预排",
  通关中: "通关中",
  已签收: "已签收",
  异常滞留: "费用待确认"
};
export const ORDER_STATUS_OPTIONS = ["待确认", "预排", "正常", "通关中", "已签收", "缺票据", "费用待确认", "已审核"];
export const DEFAULT_DRIVER_TYPES = ["香港司机", "大陆骑师", "其他"];
export const DRIVER_ADJUSTMENT_TYPES = ["预支款", "停车费", "过磅费", "加油费", "维修费", "其他报销"];
export const DRIVER_ADJUSTMENT_STATUS_OPTIONS = ["待工资结算", "工资报销", "已结算"];

export const RELATED_ORDER_DATE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "today", label: "今日" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "lastMonth", label: "上月" },
  { key: "year", label: "今年" },
  { key: "pastYears", label: "往年" }
];
export const ORDER_DATE_FILTERS = [
  { key: "yesterday", label: "昨日" },
  { key: "today", label: "今日" },
  { key: "tomorrow", label: "明天" },
  { key: "week", label: "本周" },
  { key: "month", label: "本月" },
  { key: "lastMonth", label: "上月" },
  { key: "custom", label: "自定义" }
];
export const PERIOD_FILTER_MODES = [
  { key: "month", label: "按月查看" },
  { key: "year", label: "按年查看" },
  { key: "all", label: "全部" }
];
export const PERIOD_MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1).padStart(2, "0");
  return { value, label: `${index + 1}月` };
});
export const DISPATCH_LOAD_TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 15;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
});

export const FILE_UPLOAD_ACCEPT = "image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff,.avif,.heic,.heif,.svg,.pdf,application/pdf";
export const SAFE_UPLOAD_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff", "avif", "heic", "heif", "svg", "pdf"]);
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const UPLOAD_MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  pdf: "application/pdf"
};
