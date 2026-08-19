import { apiFetch } from "./client.js";

export function listFiles(entityType, entityId, options = {}) {
  const deletedOnly = options.deletedOnly ? "&deletedOnly=1" : "";
  const includeOrderFiles = options.includeOrderFiles ? "&includeOrderFiles=1" : "";
  return apiFetch(`/files?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}${deletedOnly}${includeOrderFiles}`);
}

export function uploadFile(payload) {
  return apiFetch("/files", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function moveFileById(id, payload) {
  return apiFetch(`/files/${id}/move`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteFileById(id) {
  return apiFetch(`/files/${id}`, { method: "DELETE" });
}

export function restoreFileById(id) {
  return apiFetch(`/files/${id}/restore`, { method: "POST" });
}

export function permanentlyDeleteFile(id) {
  return apiFetch(`/files/${id}/permanent`, { method: "DELETE" });
}
