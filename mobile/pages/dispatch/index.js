const api = require("../../utils/api");
const { DISPATCH_DATE_KEY, setDispatchFormContext } = require("../../utils/context");
const { addDaysToInputDate, formatDateLabel, todayInputValue } = require("../../utils/date");
const { dispatchCopyQuery, dispatchSharePath, enableShareMenu, shareImageUrl } = require("../../utils/share");
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

function realtimeEventAffectsDispatch(event) {
  const modules = new Set(Array.isArray(event && event.affectedModules) ? event.affectedModules.map(String) : []);
  if (modules.has("dispatchBoard") || modules.has("orders") || modules.has("customers") || modules.has("vehicleDriver") || modules.has("reminders") || modules.has("freight")) {
    return true;
  }
  return ["dispatch_plan", "order", "customer", "customer_contact", "address_book", "vehicle", "vehicle_expense", "driver", "freight_rate"].indexOf(String(event && event.entityType || "")) >= 0;
}

function compactOrderForDispatchForm(order) {
  if (!order) return null;
  return {
    no: order.no || "",
    dispatchNo: order.dispatchNo || "",
    customerId: order.customerId || "",
    customer: order.customer || "",
    businessType: order.businessType || "",
    port: order.port || "",
    direction: order.direction || "",
    tonnage: order.tonnage || "",
    currency: order.currency || "",
    quantity: order.quantity || "",
    weight: order.weight || "",
    vehicleSource: order.vehicleSource || "",
    supplier: order.supplier || "",
    plate: order.plate || "",
    driver: order.driver || "",
    hkDriver: order.hkDriver || "",
    mainlandDriver: order.mainlandDriver || "",
    transportMode: order.transportMode || "",
    loading: order.loading || "",
    unloading: order.unloading || "",
    date: order.date || "",
    status: order.status || "",
    remark: order.remark || "",
    tripNoEnabled: order.tripNoEnabled ? 1 : 0,
    tripNo: order.tripNo || "",
    sixSheetEnabled: order.sixSheetEnabled ? 1 : 0,
    sixSheetNo: order.sixSheetNo || ""
  };
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

  onLoad(options) {
    enableShareMenu();
    const today = todayInputValue();
    this.dispatchToday = today;
    const storedDate = wx.getStorageSync(DISPATCH_DATE_KEY);
    const optionDate = String(options && options.date ? options.date : "").slice(0, 10);
    const initialDate = optionDate || (storedDate === today ? storedDate : today);
    if (storedDate !== initialDate) wx.setStorageSync(DISPATCH_DATE_KEY, initialDate);
    this.setData({
      activeStatus: options && options.status ? decodeURIComponent(options.status) : "all",
      dispatchDate: initialDate,
      dateLabel: formatDateLabel(initialDate)
    });
  },

  onShareAppMessage() {
    return {
      title: `${formatDateLabel(this.data.dispatchDate)} 汉业排车表`,
      path: dispatchSharePath(this.data.dispatchDate, this.data.activeStatus),
      imageUrl: shareImageUrl()
    };
  },

  onShareTimeline() {
    return {
      title: `${formatDateLabel(this.data.dispatchDate)} 汉业排车表`,
      query: dispatchCopyQuery(this.data.dispatchDate, this.data.activeStatus)
    };
  },

  onCopyUrl() {
    return {
      query: dispatchCopyQuery(this.data.dispatchDate, this.data.activeStatus)
    };
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
    enableShareMenu();
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
    this.attachRealtime();
    await this.loadBoard();
  },

  async onPullDownRefresh() {
    await this.loadBoard({ silent: true });
    wx.stopPullDownRefresh();
  },

  onHide() {
    this.detachRealtime();
  },

  onUnload() {
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
    if (!realtimeEventAffectsDispatch(event)) return;
    this.scheduleRealtimeReload();
  },

  scheduleRealtimeReload(delay) {
    if (this.realtimeReloadTimer) clearTimeout(this.realtimeReloadTimer);
    this.realtimeReloadTimer = setTimeout(async () => {
      this.realtimeReloadTimer = null;
      if (this.data.saving) {
        this.scheduleRealtimeReload(800);
        return;
      }
      await this.loadBoard({ silent: true });
    }, Number(delay || 500));
  },

  async loadBoard(options) {
    const silent = options && options.silent;
    const date = this.data.dispatchDate;
    const selectedBeforeReload = new Set(this.data.selectedDispatchIds || []);
    this.expiryReminderRows = null;
    if (!silent) this.setData({ loading: true });
    if (!silent) wx.showNavigationBarLoading();
    try {
      const [plan, orders, vehicles, drivers, expiryReminders] = await Promise.all([
        api.getDispatchPlan(date),
        api.listOrders(),
        api.listVehicles(),
        api.listDrivers(),
        api.listExpiryReminders().catch(() => null)
      ]);
      this.expiryReminderRows = Array.isArray(expiryReminders && expiryReminders.rows)
        ? expiryReminders.rows
        : null;
      const rows = sortDispatchRows(plan && plan.rows ? plan.rows : [], orders, date);
      const nextSelectedIds = silent
        ? rows.filter((row) => selectedBeforeReload.has(row.id)).map((row) => row.id)
        : [];
      this.setData({
        drivers,
        loading: false,
        orders,
        rawRows: rows,
        selectedDispatchIds: nextSelectedIds,
        vehicles
      });
      this.refreshDerivedData();
    } catch (error) {
      this.setData({ loading: false });
      if (silent) {
        console.warn("Realtime dispatch refresh failed", error);
      } else {
        wx.showToast({ title: error.message || "读取排车表失败", icon: "none" });
      }
    } finally {
      if (!silent) wx.hideNavigationBarLoading();
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
    const serverWarnings = Array.isArray(this.expiryReminderRows)
      ? this.expiryReminderRows
        .map((row) => String(row && row.message || "").trim())
        .filter(Boolean)
      : null;
    const warnings = serverWarnings !== null
      ? Array.from(new Set(serverWarnings))
      : buildDispatchWarnings(rawRows, this.data.orders, this.data.vehicles, this.data.drivers, date);
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

  linkedOrderForRow(row) {
    if (!row) return null;
    const orderNo = String(row.orderNo || "").trim();
    const dispatchNo = String(row.dispatchNo || "").trim();
    return (this.data.orders || []).find((order) => order.no === orderNo)
      || (dispatchNo ? (this.data.orders || []).find((order) => String(order.dispatchNo || "").trim() === dispatchNo) : null)
      || null;
  },

  dispatchFormRowForContext(row) {
    const order = this.linkedOrderForRow(row) || row.order || null;
    return Object.assign({}, sanitizeDispatchRow(row), {
      order: compactOrderForDispatchForm(order)
    });
  },

  openDispatchForm(context) {
    wx.showLoading({
      title: "正在打开排车单...",
      mask: true
    });
    try {
      setDispatchFormContext(context);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: "打开排车单失败，请重试", icon: "none" });
      return;
    }
    wx.navigateTo({
      url: "/pages/dispatch-form/index",
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "打开排车单失败，请重试", icon: "none" });
      }
    });
  },

  openNewDispatch() {
    this.openDispatchForm({
      mode: "new",
      date: this.data.dispatchDate
    });
  },

  openEditDispatch(event) {
    if (this.data.saving) return;
    const dataset = (event.currentTarget && event.currentTarget.dataset) || (event.target && event.target.dataset) || {};
    const row = this.rowById(dataset.id);
    if (!row) {
      wx.showToast({ title: "未找到这张排车单，请刷新后重试", icon: "none" });
      return;
    }
    this.openDispatchForm({
      mode: "edit",
      date: this.data.dispatchDate,
      row: this.dispatchFormRowForContext(row)
    });
  },

  openCopyDispatch(event) {
    const row = this.rowById(event.currentTarget.dataset.id);
    if (!row) return;
    this.openCopyDispatchByRow(row);
  },

  openCopyDispatchByRow(row) {
    if (!row) return;
    this.openDispatchForm({
      mode: "copy",
      date: this.data.dispatchDate,
      row: this.dispatchFormRowForContext(row)
    });
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
    const linkedOrder = this.linkedOrderForRow(row);
    wx.showModal({
      title: "删除排车单",
      content: linkedOrder
        ? `确认删除 ${row.dispatchNo || "这张排车单"} 及其关联订单 ${linkedOrder.no}？`
        : `确认从当天排车表移除 ${row.dispatchNo || "这张排车单"}？`,
      confirmText: "删除",
      confirmColor: "#b42318",
      success: async (result) => {
        if (!result.confirm) return;
        try {
          if (linkedOrder) {
            let fallbackSave = false;
            try {
              await api.deleteOrder(linkedOrder.no);
            } catch (error) {
              const message = String(error.message || "");
              if (message.indexOf("不存在或已删除") < 0) {
                throw error;
              }
              fallbackSave = true;
            }
            const deletedOrderNo = linkedOrder.no;
            const deletedDispatchNo = String(linkedOrder.dispatchNo || row.dispatchNo || "").trim();
            const nextOrders = (this.data.orders || []).filter((order) => order.no !== deletedOrderNo);
            const nextRows = (this.data.rawRows || []).filter((item) =>
              item.id !== id
              && item.orderNo !== deletedOrderNo
              && (!deletedDispatchNo || String(item.dispatchNo || "").trim() !== deletedDispatchNo)
            );
            if (fallbackSave) {
              const saved = await this.saveRows(nextRows, { sort: false, toast: "排车单已移除" });
              if (saved) {
                this.setData({ orders: nextOrders });
                this.refreshDerivedData();
              }
              return;
            }
            this.setData({ orders: nextOrders, rawRows: nextRows });
            this.refreshDerivedData();
            wx.showToast({ title: "排车单及关联订单已删除", icon: "none" });
            return;
          }
          const rows = this.data.rawRows.filter((item) => item.id !== id);
          await this.saveRows(rows, { sort: false, toast: "排车单已移除" });
        } catch (error) {
          wx.showToast({ title: error.message || "删除失败", icon: "none" });
        }
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
        getApp().clearAccount();
        wx.reLaunch({ url: "/pages/login/index" });
      }
    });
  }
});
