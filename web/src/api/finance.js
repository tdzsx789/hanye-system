import { apiFetch, apiFetchList } from "./client.js";

export function listStatementDownloads() {
  return apiFetchList("/statement-downloads");
}

export function createStatementDownload(payload) {
  return apiFetch("/statement-downloads", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateStatementDownloadStatus(id, status) {
  return apiFetch(`/statement-downloads/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function syncStatementDownloads(rows = []) {
  return apiFetch("/statement-downloads/sync", {
    method: "POST",
    body: JSON.stringify({ rows })
  });
}

export function listDriverRouteAdjustRules() {
  return apiFetchList("/driver-route-adjust-rules");
}

export function createDriverRouteAdjustRule(payload) {
  return apiFetch("/driver-route-adjust-rules", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteDriverRouteAdjustRule(id) {
  return apiFetch(`/driver-route-adjust-rules/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function syncDriverRouteAdjustRules(rows = []) {
  return apiFetch("/driver-route-adjust-rules/sync", {
    method: "POST",
    body: JSON.stringify({ rows })
  });
}

export function listCostCenterRates(source = "") {
  const query = source ? `?source=${encodeURIComponent(source)}` : "";
  return apiFetchList(`/cost-center-rates${query}`);
}

export function saveCostCenterRate(payload) {
  return apiFetch("/cost-center-rates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteCostCenterRate(id) {
  return apiFetch(`/cost-center-rates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listVehicleProfitExchangeRates() {
  return apiFetchList("/vehicle-profit-exchange-rates");
}

export function saveVehicleProfitExchangeRate(payload) {
  return apiFetch("/vehicle-profit-exchange-rates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
