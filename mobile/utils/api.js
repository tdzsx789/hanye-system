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

function listCustomerContacts(customerId) {
  const path = customerId
    ? `/customer-contacts?customerId=${encodeURIComponent(customerId)}`
    : "/customer-contacts";
  return requestList(path);
}

function createCustomerContact(payload) {
  return request("/customer-contacts", { method: "POST", data: payload });
}

function updateCustomerContact(contactId, payload) {
  return request(`/customer-contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    data: payload
  });
}

function deleteCustomerContact(contactId) {
  return request(`/customer-contacts/${encodeURIComponent(contactId)}`, {
    method: "DELETE"
  });
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

function deleteOrder(orderNo) {
  return request(`/orders/${encodeURIComponent(orderNo)}`, {
    method: "DELETE"
  });
}

function listVehicles() {
  return requestList("/vehicles");
}

function listDrivers() {
  return requestList("/drivers");
}

function listExpiryReminders() {
  return request("/reminders/expiry");
}

function listFreightRates() {
  return requestList("/freight-rates");
}

function getDispatchPlan(date) {
  return request(`/dispatch-plans/${encodeURIComponent(date)}`);
}

function saveDispatchPlan(date, rows, options) {
  const source = options || {};
  return request(`/dispatch-plans/${encodeURIComponent(date)}`, {
    method: "PUT",
    data: {
      rows: rows || [],
      baseRows: Array.isArray(source.baseRows) ? source.baseRows : [],
      updatedAt: source.updatedAt || source.version || ""
    }
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
  createCustomerContact,
  deleteOrder,
  getCurrentAccount,
  getDispatchPlan,
  listCustomers,
  listFreightRates,
  listCustomerContacts,
  listDispatchPlans,
  listDrivers,
  listExpiryReminders,
  listOrders,
  listVehicles,
  login,
  deleteCustomerContact,
  saveDispatchPlan,
  updateOrder,
  updateCustomerContact,
  updateOrderStatus
};
