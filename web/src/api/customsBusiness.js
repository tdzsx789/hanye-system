import { API_BASE, apiDownloadErrorMessage, apiFetch, apiFetchList, apiRequestHeaders } from "./client.js";

export function listCustomsBusinesses(period) {
  return apiFetchList(`/customs-businesses?period=${encodeURIComponent(period)}`);
}

export function listAllCustomsBusinesses() {
  return apiFetchList("/customs-businesses?period=all");
}

export function listRecycleCustomsBusinesses() {
  return apiFetchList("/customs-businesses/recycle");
}

export function createCustomsBusiness(payload) {
  return apiFetch("/customs-businesses", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateCustomsBusiness(id, payload) {
  return apiFetch(`/customs-businesses/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteCustomsBusiness(id) {
  return apiFetch(`/customs-businesses/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function restoreCustomsBusiness(id) {
  return apiFetch(`/customs-businesses/${encodeURIComponent(id)}/restore`, {
    method: "POST"
  });
}

export async function exportCustomsStatement(format = "excel", payload = {}) {
  const normalizedFormat = format === "pdf" ? "pdf" : "excel";
  const response = await fetch(`${API_BASE}/customs-businesses/export/${normalizedFormat}`, {
    method: "POST",
    headers: apiRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await apiDownloadErrorMessage(response, normalizedFormat === "pdf" ? "报关对账单 PDF 导出失败" : "报关对账单 Excel 导出失败"));
  }
  return response.blob();
}
