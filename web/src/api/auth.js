import { apiFetch } from "./client.js";

export function getCurrentAccount() {
  return apiFetch("/auth/me");
}

export function updatePassword(payload) {
  return apiFetch("/auth/password", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function updateProfile(payload) {
  return apiFetch("/auth/profile", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function getTablePreferences() {
  return apiFetch("/auth/table-preferences");
}

export function updateTablePreferences(payload) {
  return apiFetch("/auth/table-preferences", {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}
