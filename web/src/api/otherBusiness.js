import { apiFetch, apiFetchList } from "./client.js";

export function listOtherBusinesses(period) {
  return apiFetchList(`/other-businesses?period=${encodeURIComponent(period)}`);
}

export function listAllOtherBusinesses() {
  return apiFetchList("/other-businesses?period=all");
}

export function listRecycleOtherBusinesses() {
  return apiFetchList("/other-businesses/recycle");
}

export function createOtherBusiness(payload) {
  return apiFetch("/other-businesses", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateOtherBusiness(id, payload) {
  return apiFetch(`/other-businesses/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function deleteOtherBusiness(id) {
  return apiFetch(`/other-businesses/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function restoreOtherBusiness(id) {
  return apiFetch(`/other-businesses/${encodeURIComponent(id)}/restore`, {
    method: "POST"
  });
}
