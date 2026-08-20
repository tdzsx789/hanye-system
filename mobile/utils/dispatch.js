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
  return value === undefined || value === null ? "" : String(value).trim();
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
  const text = valueText(source);
  if (text === "本公司车辆") return "source-own";
  if (text === "外派车辆") return "source-outsourced";
  return "source-empty";
}

function sanitizeDispatchRow(row) {
  const item = row || {};
  return {
    id: valueText(item.id),
    date: valueText(item.date),
    createdAt: dispatchRowCreatedAt(item, item.date),
    dispatchNo: valueText(item.dispatchNo),
    orderNo: valueText(item.orderNo),
    customer: valueText(item.customer),
    plate: valueText(item.plate),
    port: valueText(item.port),
    direction: valueText(item.direction),
    tonnage: valueText(item.tonnage),
    quantity: item.quantity === undefined || item.quantity === null ? "" : String(item.quantity).trim(),
    weight: valueText(item.weight),
    loading: valueText(item.loading),
    unloading: valueText(item.unloading),
    loadTime: valueText(item.loadTime),
    vehicleSource: valueText(item.vehicleSource),
    supplier: valueText(item.supplier),
    transportMode: normalizeTransportMode(item.transportMode),
    driver: valueText(item.driver),
    hkDriver: valueText(item.hkDriver),
    mainlandDriver: valueText(item.mainlandDriver),
    status: normalizeDispatchPlanStatus(item.status),
    createdByAccountId: Number(item.createdByAccountId || item.created_by_account_id || 0) || null,
    createdByUsername: valueText(item.createdByUsername || item.created_by_username),
    createdByName: valueText(item.createdByName || item.createdByDisplayName || item.created_by_display_name || item.createdByUsername || item.created_by_username),
    note: valueText(item.note)
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
      customer: row.customer || "",
      date: row.date || date,
      port: row.port || "",
      direction: row.direction || "",
      tonnage: row.tonnage || "",
      quantity: row.quantity || "",
      weight: row.weight || "",
      loading: row.loading || "",
      unloading: row.unloading || "",
      vehicleSource: row.vehicleSource || "",
      supplier: row.supplier || ""
    }
  });
}

function dispatchPlanTimeRank(value) {
  const match = valueText(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return 24 * 60 + 1;
  return Number(match[1]) * 60 + Number(match[2]);
}

function dispatchPlanSourceRank(row) {
  const source = valueText((row && row.vehicleSource) || (row && row.order && row.order.vehicleSource));
  if (source === "本公司车辆") return 0;
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
  const parts = valueText(value)
    .replace(/\r/g, "\n")
    .split(/[\n；;\/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length ? parts.slice(0, 2).join(" / ") : "";
}

function dispatchOrderRouteText(record) {
  const loading = dispatchShortLocation(record && record.loading);
  const unloading = dispatchShortLocation(record && record.unloading);
  return [loading, unloading].filter(Boolean).join(" -> ") || "-";
}

function splitDispatchLocationEntries(value) {
  return valueText(value)
    .replace(/\r/g, "\n")
    .split(/[\n；;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dispatchMessageLocationDetail(value) {
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
  const source = valueText(order.vehicleSource || (row && row.vehicleSource));
  if (source === "外派车辆") return valueText(order.supplier || (row && row.supplier)) || "外派供应商";
  if (source === "本公司车辆") return "本公司";
  return source || "-";
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
    row.loading,
    row.unloading,
    row.supplier,
    row.createdByName,
    row.createdByUsername,
    row.note,
    row.order && row.order.no,
    row.order && row.order.customer
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
      unloading: order.unloading || row.unloading
    });
    const status = dispatchStatusValueForRow(row);
    const source = valueText(order.vehicleSource || row.vehicleSource);
    return Object.assign({}, row, {
      displayIndex: displayIndex + 1,
      customerText: valueText(order.customer || row.customer) || "-",
      dateText: valueText(row.date || date),
      driverText: driverDisplayText(row),
      orderNoText: valueText(order.no || row.orderNo) || "-",
      orderStatusText: valueText(order.status),
      creatorText: valueText(row.createdByName || row.createdByUsername),
      routeText: dispatchOrderRouteText(record),
      sourceText: dispatchVehicleSourceText(row),
      sourceClass: sourceClass(source),
      status,
      previousStatus: normalizeOptionalDispatchPlanStatus(row.previousStatus),
      statusActionDisabled: dispatchStatusLockedForRow(row),
      returnStatus: dispatchReturnStatusForRow(row),
      statusClass: dispatchStatusClass(status),
      timeText: valueText(row.loadTime) || "未定",
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
      port: order.port || "-",
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
  const entries = splitDispatchLocationEntries(record && record[field]);
  if (entries.length <= 1) {
    const location = entries[0] || "-";
    return `${label}：${dispatchMessageLocationDetail(location) || location}`;
  }
  return entries
    .map((location, index) => `${label}${index + 1}：${dispatchMessageLocationDetail(location) || location || "-"}`)
    .join("\n");
}

function dispatchMessageText(rows, orders, date) {
  const mergedRows = normalizeDispatchRows(rows, date).map((row) => rowWithOrder(row, orders, date));
  return mergedRows.map((row) => {
    const order = row.order || {};
    const record = Object.assign({}, order, {
      loading: order.loading || row.loading,
      unloading: order.unloading || row.unloading
    });
    return [
      `装货时间：${row.date || date || "-"}   ${row.loadTime || "-"}  口岸：${order.port || row.port || "-"}`,
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
    port: order.port || source.port || "",
    direction: order.direction || source.direction || "",
    tonnage: order.tonnage || source.tonnage || "",
    quantity: order.quantity || source.quantity || "",
    weight: order.weight || source.weight || "",
    loading: order.loading || source.loading || "",
    unloading: order.unloading || source.unloading || "",
    loadTime: source.loadTime || order.loadTime || "",
    vehicleSource: order.vehicleSource || source.vehicleSource || "本公司车辆",
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
    tripNoEnabled: order.tripNoEnabled ? 1 : 0,
    tripNo: order.tripNo || "",
    sixSheetEnabled: order.sixSheetEnabled ? 1 : 0,
    sixSheetNo: order.sixSheetNo || ""
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
    plate: source.plate,
    port: source.port,
    direction: source.direction,
    tonnage: source.tonnage,
    quantity: source.quantity,
    weight: source.weight,
    loading: source.loading,
    unloading: source.unloading,
    loadTime: source.loadTime,
    vehicleSource: source.vehicleSource,
    supplier: source.vehicleSource === "外派车辆" ? source.supplier : "",
    transportMode: source.transportMode,
    driver: source.driver,
    hkDriver: source.hkDriver,
    mainlandDriver: source.mainlandDriver,
    status: source.status || DISPATCH_PLAN_DEFAULT_STATUS,
    previousStatus: normalizeOptionalDispatchPlanStatus(source.previousStatus),
    createdByAccountId: source.createdByAccountId || source.created_by_account_id || null,
    createdByUsername: source.createdByUsername || source.created_by_username || "",
    createdByName: source.createdByName || source.createdByDisplayName || source.created_by_display_name || source.createdByUsername || source.created_by_username || "",
    note: source.note
  });
}

function orderPayloadFromForm(form, customer, includeFees) {
  const source = form || {};
  const payload = {
    dispatchNo: source.dispatchNo,
    customerId: customer.id,
    customer: customer.name,
    businessType: source.businessType || "运输",
    port: source.port,
    direction: source.direction,
    tonnage: source.tonnage,
    currency: source.currency || "",
    quantity: source.quantity,
    weight: source.weight,
    vehicleSource: source.vehicleSource,
    supplier: source.vehicleSource === "外派车辆" ? source.supplier : "",
    plate: source.plate,
    driver: source.driver,
    hkDriver: source.hkDriver,
    mainlandDriver: source.mainlandDriver,
    transportMode: normalizeTransportMode(source.transportMode || ""),
    loading: source.loading,
    unloading: source.unloading,
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
  normalizeTransportMode,
  orderPayloadFromForm,
  presentDispatchRows,
  presentUnplannedOrders,
  rowFromForm,
  sanitizeDispatchRow,
  sortDispatchRows
};
