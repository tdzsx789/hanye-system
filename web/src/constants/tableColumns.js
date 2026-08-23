function withDefaultIndex(columns) {
  return columns.map((column, index) => ({ ...column, defaultIndex: index }));
}

export const CUSTOMER_ORDER_COLUMN_STORAGE_KEY = "hanye_customer_order_column_widths";
export const ORDER_COLUMN_STORAGE_KEY = "hanye_order_column_widths";
export const RELATED_VEHICLE_ORDER_COLUMN_STORAGE_KEY = "hanye_related_vehicle_order_column_widths";
export const RELATED_DRIVER_ORDER_COLUMN_STORAGE_KEY = "hanye_related_driver_order_column_widths";
export const CUSTOMER_ORDER_COLUMN_VISIBILITY_KEY = "hanye_customer_order_column_visibility";
export const ORDER_COLUMN_VISIBILITY_KEY = "hanye_order_column_visibility";
export const CUSTOMER_ORDER_COLUMN_ORDER_KEY = "hanye_customer_order_column_order";
export const ORDER_COLUMN_ORDER_KEY = "hanye_order_column_order";
export const CUSTOMER_ORDER_COLUMN_LOCKED_KEY = "hanye_customer_order_column_locked";
export const ORDER_COLUMN_LOCKED_KEY = "hanye_order_column_locked";
export const ORDER_LEFT_STICKY_KEYS = ["sequence", "date", "plate", "direction"];
export const ORDER_RIGHT_STICKY_KEYS = ["status", "actions"];
export const DISPATCH_LEFT_STICKY_KEYS = ["sequence", "loadTime", "plate"];

export function createCustomerOrderColumns() {
  return withDefaultIndex([
    { key: "select", label: "选择", width: 32, min: 30, locked: true },
    { key: "date", label: "日期", width: 82, min: 68 },
    { key: "no", label: "订单号", width: 98, min: 72 },
    { key: "businessType", label: "业务类型", width: 48, min: 42 },
    { key: "port", label: "口岸", width: 76, min: 56 },
    { key: "direction", label: "进出口", width: 48, min: 42 },
    { key: "tonnage", label: "吨位", width: 48, min: 42 },
    { key: "currency", label: "币种", width: 48, min: 42 },
    { key: "quantity", label: "件数/板数", width: 62, min: 50 },
    { key: "weight", label: "重量", width: 64, min: 50 },
    { key: "vehicleSource", label: "车辆来源", width: 74, min: 56 },
    { key: "plate", label: "车牌", width: 56, min: 46 },
    { key: "driver", label: "司机", width: 52, min: 42 },
    { key: "transportMode", label: "运输模式", width: 64, min: 50 },
    { key: "loading", label: "装货地", width: 50, min: 46 },
    { key: "unloading", label: "卸货地", width: 50, min: 46 },
    { key: "receivableHKD", label: "应收港币", width: 82, min: 68 },
    { key: "receivableRMB", label: "应收人民币", width: 82, min: 68 },
    { key: "status", label: "状态", width: 64, min: 54 },
    { key: "actions", label: "操作", width: 82, min: 72, locked: true }
  ]);
}

export function createOrderColumns() {
  return withDefaultIndex([
    { key: "select", label: "选择", width: 32, min: 30, locked: true },
    { key: "sequence", label: "序号", width: 66, min: 62, locked: true, leftPinned: true },
    { key: "date", label: "装车日期/时间", width: 168, min: 152, leftPinned: true },
    { key: "plate", label: "车牌", width: 118, min: 108, leftPinned: true },
    { key: "direction", label: "进出口", width: 58, min: 44, leftPinned: true },
    { key: "no", label: "订单号", width: 128, min: 104 },
    { key: "dispatchNo", label: "排车单号", width: 118, min: 88 },
    { key: "createdByName", label: "创建者", width: 82, min: 64 },
    { key: "customer", label: "客户", width: 220, min: 140 },
    { key: "driver", label: "司机", width: 132, min: 96 },
    { key: "supplier", label: "供应商", width: 144, min: 96 },
    { key: "businessType", label: "业务类型", width: 70, min: 52 },
    { key: "port", label: "口岸", width: 86, min: 58 },
    { key: "tonnage", label: "吨位", width: 54, min: 42 },
    { key: "currency", label: "币种", width: 58, min: 44 },
    { key: "quantity", label: "件数/板数", width: 76, min: 54 },
    { key: "weight", label: "重量", width: 70, min: 54 },
    { key: "vehicleSource", label: "车辆来源", width: 82, min: 58 },
    { key: "transportMode", label: "运输模式", width: 74, min: 54 },
    { key: "loading", label: "装货地", width: 120, min: 68 },
    { key: "unloading", label: "卸货地", width: 120, min: 68 },
    { key: "receivableHKD", label: "应收港币", width: 92, min: 70 },
    { key: "receivableRMB", label: "应收人民币", width: 92, min: 70 },
    { key: "status", label: "状态", width: 84, min: 68, rightPinned: true },
    { key: "actions", label: "操作", width: 256, min: 244, max: 260, locked: true, rightPinned: true }
  ]);
}

export function createRelatedVehicleOrderColumns() {
  return [
    { key: "no", label: "订单号", width: 104, min: 72 },
    { key: "date", label: "日期", width: 82, min: 68 },
    { key: "customer", label: "客户", width: 176, min: 90 },
    { key: "route", label: "路线", width: 280, min: 130 },
    { key: "status", label: "状态", width: 76, min: 60 }
  ];
}

export function createRelatedDriverOrderColumns() {
  return [
    { key: "no", label: "订单号", width: 104, min: 72 },
    { key: "date", label: "日期", width: 82, min: 68 },
    { key: "customer", label: "客户", width: 176, min: 90 },
    { key: "route", label: "路线", width: 260, min: 130 },
    { key: "transportMode", label: "运输模式", width: 82, min: 68 },
    { key: "costCenter", label: "成本中心", width: 120, min: 86 },
    { key: "advanceHKD", label: "代垫HKD", width: 92, min: 72 },
    { key: "advanceRMB", label: "代垫RMB", width: 92, min: 72 },
    { key: "routeAdjustHKD", label: "调整HKD", width: 92, min: 72 },
    { key: "routeAdjustRMB", label: "调整RMB", width: 92, min: 72 },
    { key: "payable", label: "应付合计", width: 116, min: 86 },
    { key: "status", label: "状态", width: 70, min: 60 }
  ];
}

export function createFinanceWageTableColumns() {
  return withDefaultIndex([
    { key: "driver", label: "司机", width: 120, min: 84, locked: true },
    { key: "type", label: "类型", width: 110, min: 80 },
    { key: "orderCount", label: "订单数", width: 76, min: 64 },
    { key: "tripFee", label: "成本中心合计", width: 150, min: 110 },
    { key: "advanceFee", label: "代垫费", width: 150, min: 110 },
    { key: "adjustments", label: "预支/报销", width: 150, min: 110 },
    { key: "total", label: "应付合计", width: 160, min: 120 },
    { key: "status", label: "状态", width: 80, min: 64 },
    { key: "actions", label: "操作", width: 86, min: 76, locked: true, exportable: false }
  ]);
}

export function createDispatchTableColumns() {
  return withDefaultIndex([
    { key: "sequence", label: "序号", width: 72, min: 58, locked: true },
    { key: "loadTime", label: "装车日期/时间", width: 230, min: 220, locked: true },
    { key: "plate", label: "车牌", width: 128, min: 118, locked: true },
    { key: "dispatchNo", label: "排车单号", width: 112, min: 88 },
    { key: "createdByName", label: "创建者", width: 86, min: 64 },
    { key: "customer", label: "客户", width: 180, min: 110 },
    { key: "businessType", label: "业务类型", width: 78, min: 58 },
    { key: "driver", label: "司机", width: 210, min: 160 },
    { key: "supplier", label: "供应商", width: 116, min: 86 },
    { key: "status", label: "排车状态", width: 104, min: 84 },
    { key: "port", label: "口岸", width: 86, min: 68 },
    { key: "direction", label: "进出口", width: 64, min: 52 },
    { key: "tonnage", label: "吨位", width: 58, min: 46 },
    { key: "quantity", label: "件数/板数", width: 82, min: 64 },
    { key: "weight", label: "重量", width: 76, min: 58 },
    { key: "route", label: "装 / 卸", width: 250, min: 140 },
    { key: "note", label: "备注", width: 120, min: 86 },
    { key: "actions", label: "操作", width: 184, min: 144, locked: true }
  ]);
}

export function createCustomerListDetailColumns() {
  return withDefaultIndex([
    { key: "id", label: "编号", width: 108, min: 82 },
    { key: "type", label: "类型", width: 72, min: 58 },
    { key: "name", label: "名称", width: 220, min: 120 },
    { key: "city", label: "城市", width: 90, min: 68 },
    { key: "term", label: "账期", width: 100, min: 76 },
    { key: "settlementCurrency", label: "结算币种", width: 100, min: 78 },
    { key: "receivableRMB", label: "应收人民币", width: 116, min: 92 },
    { key: "receivableHKD", label: "应收港币", width: 116, min: 92 },
    { key: "recentOrderDate", label: "最近订单日期", width: 120, min: 96 },
    { key: "customsHomeItemCount", label: "主页品名项", width: 104, min: 86 },
    { key: "customsPageItemCount", label: "续页品名项", width: 104, min: 86 },
    { key: "customsImportHomeFee", label: "进口主页费用", width: 116, min: 96 },
    { key: "customsExportHomeFee", label: "出口主页费用", width: 116, min: 96 },
    { key: "customsImportDeclarationFee", label: "进口报关费", width: 116, min: 96 },
    { key: "customsExportDeclarationFee", label: "出口报关费", width: 116, min: 96 },
    { key: "customsImportPageFee", label: "进口续页费用", width: 116, min: 96 },
    { key: "customsExportPageFee", label: "出口续页费用", width: 116, min: 96 },
    { key: "customsVerificationFee", label: "核注费", width: 96, min: 78 },
    { key: "createdAt", label: "创建日期", width: 110, min: 86 },
    { key: "actions", label: "操作", width: 138, min: 100, locked: true }
  ]);
}

export function createVehicleListDetailColumns() {
  return withDefaultIndex([
    { key: "plate", label: "车牌", width: 110, min: 82 },
    { key: "brand", label: "品牌", width: 110, min: 78 },
    { key: "model", label: "型号", width: 130, min: 90 },
    { key: "type", label: "车型", width: 80, min: 64 },
    { key: "mainlandInsuranceDate", label: "大陆保险", width: 112, min: 88 },
    { key: "hkInsuranceDate", label: "香港保险", width: 112, min: 88 },
    { key: "status", label: "状态", width: 86, min: 68 },
    { key: "monthlyCost", label: "本月费用", width: 104, min: 82 },
    { key: "note", label: "备注", width: 180, min: 100 },
    { key: "actions", label: "操作", width: 138, min: 100, locked: true }
  ]);
}

export function createDriverListDetailColumns() {
  return withDefaultIndex([
    { key: "type", label: "类型", width: 92, min: 72 },
    { key: "name", label: "司机", width: 100, min: 76 },
    { key: "phone", label: "电话", width: 120, min: 92 },
    { key: "idNo", label: "身份证号", width: 156, min: 116 },
    { key: "license", label: "驾驶证", width: 128, min: 96 },
    { key: "birthday", label: "生日", width: 100, min: 76 },
    { key: "hireDate", label: "入职日期", width: 104, min: 82 },
    { key: "leaveDate", label: "离职日期", width: 104, min: 82 },
    { key: "employmentStatus", label: "入职状态", width: 92, min: 76 },
    { key: "expireAt", label: "证件到期", width: 104, min: 82 },
    { key: "status", label: "状态", width: 86, min: 68 },
    { key: "note", label: "备注", width: 180, min: 100 },
    { key: "actions", label: "操作", width: 138, min: 100, locked: true }
  ]);
}

export const DATA_TABLE_DENSITY_OPTIONS = [
  { key: "compact", label: "紧凑" },
  { key: "normal", label: "标准" },
  { key: "comfortable", label: "宽松" }
];
