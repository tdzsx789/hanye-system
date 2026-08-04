import { apiFetch, apiFetchList } from "./client.js";

export function listCustomsBusinesses(period) {
  return apiFetchList(`/customs-businesses?period=${encodeURIComponent(period)}`);
}

export function createCustomsBusiness(payload) {
  return apiFetch("/customs-businesses", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
