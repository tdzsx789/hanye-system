const {
  BUSINESS_TYPE_OPTIONS,
  DIRECTION_OPTIONS,
  DISPATCH_LOCKED_STATUS,
  DISPATCH_PLAN_DEFAULT_STATUS,
  DISPATCH_STATUS_OPTIONS,
  DISPATCH_STATUS_TO_ORDER_STATUS,
  PORT_OPTIONS,
  STATUS_ACTION_LABELS,
  STATUS_CLASS_MAP,
  TONNAGE_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  VEHICLE_SOURCE_OPTIONS
} = require("./constants");
const { currentTimestampInputValue, daysUntilInputDate, todayInputValue } = require("./date");

function valueText(value) {
  return normalizeUserText(value, { compactCjkSpacing: true });
}

function normalizePortText(value = "") {
  return valueText(value).replace(/\s*(?:海关|海關)\s*$/u, "").trim();
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
  const source = String(value === undefined || value === null ? "" : value);
  let text = typeof source.normalize === "function" ? source.normalize("NFKC") : source;
  text = text
    .replace(USER_TEXT_COMPAT_CHAR_RE, (char) => USER_TEXT_COMPAT_CHAR_MAP[char] || char)
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\r\n?/g, "\n");
  if (options.singleLine) text = text.replace(/\n+/g, " ");
  if (options.compactCjkSpacing) {
    text = text
      .replace(new RegExp(`([${USER_TEXT_CJK}])[\\t ]+(?=[${USER_TEXT_CJK}])`, "g"), "$1")
      .replace(new RegExp(`([${USER_TEXT_CJK}])[\\t ]+(?=\\d)`, "g"), "$1")
      .replace(new RegExp(`(\\d)[\\t ]+(?=[${USER_TEXT_CJK}])`, "g"), "$1")
      .replace(/(\d)[\t ]+(?=\d)/g, "$1")
      .replace(/(\d)\s*-\s*(?=\d)/g, "$1-")
      .replace(new RegExp(`([${USER_TEXT_CJK}])\\s*([:：])\\s*`, "g"), "$1$2")
      .replace(new RegExp(`([:：])\\s*(?=[${USER_TEXT_CJK}\\d])`, "g"), "$1");
  }
  text = text.replace(/[ \t]{2,}/g, " ");
  return options.trim === false ? text : text.trim();
}

function normalizePlateText(value = "") {
  return normalizeUserText(value, { singleLine: true, compactCjkSpacing: true })
    .replace(/\s+/g, "")
    .toUpperCase();
}

function normalizeLocationPartText(value = "") {
  return normalizeUserText(value, { singleLine: true, compactCjkSpacing: true });
}

function normalizeLocationDetailText(value = "") {
  return String(value === undefined || value === null ? "" : value).replace(/\r\n?/g, "\n").trim();
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
  const text = String(value === undefined || value === null ? "" : value).replace(/\r\n?/g, "\n").trim();
  if (!text) return { city: "", district: "", detail: "" };
  const normalized = text.replace(/[／｜|]/g, "/");
  if (!normalized.includes("/")) return { city: "", district: "", detail: text };
  const parts = normalized.split("/").map((part) => part.trim());
  return {
    city: normalizeLocationPartText(parts[0] || ""),
    district: normalizeLocationPartText(parts[1] || ""),
    detail: normalizeLocationDetailText(parts.slice(2).join(" / "))
  };
}

function locationEntryHasValue(entry) {
  return Boolean(entry && String(entry.city || entry.district || entry.detail || "").trim());
}

function normalizeLocationEntry(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    if (entry.city !== undefined || entry.district !== undefined || entry.detail !== undefined) {
      return {
        city: normalizeLocationPartText(entry.city),
        district: normalizeLocationPartText(entry.district),
        detail: normalizeLocationDetailText(entry.detail)
      };
    }
    if (entry.value !== undefined) return splitLegacyLocationEntry(entry.value);
  }
  return splitLegacyLocationEntry(entry);
}

function splitLegacyLocationEntries(value = "") {
  const text = String(value === undefined || value === null ? "" : value).replace(/\r\n?/g, "\n");
  if (!text.trim()) return [];
  return text
    .split(/[；;]+/)
    .map((entry) => normalizeLocationEntry(entry))
    .filter(locationEntryHasValue);
}

function normalizeLocationEntries(entries, fallbackText = "") {
  const source = Array.isArray(entries)
    ? entries
    : (entries && typeof entries === "object" ? [entries] : []);
  const normalized = source.map((entry) => normalizeLocationEntry(entry)).filter(locationEntryHasValue);
  if (normalized.length) return normalized;
  return splitLegacyLocationEntries(fallbackText || (typeof entries === "string" ? entries : ""));
}

function composeLocationEntriesText(entries) {
  return normalizeLocationEntries(entries)
    .map((entry) => composeLocationEntryText(entry.city, entry.district, entry.detail))
    .filter(Boolean)
    .join("；");
}

function normalizeVehicleSource(value) {
  const text = valueText(value);
  return text === "本公司车辆" ? "汉业物流" : text;
}

function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "过磅"].indexOf(text) >= 0) return true;
  if (["0", "false", "no", "off", "不用过磅"].indexOf(text) >= 0) return false;
  return fallback;
}

function normalizeTimestampInputValue(value) {
  const text = valueText(value);
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!matched) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(matched[1])) return "";
  if (!matched[2]) return `${matched[1]} 00:00:00`;
  return `${matched[1]} ${matched[2]}:${matched[3]}:${matched[4] || "00"}`;
}

function timestampInputValueFromRowId(row) {
  const id = valueText(row && row.id);
  const matched = id.match(/(?:^|[-_])(\d{13})(?:$|[-_])/);
  if (!matched) return "";
  const timestamp = Number(matched[1]);
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  if (year < 2020 || year > 2100) return "";
  return currentTimestampInputValue(date);
}

function dispatchRowCreatedAt(row, fallbackDate) {
  return normalizeTimestampInputValue((row && (row.createdAt || row.created_at)) || "")
    || timestampInputValueFromRowId(row)
    || normalizeTimestampInputValue(fallbackDate)
    || `${todayInputValue()} 00:00:00`;
}

function dispatchRowCreatedDate(row, fallbackDate) {
  return dispatchRowCreatedAt(row, fallbackDate).slice(0, 10);
}

function uniqueTextList(values) {
  const result = [];
  values.forEach((value) => {
    const text = valueText(value);
    if (text && result.indexOf(text) < 0) result.push(text);
  });
  return result;
}

function normalizeTransportMode(value) {
  const text = valueText(value);
  if (text === "香港司机直送") return "单司机";
  if (text === "香港司机 + 大陆骑师接驳") return "双司机";
  if (text === "口岸交货") return "口岸转国内车";
  return TRANSPORT_MODE_OPTIONS.indexOf(text) >= 0 ? text : "";
}

function normalizeDispatchPlanStatus(status) {
  const text = valueText(status);
  if (text === "待预排" || text === "已预排") return DISPATCH_PLAN_DEFAULT_STATUS;
  if (text === "完成结算") return "已签收";
  return DISPATCH_STATUS_OPTIONS.indexOf(text) >= 0 ? text : DISPATCH_PLAN_DEFAULT_STATUS;
}

function dispatchStatusValueForRow(row) {
  return normalizeDispatchPlanStatus(row && row.status ? row.status : DISPATCH_PLAN_DEFAULT_STATUS);
}

function dispatchStatusOptionsForRow(row) {
  const currentStatus = dispatchStatusValueForRow(row);
  if (currentStatus === "预排") return ["已派车"];
  if (currentStatus === "已派车") return ["通关中"];
  if (currentStatus === DISPATCH_LOCKED_STATUS) {
    return ["已签收", "异常滞留"];
  }
  if (currentStatus === "已签收") {
    return ["已签收"];
  }
  if (currentStatus === "异常滞留") return ["已签收"];
  return DISPATCH_STATUS_OPTIONS;
}

function dispatchStatusLockedForRow(row) {
  return dispatchStatusValueForRow(row) === "已签收";
}

const DISPATCH_STATUS_FALLBACK_PREVIOUS = {
  已派车: "预排",
  通关中: "已派车",
  已签收: "通关中",
  异常滞留: "通关中"
};

function normalizeOptionalDispatchPlanStatus(status) {
  const text = valueText(status);
  if (!text) return "";
  if (text === "待预排" || text === "已预排") return DISPATCH_PLAN_DEFAULT_STATUS;
  if (text === "完成结算") return "已签收";
  return DISPATCH_STATUS_OPTIONS.indexOf(text) >= 0 ? text : "";
}

function dispatchReturnStatusForRow(row) {
  const currentStatus = dispatchStatusValueForRow(row);
  if (currentStatus === DISPATCH_PLAN_DEFAULT_STATUS) return "";
  const previousStatus = normalizeOptionalDispatchPlanStatus(row && row.previousStatus);
  if (previousStatus && previousStatus !== currentStatus) return previousStatus;
  return DISPATCH_STATUS_FALLBACK_PREVIOUS[currentStatus] || "";
}

function dispatchStatusActionItems(row) {
  const current = dispatchStatusValueForRow(row);
  return dispatchStatusOptionsForRow(row)
    .filter((status) => status !== current)
    .map((status) => ({
      status,
      label: STATUS_ACTION_LABELS[status] || `改为${status}`
    }));
}

function dispatchStatusClass(status) {
  return STATUS_CLASS_MAP[normalizeDispatchPlanStatus(status)] || STATUS_CLASS_MAP[DISPATCH_PLAN_DEFAULT_STATUS];
}

function dispatchOrderStatusForPlanStatus(status) {
  return DISPATCH_STATUS_TO_ORDER_STATUS[normalizeDispatchPlanStatus(status)] || "";
}

function sourceClass(source) {
  const text = normalizeVehicleSource(source);
  if (text === "汉业物流") return "source-own";
  if (text === "外派车辆") return "source-outsourced";
  return "source-empty";
}

function sanitizeDispatchRow(row) {
  const item = row || {};
  const status = normalizeDispatchPlanStatus(item.status);
  const previousStatus = normalizeOptionalDispatchPlanStatus(item.previousStatus || item.previous_status);
  const loadingLocations = normalizeLocationEntries(item.loadingLocations || item.loading_locations, item.loading);
  const unloadingLocations = normalizeLocationEntries(item.unloadingLocations || item.unloading_locations, item.unloading);
  return {
    id: valueText(item.id),
    date: valueText(item.date),
    createdAt: dispatchRowCreatedAt(item, item.date),
    dispatchNo: valueText(item.dispatchNo || item.dispatch_no),
    orderNo: valueText(item.orderNo || item.order_no),
    customerId: valueText(item.customerId || item.customer_id),
    customer: valueText(item.customer),
    businessType: valueText(item.businessType || item.business_type),
    currency: valueText(item.currency),
    plate: normalizePlateText(item.plate),
    port: normalizePortText(item.port),
    needsWeighing: booleanFlag(item.needsWeighing ?? item.needs_weighing, false),
    direction: valueText(item.direction),
    tonnage: valueText(item.tonnage),
    quantity: item.quantity === undefined || item.quantity === null ? "" : String(item.quantity).trim(),
    weight: valueText(item.weight),
    loading: composeLocationEntriesText(loadingLocations) || valueText(item.loading),
    loadingLocations,
    unloading: composeLocationEntriesText(unloadingLocations) || valueText(item.unloading),
    unloadingLocations,
    loadTime: valueText(item.loadTime || item.load_time),
    vehicleSource: normalizeVehicleSource(item.vehicleSource || item.vehicle_source),
    supplier: valueText(item.supplier),
    transportMode: normalizeTransportMode(item.transportMode || item.transport_mode),
    driver: valueText(item.driver),
    hkDriver: valueText(item.hkDriver || item.hk_driver),
    mainlandDriver: valueText(item.mainlandDriver || item.mainland_driver),
    status,
    previousStatus: previousStatus && previousStatus !== status ? previousStatus : "",
    createdByAccountId: Number(item.createdByAccountId || item.created_by_account_id || 0) || null,
    createdByUsername: valueText(item.createdByUsername || item.created_by_username),
    createdByName: valueText(item.createdByName || item.createdByDisplayName || item.created_by_display_name || item.createdByUsername || item.created_by_username),
    note: valueText(item.note),
    tripNoEnabled: booleanFlag(item.tripNoEnabled ?? item.trip_no_enabled, false) ? 1 : 0,
    tripNo: valueText(item.tripNo || item.trip_no),
    sixSheetEnabled: booleanFlag(item.sixSheetEnabled ?? item.six_sheet_enabled, false) ? 1 : 0,
    sixSheetNo: valueText(item.sixSheetNo || item.six_sheet_no)
  };
}

function normalizeDispatchRows(rows, date) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return sourceRows.map((row, index) => {
    const normalized = sanitizeDispatchRow(row);
    if (!normalized.id) {
      normalized.id = `dispatch-mobile-${Date.now()}-${index}`;
    }
    normalized.date = row && row.date ? row.date : date;
    normalized.createdAt = dispatchRowCreatedAt(row, date);
    return normalized;
  });
}

function generateDispatchNo(date, rows, extraRows) {
  return generateBusinessNo("PC", date, rows, extraRows);
}

function getRowOrder(row, orders) {
  const orderRows = Array.isArray(orders) ? orders : [];
  const orderNo = valueText(row && row.orderNo);
  const dispatchNo = valueText(row && row.dispatchNo);
  return orderRows.find((order) => order.no === orderNo)
    || orderRows.find((order) => dispatchNo && order.dispatchNo === dispatchNo)
    || null;
}

function rowWithOrder(row, orders, date) {
  const order = getRowOrder(row, orders);
  return Object.assign({}, row, {
    order: order || {
      no: row.orderNo || "",
      dispatchNo: row.dispatchNo || "",
      customerId: row.customerId || "",
      customer: row.customer || "",
      businessType: row.businessType || "",
      currency: row.currency || "",
      date: row.date || date,
      port: normalizePortText(row.port),
      needsWeighing: booleanFlag(row.needsWeighing, false),
      direction: row.direction || "",
      tonnage: row.tonnage || "",
      quantity: row.quantity || "",
	      weight: row.weight || "",
	      loading: row.loading || "",
	      loadingLocations: row.loadingLocations || [],
	      unloading: row.unloading || "",
	      unloadingLocations: row.unloadingLocations || [],
      loadTime: row.loadTime || "",
      loadingTime: row.loadTime || "",
      vehicleSource: normalizeVehicleSource(row.vehicleSource || ""),
      supplier: row.supplier || "",
      status: row.status || "",
      remark: row.note || "",
      tripNoEnabled: row.tripNoEnabled ? 1 : 0,
      tripNo: row.tripNo || "",
      sixSheetEnabled: row.sixSheetEnabled ? 1 : 0,
      sixSheetNo: row.sixSheetNo || ""
    }
  });
}

function dispatchPlanTimeRank(value) {
  const match = valueText(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 24 * 60 + 1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function dispatchPlanSourceRank(row) {
  const source = normalizeVehicleSource((row && row.vehicleSource) || (row && row.order && row.order.vehicleSource));
  if (source === "汉业物流") return 0;
  if (source === "外派车辆") return 1;
  return 2;
}

function dispatchPlanGroupKey(row) {
  if (dispatchPlanSourceRank(row) === 1) {
    return valueText((row && row.supplier) || (row && row.order && row.order.supplier));
  }
  return valueText(row && row.plate);
}

function compareDispatchRows(left, right) {
  const leftGroup = dispatchPlanGroupKey(left);
  const rightGroup = dispatchPlanGroupKey(right);
  if (!leftGroup && rightGroup) return 1;
  if (!rightGroup && leftGroup) return -1;
  const groupCompare = leftGroup.localeCompare(rightGroup, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
  if (groupCompare !== 0) return groupCompare;
  const leftDate = valueText(left && left.date);
  const rightDate = valueText(right && right.date);
  const dateCompare = leftDate.localeCompare(rightDate);
  if (dateCompare !== 0) return dateCompare;
  const timeCompare = dispatchPlanTimeRank(left && left.loadTime) - dispatchPlanTimeRank(right && right.loadTime);
  if (timeCompare !== 0) return timeCompare;
  const noCompare = valueText(left && left.dispatchNo).localeCompare(valueText(right && right.dispatchNo), "zh-Hans-CN", { numeric: true });
  if (noCompare !== 0) return noCompare;
  return (left && left.index ? left.index : 0) - (right && right.index ? right.index : 0);
}

function sortDispatchRows(rows, orders, date) {
  return normalizeDispatchRows(rows, date)
    .map((row, index) => Object.assign({}, rowWithOrder(row, orders || [], date), { index }))
    .sort(compareDispatchRows)
    .map((row) => sanitizeDispatchRow(row));
}

function businessNoDateKey(date) {
  const text = valueText(date || todayInputValue()).slice(0, 10);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayInputValue();
  return normalized.replace(/-/g, "");
}

function generateBusinessNo(prefix, date, rows, extraRows) {
  const fullPrefix = `${prefix}${businessNoDateKey(date)}`;
  let max = 0;
  const candidates = []
    .concat(Array.isArray(rows) ? rows : [])
    .concat(Array.isArray(extraRows) ? extraRows : []);
  candidates.forEach((row) => {
    const no = valueText((row && row.no) || (row && row.dispatchNo) || (row && row.dispatch_no));
    if (no.indexOf(fullPrefix) !== 0) return;
    max = Math.max(max, Number(no.slice(fullPrefix.length)) || 0);
  });
  return `${fullPrefix}${String(max + 1).padStart(3, "0")}`;
}

function isTransportOrder(order) {
  return !order || order.businessType !== "报关";
}

function dispatchShortLocation(value) {
  const [firstEntry = ""] = splitDispatchLocationEntries(value);
  const parts = splitLocationParts(valueText(firstEntry));
  return parts.city && parts.district
    ? [parts.city, parts.district].join(" / ")
    : parts.city || parts.district || parts.detail || "";
}

function dispatchShortLocationFromEntries(entries) {
  return normalizeLocationEntries(entries)
    .map((entry) => {
      const city = valueText(entry.city);
      const district = valueText(entry.district);
      const detail = normalizeLocationDetailText(entry.detail);
      return city && district ? [city, district].join(" / ") : city || district || detail;
    })
    .filter(Boolean)
    .join(" + ");
}

function recordLocationEntries(record, field) {
  return normalizeLocationEntries(record && record[`${field}Locations`], record && record[field]);
}

function dispatchOrderRouteText(record) {
  const loading = dispatchShortLocationFromEntries(recordLocationEntries(record, "loading")) || dispatchShortLocation(record && record.loading);
  const unloading = dispatchShortLocationFromEntries(recordLocationEntries(record, "unloading")) || dispatchShortLocation(record && record.unloading);
  return [loading, unloading].filter(Boolean).join(" -> ") || "-";
}

function splitDispatchLocationEntries(value) {
  const text = valueText(value).replace(/\r/g, "\n");
  if (!text.trim()) return [""];
  const trailingBlankCount = (text.match(/[；;]+$/)?.[0].length) || 0;
  const body = trailingBlankCount > 0 ? text.slice(0, text.length - trailingBlankCount) : text;
  const entries = body
    .split(/[；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!entries.length) return [""];
  return trailingBlankCount > 0
    ? [...entries, ...Array.from({ length: trailingBlankCount }, () => "")]
    : entries;
}

function dispatchMessageLocationDetail(value) {
  if (value && typeof value === "object") return normalizeLocationDetailText(value.detail);
  const text = valueText(value);
  if (!text) return "";
  if (text.indexOf("/") >= 0) {
    const parts = text.split("/").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 3) return parts.slice(2).join(" / ");
    if (parts.length === 2) return parts[1];
    return parts[0] || "";
  }
  return text
    .replace(/^(?:[\u4e00-\u9fa5]{2,16}?(?:省|自治区|特别行政区))/, "")
    .replace(/^(?:北京市|上海市|天津市|重庆市|香港|澳门|[\u4e00-\u9fa5]{2,16}?市)/, "")
    .replace(/^(?:[\u4e00-\u9fa5]{1,16}?(?:区|县))/, "")
    .trim();
}

function dispatchVehicleSourceText(row) {
  const order = row && row.order ? row.order : {};
  const source = normalizeVehicleSource(order.vehicleSource || (row && row.vehicleSource));
  if (source === "外派车辆") return valueText(order.supplier || (row && row.supplier)) || "外派供应商";
  if (source === "汉业物流") return "汉业物流";
  return source || "-";
}

function dispatchWeighingText(value) {
  return booleanFlag(value, false) ? "过磅" : "不用过磅";
}

function dispatchDirectionText(value) {
  const text = valueText(value);
  if (text === "进口") return "进口";
  if (text === "出口") return "出口";
  return text || "-";
}

function driverDisplayText(row) {
  const order = row && row.order ? row.order : {};
  const names = uniqueTextList([
    row && row.driver,
    row && row.hkDriver,
    row && row.mainlandDriver,
    order.driver,
    order.hkDriver,
    order.mainlandDriver
  ]);
  return names.join(" / ") || "-";
}

function textMatchesRow(row, keyword) {
  const text = [
    row.dispatchNo,
    row.orderNo,
    row.customer,
    row.plate,
    row.port,
    row.direction,
    row.tonnage,
    row.businessType,
    row.currency,
    row.loading,
    row.unloading,
    row.vehicleSource,
    row.supplier,
    row.driver,
    row.hkDriver,
    row.mainlandDriver,
    row.createdByName,
    row.createdByUsername,
    row.note,
    row.order && row.order.no,
    row.order && row.order.customer,
    row.order && row.order.businessType,
    row.order && row.order.vehicleSource,
    row.order && row.order.supplier,
    row.order && row.order.driver,
    row.order && row.order.hkDriver,
    row.order && row.order.mainlandDriver
  ].map(valueText).join(" ").toLowerCase();
  return text.indexOf(valueText(keyword).toLowerCase()) >= 0;
}

function filteredRows(rows, options) {
  const source = options || {};
  const status = valueText(source.status);
  const keyword = valueText(source.keyword);
  return rows.filter((row) => {
    const statusOk = !status || status === "all" || dispatchStatusValueForRow(row) === status;
    const keywordOk = !keyword || textMatchesRow(row, keyword);
    return statusOk && keywordOk;
  });
}

function presentDispatchRows(rows, orders, date, options) {
  const expandedIds = (options && options.expandedIds) || [];
  const merged = normalizeDispatchRows(rows, date).map((row, index) =>
    Object.assign({}, rowWithOrder(row, orders, date), { index })
  );
	  return filteredRows(merged, options).map((row, displayIndex) => {
	    const order = row.order || {};
	    const record = Object.assign({}, order, {
	      loading: order.loading || row.loading,
	      loadingLocations: order.loadingLocations || row.loadingLocations || [],
	      unloading: order.unloading || row.unloading,
	      unloadingLocations: order.unloadingLocations || row.unloadingLocations || []
	    });
    const status = dispatchStatusValueForRow(row);
    const source = valueText(order.vehicleSource || row.vehicleSource);
    const businessType = valueText(order.businessType || row.businessType);
    const needsWeighing = booleanFlag(row.needsWeighing ?? order.needsWeighing, false);
    return Object.assign({}, row, {
      displayIndex: displayIndex + 1,
      customerText: valueText(order.customer || row.customer) || "-",
      businessTypeText: businessType || "-",
      dateText: valueText(row.date || date),
      driverText: driverDisplayText(row),
      highlightTimeText: valueText(row.loadTime) || "未定",
      highlightPlateText: valueText(row.plate || order.plate) || "-",
      orderNoText: valueText(order.no || row.orderNo) || "-",
      orderStatusText: valueText(order.status),
      creatorText: valueText(row.createdByName || row.createdByUsername),
      routeText: dispatchOrderRouteText(record),
      sourceText: source === "外派车辆" ? "外派车辆" : dispatchVehicleSourceText(row),
      sourceClass: sourceClass(source),
      supplierHighlightText: source === "外派车辆" ? valueText(order.supplier || row.supplier) : "",
      status,
      previousStatus: normalizeOptionalDispatchPlanStatus(row.previousStatus),
      statusActionDisabled: dispatchStatusLockedForRow(row),
      returnStatus: dispatchReturnStatusForRow(row),
      statusClass: dispatchStatusClass(status),
      timeText: valueText(row.loadTime) || "未定",
      weighingText: dispatchWeighingText(needsWeighing),
      expanded: expandedIds.indexOf(row.id) >= 0,
      noteText: valueText(row.note || order.remark)
    });
  });
}

function plannedOrderNos(rows) {
  const set = {};
  (rows || []).forEach((row) => {
    const no = valueText(row && row.orderNo);
    if (no) set[no] = true;
  });
  return set;
}

function presentUnplannedOrders(rows, orders, date, keyword) {
  const planned = plannedOrderNos(rows);
  const normalizedKeyword = valueText(keyword).toLowerCase();
  return (orders || [])
    .filter((order) => order && order.date === date && !order.deletedAt && isTransportOrder(order) && !planned[order.no])
    .filter((order) => {
      if (!normalizedKeyword) return true;
      const text = [
        order.no,
        order.dispatchNo,
        order.customer,
        order.plate,
        order.port,
        order.direction,
        order.tonnage,
        order.loading,
        order.unloading,
        order.vehicleSource,
        order.supplier,
        order.status
      ].map(valueText).join(" ").toLowerCase();
      return text.indexOf(normalizedKeyword) >= 0;
    })
    .map((order) => ({
      no: order.no,
      dispatchNo: order.dispatchNo || "",
      customer: order.customer || "-",
      port: normalizePortText(order.port) || "-",
      direction: order.direction || "-",
      tonnage: order.tonnage || "-",
      plate: order.plate || "-",
      sourceText: order.vehicleSource === "外派车辆" ? (order.supplier || "外派供应商") : (order.vehicleSource || "-"),
      sourceClass: sourceClass(order.vehicleSource),
      status: order.status || "-",
      routeText: dispatchOrderRouteText(order),
      quantityText: [order.quantity, order.weight].map(valueText).filter(Boolean).join(" / ") || "-"
    }));
}

function dispatchSummaryCards(rows) {
  const normalized = normalizeDispatchRows(rows || [], "");
  const statusOrder = ["预排", "已派车", "通关中", "已签收", "异常滞留"];
  const cards = [];
  statusOrder.forEach((status) => {
    cards.push({
      key: status,
      label: status,
      value: normalized.filter((row) => dispatchStatusValueForRow(row) === status).length,
      className: dispatchStatusClass(status)
    });
  });
  cards.push({ key: "all", label: "全部", value: normalized.length, className: "status-all" });
  return cards;
}

function certificateExpiryWarning(owner, certificateName, expireDate, referenceDate) {
  const days = daysUntilInputDate(expireDate, referenceDate);
  if (days === null || days > 30) return "";
  if (days < 0) return `${owner} ${certificateName}已过期 ${Math.abs(days)} 天`;
  if (days === 0) return `${owner} ${certificateName}今天到期`;
  return `${owner} ${certificateName}到期还剩 ${days} 天`;
}

function buildDispatchWarnings(rows, orders, vehicles, drivers, date) {
  const warnings = [];
  const vehicleMap = {};
  const driverMap = {};
  const warnedKeys = {};
  (vehicles || []).forEach((vehicle) => {
    if (vehicle && vehicle.plate) vehicleMap[vehicle.plate] = vehicle;
  });
  (drivers || []).forEach((driver) => {
    if (driver && driver.name) driverMap[driver.name] = driver;
  });
  normalizeDispatchRows(rows, date).forEach((row) => {
    const order = getRowOrder(row, orders) || {};
    const plate = valueText(row.plate || order.plate);
    const vehicle = vehicleMap[plate];
    if (vehicle) {
      [
        ["mainlandReviewDate", "大陆年审"],
        ["hkReviewDate", "香港年审"],
        ["mainlandInsuranceDate", "大陆保险"],
        ["hkInsuranceDate", "香港保险"]
      ].forEach(([field, label]) => {
        const key = `vehicle:${plate}:${field}`;
        const message = certificateExpiryWarning(plate, label, vehicle[field], date);
        if (message && !warnedKeys[key]) {
          warnings.push(message);
          warnedKeys[key] = true;
        }
      });
    }
    uniqueTextList([row.driver, row.hkDriver, row.mainlandDriver, order.driver, order.hkDriver, order.mainlandDriver]).forEach((name) => {
      const driver = driverMap[name];
      if (!driver) return;
      const key = `driver:${name}:expireAt`;
      const message = certificateExpiryWarning(name, `${driver.type || "司机"}证件`, driver.expireAt, date);
      if (message && !warnedKeys[key]) {
        warnings.push(message);
        warnedKeys[key] = true;
      }
    });
  });
  return warnings;
}

function dispatchLocationBlock(label, record, field) {
  const entries = recordLocationEntries(record, field);
  if (entries.length <= 1) {
    const location = entries[0] || {};
    return `${label}：${dispatchMessageLocationDetail(location) || "-"}`;
  }
  return entries
    .map((location, index) => `${label}${index + 1}：${dispatchMessageLocationDetail(location) || "-"}`)
    .join("\n");
}

function dispatchMessageText(rows, orders, date) {
  const mergedRows = normalizeDispatchRows(rows, date).map((row) => rowWithOrder(row, orders, date));
  return mergedRows.map((row) => {
	    const order = row.order || {};
	    const record = Object.assign({}, order, {
	      loading: order.loading || row.loading,
	      loadingLocations: order.loadingLocations || row.loadingLocations || [],
	      unloading: order.unloading || row.unloading,
	      unloadingLocations: order.unloadingLocations || row.unloadingLocations || []
	    });
    const rowDate = row.date || date || "-";
    const time = row.loadTime || order.loadTime || order.loadingTime || "-";
    const direction = order.direction || row.direction || "";
    const needsWeighing = row.needsWeighing ?? order.needsWeighing;
    return [
      `装货时间：${rowDate}   ${time}  ${dispatchWeighingText(needsWeighing)} ${dispatchDirectionText(direction)} 口岸：${normalizePortText(order.port || row.port) || "-"}`,
      `车牌：${row.plate || order.plate || "-"} 吨位：${order.tonnage || row.tonnage || "-"}    板数：${order.quantity || row.quantity || "-"}`,
      "",
      dispatchLocationBlock("装货地", record, "loading"),
      "",
      dispatchLocationBlock("卸货地", record, "unloading"),
      "",
      `备注：${row.note || order.remark || "-"}`
    ].join("\n");
  }).join("\n\n");
}

function createDispatchRowFromOrder(order, date, existingRows) {
  const mode = normalizeTransportMode(order && order.transportMode ? order.transportMode : "单司机") || "单司机";
  const createdAt = currentTimestampInputValue();
  return sanitizeDispatchRow({
    id: `dispatch-${order.no}-${Date.now()}`,
    date,
    createdAt,
    dispatchNo: order.dispatchNo || generateDispatchNo(date, existingRows || []),
    orderNo: order.no,
    customer: order.customer || "",
    plate: order.plate || "",
    port: normalizePortText(order.port),
    needsWeighing: booleanFlag(order.needsWeighing, false),
    direction: order.direction || "",
    tonnage: order.tonnage || "",
    quantity: order.quantity || "",
	    weight: order.weight || "",
	    loading: order.loading || "",
	    loadingLocations: normalizeLocationEntries(order.loadingLocations, order.loading),
	    unloading: order.unloading || "",
	    unloadingLocations: normalizeLocationEntries(order.unloadingLocations, order.unloading),
    vehicleSource: normalizeVehicleSource(order.vehicleSource || ""),
    supplier: order.supplier || "",
    transportMode: mode,
    driver: "",
    hkDriver: order.hkDriver || (mode === "单司机" ? order.driver || "" : ""),
    mainlandDriver: order.mainlandDriver || "",
    loadTime: order.loadTime || "",
    status: DISPATCH_PLAN_DEFAULT_STATUS,
    note: ""
  });
}

function formFromDispatchRow(row, date) {
  const source = row || {};
  const order = source.order || {};
  return {
    id: source.id || "",
    date: source.date || date || todayInputValue(),
    createdAt: dispatchRowCreatedAt(source, date),
    dispatchNo: source.dispatchNo || order.dispatchNo || "",
    orderNo: source.orderNo || order.no || "",
    customerId: order.customerId || source.customerId || "",
    customer: order.customer || source.customer || "",
    businessType: order.businessType || source.businessType || "运输",
    currency: order.currency || source.currency || "",
    plate: source.plate || order.plate || "",
    port: normalizePortText(order.port || source.port),
    needsWeighing: booleanFlag(source.needsWeighing ?? order.needsWeighing, false),
    direction: order.direction || source.direction || "",
    tonnage: order.tonnage || source.tonnage || "",
    quantity: order.quantity || source.quantity || "",
	    weight: order.weight || source.weight || "",
	    loading: order.loading || source.loading || "",
	    loadingLocations: normalizeLocationEntries(order.loadingLocations || source.loadingLocations, order.loading || source.loading),
	    unloading: order.unloading || source.unloading || "",
	    unloadingLocations: normalizeLocationEntries(order.unloadingLocations || source.unloadingLocations, order.unloading || source.unloading),
    loadTime: source.loadTime || order.loadTime || "",
    vehicleSource: normalizeVehicleSource(order.vehicleSource || source.vehicleSource || "汉业物流"),
    supplier: order.supplier === "-" ? "" : (order.supplier || source.supplier || ""),
    transportMode: normalizeTransportMode(source.transportMode || order.transportMode || ""),
    driver: source.driver || order.driver || "",
    hkDriver: source.hkDriver || order.hkDriver || "",
    mainlandDriver: source.mainlandDriver || order.mainlandDriver || "",
    status: dispatchStatusValueForRow(source),
    previousStatus: normalizeOptionalDispatchPlanStatus(source.previousStatus),
    createdByAccountId: source.createdByAccountId || source.created_by_account_id || null,
    createdByUsername: source.createdByUsername || source.created_by_username || "",
    createdByName: source.createdByName || source.createdByDisplayName || source.created_by_display_name || source.createdByUsername || source.created_by_username || "",
    note: source.note || order.remark || "",
    tripNoEnabled: (order.tripNoEnabled || source.tripNoEnabled) ? 1 : 0,
    tripNo: order.tripNo || source.tripNo || "",
    sixSheetEnabled: (order.sixSheetEnabled || source.sixSheetEnabled) ? 1 : 0,
    sixSheetNo: order.sixSheetNo || source.sixSheetNo || ""
  };
}

function rowFromForm(form, orderNo) {
  const source = form || {};
  return sanitizeDispatchRow({
    id: source.id || `dispatch-manual-${Date.now()}`,
    date: source.date,
    createdAt: source.createdAt || source.created_at || currentTimestampInputValue(),
    dispatchNo: source.dispatchNo,
    orderNo: orderNo || source.orderNo || "",
    customer: source.customer,
    customerId: source.customerId,
    businessType: source.businessType || "运输",
    currency: source.currency || "",
    plate: normalizePlateText(source.plate),
    port: normalizePortText(source.port),
    needsWeighing: booleanFlag(source.needsWeighing, false),
    direction: source.direction,
    tonnage: source.tonnage,
    quantity: source.quantity,
	    weight: source.weight,
	    loading: source.loading,
	    loadingLocations: normalizeLocationEntries(source.loadingLocations, source.loading),
	    unloading: source.unloading,
	    unloadingLocations: normalizeLocationEntries(source.unloadingLocations, source.unloading),
    loadTime: source.loadTime,
    vehicleSource: normalizeVehicleSource(source.vehicleSource),
    supplier: normalizeVehicleSource(source.vehicleSource) === "外派车辆" ? source.supplier : "",
    transportMode: source.transportMode,
    driver: source.driver,
    hkDriver: source.hkDriver,
    mainlandDriver: source.mainlandDriver,
    status: source.status || DISPATCH_PLAN_DEFAULT_STATUS,
    previousStatus: normalizeOptionalDispatchPlanStatus(source.previousStatus),
    createdByAccountId: source.createdByAccountId || source.created_by_account_id || null,
    createdByUsername: source.createdByUsername || source.created_by_username || "",
    createdByName: source.createdByName || source.createdByDisplayName || source.created_by_display_name || source.createdByUsername || source.created_by_username || "",
    note: source.note,
    tripNoEnabled: source.tripNoEnabled ? 1 : 0,
    tripNo: source.tripNo || "",
    sixSheetEnabled: source.sixSheetEnabled ? 1 : 0,
    sixSheetNo: source.sixSheetNo || ""
  });
}

function orderPayloadFromForm(form, customer, includeFees) {
  const source = form || {};
  const payload = {
    dispatchNo: source.dispatchNo,
    customerId: customer.id,
    customer: customer.name,
    businessType: source.businessType || "运输",
    port: normalizePortText(source.port),
    needsWeighing: booleanFlag(source.needsWeighing, false),
    direction: source.direction,
    tonnage: source.tonnage,
    currency: source.currency || "",
    quantity: source.quantity,
    weight: source.weight,
    vehicleSource: normalizeVehicleSource(source.vehicleSource),
    supplier: normalizeVehicleSource(source.vehicleSource) === "外派车辆" ? source.supplier : "",
    plate: normalizePlateText(source.plate),
    driver: source.driver,
    hkDriver: source.hkDriver,
    mainlandDriver: source.mainlandDriver,
	    transportMode: normalizeTransportMode(source.transportMode || ""),
	    loading: source.loading,
	    loadingLocations: normalizeLocationEntries(source.loadingLocations, source.loading),
	    unloading: source.unloading,
	    unloadingLocations: normalizeLocationEntries(source.unloadingLocations, source.unloading),
    date: source.date,
    status: dispatchOrderStatusForPlanStatus(source.status),
    remark: source.note,
    tripNoEnabled: source.tripNoEnabled ? 1 : 0,
    tripNo: source.tripNo || "",
    sixSheetEnabled: source.sixSheetEnabled ? 1 : 0,
    sixSheetNo: source.sixSheetNo || ""
  };
  if (includeFees) payload.fees = [];
  return payload;
}

function hasDispatchAccess(account) {
  if (!account) return false;
  const role = valueText(account.role);
  if (role === "司机") return false;
  if (["管理员", "财务", "跟单员"].indexOf(role) >= 0) return true;

  const allowedModules = Array.isArray(account.allowedModules) ? account.allowedModules : [];
  if (allowedModules.indexOf("dispatchBoard") >= 0) return true;

  const permissions = Array.isArray(account.permissions)
    ? account.permissions
    : valueText(account.permissions).split(/[，,、\s]+/).filter(Boolean);
  return permissions.indexOf("dispatchBoard") >= 0 || permissions.indexOf("排车表") >= 0;
}

module.exports = {
  BUSINESS_TYPE_OPTIONS,
  DIRECTION_OPTIONS,
  DISPATCH_STATUS_OPTIONS,
  PORT_OPTIONS,
  TONNAGE_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  VEHICLE_SOURCE_OPTIONS,
  buildDispatchWarnings,
  createDispatchRowFromOrder,
  dispatchMessageText,
  dispatchOrderStatusForPlanStatus,
  dispatchStatusActionItems,
  dispatchStatusClass,
  dispatchStatusLockedForRow,
  dispatchStatusOptionsForRow,
  dispatchReturnStatusForRow,
  dispatchStatusValueForRow,
  dispatchSummaryCards,
  dispatchVehicleSourceText,
  formFromDispatchRow,
  generateDispatchNo,
  hasDispatchAccess,
  normalizeDispatchPlanStatus,
  normalizeDispatchRows,
  normalizePlateText,
  normalizePortText,
  normalizeTransportMode,
  normalizeUserText,
  orderPayloadFromForm,
  presentDispatchRows,
  presentUnplannedOrders,
  rowFromForm,
  sanitizeDispatchRow,
  sortDispatchRows
};
