import { apiFetch } from "./client.js";

export function listFiles(entityType, entityId, options = {}) {
  const deletedOnly = options.deletedOnly ? "&deletedOnly=1" : "";
  const includeOrderFiles = options.includeOrderFiles ? "&includeOrderFiles=1" : "";
  const entityIds = Array.isArray(options.entityIds)
    ? options.entityIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const entityIdQuery = entityId ? `&entityId=${encodeURIComponent(entityId)}` : "";
  const entityIdsQuery = entityIds.length
    ? `&entityIds=${encodeURIComponent(entityIds.join(","))}`
    : "";
  return apiFetch(`/files?entityType=${encodeURIComponent(entityType)}${entityIdQuery}${entityIdsQuery}${deletedOnly}${includeOrderFiles}`);
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
