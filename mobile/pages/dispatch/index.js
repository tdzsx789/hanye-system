const api = require("../../utils/api");
const { DISPATCH_DATE_KEY, setDispatchFormContext } = require("../../utils/context");
const { addDaysToInputDate, formatDateLabel, todayInputValue } = require("../../utils/date");
const { clearSession } = require("../../utils/session");
const {
  buildDispatchWarnings,
  createDispatchRowFromOrder,
  dispatchMessageText,
  dispatchOrderStatusForPlanStatus,
  dispatchReturnStatusForRow,
  dispatchStatusActionItems,
  dispatchStatusOptionsForRow,
  dispatchStatusValueForRow,
  dispatchSummaryCards,
  hasDispatchAccess,
  presentDispatchRows,
  sanitizeDispatchRow,
  sortDispatchRows
} = require("../../utils/dispatch");

const MAIN_STATUS_RANK = {
  预排: 0,
  已派车: 1,
  通关中: 2,
  已签收: 3,
  异常滞留: 4
};

function orderDisplayDispatchRows(rows) {
  return rows.slice()
    .sort((left, right) => {
      const leftRank = MAIN_STATUS_RANK[dispatchStatusValueForRow(left)] ?? 9;
      const rightRank = MAIN_STATUS_RANK[dispatchStatusValueForRow(right)] ?? 9;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return (left.index ?? 0) - (right.index ?? 0);
    })
    .map((row, index) => Object.assign({}, row, { displayIndex: index + 1 }));
}

function emptyTextForStatus(status) {
  if (status === "all") return "当前条件下暂无排车单";
  if (status === "已签收") return "当前条件下暂无已签收订单";
  return `当前条件下暂无${status}排车单`;
}

Page({
  data: {
    accountLabel: "",
    activeStatus: "all",
    dateLabel: "",
    dispatchDate: todayInputValue(),
    displayRows: [],
    emptyText: "当前条件下暂无排车单",
    expandedIds: [],
    loading: false,
    orders: [],
    rawRows: [],
    selectedDispatchCount: 0,
    selectedDispatchIds: [],
    allVisibleDispatchRowsSelected: false,
    dispatchInfoBusy: false,
    saving: false,
    searchKeyword: "",
    showWarningsPanel: false,
    summaryCards: [],
    vehicles: [],
    drivers: [],
    warnings: []
  },

  onLoad() {
    const today = todayInputValue();
    this.dispatchToday = today;
    const storedDate = wx.getStorageSync(DISPATCH_DATE_KEY);
    const initialDate = storedDate === today ? storedDate : today;
    if (storedDate !== initialDate) wx.setStorageSync(DISPATCH_DATE_KEY, initialDate);
    this.setData({
      dispatchDate: initialDate,
      dateLabel: formatDateLabel(initialDate)
    });
  },

  syncDispatchDateForToday() {
    const today = todayInputValue();
    if (this.dispatchToday === today) return;
    this.dispatchToday = today;
    if (this.data.dispatchDate === today) return;
    wx.setStorageSync(DISPATCH_DATE_KEY, today);
    this.setData({
      activeStatus: "all",
      dispatchDate: today,
      dateLabel: formatDateLabel(today),
      expandedIds: [],
      selectedDispatchIds: [],
      showWarningsPanel: false
    });
  },

  async onShow() {
    this.syncDispatchDateForToday();
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
        selectedDispatchIds: [],
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
    const selectedIds = new Set(this.data.selectedDispatchIds || []);
    const summaryCards = dispatchSummaryCards(rawRows).map((card) => Object.assign({}, card, {
      active: this.data.activeStatus === card.key
    }));
    const activeStatus = this.data.activeStatus || "all";
    const displayRows = orderDisplayDispatchRows(presentDispatchRows(rawRows, this.data.orders, date, {
      expandedIds: this.data.expandedIds,
      keyword: this.data.searchKeyword,
      status: activeStatus
    })).map((row) => Object.assign({}, row, {
      selected: selectedIds.has(row.id)
    }));
    const selectedDisplayRows = displayRows.filter((row) => row.selected);
    const warnings = buildDispatchWarnings(rawRows, this.data.orders, this.data.vehicles, this.data.drivers, date);
    const emptyText = emptyTextForStatus(activeStatus);
    this.setData({
      dateLabel: formatDateLabel(date),
      displayRows,
      emptyText,
      selectedDispatchCount: selectedDisplayRows.length,
      allVisibleDispatchRowsSelected: displayRows.length > 0 && selectedDisplayRows.length === displayRows.length,
      showWarningsPanel: warnings.length ? this.data.showWarningsPanel : false,
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
      expandedIds: [],
      selectedDispatchIds: [],
      showWarningsPanel: false
    });
    await this.loadBoard();
  },

  onSearchInput(event) {
    this.setData({
      searchKeyword: event.detail.value,
      selectedDispatchIds: []
    });
    this.refreshDerivedData();
  },

  clearSearch() {
    this.setData({
      searchKeyword: "",
      selectedDispatchIds: []
    });
    this.refreshDerivedData();
  },

  setStatusFilter(event) {
    const activeStatus = event.currentTarget.dataset.status || "all";
    this.setData({
      activeStatus,
      selectedDispatchIds: []
    });
    this.refreshDerivedData();
  },

  selectedDispatchRows() {
    const selectedIds = new Set(this.data.selectedDispatchIds || []);
    return (this.data.displayRows || []).filter((row) => selectedIds.has(row.id));
  },

  toggleDispatchSelection(event) {
    if (this.data.loading || this.data.saving) return;
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const selectedIds = new Set(this.data.selectedDispatchIds || []);
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    this.setData({ selectedDispatchIds: Array.from(selectedIds) });
    this.refreshDerivedData();
  },

  toggleAllVisibleDispatchSelection() {
    if (this.data.loading || this.data.saving) return;
    const visibleRows = this.data.displayRows || [];
    if (!visibleRows.length) return;
    const selectedIds = new Set(this.data.selectedDispatchIds || []);
    if (this.data.allVisibleDispatchRowsSelected) {
      visibleRows.forEach((row) => selectedIds.delete(row.id));
    } else {
      visibleRows.forEach((row) => selectedIds.add(row.id));
    }
    this.setData({ selectedDispatchIds: Array.from(selectedIds) });
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
    if (this.data.saving) return;
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
    this.openCopyDispatchByRow(row);
  },

  openCopyDispatchByRow(row) {
    if (!row) return;
    setDispatchFormContext({
      mode: "copy",
      date: this.data.dispatchDate,
      row
    });
    wx.navigateTo({ url: "/pages/dispatch-form/index" });
  },

  async copyDispatchTextToClipboard(text, successTitle) {
    if (this.data.dispatchInfoBusy) return;
    this.setData({ dispatchInfoBusy: true });
    wx.showLoading({ title: "生成中...", mask: true });
    const startedAt = Date.now();
    try {
      await new Promise((resolve, reject) => {
        wx.setClipboardData({
          data: text,
          success: resolve,
          fail: reject
        });
      });
      const elapsed = Date.now() - startedAt;
      if (elapsed < 250) {
        await new Promise((resolve) => setTimeout(resolve, 250 - elapsed));
      }
      wx.hideLoading();
      wx.showToast({ title: successTitle, icon: "none" });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "生成派车信息失败", icon: "none" });
    } finally {
      this.setData({ dispatchInfoBusy: false });
    }
  },

  async saveRows(rows, options) {
    const source = options || {};
    const date = this.data.dispatchDate;
    const nextRows = source.sort === false
      ? rows.map((row) => sanitizeDispatchRow(row))
      : sortDispatchRows(rows, this.data.orders, date);
    this.setData({ saving: true });
    try {
      const savedPlan = await api.saveDispatchPlan(date, nextRows);
      const savedRows = savedPlan && Array.isArray(savedPlan.rows)
        ? sortDispatchRows(savedPlan.rows, this.data.orders, date)
        : nextRows;
      this.setData({
        rawRows: savedRows,
        selectedDispatchIds: []
      });
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
    if (this.data.saving) return;
    const row = this.rowById(event.currentTarget.dataset.id);
    if (!row) return;
    if (row.statusActionDisabled) return;
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

  async updateRowStatus(id, nextStatus, options) {
    const source = options || {};
    const rows = this.data.rawRows.slice();
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) return;
    const row = Object.assign({}, rows[index]);
    const previousStatus = dispatchStatusValueForRow(row);
    const previousRecordedStatus = row.previousStatus || "";
    const allowed = dispatchStatusOptionsForRow(row);
    if (!source.allowReturn && allowed.indexOf(nextStatus) < 0) {
      wx.showToast({ title: "当前状态不能这样切换", icon: "none" });
      return;
    }
    row.status = nextStatus;
    if (source.clearPreviousStatus) {
      row.previousStatus = "";
    } else if (nextStatus !== previousStatus) {
      row.previousStatus = previousStatus;
    }
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
      const savedPlan = await api.saveDispatchPlan(this.data.dispatchDate, rows.map((item) => sanitizeDispatchRow(item)));
      const savedRows = savedPlan && Array.isArray(savedPlan.rows)
        ? savedPlan.rows.map((item) => sanitizeDispatchRow(item))
        : rows.map((item) => sanitizeDispatchRow(item));
      this.setData({
        rawRows: savedRows,
        selectedDispatchIds: [],
        ...(source.switchToStatus ? { activeStatus: nextStatus } : {})
      });
      this.refreshDerivedData();
      wx.showToast({ title: source.toast || "排车状态已同步", icon: "none" });
    } catch (error) {
      row.status = previousStatus;
      row.previousStatus = previousRecordedStatus;
      rows[index] = row;
      this.setData({ rawRows: rows.map((item) => sanitizeDispatchRow(item)) });
      this.refreshDerivedData();
      wx.showToast({ title: error.message || "状态同步失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  async returnRowStatus(event) {
    if (this.data.saving) return;
    const row = this.rowById(event.currentTarget.dataset.id);
    if (!row) return;
    const previousStatus = dispatchReturnStatusForRow(row);
    if (!previousStatus) {
      wx.showToast({ title: "当前状态没有上一步", icon: "none" });
      return;
    }
    await this.updateRowStatus(row.id, previousStatus, {
      allowReturn: true,
      clearPreviousStatus: true,
      switchToStatus: true,
      toast: `已返回到${previousStatus}`
    });
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
    if (this.data.saving) return;
    const id = event.currentTarget.dataset.id;
    const rows = this.data.rawRows || [];
    const index = rows.findIndex((row) => row.id === id);
    const actions = [
      { key: "copy-text", label: "生成派车信息" },
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
        if (action.key === "copy-text") this.generateDispatchInfoForRow(id);
        if (action.key === "copy") this.openCopyDispatch({ currentTarget: { dataset: { id } } });
        if (action.key === "up") this.moveRow({ currentTarget: { dataset: { id, offset: -1 } } });
        if (action.key === "down") this.moveRow({ currentTarget: { dataset: { id, offset: 1 } } });
        if (action.key === "delete") this.deleteRow({ currentTarget: { dataset: { id } } });
      }
    });
  },

  generateDispatchInfoForRow(id) {
    const row = this.rowById(id);
    if (!row) return;
    const text = dispatchMessageText([row], this.data.orders, this.data.dispatchDate);
    this.copyDispatchTextToClipboard(text, "已生成并复制 1 单派车信息");
  },

  copySingleDispatchText(id) {
    this.generateDispatchInfoForRow(id);
  },

  generateSelectedDispatchInfo() {
    const rows = this.selectedDispatchRows();
    if (!rows.length) {
      wx.showToast({ title: "请先勾选要生成派车信息的排车单", icon: "none" });
      return;
    }
    const text = dispatchMessageText(rows, this.data.orders, this.data.dispatchDate);
    this.copyDispatchTextToClipboard(text, `已生成并复制 ${rows.length} 单派车信息`);
  },

  copySelectedDispatchRow() {
    const rows = this.selectedDispatchRows();
    if (!rows.length) {
      wx.showToast({ title: "请先勾选要复制的排车单", icon: "none" });
      return;
    }
    if (rows.length > 1) {
      wx.showToast({ title: "一次只能复制一张排车单，请只勾选一张", icon: "none" });
      return;
    }
    this.openCopyDispatchByRow(rows[0]);
  },

  openWarningsPanel() {
    this.setData({ showWarningsPanel: true });
  },

  closeWarningsPanel() {
    this.setData({ showWarningsPanel: false });
  },

  noop() {
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
