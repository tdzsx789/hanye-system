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
