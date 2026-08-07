const api = require("../../utils/api");
const { DISPATCH_LOAD_TIME_OPTIONS } = require("../../utils/constants");
const { clearDispatchFormContext, DISPATCH_DATE_KEY, getDispatchFormContext } = require("../../utils/context");
const { todayInputValue } = require("../../utils/date");
const {
  BUSINESS_TYPE_OPTIONS,
  DIRECTION_OPTIONS,
  PORT_OPTIONS,
  TONNAGE_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  VEHICLE_SOURCE_OPTIONS,
  dispatchStatusLockedForRow,
  dispatchStatusOptionsForRow,
  dispatchStatusValueForRow,
  formFromDispatchRow,
  generateDispatchNo,
  normalizeDispatchRows,
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

Page({
  data: {
    advancedOpen: false,
    businessTypeOptions: BUSINESS_TYPE_OPTIONS,
    customerPickerOpen: false,
    customerSuggestions: [],
    customers: [],
    directionOptions: DIRECTION_OPTIONS,
    form: {},
    loadingRefs: true,
    mode: "new",
    originDate: "",
    plateOptions: [],
    portOptions: PORT_OPTIONS,
    saving: false,
    sourceRow: null,
    statusPickerDisabled: false,
    statusOptions: ["预排"],
    supplierOptions: [],
    timeOptions: DISPATCH_LOAD_TIME_OPTIONS,
    title: "新建排车单",
    tonnageOptions: TONNAGE_OPTIONS,
    transportModeOptions: TRANSPORT_MODE_OPTIONS,
    vehicleSourceOptions: VEHICLE_SOURCE_OPTIONS,
    vehicles: []
  },

  onLoad() {
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
    }
    this.setData({
      form,
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
      const [customers, vehicles, drivers, plan] = await Promise.all([
        api.listCustomers(),
        api.listVehicles(),
        api.listDrivers(),
        api.getDispatchPlan(this.data.form.date || this.data.originDate)
      ]);
      const rows = normalizeDispatchRows(plan && plan.rows ? plan.rows : [], this.data.form.date);
      const form = Object.assign({}, this.data.form);
      if (this.data.mode !== "edit" && !form.dispatchNo) {
        form.dispatchNo = generateDispatchNo(form.date, rows);
      }
      this.setData({
        customers,
        drivers,
        form,
        loadingRefs: false,
        plateOptions: vehicles.map((vehicle) => vehicle.plate).filter(Boolean),
        supplierOptions: customers.filter((item) => item.type === "供应商").map((item) => item.name),
        vehicles
      });
      this.refreshCustomerSuggestions();
      this.refreshStatusOptions();
    } catch (error) {
      this.setData({ loadingRefs: false });
      wx.showToast({ title: error.message || "读取基础资料失败", icon: "none" });
    }
  },

  refreshStatusOptions() {
    const current = dispatchStatusValueForRow({ status: this.data.form.status });
    const locked = dispatchStatusLockedForRow({ status: current });
    if (this.data.mode !== "edit") {
      this.setData({ statusOptions: [current], statusPickerDisabled: true });
      return;
    }
    const next = [current];
    dispatchStatusOptionsForRow({ status: current }).forEach((status) => {
      if (next.indexOf(status) < 0) next.push(status);
    });
    this.setData({ statusOptions: next, statusPickerDisabled: locked });
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

  onCustomerFocus() {
    this.setData({ customerPickerOpen: true });
    this.refreshCustomerSuggestions();
  },

  closeCustomerPicker() {
    this.setData({ customerPickerOpen: false });
  },

  selectCustomer(event) {
    const id = event.currentTarget.dataset.id;
    const customer = (this.data.customers || []).find((item) => item.id === id);
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
    if (this.data.mode !== "edit") {
      try {
        const plan = await api.getDispatchPlan(date);
        const rows = normalizeDispatchRows(plan && plan.rows ? plan.rows : [], date);
        this.setData({ "form.dispatchNo": generateDispatchNo(date, rows) });
      } catch (error) {
        wx.showToast({ title: error.message || "排车号生成失败", icon: "none" });
      }
    }
  },

  onPickerChange(event) {
    const field = event.currentTarget.dataset.field;
    const optionsKey = event.currentTarget.dataset.optionsKey;
    const options = this.data[optionsKey] || [];
    const value = options[Number(event.detail.value || 0)] || "";
    const patch = { [`form.${field}`]: value };
    if (field === "vehicleSource" && value === "本公司车辆") {
      patch["form.supplier"] = "";
    }
    this.setData(patch);
    if (field === "status") this.refreshStatusOptions();
  },

  toggleAdvanced() {
    this.setData({ advancedOpen: !this.data.advancedOpen });
  },

  findMatchedCustomer() {
    const customerId = String(this.data.form.customerId || "").trim();
    const customerName = String(this.data.form.customer || "").trim();
    const customers = (this.data.customers || []).filter((item) => item.type === "客户");
    return customers.find((item) => customerId && item.id === customerId)
      || customers.find((item) => item.name === customerName)
      || null;
  },

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
    const form = Object.assign({}, this.data.form);
    const customer = this.findMatchedCustomer();
    if (!customer) {
      wx.showToast({ title: "请选择客户资料中的有效客户", icon: "none" });
      return;
    }
    if (!form.date) form.date = todayInputValue();
    if (!form.customer) form.customer = customer.name;
    this.setData({ saving: true });
    try {
      const targetRows = await this.loadPlanRows(form.date);
      if (!form.dispatchNo) {
        form.dispatchNo = generateDispatchNo(form.date, targetRows);
      }
      form.customerId = customer.id;
      form.customer = customer.name;
      const shouldCreateOrder = this.data.mode !== "edit" || !form.orderNo;
      const payload = orderPayloadFromForm(form, customer, shouldCreateOrder);
      const order = shouldCreateOrder
        ? await api.createOrder(payload)
        : await api.updateOrder(form.orderNo, payload);
      const nextForm = Object.assign({}, form, {
        dispatchNo: order.dispatchNo || form.dispatchNo,
        orderNo: order.no || form.orderNo
      });
      const row = rowFromForm(nextForm, nextForm.orderNo);
      row.customer = order.customer || customer.name;
      row.dispatchNo = order.dispatchNo || nextForm.dispatchNo;
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
