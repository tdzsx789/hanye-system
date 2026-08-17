const api = require("../../utils/api");
const { clearDispatchFormContext, DISPATCH_DATE_KEY, getDispatchFormContext } = require("../../utils/context");
const { todayInputValue } = require("../../utils/date");
const {
  BUSINESS_TYPE_OPTIONS,
  DIRECTION_OPTIONS,
  PORT_OPTIONS,
  TONNAGE_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  VEHICLE_SOURCE_OPTIONS,
  formFromDispatchRow,
  generateDispatchNo,
  normalizeDispatchRows,
  normalizeTransportMode,
  orderPayloadFromForm,
  rowFromForm,
  sanitizeDispatchRow,
  sortDispatchRows
} = require("../../utils/dispatch");

function titleForMode(mode) {
  if (mode === "edit") return "编辑排车单";
  if (mode === "copy") return "复制排车单";
  return "新建排车单";
}

function uniqueTextList(values) {
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = value === undefined || value === null ? "" : String(value).trim();
    if (text && result.indexOf(text) < 0) result.push(text);
  });
  return result;
}

const LOCATION_ENTRY_KEYS = {
  loading: "loadingEntries",
  unloading: "unloadingEntries"
};
const LOAD_TIME_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const LOAD_TIME_MINUTES = ["00", "15", "30", "45"];

let locationEntrySerial = 0;

function nextLocationEntryId() {
  locationEntrySerial += 1;
  return `location-entry-${Date.now()}-${locationEntrySerial}`;
}

function createLocationEntry(value) {
  return {
    id: nextLocationEntryId(),
    value: value === undefined || value === null ? "" : String(value).trim()
  };
}

function locationEntryValue(entry) {
  const value = entry && typeof entry === "object" ? entry.value : entry;
  return value === undefined || value === null ? "" : String(value).trim();
}

function splitLocationEntries(value) {
  const text = value === undefined || value === null ? "" : String(value).replace(/\r/g, "\n");
  if (!text.trim()) return [createLocationEntry("")];
  const entries = text
    .split(/[\n；;]+/)
    .map((item) => createLocationEntry(item));
  return entries.length ? entries : [createLocationEntry("")];
}

function normalizeLocationEntries(entries) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((item) => ({
      id: item && typeof item === "object" && item.id ? item.id : nextLocationEntryId(),
      value: locationEntryValue(item)
    }));
  return normalized.length ? normalized : [createLocationEntry("")];
}

function joinLocationEntries(entries) {
  return normalizeLocationEntries(entries)
    .map((entry) => entry.value)
    .filter(Boolean)
    .join("\n");
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
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[；;]/g, "\n")
    .replace(/\s+/g, "")
    .toLowerCase();
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
  const vehicleSource = String(form.vehicleSource || "").trim();
  form.vehicleSource = vehicleSource;
  form.transportMode = normalizeTransportMode(form.transportMode || "");
  if (vehicleSource === "本公司车辆") {
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
    driverOptions: [],
    form: {},
    hkDriverOptions: [],
    loadingEntries: [createLocationEntry("")],
    loadingEntryCount: 0,
    loadingRefs: true,
    loadTimePickerRange: [LOAD_TIME_HOURS, LOAD_TIME_MINUTES],
    loadTimePickerValue: [12, 0],
    locationPickerOpen: false,
    locationPickerTarget: "",
    locationPickerTitle: "",
    mainlandDriverOptions: [],
    mode: "new",
    originDate: "",
    plateOptions: [],
    portOptions: PORT_OPTIONS,
    saving: false,
    sourceRow: null,
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
    }
    if (mode === "copy") {
      form.id = "";
      form.orderNo = "";
      form.dispatchNo = "";
      form.status = "预排";
      form.createdByAccountId = null;
      form.createdByUsername = "";
      form.createdByName = "";
    }
    normalizeDispatchFormForDisplay(form);
    const locationPatch = locationEntriesPatchFromForm(form);
    this.setData({
      form,
      ...locationPatch,
      loadTimePickerValue: loadTimePickerValueFromText(form.loadTime),
      mode,
      originDate: date,
      sourceRow,
      title: titleForMode(mode)
    });
    wx.setNavigationBarTitle({ title: titleForMode(mode) });
    this.loadReferences();
  },

  onUnload() {
    clearDispatchFormContext();
  },

  async loadReferences() {
    this.setData({ loadingRefs: true });
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
      const form = normalizeDispatchFormForDisplay(Object.assign({}, this.data.form));
      const locationPatch = locationEntriesPatchFromForm(form);
      this.setData({
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
    } catch (error) {
      this.setData({ loadingRefs: false });
      wx.showToast({ title: error.message || "读取基础资料失败", icon: "none" });
    }
  },

  refreshCustomerSuggestions() {
    const keyword = String(this.data.form.customer || "").trim().toLowerCase();
    const rows = (this.data.customers || [])
      .filter((item) => item.type === "客户")
      .filter((item) => {
        if (!keyword) return true;
        return [item.id, item.name, item.contact, item.mobile].join(" ").toLowerCase().indexOf(keyword) >= 0;
      })
      .slice(0, 8);
    this.setData({ customerSuggestions: rows });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
    if (field === "customer") {
      this.setData({ "form.customerId": "", customerPickerOpen: true });
      this.refreshCustomerSuggestions();
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
    this.setData({
      "form.customer": customer.name,
      "form.customerId": customer.id,
      customerPickerOpen: false
    });
  },

  async onFormDateChange(event) {
    const date = event.detail.value;
    this.setData({ "form.date": date });
  },

  handleVehicleSourceChange(value) {
    const form = Object.assign({}, this.data.form, { vehicleSource: value });
    if (value === "本公司车辆") {
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
    this.setData({ form });
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
    this.setData({ form });
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
    const customers = (this.data.customers || []).filter((item) => item.type === "客户");
    return customers.find((item) => customerId && String(item.id) === customerId)
      || customers.find((item) => item.name === customerName)
      || null;
  },

  async openLocationPicker(event) {
    const target = event.currentTarget.dataset.target;
    const customer = this.findMatchedCustomer();
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
        addressBookFormOpen: false
      });
      return;
    }
    this.setData({
      addressBookForm: createBlankAddressBookForm(),
      addressBookFormOpen: true
    });
    this.syncAddressBookAreaPicker("");
  },

  onAddressBookFormInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`addressBookForm.${field}`]: event.detail.value });
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

  onAddressBookCheckboxChange(event) {
    const id = String(event.currentTarget.dataset.id || "").trim();
    if (!id) return;
    const values = Array.isArray(event.detail.value) ? event.detail.value.map((item) => String(item)) : [];
    this.setAddressBookSelection(id, values.indexOf(id) >= 0);
  },

  async saveAddressBookEntry() {
    if (this.data.addressBookSaving) return;
    const customer = this.findMatchedCustomer();
    if (!customer) {
      wx.showToast({ title: "请选择客户资料中的有效客户", icon: "none" });
      return;
    }
    const area = String(this.data.addressBookForm.area || "").trim();
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
    return normalizeDispatchRows(plan && plan.rows ? plan.rows : [], date);
  },

  async saveRowToPlan(row, targetDate) {
    const mode = this.data.mode;
    const originDate = this.data.originDate;
    const cleanRow = sanitizeDispatchRow(row);
    if (mode === "edit" && originDate && originDate !== targetDate) {
      const targetRows = await this.loadPlanRows(targetDate);
      const nextRows = targetRows.filter((item) => item.id !== cleanRow.id).concat([cleanRow]);
      await api.saveDispatchPlan(targetDate, sortDispatchRows(nextRows, [], targetDate));
      const originRows = await this.loadPlanRows(originDate);
      await api.saveDispatchPlan(originDate, originRows.filter((item) => item.id !== cleanRow.id).map(sanitizeDispatchRow));
      return;
    }
    const rows = await this.loadPlanRows(targetDate);
    let replaced = false;
    const nextRows = rows.map((item) => {
      if (mode === "edit" && item.id === cleanRow.id) {
        replaced = true;
        return cleanRow;
      }
      return item;
    });
    if (!replaced) nextRows.push(cleanRow);
    await api.saveDispatchPlan(targetDate, sortDispatchRows(nextRows, [], targetDate));
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
    this.setData({ saving: true });
    try {
      const targetRows = await this.loadPlanRows(form.date);
      form.customerId = customer.id;
      form.customer = customer.name;
      const shouldCreateOrder = this.data.mode !== "edit" || !form.orderNo;
      const payload = orderPayloadFromForm(form, customer, shouldCreateOrder);
      if (shouldCreateOrder) delete payload.dispatchNo;
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
      const row = rowFromForm(nextForm, nextForm.orderNo);
      row.customer = order.customer || customer.name;
      row.dispatchNo = dispatchNo;
      await this.saveRowToPlan(row, nextForm.date);
      wx.setStorageSync(DISPATCH_DATE_KEY, nextForm.date);
      wx.showToast({
        title: this.data.mode === "edit" ? "排车单已更新" : "排车单已创建",
        icon: "none"
      });
      setTimeout(() => {
        wx.navigateBack({ delta: 1 });
      }, 500);
    } catch (error) {
      wx.showToast({ title: error.message || "保存排车单失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  cancelForm() {
    wx.navigateBack({ delta: 1 });
  }
});
