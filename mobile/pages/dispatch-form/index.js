const api = require("../../utils/api");
const { clearDispatchFormContext, DISPATCH_DATE_KEY, getDispatchFormContext } = require("../../utils/context");
const { currentTimestampInputValue, todayInputValue } = require("../../utils/date");
const { dispatchCopyQuery, dispatchSharePath, enableShareMenu, shareImageUrl } = require("../../utils/share");
const {
  BUSINESS_TYPE_OPTIONS,
  DIRECTION_OPTIONS,
  PORT_OPTIONS,
  TONNAGE_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  VEHICLE_SOURCE_OPTIONS,
  formFromDispatchRow,
  generateDispatchNo,
  normalizePlateText,
  normalizeUserText,
  normalizeDispatchRows,
  normalizeTransportMode,
  orderPayloadFromForm,
  rowFromForm,
  sanitizeDispatchRow,
  sortDispatchRows
} = require("../../utils/dispatch");

function titleForMode(mode) {
  if (mode === "order-edit") return "编辑订单";
  if (mode === "edit") return "编辑排车单";
  if (mode === "copy") return "复制排车单";
  return "新建排车单";
}

function subtitleForMode(mode, form = {}) {
  if (mode === "order-edit") {
    return `订单号：${form.orderNo || "保存时生成"} · 排车单号：${form.dispatchNo || "-"}`;
  }
  return `排车单号：${form.dispatchNo || "保存时生成"}`;
}

function isEditMode(mode) {
  return mode === "edit" || mode === "order-edit";
}

function isOrderEditMode(mode) {
  return mode === "order-edit";
}

function dispatchStatusFromOrderStatus(status) {
  const text = status === undefined || status === null ? "" : String(status).trim();
  if (text === "已签收" || text === "已审核") return "已签收";
  if (text === "费用待确认") return "异常滞留";
  if (text === "通关中") return "通关中";
  if (text === "正常" || text === "待确认" || text === "预排") return "预排";
  return text;
}

function createOrderFeeRow(fee = {}) {
  const quantity = Number(fee.quantity);
  const unitPrice = Number(fee.unitPrice ?? fee.unit_price ?? 0);
  const amount = Number(fee.amount ?? 0);
  const costValue = fee.cost === undefined || fee.cost === null || fee.cost === "" ? "" : Number(fee.cost);
  return {
    category: normalizeUserText(fee.category || "正常", { singleLine: true, compactCjkSpacing: true }) || "正常",
    name: normalizeUserText(fee.name, { singleLine: true, compactCjkSpacing: true }),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
    currency: normalizeUserText(fee.currency || "港币", { singleLine: true, compactCjkSpacing: true }) || "港币",
    amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
    cost: Number.isFinite(costValue) && costValue >= 0 ? costValue : "",
    remark: normalizeUserText(fee.remark, { singleLine: true, compactCjkSpacing: true })
  };
}

function normalizeOrderFeeRows(fees = []) {
  const rows = (Array.isArray(fees) ? fees : []).map((fee) => createOrderFeeRow(fee));
  return rows.length ? rows : [createOrderFeeRow()];
}

function payloadOrderFeeRows(fees = []) {
  return normalizeOrderFeeRows(fees)
    .filter((fee) => fee.name)
    .map((fee) => ({
      category: fee.category,
      name: fee.name,
      quantity: Number(fee.quantity || 1),
      unitPrice: Number(fee.unitPrice || 0),
      currency: fee.currency || "港币",
      amount: Number(fee.amount || 0),
      cost: fee.cost === "" ? null : Number(fee.cost || 0),
      remark: fee.remark || ""
    }));
}

function uniqueTextList(values) {
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (text && result.indexOf(text) < 0) result.push(text);
  });
  return result;
}

function customerShortDisplay(customer) {
  if (!customer) return "";
  return String(customer.shortName || customer.short_name || customer.name || "").trim();
}

function customerOptionPrimaryDisplay(customer) {
  return customerShortDisplay(customer);
}

function customerOptionSecondaryDisplay(customer) {
  return "";
}

function customerSearchText(customer) {
  return [
    customer && customer.id,
    customer && customer.name,
    customerShortDisplay(customer),
    customer && customer.contact,
    customer && customer.mobile
  ].join(" ").toLowerCase();
}

function driverSearchText(driver) {
  return [
    driver && driver.name,
    driver && driver.type,
    driver && driver.phone,
    driver && driver.license,
    driver && driver.employmentStatus
  ].join(" ").toLowerCase();
}

function customerMatchesInput(customer, text) {
  const target = String(text || "").trim();
  if (!target || !customer) return false;
  return String(customer.name || "").trim() === target
    || String(customer.shortName || customer.short_name || "").trim() === target
    || String(customer.id || "").trim() === target;
}

function findCustomerByIdOrText(customers, customerId, customerText) {
  const rows = (Array.isArray(customers) ? customers : []).filter((item) => item.type === "客户");
  const id = String(customerId || "").trim();
  const text = String(customerText || "").trim();
  return rows.find((item) => id && String(item.id) === id)
    || rows.find((item) => customerMatchesInput(item, text))
    || null;
}

function orderSignRequirementForCustomer(customer, fallbackName) {
  const values = [
    customer && customer.id,
    customer && customer.name,
    customer && customer.shortName,
    customer && customer.short_name,
    fallbackName
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return ORDER_SIGN_REQUIREMENT_CUSTOMERS.find((rule) =>
    values.some((value) =>
      rule.keywords.some((keyword) => normalizeLocationText(value).indexOf(normalizeLocationText(keyword)) >= 0)
    )
  ) || null;
}

function missingOrderSignRequiredFieldLabels(form, customer) {
  const requirement = orderSignRequirementForCustomer(customer, form && form.customer);
  if (!requirement) return [];
  const labels = [];
  if (requirement.tripNo && !String(form && form.tripNo || "").trim()) labels.push("车次号");
  if (requirement.sixSheetNo && !String(form && form.sixSheetNo || "").trim()) labels.push("六联单号");
  return labels;
}

function orderSignRequiredMessage(labels) {
  return labels && labels.length ? `请先填写${labels.join("和")}后再签收` : "";
}

function decorateCustomerSuggestion(customer) {
  return Object.assign({}, customer, {
    displayName: customerOptionPrimaryDisplay(customer),
    secondaryText: customerOptionSecondaryDisplay(customer)
  });
}

function decorateDriverSuggestion(driver) {
  return {
    id: driver && driver.id ? String(driver.id) : "",
    name: String(driver && driver.name || "").trim(),
    displayName: String(driver && driver.name || "").trim(),
    secondaryText: String(driver && driver.type || "").trim()
  };
}

function filterDriverSuggestions(drivers, keyword) {
  const normalizedKeyword = String(keyword || "").trim().toLowerCase();
  return (Array.isArray(drivers) ? drivers : [])
    .filter((driver) => String(driver && driver.employmentStatus || "在职").trim() !== "离职")
    .filter((driver) => {
      if (!normalizedKeyword) return true;
      return driverSearchText(driver).indexOf(normalizedKeyword) >= 0;
    })
    .slice(0, 8)
    .map((driver) => decorateDriverSuggestion(driver));
}

const LOCATION_ENTRY_KEYS = {
  loading: "loadingEntries",
  unloading: "unloadingEntries"
};
const LOAD_TIME_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const LOAD_TIME_MINUTES = ["00", "15", "30", "45"];
const ORDER_BUSINESS_TYPE_OPTIONS = ["运输", "报关", "运输+报关"];
const FEE_CATEGORY_OPTIONS = ["正常", "代垫", "公司自费"];
const ORDER_STATUS_OPTIONS = ["待确认", "预排", "正常", "通关中", "已签收", "已审核", "缺票据", "费用待确认"];
const ORDER_SIGN_REQUIREMENT_CUSTOMERS = [
  { keywords: ["恒泰通"], tripNo: true, sixSheetNo: true },
  { keywords: ["前海慧华"], tripNo: true, sixSheetNo: true },
  { keywords: ["深佩"], sixSheetNo: true }
];

let locationEntrySerial = 0;

function nextLocationEntryId() {
  locationEntrySerial += 1;
  return `location-entry-${Date.now()}-${locationEntrySerial}`;
}

function createLocationEntry(value) {
  const hasStructuredParts = value && typeof value === "object"
    && (value.city !== undefined || value.district !== undefined || value.detail !== undefined);
  const parts = hasStructuredParts ? null : splitLocationParts(value && typeof value === "object" ? value.value : value);
  const city = hasStructuredParts ? normalizeUserText(value.city, { singleLine: true, compactCjkSpacing: true }) : parts.city;
  const district = hasStructuredParts ? normalizeUserText(value.district, { singleLine: true, compactCjkSpacing: true }) : parts.district;
  const detail = hasStructuredParts ? normalizeUserText(value.detail, { singleLine: true, compactCjkSpacing: true }) : parts.detail;
  return {
    id: nextLocationEntryId(),
    city,
    district,
    detail,
    value: composeLocationParts(city, district, detail)
  };
}

function locationEntryValue(entry) {
  const value = entry && typeof entry === "object" ? entry.value : entry;
  return value === undefined || value === null ? "" : String(value).trim();
}

function splitLocationEntries(value) {
  const text = normalizeUserText(value, { compactCjkSpacing: true });
  if (!text.trim()) return [createLocationEntry("")];
  const trailingBlankCount = (text.match(/[；;]+$/)?.[0].length) || 0;
  const body = trailingBlankCount > 0 ? text.slice(0, text.length - trailingBlankCount) : text;
  const entries = body
    .split(/[；;]+/)
    .map((item) => createLocationEntry(item))
    .filter((item) => item && item.value);
  if (!entries.length) return [createLocationEntry("")];
  return trailingBlankCount > 0
    ? [...entries, ...Array.from({ length: trailingBlankCount }, () => createLocationEntry(""))]
    : entries;
}

function normalizeLocationEntries(entries) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((item) => {
      if (item && typeof item === "object") {
        const hasStructuredParts = item.city !== undefined || item.district !== undefined || item.detail !== undefined;
        const parts = hasStructuredParts ? null : splitLocationParts(item.value);
        const city = hasStructuredParts ? normalizeUserText(item.city, { singleLine: true, compactCjkSpacing: true }) : parts.city;
        const district = hasStructuredParts ? normalizeUserText(item.district, { singleLine: true, compactCjkSpacing: true }) : parts.district;
        const detail = hasStructuredParts ? normalizeUserText(item.detail, { singleLine: true, compactCjkSpacing: true }) : parts.detail;
        return {
          id: item.id || nextLocationEntryId(),
          city,
          district,
          detail,
          value: composeLocationParts(city, district, detail)
        };
      }
      return createLocationEntry(item);
    });
  return normalized.length ? normalized : [createLocationEntry("")];
}

function joinLocationEntries(entries) {
  return normalizeLocationEntries(entries)
    .map((entry) => entry.value)
    .filter(Boolean)
    .join("；");
}

function locationEntryCount(entries) {
  return normalizeLocationEntries(entries).filter((entry) => entry.value).length;
}

function locationEntriesPatchFromForm(form) {
  const loadingEntries = splitLocationEntries(form && form.loading);
  const unloadingEntries = splitLocationEntries(form && form.unloading);
  return {
    loadingEntries,
    unloadingEntries,
    loadingEntryCount: locationEntryCount(loadingEntries),
    unloadingEntryCount: locationEntryCount(unloadingEntries)
  };
}

function loadTimePickerValueFromText(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return [12, 0];
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minuteIndex = LOAD_TIME_MINUTES.indexOf(match[2]);
  return [hour, minuteIndex >= 0 ? minuteIndex : 0];
}

function loadTimeTextFromPicker(value) {
  const hourIndex = Number(Array.isArray(value) ? value[0] : 0);
  const minuteIndex = Number(Array.isArray(value) ? value[1] : 0);
  const hour = LOAD_TIME_HOURS[Number.isFinite(hourIndex) ? hourIndex : 0] || "00";
  const minute = LOAD_TIME_MINUTES[Number.isFinite(minuteIndex) ? minuteIndex : 0] || "00";
  return `${hour}:${minute}`;
}

function normalizeLocationText(value = "") {
  return normalizeUserText(value, { compactCjkSpacing: true })
    .replace(/\r/g, "\n")
    .replace(/[；;]/g, "\n")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function normalizeCityLookupText(value = "") {
  const text = normalizeLocationText(value);
  if (!text) return "";
  if (text === "香港" || text === "澳门") return text;
  return text.replace(/市$/u, "");
}

function cityNameMatches(left = "", right = "") {
  const leftText = normalizeLocationText(left);
  const rightText = normalizeLocationText(right);
  if (!leftText || !rightText) return false;
  return leftText === rightText || normalizeCityLookupText(leftText) === normalizeCityLookupText(rightText);
}

function splitLocationParts(value = "") {
  const text = normalizeUserText(value, { singleLine: true, compactCjkSpacing: true });
  if (!text) return { city: "", district: "", detail: "" };
  const normalized = text
    .replace(/[／｜|]+/g, "/")
    .replace(/\s*\/\s*/g, "/");
  if (normalized.indexOf("/") >= 0) {
    const parts = normalized.split("/").map((item) => String(item || "").trim());
    return {
      city: parts[0] || "",
      district: parts[1] || "",
      detail: parts.slice(2).join(" / ")
    };
  }
  const cityMatch = text.match(/^(.+?(?:市|香港|澳门))/u);
  const city = cityMatch ? cityMatch[1] : "";
  const afterCity = city ? text.slice(city.length).trim() : text;
  const districtMatch = afterCity.match(/^(.+?(?:区|县|镇|乡|街道))/u);
  const district = districtMatch ? districtMatch[1] : "";
  const detail = district ? afterCity.slice(district.length).trim() : afterCity;
  return {
    city,
    district,
    detail: city || district ? detail : text
  };
}

function composeLocationParts(city = "", district = "", detail = "") {
  return [city, district, detail]
    .map((part) => normalizeUserText(part, { singleLine: true, compactCjkSpacing: true }))
    .filter(Boolean)
    .join(" / ");
}

function normalizeLocationPartValue(value = "", part = "") {
  const text = normalizeUserText(value, { singleLine: true, compactCjkSpacing: true });
  if (!text || part === "detail") return text;
  const parsed = splitLocationParts(text);
  if (part === "city") return parsed.city || text;
  if (part === "district") return parsed.district || text;
  return text;
}

function customerContactLocationValue(contact = {}) {
  return [String(contact.area || "").trim(), String(contact.address || "").trim()]
    .filter(Boolean)
    .join(" / ");
}

function locationTargetLabel(target = "") {
  return target === "unloading" ? "卸货地" : "装货地";
}

function normalizeCustomerContactRow(row = {}) {
  const area = String(row.area || "").trim();
  const contact = String(row.name || row.contact || "").trim();
  const phone = String(row.mobile || row.phone || "").trim();
  const address = String(row.address || "").trim();
  const note = String(row.remark || "").trim();
  const value = customerContactLocationValue({ area, address });
  return {
    id: row.id === undefined || row.id === null ? "" : String(row.id),
    area,
    contact,
    phone,
    address,
    note,
    value,
    searchText: [row.id, area, contact, phone, address, note, value].map((item) => String(item || "").trim()).join(" ").toLowerCase()
  };
}

function createBlankAddressBookForm() {
  return {
    area: "",
    city: "",
    district: "",
    contact: "",
    phone: "",
    address: "",
    note: ""
  };
}

function ensureDispatchCurrency(form) {
  if (form && !String(form.currency || "").trim()) {
    form.currency = "港币";
  }
  return form;
}

function normalizeDispatchFormForDisplay(form) {
  if (!form || typeof form !== "object") return form;
  form.transportMode = normalizeTransportMode(form.transportMode || "");
  if (!form.transportMode || form.transportMode === "单司机") {
    form.driver = String(form.driver || form.hkDriver || "").trim();
    form.hkDriver = "";
    form.mainlandDriver = "";
  } else if (!String(form.hkDriver || "").trim() && String(form.driver || "").includes(" / ")) {
    const [hkDriver = "", mainlandDriver = ""] = String(form.driver || "").split(" / ");
    form.hkDriver = hkDriver.trim();
    form.mainlandDriver = mainlandDriver.trim();
    form.driver = "";
  }
  ensureDispatchCurrency(form);
  return form;
}

function normalizeDispatchFormForSave(form) {
  if (!form || typeof form !== "object") return form;
  const vehicleSource = String(form.vehicleSource || "").trim() === "本公司车辆" ? "汉业物流" : String(form.vehicleSource || "").trim();
  form.vehicleSource = vehicleSource;
  form.plate = normalizePlateText(form.plate);
  form.transportMode = normalizeTransportMode(form.transportMode || "");
  if (vehicleSource === "汉业物流") {
    if (form.transportMode === "双司机" || form.transportMode === "口岸转国内车") {
      form.driver = [form.hkDriver, form.mainlandDriver].filter(Boolean).join(" / ");
    } else {
      form.driver = String(form.driver || form.hkDriver || "").trim();
      form.hkDriver = "";
      form.mainlandDriver = "";
    }
  } else if (vehicleSource === "外派车辆") {
    form.driver = "";
    form.hkDriver = "";
    form.mainlandDriver = "";
    form.transportMode = "";
  } else {
    form.plate = "";
    form.supplier = "";
    form.driver = "";
    form.hkDriver = "";
    form.mainlandDriver = "";
    form.transportMode = "";
  }
  ensureDispatchCurrency(form);
  return form;
}

function normalizeAddressBookRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeCustomerContactRow(row))
    .filter((row) => Boolean(row.contact || row.phone || row.area || row.address));
}

function filterAddressBookRows(rows, keyword) {
  const normalizedKeyword = normalizeLocationText(keyword);
  if (!normalizedKeyword) return rows.slice();
  return rows.filter((row) => row.searchText.indexOf(normalizedKeyword) >= 0);
}

function rowsWithAddressBookSelection(rows = [], selectedIds = []) {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((item) => String(item)));
  return (Array.isArray(rows) ? rows : []).map((row) => Object.assign({}, row, {
    selected: selected.has(String(row.id))
  }));
}

function selectedAddressBookIdsForValue(value, rows) {
  const values = splitLocationEntries(value).map((entry) => locationEntryValue(entry)).filter(Boolean);
  if (!values.length) return [];
  const optionIdsByValue = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    [
      row.value,
      row.address,
      row.area,
      [row.area, row.address].filter(Boolean).join(" / ")
    ].forEach((candidate) => {
      const key = normalizeLocationText(candidate);
      if (key && !optionIdsByValue.has(key)) optionIdsByValue.set(key, row.id);
    });
  });
  const selectedIds = [];
  values.forEach((item) => {
    const id = optionIdsByValue.get(normalizeLocationText(item));
    if (id && selectedIds.indexOf(id) < 0) selectedIds.push(id);
  });
  return selectedIds;
}

function uniqueSortedTextList(values) {
  return uniqueTextList(values).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
}

function areaCatalogCityOptions(catalog = {}, rows = []) {
  return uniqueSortedTextList([
    ...(Array.isArray(catalog.level1Options) ? catalog.level1Options : []),
    ...(Array.isArray(rows) ? rows : []).map((row) => splitLocationParts(row && row.area).city)
  ]);
}

function areaCatalogDistrictOptions(catalog = {}, city = "", rows = []) {
  const targetCity = String(city || "").trim();
  const level2OptionsByLevel1 = catalog.level2OptionsByLevel1 || {};
  const allCatalogDistricts = Object.keys(level2OptionsByLevel1).reduce((result, level1) => {
    return result.concat(level2OptionsByLevel1[level1] || []);
  }, []);
  const cityCatalogDistricts = targetCity
    ? Object.keys(level2OptionsByLevel1).reduce((result, level1) => {
      return cityNameMatches(level1, targetCity) ? result.concat(level2OptionsByLevel1[level1] || []) : result;
    }, [])
    : [];
  const catalogDistricts = targetCity ? (cityCatalogDistricts.length ? cityCatalogDistricts : allCatalogDistricts) : allCatalogDistricts;
  const rowDistricts = (Array.isArray(rows) ? rows : [])
    .map((row) => splitLocationParts(row && row.area))
    .filter((parts) => !targetCity || cityNameMatches(parts.city, targetCity))
    .map((parts) => parts.district);
  return uniqueSortedTextList([...catalogDistricts, ...rowDistricts]);
}

function filterLocationOptions(options = [], keyword = "") {
  const normalizedKeyword = normalizeLocationText(keyword);
  const cityKeyword = normalizeCityLookupText(keyword);
  const rows = Array.isArray(options) ? options : [];
  if (!normalizedKeyword) return rows.slice(0, 12);
  return rows
    .filter((item) => {
      const itemText = normalizeLocationText(item);
      if (itemText.indexOf(normalizedKeyword) >= 0) return true;
      const cityItem = normalizeCityLookupText(item);
      return Boolean(cityKeyword && cityItem && (cityItem.indexOf(cityKeyword) >= 0 || cityKeyword.indexOf(cityItem) >= 0));
    })
    .slice(0, 12);
}

function splitAreaPickerPath(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[／｜|]+/g, "/")
    .replace(/\s*\/\s*/g, "/")
    .split("/")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function formatAreaPickerPath(level1 = "", level2 = "") {
  return [level1, level2].map((item) => String(item || "").trim()).filter(Boolean).join(" / ");
}

function buildAddressBookAreaCatalog(rows = []) {
  const level2OptionsByLevel1 = {};
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const level1 = String(row && (row.level1 || row.city) || "").trim();
    const level2 = String(row && row.level2 || "").trim();
    if (!level1) return;
    const key = `${level1}||${level2}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (!level2OptionsByLevel1[level1]) level2OptionsByLevel1[level1] = [];
    if (level2 && level2OptionsByLevel1[level1].indexOf(level2) < 0) {
      level2OptionsByLevel1[level1].push(level2);
    }
  });
  const level1Options = uniqueSortedTextList(Object.keys(level2OptionsByLevel1));
  level1Options.forEach((level1) => {
    level2OptionsByLevel1[level1] = uniqueSortedTextList(level2OptionsByLevel1[level1] || []);
  });
  return {
    level1Options,
    level2OptionsByLevel1
  };
}

function realtimeEventAffectsFormReferences(event) {
  const modules = new Set(Array.isArray(event && event.affectedModules) ? event.affectedModules.map(String) : []);
  if (modules.has("customers") || modules.has("vehicleDriver") || modules.has("freight")) return true;
  return ["customer", "customer_contact", "address_book", "vehicle", "driver", "freight_rate"].indexOf(String(event && event.entityType || "")) >= 0;
}

Page({
  data: {
    addressBookForm: createBlankAddressBookForm(),
    addressBookFormOpen: false,
    addressBookKeyword: "",
    addressBookLoading: false,
    addressBookRows: [],
    addressBookSaving: false,
    addressBookSelectedIds: [],
    addressBookVisibleRows: [],
    addressBookCustomerReady: false,
    addressBookCityOptions: [],
    addressBookSuggestionPart: "",
    addressBookSuggestionOptions: [],
    addressBookAreaLevel1Options: [],
    addressBookAreaLevel2Options: [],
    addressBookAreaPickerRange: [[], []],
    addressBookAreaPickerValue: [0, 0],
    businessTypeOptions: BUSINESS_TYPE_OPTIONS,
    customerPickerOpen: false,
    customerSuggestions: [],
    customers: [],
    currencyOptions: ["港币", "人民币"],
    directionOptions: DIRECTION_OPTIONS,
    driverPickerOpen: false,
    driverSuggestions: [],
    driverOptions: [],
    feeCategoryOptions: FEE_CATEGORY_OPTIONS,
    form: {},
    hkDriverOptions: [],
    loadingEntries: [createLocationEntry("")],
    loadingEntryCount: 0,
    loadingRefs: true,
    locationSuggestionTarget: "",
    locationSuggestionIndex: -1,
    locationSuggestionPart: "",
    locationSuggestionOptions: [],
    loadTimePickerRange: [LOAD_TIME_HOURS, LOAD_TIME_MINUTES],
    loadTimePickerValue: [12, 0],
    locationPickerOpen: false,
    locationPickerTarget: "",
    locationPickerTitle: "",
    isOrderEditMode: false,
    mainlandDriverOptions: [],
    mode: "new",
    orderFeeRows: [createOrderFeeRow()],
    orderStatusOptions: ORDER_STATUS_OPTIONS,
    originDate: "",
    plateOptions: [],
    portOptions: PORT_OPTIONS,
    saving: false,
    sourceRow: null,
    subtitle: "排车单号：保存时生成",
    supplierOptions: [],
    title: "新建排车单",
    tonnageOptions: TONNAGE_OPTIONS,
    transportModeOptions: TRANSPORT_MODE_OPTIONS,
    unloadingEntries: [createLocationEntry("")],
    unloadingEntryCount: 0,
    vehicleSourceOptions: VEHICLE_SOURCE_OPTIONS,
    vehicles: []
  },

  onLoad() {
    enableShareMenu();
    this.addressBookAreaCatalog = buildAddressBookAreaCatalog();
    const context = getDispatchFormContext();
    const mode = context.mode || "new";
    const date = context.date || todayInputValue();
    const sourceRow = context.row || null;
    let form = formFromDispatchRow(sourceRow || {}, date);
    if (mode === "new") {
      form = formFromDispatchRow({}, date);
      form.dispatchNo = "";
      form.orderNo = "";
      form.createdAt = "";
    }
    if (mode === "copy") {
      form.id = "";
      form.orderNo = "";
      form.dispatchNo = "";
      form.status = "预排";
      form.createdByAccountId = null;
      form.createdByUsername = "";
      form.createdByName = "";
      form.createdAt = "";
    }
    if (mode === "order-edit" && sourceRow && sourceRow.order && sourceRow.order.status) {
      form.status = sourceRow.order.status;
    }
    normalizeDispatchFormForDisplay(form);
    const locationPatch = locationEntriesPatchFromForm(form);
    this.setData({
      form,
      ...locationPatch,
      businessTypeOptions: isOrderEditMode(mode) ? ORDER_BUSINESS_TYPE_OPTIONS : BUSINESS_TYPE_OPTIONS,
      orderFeeRows: isOrderEditMode(mode) ? normalizeOrderFeeRows(sourceRow && sourceRow.order && sourceRow.order.fees) : [createOrderFeeRow()],
      loadTimePickerValue: loadTimePickerValueFromText(form.loadTime),
      mode,
      originDate: date,
      sourceRow,
      subtitle: subtitleForMode(mode, form),
      title: titleForMode(mode),
      isOrderEditMode: isOrderEditMode(mode)
    });
    wx.setNavigationBarTitle({ title: titleForMode(mode) });
    this.loadReferences();
  },

  onShow() {
    enableShareMenu();
    this.attachRealtime();
  },

  onShareAppMessage() {
    const date = this.data.form && this.data.form.date ? this.data.form.date : this.data.originDate;
    return {
      title: `${this.data.title || "排车单"} - 汉业排车`,
      path: dispatchSharePath(date || todayInputValue(), "all"),
      imageUrl: shareImageUrl()
    };
  },

  onShareTimeline() {
    const date = this.data.form && this.data.form.date ? this.data.form.date : this.data.originDate;
    return {
      title: `${this.data.title || "排车单"} - 汉业排车`,
      query: dispatchCopyQuery(date || todayInputValue(), "all")
    };
  },

  onCopyUrl() {
    const date = this.data.form && this.data.form.date ? this.data.form.date : this.data.originDate;
    return {
      query: dispatchCopyQuery(date || todayInputValue(), "all")
    };
  },

  onUnload() {
    this.detachRealtime();
    clearDispatchFormContext();
  },

  onHide() {
    this.detachRealtime();
  },

  attachRealtime() {
    if (this.realtimeUnsubscribe) return;
    this.realtimeUnsubscribe = getApp().registerRealtimeListener((event) => {
      this.onRealtimeChange(event);
    });
  },

  detachRealtime() {
    if (this.realtimeReloadTimer) {
      clearTimeout(this.realtimeReloadTimer);
      this.realtimeReloadTimer = null;
    }
    if (this.realtimeUnsubscribe) {
      this.realtimeUnsubscribe();
      this.realtimeUnsubscribe = null;
    }
  },

  onRealtimeChange(event) {
    if (!realtimeEventAffectsFormReferences(event)) return;
    if (this.realtimeReloadTimer) clearTimeout(this.realtimeReloadTimer);
    this.realtimeReloadTimer = setTimeout(() => {
      this.realtimeReloadTimer = null;
      this.loadReferences({ silent: true });
    }, 500);
  },

  async loadReferences(options) {
    const silent = options && options.silent;
    if (!silent) this.setData({ loadingRefs: true });
    try {
      const [customers, vehicles, drivers, freightRates] = await Promise.all([
        api.listCustomers(),
        api.listVehicles(),
        api.listDrivers(),
        api.listFreightRates().catch(() => [])
      ]);
      this.addressBookAreaCatalog = buildAddressBookAreaCatalog(
        (Array.isArray(freightRates) ? freightRates : []).filter((item) => !String(item.customerId || item.customer_id || "").trim() && !String(item.customerName || item.customer_name || "").trim())
      );
      const addressBookCityOptions = areaCatalogCityOptions(this.addressBookAreaCatalog, this.data.addressBookRows || []);
      const form = normalizeDispatchFormForDisplay(Object.assign({}, this.data.form));
      const matchedCustomer = findCustomerByIdOrText(customers, form.customerId, form.customer);
      if (matchedCustomer) {
        form.customerId = matchedCustomer.id;
        form.customer = customerOptionPrimaryDisplay(matchedCustomer);
      }
      this.applyOrderRequiredFieldDefaults(form, matchedCustomer);
      const locationPatch = locationEntriesPatchFromForm(form);
      this.setData({
        addressBookCityOptions,
        customers,
        drivers,
        driverOptions: uniqueTextList(drivers.map((item) => item.name)),
        form,
        hkDriverOptions: uniqueTextList(drivers.filter((item) => (item.type || "香港司机") === "香港司机").map((item) => item.name)),
        loadingEntries: locationPatch.loadingEntries,
        loadingEntryCount: locationPatch.loadingEntryCount,
        loadingRefs: false,
        loadTimePickerValue: loadTimePickerValueFromText(form.loadTime),
        mainlandDriverOptions: uniqueTextList(drivers.filter((item) => item.type === "大陆骑师").map((item) => item.name)),
        plateOptions: uniqueTextList(vehicles.map((vehicle) => vehicle.plate).filter(Boolean)),
        supplierOptions: uniqueTextList(customers.filter((item) => item.type === "供应商").map((item) => item.name).filter(Boolean)),
        unloadingEntries: locationPatch.unloadingEntries,
        unloadingEntryCount: locationPatch.unloadingEntryCount,
        vehicles
      });
      this.syncAddressBookAreaPicker();
      this.refreshCustomerSuggestions();
      this.refreshDriverSuggestions();
    } catch (error) {
      if (!silent) this.setData({ loadingRefs: false });
      if (silent) {
        console.warn("Realtime reference refresh failed", error);
      } else {
        wx.showToast({ title: error.message || "读取基础资料失败", icon: "none" });
      }
    } finally {
      if (!silent) wx.hideLoading();
    }
  },

  refreshCustomerSuggestions() {
    const keyword = String(this.data.form.customer || "").trim().toLowerCase();
    const rows = (this.data.customers || [])
      .filter((item) => item.type === "客户")
      .filter((item) => {
        if (!keyword) return true;
        return customerSearchText(item).indexOf(keyword) >= 0;
      })
      .slice(0, 8)
      .map((item) => decorateCustomerSuggestion(item));
    this.setData({ customerSuggestions: rows });
  },

  refreshDriverSuggestions(keyword) {
    const text = keyword === undefined ? String(this.data.form.driver || "").trim() : String(keyword || "").trim();
    this.setData({
      driverSuggestions: filterDriverSuggestions(this.data.drivers || [], text)
    });
  },

  applyOrderRequiredFieldDefaults(form, customer) {
    if (!isOrderEditMode(this.data.mode)) return form;
    const targetForm = form || Object.assign({}, this.data.form);
    const matchedCustomer = customer || findCustomerByIdOrText(this.data.customers || [], targetForm.customerId, targetForm.customer);
    const requirement = orderSignRequirementForCustomer(matchedCustomer, targetForm.customer);
    if (!requirement) return targetForm;
    if (requirement.tripNo) targetForm.tripNoEnabled = 1;
    if (requirement.sixSheetNo) targetForm.sixSheetEnabled = 1;
    if (!form) this.setData({ form: targetForm });
    return targetForm;
  },

  closeDriverPicker() {
    this.setData({
      driverPickerOpen: false,
      driverSuggestions: []
    });
  },

  scheduleCloseDriverSuggestion() {
    setTimeout(() => {
      if (this.data.driverPickerOpen) {
        this.closeDriverPicker();
      }
    }, 180);
  },

  onDriverFocus() {
    this.setData({ driverPickerOpen: true });
    this.refreshDriverSuggestions();
  },

  selectDriverSuggestion(event) {
    const value = String(event.currentTarget.dataset.value || "").trim();
    this.setData({
      "form.driver": value,
      driverPickerOpen: false,
      driverSuggestions: []
    });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.setData({ [`form.${field}`]: value });
    if (field === "customer") {
      this.setData({ "form.customerId": "", customerPickerOpen: true });
      this.refreshCustomerSuggestions();
      return;
    }
    if (field === "driver") {
      this.setData({ driverPickerOpen: true });
      this.refreshDriverSuggestions(value);
    }
  },

  setLocationEntries(target, entries) {
    const entriesKey = LOCATION_ENTRY_KEYS[target];
    if (!entriesKey) return;
    const normalized = normalizeLocationEntries(entries);
    this.setData({
      [entriesKey]: normalized,
      [`${target}EntryCount`]: locationEntryCount(normalized),
      [`form.${target}`]: joinLocationEntries(normalized)
    });
  },

  locationCityOptions() {
    return areaCatalogCityOptions(this.addressBookAreaCatalog || buildAddressBookAreaCatalog(), this.data.addressBookRows || []);
  },

  locationDistrictOptions(city) {
    return areaCatalogDistrictOptions(this.addressBookAreaCatalog || buildAddressBookAreaCatalog(), city, this.data.addressBookRows || []);
  },

  refreshLocationSuggestion(target, index, part, keyword) {
    const entriesKey = LOCATION_ENTRY_KEYS[target];
    const entries = normalizeLocationEntries(this.data[entriesKey] || []);
    const entry = entries[Number(index || 0)] || createLocationEntry("");
    const options = part === "city"
      ? this.locationCityOptions()
      : this.locationDistrictOptions(entry.city);
    this.setData({
      locationSuggestionTarget: target,
      locationSuggestionIndex: Number(index || 0),
      locationSuggestionPart: part,
      locationSuggestionOptions: filterLocationOptions(options, keyword)
    });
  },

  clearLocationSuggestion() {
    this.setData({
      locationSuggestionTarget: "",
      locationSuggestionIndex: -1,
      locationSuggestionPart: "",
      locationSuggestionOptions: []
    });
  },

  scheduleCloseLocationSuggestion(event) {
    const target = event.currentTarget.dataset.target;
    const index = Number(event.currentTarget.dataset.index || 0);
    const part = event.currentTarget.dataset.part;
    setTimeout(() => {
      if (
        this.data.locationSuggestionTarget === target &&
        Number(this.data.locationSuggestionIndex) === index &&
        this.data.locationSuggestionPart === part
      ) {
        this.clearLocationSuggestion();
      }
    }, 180);
  },

  updateLocationEntryPart(target, index, part, value) {
    const entriesKey = LOCATION_ENTRY_KEYS[target];
    if (!entriesKey) return;
    const entries = normalizeLocationEntries(this.data[entriesKey] || []);
    const entryIndex = Number(index || 0);
    while (entries.length <= entryIndex) entries.push(createLocationEntry(""));
    const entry = Object.assign({}, entries[entryIndex]);
    const nextValue = normalizeLocationPartValue(value, part);
    if (part === "city" && entry.city !== nextValue) {
      entry.district = "";
    }
    entry[part] = nextValue;
    entry.value = composeLocationParts(entry.city, entry.district, entry.detail);
    entries[entryIndex] = entry;
    this.setLocationEntries(target, entries);
    return entry;
  },

  onLocationPartFocus(event) {
    const target = event.currentTarget.dataset.target;
    const index = Number(event.currentTarget.dataset.index || 0);
    const part = event.currentTarget.dataset.part;
    if (part !== "city" && part !== "district") return;
    const entriesKey = LOCATION_ENTRY_KEYS[target];
    const entries = normalizeLocationEntries(this.data[entriesKey] || []);
    const entry = entries[index] || createLocationEntry("");
    const value = String(entry[part] || "").trim();
    this.refreshLocationSuggestion(target, index, part, value);
  },

  onLocationPartInput(event) {
    const target = event.currentTarget.dataset.target;
    const index = Number(event.currentTarget.dataset.index || 0);
    const part = event.currentTarget.dataset.part;
    const value = event.detail.value;
    this.updateLocationEntryPart(target, index, part, value);
    if (part === "city" || part === "district") {
      this.refreshLocationSuggestion(target, index, part, value);
    }
  },

  selectLocationSuggestion(event) {
    const target = event.currentTarget.dataset.target;
    const index = Number(event.currentTarget.dataset.index || 0);
    const part = event.currentTarget.dataset.part;
    const value = event.currentTarget.dataset.value;
    this.updateLocationEntryPart(target, index, part, value);
    this.clearLocationSuggestion();
  },

  addLocationEntry(event) {
    const target = event.currentTarget.dataset.target;
    const entriesKey = LOCATION_ENTRY_KEYS[target];
    if (!entriesKey) return;
    this.setLocationEntries(target, [
      ...normalizeLocationEntries(this.data[entriesKey] || []),
      createLocationEntry("")
    ]);
  },

  removeLocationEntry(event) {
    const target = event.currentTarget.dataset.target;
    const index = Number(event.currentTarget.dataset.index || 0);
    const entriesKey = LOCATION_ENTRY_KEYS[target];
    if (!entriesKey) return;
    if (index <= 0) return;
    const nextEntries = normalizeLocationEntries(this.data[entriesKey] || []).filter((_, entryIndex) => entryIndex !== index);
    this.setLocationEntries(target, nextEntries.length ? nextEntries : [createLocationEntry("")]);
    this.clearLocationSuggestion();
  },

  onCustomerFocus() {
    this.setData({ customerPickerOpen: true });
    this.refreshCustomerSuggestions();
  },

  closeCustomerPicker() {
    this.setData({ customerPickerOpen: false });
  },

  selectCustomer(event) {
    const id = event.currentTarget.dataset.id;
    const customer = (this.data.customers || []).find((item) => String(item.id) === String(id));
    if (!customer) return;
    const form = Object.assign({}, this.data.form, {
      customer: customerOptionPrimaryDisplay(customer),
      customerId: customer.id
    });
    this.applyOrderRequiredFieldDefaults(form, customer);
    this.setData({
      form,
      customerPickerOpen: false
    });
  },

  async onFormDateChange(event) {
    const date = event.detail.value;
    this.setData({ "form.date": date });
  },

  onNeedsWeighingChange(event) {
    this.setData({ "form.needsWeighing": Boolean(event.detail.value) });
  },

  toggleNeedsWeighing() {
    this.setData({ "form.needsWeighing": !Boolean(this.data.form && this.data.form.needsWeighing) });
  },

  onBooleanFieldChange(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: Boolean(event.detail.value) });
  },

  toggleBooleanField(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`form.${field}`]: !Boolean(this.data.form && this.data.form[field]) });
  },

  onOrderFeeInput(event) {
    const index = Number(event.currentTarget.dataset.index || 0);
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    const rows = normalizeOrderFeeRows(this.data.orderFeeRows || []);
    const nextRow = Object.assign({}, rows[index] || createOrderFeeRow(), { [field]: event.detail.value });
    if (field === "quantity" || field === "unitPrice") {
      const quantity = Number(field === "quantity" ? event.detail.value : nextRow.quantity);
      const unitPrice = Number(field === "unitPrice" ? event.detail.value : nextRow.unitPrice);
      nextRow.amount = Number(((Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(unitPrice) ? unitPrice : 0)).toFixed(2));
    }
    rows[index] = createOrderFeeRow(nextRow);
    this.setData({ orderFeeRows: rows });
  },

  onOrderFeePickerChange(event) {
    const index = Number(event.currentTarget.dataset.index || 0);
    const field = event.currentTarget.dataset.field;
    const options = this.data[event.currentTarget.dataset.optionsKey] || [];
    const value = options[Number(event.detail.value || 0)] || "";
    if (!field) return;
    const rows = normalizeOrderFeeRows(this.data.orderFeeRows || []);
    rows[index] = createOrderFeeRow(Object.assign({}, rows[index] || {}, { [field]: value }));
    this.setData({ orderFeeRows: rows });
  },

  addOrderFeeRow() {
    this.setData({ orderFeeRows: [...normalizeOrderFeeRows(this.data.orderFeeRows || []), createOrderFeeRow()] });
  },

  removeOrderFeeRow(event) {
    const index = Number(event.currentTarget.dataset.index || 0);
    const rows = normalizeOrderFeeRows(this.data.orderFeeRows || []).filter((_, rowIndex) => rowIndex !== index);
    this.setData({ orderFeeRows: rows.length ? rows : [createOrderFeeRow()] });
  },

  handleVehicleSourceChange(value) {
    const form = Object.assign({}, this.data.form, { vehicleSource: value });
    if (value === "汉业物流") {
      form.supplier = "";
    } else if (value === "外派车辆") {
      form.driver = "";
      form.hkDriver = "";
      form.mainlandDriver = "";
      form.transportMode = "";
    } else {
      form.plate = "";
      form.supplier = "";
      form.driver = "";
      form.hkDriver = "";
      form.mainlandDriver = "";
      form.transportMode = "";
    }
    normalizeDispatchFormForDisplay(form);
    this.setData({ form, driverPickerOpen: false, driverSuggestions: [] });
  },

  handleTransportModeChange(value) {
    const transportMode = normalizeTransportMode(value);
    const form = Object.assign({}, this.data.form, { transportMode });
    if (transportMode === "双司机" || transportMode === "口岸转国内车") {
      if (!String(form.hkDriver || "").trim()) {
        if (String(form.driver || "").includes(" / ")) {
          const [hkDriver = "", mainlandDriver = ""] = String(form.driver || "").split(" / ");
          form.hkDriver = hkDriver.trim();
          if (!String(form.mainlandDriver || "").trim()) {
            form.mainlandDriver = mainlandDriver.trim();
          }
        } else {
          form.hkDriver = String(form.driver || "").trim();
        }
      }
      form.driver = "";
    } else {
      form.driver = String(form.driver || form.hkDriver || "").trim();
      form.hkDriver = "";
      form.mainlandDriver = "";
    }
    normalizeDispatchFormForDisplay(form);
    this.setData({ form, driverPickerOpen: false, driverSuggestions: [] });
  },

  onPickerChange(event) {
    const field = event.currentTarget.dataset.field;
    const optionsKey = event.currentTarget.dataset.optionsKey;
    const options = this.data[optionsKey] || [];
    const value = options[Number(event.detail.value || 0)] || "";
    if (field === "vehicleSource") {
      this.handleVehicleSourceChange(value);
      return;
    }
    if (field === "transportMode") {
      this.handleTransportModeChange(value);
      return;
    }
    const patch = { [`form.${field}`]: value };
    if (field === "currency") {
      patch["form.currency"] = value;
    }
    this.setData(patch);
  },

  onLoadTimePickerChange(event) {
    const nextValue = loadTimeTextFromPicker(event.detail.value || this.data.loadTimePickerValue);
    this.setData({
      "form.loadTime": nextValue,
      loadTimePickerValue: loadTimePickerValueFromText(nextValue)
    });
  },

  findMatchedCustomer() {
    const customerId = String(this.data.form.customerId || "").trim();
    const customerName = String(this.data.form.customer || "").trim();
    return findCustomerByIdOrText(this.data.customers || [], customerId, customerName);
  },

  async openLocationPicker(event) {
    const target = event.currentTarget.dataset.target;
    const customer = this.findMatchedCustomer();
    this.clearLocationSuggestion();
    this.setData({
      addressBookForm: createBlankAddressBookForm(),
      addressBookFormOpen: false,
      addressBookKeyword: "",
      addressBookLoading: Boolean(customer),
      addressBookRows: [],
      addressBookSelectedIds: [],
      addressBookVisibleRows: [],
      addressBookCustomerReady: Boolean(customer),
      locationPickerOpen: true,
      locationPickerTarget: target,
      locationPickerTitle: `客户联系人地址 · ${locationTargetLabel(target)}`
    });
    if (!customer) {
      this.setData({ addressBookLoading: false });
      return;
    }
    try {
      await this.loadAddressBookRows(customer.id, target);
    } catch (error) {
      this.setData({ addressBookLoading: false });
      wx.showToast({ title: error.message || "读取联系人地址失败", icon: "none" });
    }
  },

  async loadAddressBookRows(customerId, target) {
    const rows = normalizeAddressBookRows(await api.listCustomerContacts(customerId));
    const keyword = String(this.data.addressBookKeyword || "").trim();
    const addressBookSelectedIds = selectedAddressBookIdsForValue(this.data.form[target] || "", rows);
    this.setData({
      addressBookCityOptions: areaCatalogCityOptions(this.addressBookAreaCatalog || buildAddressBookAreaCatalog(), rows),
      addressBookLoading: false,
      addressBookRows: rows,
      addressBookSelectedIds,
      addressBookVisibleRows: rowsWithAddressBookSelection(filterAddressBookRows(rows, keyword), addressBookSelectedIds)
    });
  },

  closeLocationPicker() {
    this.setData({
      addressBookFormOpen: false,
      addressBookLoading: false,
      addressBookSaving: false,
      addressBookKeyword: "",
      addressBookSuggestionPart: "",
      addressBookSuggestionOptions: [],
      addressBookCustomerReady: false,
      locationPickerOpen: false,
      locationPickerTarget: "",
      locationPickerTitle: ""
    });
  },

  syncAddressBookAreaPicker(value) {
    const catalog = this.addressBookAreaCatalog || buildAddressBookAreaCatalog();
    const level1Options = Array.isArray(catalog.level1Options) ? catalog.level1Options : [];
    const parsed = splitAreaPickerPath(value === undefined ? this.data.addressBookForm.area : value);
    const selectedLevel1 = parsed[0] && level1Options.indexOf(parsed[0]) >= 0 ? parsed[0] : (level1Options[0] || "");
    const rawLevel2Options = selectedLevel1
      ? (catalog.level2OptionsByLevel1[selectedLevel1] || [])
      : [];
    const level2Options = rawLevel2Options.length ? rawLevel2Options : [""];
    const selectedLevel2 = parsed[1] && level2Options.indexOf(parsed[1]) >= 0 ? parsed[1] : (level2Options[0] || "");
    const level1Index = selectedLevel1 ? level1Options.indexOf(selectedLevel1) : 0;
    const level2Index = selectedLevel2 ? level2Options.indexOf(selectedLevel2) : 0;
    this.setData({
      addressBookAreaLevel1Options: level1Options,
      addressBookAreaLevel2Options: level2Options,
      addressBookAreaPickerRange: [level1Options, level2Options],
      addressBookAreaPickerValue: [Math.max(level1Index, 0), Math.max(level2Index, 0)]
    });
  },

  onAddressBookAreaPickerColumnChange(event) {
    const column = Number(event.detail.column || 0);
    const value = Number(event.detail.value || 0);
    const catalog = this.addressBookAreaCatalog || buildAddressBookAreaCatalog();
    const nextValue = Array.isArray(this.data.addressBookAreaPickerValue)
      ? this.data.addressBookAreaPickerValue.slice()
      : [0, 0];
    if (column === 0) {
      const level1 = (this.data.addressBookAreaLevel1Options || [])[value] || "";
      const rawLevel2Options = level1 ? (catalog.level2OptionsByLevel1[level1] || []) : [];
      const level2Options = rawLevel2Options.length ? rawLevel2Options : [""];
      nextValue[0] = value;
      nextValue[1] = 0;
      this.setData({
        addressBookAreaLevel2Options: level2Options,
        addressBookAreaPickerRange: [this.data.addressBookAreaLevel1Options || [], level2Options],
        addressBookAreaPickerValue: nextValue
      });
      return;
    }
    nextValue[column] = value;
    this.setData({ addressBookAreaPickerValue: nextValue });
  },

  onAddressBookAreaPickerChange(event) {
    const pickerValue = Array.isArray(event.detail.value) ? event.detail.value : this.data.addressBookAreaPickerValue;
    const level1 = (this.data.addressBookAreaLevel1Options || [])[Number(pickerValue[0] || 0)] || "";
    const level2 = (this.data.addressBookAreaLevel2Options || [])[Number(pickerValue[1] || 0)] || "";
    this.setData({
      "addressBookForm.area": formatAreaPickerPath(level1, level2),
      addressBookAreaPickerValue: [Number(pickerValue[0] || 0), Number(pickerValue[1] || 0)]
    });
  },

  onAddressBookKeywordInput(event) {
    const addressBookKeyword = event.detail.value;
    this.setData({
      addressBookKeyword,
      addressBookVisibleRows: rowsWithAddressBookSelection(
        filterAddressBookRows(this.data.addressBookRows || [], addressBookKeyword),
        this.data.addressBookSelectedIds || []
      )
    });
  },

  toggleAddressBookForm() {
    if (this.data.addressBookFormOpen) {
      this.setData({
        addressBookForm: createBlankAddressBookForm(),
        addressBookFormOpen: false,
        addressBookSuggestionPart: "",
        addressBookSuggestionOptions: []
      });
      return;
    }
    this.setData({
      addressBookForm: createBlankAddressBookForm(),
      addressBookFormOpen: true
    });
    this.refreshAddressBookSuggestion("city", "");
  },

  refreshAddressBookSuggestion(part, keyword) {
    const options = part === "city"
      ? areaCatalogCityOptions(this.addressBookAreaCatalog || buildAddressBookAreaCatalog(), this.data.addressBookRows || [])
      : areaCatalogDistrictOptions(this.addressBookAreaCatalog || buildAddressBookAreaCatalog(), this.data.addressBookForm.city, this.data.addressBookRows || []);
    this.setData({
      addressBookSuggestionPart: part,
      addressBookSuggestionOptions: filterLocationOptions(options, keyword)
    });
  },

  clearAddressBookSuggestion() {
    this.setData({
      addressBookSuggestionPart: "",
      addressBookSuggestionOptions: []
    });
  },

  scheduleCloseAddressBookSuggestion(event) {
    const part = event.currentTarget.dataset.field;
    setTimeout(() => {
      if (this.data.addressBookSuggestionPart === part) {
        this.clearAddressBookSuggestion();
      }
    }, 180);
  },

  onAddressBookLocationFocus(event) {
    const field = event.currentTarget.dataset.field;
    if (field !== "city" && field !== "district") return;
    this.refreshAddressBookSuggestion(field, String(this.data.addressBookForm[field] || "").trim());
  },

  onAddressBookFormInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = normalizeLocationPartValue(event.detail.value, field);
    const patch = { [`addressBookForm.${field}`]: value };
    if (field === "city") {
      patch["addressBookForm.district"] = "";
      patch["addressBookForm.area"] = formatAreaPickerPath(value, "");
    } else if (field === "district") {
      patch["addressBookForm.area"] = formatAreaPickerPath(this.data.addressBookForm.city, value);
    }
    this.setData(patch);
    if (field === "city" || field === "district") {
      this.refreshAddressBookSuggestion(field, value);
    }
  },

  selectAddressBookSuggestion(event) {
    const field = event.currentTarget.dataset.field;
    const value = normalizeLocationPartValue(event.currentTarget.dataset.value, field);
    const patch = {
      [`addressBookForm.${field}`]: value
    };
    if (field === "city") {
      patch["addressBookForm.district"] = "";
      patch["addressBookForm.area"] = formatAreaPickerPath(value, "");
    } else if (field === "district") {
      patch["addressBookForm.area"] = formatAreaPickerPath(this.data.addressBookForm.city, value);
    }
    this.setData(patch);
    this.clearAddressBookSuggestion();
  },

  setAddressBookSelection(id, checked) {
    const normalizedId = String(id || "").trim();
    if (!normalizedId) return;
    const selected = new Set((this.data.addressBookSelectedIds || []).map((item) => String(item)));
    if (checked) {
      selected.add(normalizedId);
    } else {
      selected.delete(normalizedId);
    }
    const addressBookSelectedIds = Array.from(selected);
    this.setData({
      addressBookSelectedIds,
      addressBookVisibleRows: rowsWithAddressBookSelection(this.data.addressBookVisibleRows || [], addressBookSelectedIds)
    });
  },

  toggleAddressBookSelection(event) {
    const id = String(event.currentTarget.dataset.id || "").trim();
    if (!id) return;
    const selected = new Set((this.data.addressBookSelectedIds || []).map((item) => String(item)));
    this.setAddressBookSelection(id, !selected.has(id));
  },

  async saveAddressBookEntry() {
    if (this.data.addressBookSaving) return;
    const customer = this.findMatchedCustomer();
    if (!customer) {
      wx.showToast({ title: "请选择客户资料中的有效客户", icon: "none" });
      return;
    }
    const area = formatAreaPickerPath(this.data.addressBookForm.city, this.data.addressBookForm.district)
      || String(this.data.addressBookForm.area || "").trim();
    const address = String(this.data.addressBookForm.address || "").trim();
    const contact = String(this.data.addressBookForm.contact || "").trim();
    if (!contact) {
      wx.showToast({ title: "请填写联系人", icon: "none" });
      return;
    }
    if (!address) {
      wx.showToast({ title: "请填写详细地址", icon: "none" });
      return;
    }
    const payload = {
      customerId: customer.id,
      name: contact,
      mobile: String(this.data.addressBookForm.phone || "").trim(),
      phone: String(this.data.addressBookForm.phone || "").trim(),
      area,
      address,
      remark: String(this.data.addressBookForm.note || "").trim()
    };
    this.setData({ addressBookSaving: true });
    try {
      const saved = normalizeCustomerContactRow(await api.createCustomerContact(payload));
      const nextRows = [saved, ...(this.data.addressBookRows || []).filter((item) => String(item.id) !== String(saved.id))];
      const nextSelectedIds = uniqueTextList([...(this.data.addressBookSelectedIds || []), saved.id]);
      this.setData({
        addressBookForm: createBlankAddressBookForm(),
        addressBookFormOpen: false,
        addressBookLoading: false,
        addressBookRows: nextRows,
        addressBookSelectedIds: nextSelectedIds,
        addressBookVisibleRows: rowsWithAddressBookSelection(filterAddressBookRows(nextRows, this.data.addressBookKeyword || ""), nextSelectedIds),
        addressBookSaving: false
      });
      wx.showToast({ title: "地址已保存到联系人", icon: "none" });
    } catch (error) {
      this.setData({ addressBookSaving: false });
      wx.showToast({ title: error.message || "保存地址失败", icon: "none" });
    }
  },

  applySelectedAddressBookEntries() {
    const selectedIds = new Set((this.data.addressBookSelectedIds || []).map((item) => String(item)));
    if (selectedIds.size === 0) {
      wx.showToast({ title: "请先勾选地址", icon: "none" });
      return;
    }
    const selectedOptions = (this.data.addressBookRows || []).filter((item) => selectedIds.has(String(item.id)));
    const seen = new Set();
    const values = selectedOptions
      .map((item) => item.value || item.address || item.area || "")
      .map((item) => String(item || "").trim())
      .filter((item) => {
        const key = normalizeLocationText(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (!values.length) {
      wx.showToast({ title: "请选择有效地址", icon: "none" });
      return;
    }
    const target = this.data.locationPickerTarget;
    this.setLocationEntries(target, values.map((item) => createLocationEntry(item)));
    this.closeLocationPicker();
  },

  noop() {},

  async loadPlanRows(date) {
    const plan = await api.getDispatchPlan(date);
    const rows = normalizeDispatchRows(plan && plan.rows ? plan.rows : [], date);
    return {
      rows,
      updatedAt: plan && (plan.updatedAt || plan.version) ? (plan.updatedAt || plan.version) : ""
    };
  },

  async saveRowToPlan(row, targetDate) {
    const mode = this.data.mode;
    const originDate = this.data.originDate;
    const cleanRow = sanitizeDispatchRow(row);
    if (mode === "order-edit" && !(this.data.sourceRow && this.data.sourceRow.hasDispatchRow)) return;
    if (isEditMode(mode) && originDate && originDate !== targetDate) {
      const targetPlan = await this.loadPlanRows(targetDate);
      const targetRowsWithoutCurrent = targetPlan.rows.filter((item) => item.id !== cleanRow.id);
      const nextRows = cleanRow.id ? targetRowsWithoutCurrent.concat([cleanRow]) : targetRowsWithoutCurrent;
      await api.saveDispatchPlan(targetDate, sortDispatchRows(nextRows, [], targetDate), {
        baseRows: targetPlan.rows.map(sanitizeDispatchRow),
        updatedAt: targetPlan.updatedAt
      });
      const originPlan = await this.loadPlanRows(originDate);
      await api.saveDispatchPlan(originDate, originPlan.rows.filter((item) => item.id !== cleanRow.id).map(sanitizeDispatchRow), {
        baseRows: originPlan.rows.map(sanitizeDispatchRow),
        updatedAt: originPlan.updatedAt
      });
      return;
    }
    const plan = await this.loadPlanRows(targetDate);
    const rows = plan.rows;
    let replaced = false;
    const nextRows = rows.map((item) => {
      if (isEditMode(mode) && item.id === cleanRow.id) {
        replaced = true;
        return cleanRow;
      }
      return item;
    });
    if (!replaced && mode !== "order-edit") nextRows.push(cleanRow);
    await api.saveDispatchPlan(targetDate, sortDispatchRows(nextRows, [], targetDate), {
      baseRows: rows.map(sanitizeDispatchRow),
      updatedAt: plan.updatedAt
    });
  },

  async submitForm() {
    if (this.data.saving) return;
    const form = normalizeDispatchFormForSave(Object.assign({}, this.data.form));
    const customer = this.findMatchedCustomer();
    if (!customer) {
      wx.showToast({ title: "请选择客户资料中的有效客户", icon: "none" });
      return;
    }
    if (!form.date) form.date = todayInputValue();
    if (!form.customer) form.customer = customer.name;
    form.loading = joinLocationEntries(this.data.loadingEntries);
    form.unloading = joinLocationEntries(this.data.unloadingEntries);
    this.applyOrderRequiredFieldDefaults(form, customer);
    if (isOrderEditMode(this.data.mode) && form.status === "已签收") {
      const signMissingLabels = missingOrderSignRequiredFieldLabels(form, customer);
      if (signMissingLabels.length) {
        wx.showToast({ title: orderSignRequiredMessage(signMissingLabels), icon: "none" });
        return;
      }
    }
    this.setData({ saving: true });
    try {
      const targetRows = await this.loadPlanRows(form.date);
      form.customerId = customer.id;
      form.customer = customer.name;
      const shouldCreateOrder = !isEditMode(this.data.mode) || !form.orderNo;
      const createdAt = form.createdAt || currentTimestampInputValue();
      form.createdAt = createdAt;
      const payload = orderPayloadFromForm(form, customer, shouldCreateOrder);
      if (isOrderEditMode(this.data.mode)) {
        payload.status = form.status || "待确认";
        payload.fees = payloadOrderFeeRows(this.data.orderFeeRows || []);
      }
      if (shouldCreateOrder) {
        delete payload.dispatchNo;
        payload.date = form.date;
      }
      const order = shouldCreateOrder
        ? await api.createOrder(payload)
        : await api.updateOrder(form.orderNo, payload);
      const dispatchNo = order.dispatchNo || form.dispatchNo || generateDispatchNo(form.date, targetRows);
      const nextForm = Object.assign({}, form, {
        dispatchNo,
        orderNo: order.no || form.orderNo,
        createdByAccountId: order.createdByAccountId || form.createdByAccountId || null,
        createdByUsername: order.createdByUsername || form.createdByUsername || "",
        createdByName: order.createdByName || form.createdByName || order.createdByUsername || ""
      });
      if (isOrderEditMode(this.data.mode)) {
        nextForm.status = dispatchStatusFromOrderStatus(order.status || form.status);
      }
      const row = rowFromForm(nextForm, nextForm.orderNo);
      row.customer = order.customer || customer.name;
      row.dispatchNo = dispatchNo;
      await this.saveRowToPlan(row, nextForm.date);
      wx.setStorageSync(DISPATCH_DATE_KEY, nextForm.date);
      const isOrderEdit = isOrderEditMode(this.data.mode);
      wx.showToast({
        title: isOrderEdit ? "订单已更新" : this.data.mode === "edit" ? "排车单已更新" : "排车单已创建",
        icon: "none"
      });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 500);
    } catch (error) {
      wx.showToast({ title: error.message || (isOrderEditMode(this.data.mode) ? "保存订单失败" : "保存排车单失败"), icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  cancelForm() {
    wx.navigateBack({ delta: 1 });
  }
});
