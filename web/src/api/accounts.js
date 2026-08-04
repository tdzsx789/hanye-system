import { apiFetch, apiFetchList } from "./client.js";

export function listAccounts() {
  return apiFetchList("/accounts");
}

export function createAccount(payload) {
  return apiFetch("/accounts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateAccount(id, payload) {
  return apiFetch(`/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteAccount(id) {
  return apiFetch(`/accounts/${id}`, { method: "DELETE" });
}
