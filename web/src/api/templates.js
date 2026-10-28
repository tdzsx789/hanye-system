import { apiFetch, apiFetchList } from "./client.js";

let templateMutationVersion = 0;

export function getTemplateMutationVersion() {
  return templateMutationVersion;
}

async function mutateTemplate(path, options) {
  const result = await apiFetch(path, options);
  templateMutationVersion += 1;
  return result;
}

export function listTemplates(query = "?includeContent=0&scope=export") {
  return apiFetchList(`/templates${query}`);
}

export function getTemplate(id) {
  return apiFetch(`/templates/${id}`);
}

export function createTemplate(payload) {
  return mutateTemplate("/templates", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateTemplate(id, payload) {
  return mutateTemplate(`/templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function saveTemplate(id, payload) {
  return id ? updateTemplate(id, payload) : createTemplate(payload);
}

export function deleteTemplate(id) {
  return mutateTemplate(`/templates/${id}`, { method: "DELETE" });
}
