import { apiFetch, apiFetchList } from "./client.js";

export function listFeeItems() {
  return apiFetchList("/fee-items");
}

export function saveFeeItem(id, payload) {
  return apiFetch(id ? `/fee-items/${id}` : "/fee-items", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteFeeItem(id) {
  return apiFetch(`/fee-items/${id}`, { method: "DELETE" });
}

export function reorderFeeItems(ids = []) {
  return apiFetch("/fee-items/order", {
    method: "PATCH",
    body: JSON.stringify({ ids })
  });
}

export function listFreightRates() {
  return apiFetchList("/freight-rates");
}

export function saveFreightRate(id, payload) {
  return apiFetch(id ? `/freight-rates/${id}` : "/freight-rates", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteFreightRate(id) {
  return apiFetch(`/freight-rates/${id}`, { method: "DELETE" });
}

export function listRules() {
  return apiFetchList("/rules");
}

export function saveRule(id, payload) {
  return apiFetch(id ? `/rules/${id}` : "/rules", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteRule(id) {
  return apiFetch(`/rules/${id}`, { method: "DELETE" });
}

export function listMasterData() {
  return apiFetchList("/master-data");
}

export function saveMasterData(id, payload) {
  return apiFetch(id ? `/master-data/${id}` : "/master-data", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteMasterData(id) {
  return apiFetch(`/master-data/${id}`, { method: "DELETE" });
}
