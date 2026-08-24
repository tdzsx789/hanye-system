import { apiFetch, apiFetchList } from "./client.js";

export function listOrders(query = "") {
  return apiFetchList(`/orders${query}`);
}

export function createOrder(payload) {
  return apiFetch("/orders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateOrder(orderNo, payload) {
  return apiFetch(`/orders/${encodeURIComponent(orderNo)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function updateOrderStatus(orderNo, status) {
  return apiFetch(`/orders/${encodeURIComponent(orderNo)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function updateOrderCharge(orderNo, chargedAt = "") {
  return apiFetch(`/orders/${encodeURIComponent(orderNo)}/charge`, {
    method: "PATCH",
    body: JSON.stringify({ chargedAt })
  });
}

export function auditOrders(payload) {
  return apiFetch("/orders/audit", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteOrder(orderNo) {
  return apiFetch(`/orders/${encodeURIComponent(orderNo)}`, { method: "DELETE" });
}

export function listRecycleOrders() {
  return apiFetch("/orders/recycle");
}

export function restoreOrder(orderNo) {
  return apiFetch(`/orders/${encodeURIComponent(orderNo)}/restore`, { method: "POST" });
}
