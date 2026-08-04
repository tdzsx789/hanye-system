import { apiFetch, apiFetchList } from "./client.js";

export function listTemplates(query = "?includeContent=0&scope=export") {
  return apiFetchList(`/templates${query}`);
}

export function getTemplate(id) {
  return apiFetch(`/templates/${id}`);
}

export function createTemplate(payload) {
  return apiFetch("/templates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateTemplate(id, payload) {
  return apiFetch(`/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function saveTemplate(id, payload) {
  return id ? updateTemplate(id, payload) : createTemplate(payload);
}

export function deleteTemplate(id) {
  return apiFetch(`/templates/${id}`, { method: "DELETE" });
}
