export const TEMPLATE_SYSTEM_TOTAL_COLUMNS = [
  { key: "__rmbTotal", label: "RMB合计", width: 64 },
  { key: "__hkdTotal", label: "HKD合计", width: 64 }
];
export const TEMPLATE_SYSTEM_SEQUENCE_COLUMN = { key: "__sequence", label: "序号", width: 42 };
export const TEMPLATE_SYSTEM_MANAGED_COLUMNS = [
  TEMPLATE_SYSTEM_SEQUENCE_COLUMN,
  ...TEMPLATE_SYSTEM_TOTAL_COLUMNS
];
export const TEMPLATE_REMOVED_COLUMN_KEYS = new Set(["receivableHKD", "receivableRMB", "createdByName"]);
export const TEMPLATE_ORDER_BASE_COLUMNS = [
  { key: "tonnage", label: "吨位", width: 54 },
  { key: "quantity", label: "件/板数", width: 64 },
  { key: "weight", label: "重量", width: 64 },
  { key: "tripNo", label: "车次号", width: 72 },
  { key: "sixSheetNo", label: "六联单号", width: 86 },
  { key: "port", label: "口岸", width: 76 },
  { key: "direction", label: "进出口", width: 58 },
  { key: "currency", label: "币种", width: 54 },
  { key: "vehicleSource", label: "车辆来源", width: 78 },
  { key: "plate", label: "车牌", width: 72 },
  { key: "driver", label: "司机", width: 64 },
  { key: "transportMode", label: "运输模式", width: 76 },
  { key: "supplier", label: "外派供应商", width: 96 }
];
export const TEMPLATE_PREVIEW_SAMPLE_ORDERS = [
  {
    no: "HY2606300001",
    customer: "深圳市汉业国际货运代理有限公司",
    businessType: "运输",
    port: "深圳湾海关",
    direction: "出口",
    tonnage: "5T",
    currency: "港币",
    quantity: 18,
    pieces: 18,
    weight: "1280kg",
    vehicleSource: "外派车辆",
    supplier: "深圳市飞龙通达物流有限公司",
    plate: "粤Z1234港",
    driver: "陈志强",
    transportMode: "单司机",
    loading: "深圳 / 南山 / 蛇口仓",
    unloading: "香港 / 九龙 / 葵涌货柜码头",
    date: "2026-06-30",
    receivableHKD: 2380,
    receivableRMB: 0,
    status: "已签收"
  },
  {
    no: "HY2606300002",
    customer: "深圳市文永供应链管理有限公司",
    businessType: "运输+报关",
    port: "莲塘海关",
    direction: "进口",
    tonnage: "3T",
    currency: "人民币",
    quantity: 32,
    pieces: 32,
    weight: "860kg",
    vehicleSource: "本公司车辆",
    plate: "粤ZFC62港",
    driver: "李永洪",
    transportMode: "双司机",
    loading: "香港 / 新界 / 元朗工业区",
    unloading: "深圳 / 龙岗 / 坂田仓库",
    date: "2026-06-30",
    receivableHKD: 0,
    receivableRMB: 1850,
    status: "已审核"
  },
  {
    no: "HY2606300003",
    customer: "深圳市环联程物流有限公司",
    businessType: "运输",
    port: "文锦渡海关",
    direction: "出口",
    tonnage: "12T",
    currency: "港币",
    quantity: 6,
    pieces: 6,
    weight: "4600kg",
    vehicleSource: "本公司车辆",
    plate: "粤ZYR22港",
    driver: "廖永贤",
    transportMode: "口岸转国内车",
    loading: "深圳 / 宝安 / 福永仓",
    unloading: "香港 / 沙田 / 火炭仓",
    date: "2026-06-29",
    receivableHKD: 4200,
    receivableRMB: 0,
    status: "已签收"
  }
];
export const FONT_PRESETS = [
  {
    value: "standard-sans-cn",
    label: "标准黑体",
    stack: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", Arial, sans-serif'
  },
  {
    value: "standard-serif-cn",
    label: "标准宋体",
    stack: 'SimSun, NSimSun, "Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", serif'
  },
  {
    value: "latin-sans",
    label: "英文无衬线",
    stack: 'Arial, Helvetica, "Microsoft YaHei", "PingFang SC", sans-serif'
  },
  {
    value: "latin-serif",
    label: "英文衬线",
    stack: '"Times New Roman", Georgia, SimSun, "Songti SC", serif'
  }
];
export const TEMPLATE_VARIABLES = [
  { group: "日期", items: [
    { label: "今日日期", value: "{{date}}" },
    { label: "当前时间", value: "{{datetime}}" }
  ] },
  { group: "页码", items: [
    { label: "当前页", value: "{{page}}" },
    { label: "总页数", value: "{{pages}}" }
  ] },
  { group: "人员/公司", items: [
    { label: "制表人", value: "{{user}}" },
    { label: "公司名称", value: "{{company}}" }
  ] },
  { group: "订单", items: [
    { label: "订单号", value: "{{orderNo}}" },
    { label: "客户", value: "{{customer}}" },
    { label: "业务类型", value: "{{businessType}}" },
    { label: "口岸", value: "{{port}}" },
    { label: "进出口", value: "{{direction}}" },
    { label: "吨位", value: "{{tonnage}}" },
    { label: "币种", value: "{{currency}}" }
  ] }
];
export const FREIGHT_DIRECTORY_LEVELS = [
  { value: "level1", label: "一级目录", primary: "一级目录", secondary: "说明" },
  { value: "level2", label: "二级目录", primary: "二级目录", secondary: "所属一级" }
];
export const NEW_CONTACT_ROW_ID = "__new_contact__";
