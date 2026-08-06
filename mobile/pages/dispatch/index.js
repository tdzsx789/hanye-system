const api = require("../../utils/api");
const { DISPATCH_DATE_KEY, setDispatchFormContext } = require("../../utils/context");
const { addDaysToInputDate, formatDateLabel, todayInputValue } = require("../../utils/date");
const { clearSession } = require("../../utils/session");
const {
  buildDispatchWarnings,
  createDispatchRowFromOrder,
  dispatchMessageText,
  dispatchOrderStatusForPlanStatus,
  dispatchStatusActionItems,
  dispatchStatusOptionsForRow,
  dispatchStatusValueForRow,
  dispatchSummaryCards,
  hasDispatchAccess,
  normalizeTransportMode,
  presentDispatchRows,
  sanitizeDispatchRow,
  sortDispatchRows
} = require("../../utils/dispatch");

const MAIN_STATUS_RANK = {
  预排: 0,
  已派车: 1,
  通关中: 2,
  异常滞留: 3
};

function orderMainDispatchRows(rows) {
  return rows.slice()
    .sort((left, right) => {
      const leftRank = MAIN_STATUS_RANK[dispatchStatusValueForRow(left)] ?? 9;
      const rightRank = MAIN_STATUS_RANK[dispatchStatusValueForRow(right)] ?? 9;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (left.index ?? 0) - (right.index ?? 0);
    })
    .map((row, index) => Object.assign({}, row, { displayIndex: index + 1 }));
}

Page({
  data: {
    accountLabel: "",
    activeStatus: "all",
    activeTab: "dispatch",
    dateLabel: "",
    dispatchDate: todayInputValue(),
    displayRows: [],
    expandedIds: [],
    loading: false,
    orders: [],
    rawRows: [],
    saving: false,
    searchKeyword: "",
    signedRows: [],
    summaryCards: [],
    vehicles: [],
    drivers: [],
    warnings: []
  },

  onLoad() {
    const storedDate = wx.getStorageSync(DISPATCH_DATE_KEY) || todayInputValue();
    this.setData({
      dispatchDate: storedDate,
      dateLabel: formatDateLabel(storedDate)
    });
  },

  async onShow() {
    const account = await getApp().ensureLogin();
    if (!account) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    if (!hasDispatchAccess(account)) {
      wx.showToast({ title: "当前账号无排车表权限", icon: "none" });
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.setData({
      accountLabel: account.displayName || account.username || account.role || ""
    });
    await this.loadBoard();
  },

  async onPullDownRefresh() {
    await this.loadBoard({ silent: true });
    wx.stopPullDownRefresh();
  },

  async loadBoard(options) {
    const silent = options && options.silent;
    const date = this.data.dispatchDate;
    if (!silent) this.setData({ loading: true });
    wx.showNavigationBarLoading();
    try {
      const [plan, orders, vehicles, drivers] = await Promise.all([
        api.getDispatchPlan(date),
        api.listOrders(),
        api.listVehicles(),
        api.listDrivers()
      ]);
      const rows = sortDispatchRows(plan && plan.rows ? plan.rows : [], orders, date);
      this.setData({
        drivers,
        loading: false,
        orders,
        rawRows: rows,
        vehicles
      });
      this.refreshDerivedData();
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "读取排车表失败", icon: "none" });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  refreshDerivedData() {
    const date = this.data.dispatchDate;
    const rawRows = this.data.rawRows || [];
    const summaryCards = dispatchSummaryCards(rawRows).map((card) => Object.assign({}, card, {
      active: this.data.activeStatus === card.key
    }));
    const mainRows = rawRows.filter((row) => dispatchStatusValueForRow(row) !== "已签收");
    const mainStatus = this.data.activeStatus === "已签收" ? "all" : this.data.activeStatus;
    const displayRows = orderMainDispatchRows(presentDispatchRows(mainRows, this.data.orders, date, {
      expandedIds: this.data.expandedIds,
      keyword: this.data.searchKeyword,
      status: mainStatus
    }));
    const signedRows = presentDispatchRows(rawRows, this.data.orders, date, {
      expandedIds: this.data.expandedIds,
      keyword: this.data.searchKeyword,
      status: "已签收"
    });
    const warnings = buildDispatchWarnings(rawRows, this.data.orders, this.data.vehicles, this.data.drivers, date);
    this.setData({
      dateLabel: formatDateLabel(date),
      displayRows,
      signedRows,
      summaryCards,
      warnings
    });
  },

  async changeDateByOffset(event) {
    const offset = Number(event.currentTarget.dataset.offset || 0);
    const nextDate = addDaysToInputDate(this.data.dispatchDate, offset);
    await this.switchDate(nextDate);
  },

  async goToday() {
    await this.switchDate(todayInputValue());
  },

  async onDatePickerChange(event) {
    await this.switchDate(event.detail.value);
  },

  async switchDate(date) {
    wx.setStorageSync(DISPATCH_DATE_KEY, date);
    this.setData({
      activeStatus: "all",
      dispatchDate: date,
      expandedIds: []
    });
    await this.loadBoard();
  },

  onSearchInput(event) {
    this.setData({ searchKeyword: event.detail.value });
    this.refreshDerivedData();
  },

  clearSearch() {
    this.setData({ searchKeyword: "" });
    this.refreshDerivedData();
  },

  setStatusFilter(event) {
    const activeStatus = event.currentTarget.dataset.status || "all";
    this.setData({
      activeStatus,
      activeTab: activeStatus === "已签收" ? "signed" : "dispatch"
    });
    this.refreshDerivedData();
  },

  switchTab(event) {
    const activeTab = event.currentTarget.dataset.tab || "dispatch";
    const patch = { activeTab };
    if (activeTab === "signed") patch.activeStatus = "已签收";
    if (activeTab === "dispatch" && this.data.activeStatus === "已签收") patch.activeStatus = "all";
    this.setData(patch);
    this.refreshDerivedData();
  },

  toggleExpand(event) {
    const id = event.currentTarget.dataset.id;
    const expandedIds = this.data.expandedIds.slice();
    const index = expandedIds.indexOf(id);
    if (index >= 0) {
      expandedIds.splice(index, 1);
    } else {
      expandedIds.push(id);
    }
    this.setData({ expandedIds });
    this.refreshDerivedData();
  },

  rowById(id) {
    const displayRow = (this.data.displayRows || []).find((row) => row.id === id);
    if (displayRow) return displayRow;
    const signedRow = (this.data.signedRows || []).find((row) => row.id === id);
    if (signedRow) return signedRow;
    const rawRow = (this.data.rawRows || []).find((row) => row.id === id);
    return rawRow || null;
  },

  openNewDispatch() {
    setDispatchFormContext({
      mode: "new",
      date: this.data.dispatchDate
    });
    wx.navigateTo({ url: "/pages/dispatch-form/index" });
  },

  openEditDispatch(event) {
    const row = this.rowById(event.currentTarget.dataset.id);
    if (!row) return;
    setDispatchFormContext({
      mode: "edit",
      date: this.data.dispatchDate,
      row
    });
    wx.navigateTo({ url: "/pages/dispatch-form/index" });
  },

  openCopyDispatch(event) {
    const row = this.rowById(event.currentTarget.dataset.id);
    if (!row) return;
    setDispatchFormContext({
      mode: "copy",
      date: this.data.dispatchDate,
      row
    });
    wx.navigateTo({ url: "/pages/dispatch-form/index" });
  },

  async saveRows(rows, options) {
    const source = options || {};
    const date = this.data.dispatchDate;
    const nextRows = source.sort === false
      ? rows.map((row) => sanitizeDispatchRow(row))
      : sortDispatchRows(rows, this.data.orders, date);
    this.setData({ saving: true });
    try {
      await api.saveDispatchPlan(date, nextRows);
      this.setData({ rawRows: nextRows });
      this.refreshDerivedData();
      if (source.toast) wx.showToast({ title: source.toast, icon: "none" });
      return true;
    } catch (error) {
      wx.showToast({ title: error.message || "保存排车表失败", icon: "none" });
      return false;
    } finally {
      this.setData({ saving: false });
    }
  },

  async addOrderToPlan(event) {
    const orderNo = event.currentTarget.dataset.no;
    const order = (this.data.orders || []).find((item) => item.no === orderNo);
    if (!order) return;
    const rows = this.data.rawRows.slice();
    if (rows.some((row) => row.orderNo === order.no)) {
      wx.showToast({ title: "该订单已在排车表中", icon: "none" });
      return;
    }
    rows.push(createDispatchRowFromOrder(order, this.data.dispatchDate, rows));
    await this.saveRows(rows, { toast: "已加入排车表" });
  },

  async openStatusActions(event) {
    const row = this.rowById(event.currentTarget.dataset.id);
    if (!row) return;
    const actions = dispatchStatusActionItems(row);
    if (!actions.length) {
      wx.showToast({ title: "当前状态暂无可用流转", icon: "none" });
      return;
    }
    wx.showActionSheet({
      itemList: actions.map((action) => action.label),
      success: (result) => {
        const action = actions[result.tapIndex];
        if (action) this.updateRowStatus(row.id, action.status);
      }
    });
  },

  async updateRowStatus(id, nextStatus) {
    const rows = this.data.rawRows.slice();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return;
    const row = Object.assign({}, rows[index]);
    const previousStatus = dispatchStatusValueForRow(row);
    const allowed = dispatchStatusOptionsForRow(row);
    if (allowed.indexOf(nextStatus) < 0) {
      wx.showToast({ title: "当前状态不能这样切换", icon: "none" });
      return;
    }
    row.status = nextStatus;
    rows[index] = row;
    this.setData({ saving: true });
    try {
      const orderStatus = dispatchOrderStatusForPlanStatus(nextStatus);
      if (row.orderNo && orderStatus) {
        const hasOrder = (this.data.orders || []).some((order) => order.no === row.orderNo);
        if (!hasOrder) throw new Error(`关联订单 ${row.orderNo} 不存在`);
        const updatedOrder = await api.updateOrderStatus(row.orderNo, orderStatus);
        const orders = this.data.orders.map((order) => order.no === updatedOrder.no ? updatedOrder : order);
        this.setData({ orders });
      }
      await api.saveDispatchPlan(this.data.dispatchDate, rows.map((item) => sanitizeDispatchRow(item)));
      this.setData({ rawRows: rows.map((item) => sanitizeDispatchRow(item)) });
      this.refreshDerivedData();
      wx.showToast({ title: "排车状态已同步", icon: "none" });
    } catch (error) {
      row.status = previousStatus;
      rows[index] = row;
      this.setData({ rawRows: rows.map((item) => sanitizeDispatchRow(item)) });
      this.refreshDerivedData();
      wx.showToast({ title: error.message || "状态同步失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  async moveRow(event) {
    const id = event.currentTarget.dataset.id;
    const offset = Number(event.currentTarget.dataset.offset || 0);
    const rows = this.data.rawRows.slice();
    const index = rows.findIndex((row) => row.id === id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= rows.length) {
      wx.showToast({ title: "已经到边界了", icon: "none" });
      return;
    }
    const row = rows.splice(index, 1)[0];
    rows.splice(target, 0, row);
    await this.saveRows(rows, { sort: false, toast: "顺序已保存" });
  },

  async deleteRow(event) {
    const id = event.currentTarget.dataset.id;
    const row = this.rowById(id);
    if (!row) return;
    wx.showModal({
      title: "删除排车单",
      content: `确认从当天排车表移除 ${row.dispatchNo || "这张排车单"}？关联订单不会自动删除。`,
      confirmText: "删除",
      confirmColor: "#b42318",
      success: async (result) => {
        if (!result.confirm) return;
        const rows = this.data.rawRows.filter((item) => item.id !== id);
        await this.saveRows(rows, { sort: false, toast: "排车单已移除" });
      }
    });
  },

  openMoreActions(event) {
    const id = event.currentTarget.dataset.id;
    const rows = this.data.rawRows || [];
    const index = rows.findIndex((row) => row.id === id);
    const actions = [
      { key: "copy-text", label: "复制派车信息" },
      { key: "copy", label: "复制排车单" }
    ];
    if (index > 0) actions.push({ key: "up", label: "上移" });
    if (index >= 0 && index < rows.length - 1) actions.push({ key: "down", label: "下移" });
    actions.push({ key: "delete", label: "删除" });
    wx.showActionSheet({
      itemList: actions.map((action) => action.label),
      success: (result) => {
        const action = actions[result.tapIndex];
        if (!action) return;
        if (action.key === "copy-text") this.copySingleDispatchText(id);
        if (action.key === "copy") this.openCopyDispatch({ currentTarget: { dataset: { id } } });
        if (action.key === "up") this.moveRow({ currentTarget: { dataset: { id, offset: -1 } } });
        if (action.key === "down") this.moveRow({ currentTarget: { dataset: { id, offset: 1 } } });
        if (action.key === "delete") this.deleteRow({ currentTarget: { dataset: { id } } });
      }
    });
  },

  copySingleDispatchText(id) {
    const row = this.rowById(id);
    if (!row) return;
    const text = dispatchMessageText([row], this.data.orders, this.data.dispatchDate);
    wx.setClipboardData({ data: text });
  },

  copyVisibleDispatchText() {
    const rows = this.data.activeTab === "signed" ? this.data.signedRows : this.data.displayRows;
    if (!rows.length) {
      wx.showToast({ title: "当前列表暂无排车内容", icon: "none" });
      return;
    }
    const text = dispatchMessageText(rows, this.data.orders, this.data.dispatchDate);
    wx.setClipboardData({ data: text });
  },

  async syncRowsToOrders() {
    const rows = this.data.rawRows || [];
    if (!rows.length) {
      wx.showToast({ title: "暂无可同步排车单", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const updatedOrders = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (!row.orderNo) continue;
        const order = (this.data.orders || []).find((item) => item.no === row.orderNo);
        if (!order) continue;
        const mode = normalizeTransportMode(row.transportMode || order.transportMode || "单司机") || "单司机";
        const payload = {
          dispatchNo: row.dispatchNo || order.dispatchNo || "",
          vehicleSource: order.vehicleSource || (row.plate ? "本公司车辆" : ""),
          plate: row.plate || order.plate || "",
          transportMode: mode,
          driver: mode === "单司机"
            ? (row.driver || row.hkDriver || order.driver || "")
            : [row.hkDriver || row.driver || "", row.mainlandDriver || ""].filter(Boolean).join(" / "),
          hkDriver: mode === "单司机" ? "" : (row.hkDriver || row.driver || ""),
          mainlandDriver: mode === "单司机" ? "" : (row.mainlandDriver || "")
        };
        updatedOrders.push(await api.updateOrder(order.no, payload));
      }
      const orders = this.data.orders.map((order) => {
        const updated = updatedOrders.find((item) => item.no === order.no);
        return updated || order;
      });
      this.setData({ orders });
      this.refreshDerivedData();
      wx.showToast({ title: "排车信息已同步订单", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error.message || "同步订单失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  refreshTap() {
    this.loadBoard();
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确认退出当前账号？",
      success: (result) => {
        if (!result.confirm) return;
        clearSession();
        getApp().setAccount(null);
        wx.reLaunch({ url: "/pages/login/index" });
      }
    });
  }
});
