const { request, requestList } = require("./request");

function login(payload) {
  return request("/auth/login", { method: "POST", data: payload });
}

function getCurrentAccount() {
  return request("/auth/me");
}

function listCustomers() {
  return requestList("/customers");
}

function listOrders() {
  return requestList("/orders");
}

function createOrder(payload) {
  return request("/orders", { method: "POST", data: payload });
}

function updateOrder(orderNo, payload) {
  return request(`/orders/${encodeURIComponent(orderNo)}`, {
    method: "PATCH",
    data: payload
  });
}

function updateOrderStatus(orderNo, status) {
  return request(`/orders/${encodeURIComponent(orderNo)}/status`, {
    method: "PATCH",
    data: { status }
  });
}

function listVehicles() {
  return requestList("/vehicles");
}

function listDrivers() {
  return requestList("/drivers");
}

function getDispatchPlan(date) {
  return request(`/dispatch-plans/${encodeURIComponent(date)}`);
}

function saveDispatchPlan(date, rows) {
  return request(`/dispatch-plans/${encodeURIComponent(date)}`, {
    method: "PUT",
    data: { rows: rows || [] }
  });
}

function listDispatchPlans(options) {
  const source = options || {};
  const params = [];
  if (source.period) params.push(`period=${encodeURIComponent(source.period)}`);
  if (source.start) params.push(`start=${encodeURIComponent(source.start)}`);
  if (source.end) params.push(`end=${encodeURIComponent(source.end)}`);
  return requestList(`/dispatch-plans${params.length ? `?${params.join("&")}` : ""}`);
}

module.exports = {
  createOrder,
  getCurrentAccount,
  getDispatchPlan,
  listCustomers,
  listDispatchPlans,
  listDrivers,
  listOrders,
  listVehicles,
  login,
  saveDispatchPlan,
  updateOrder,
  updateOrderStatus
};
