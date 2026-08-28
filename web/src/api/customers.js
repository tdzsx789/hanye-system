import { apiFetch, apiFetchList } from "./client.js";

export function listCustomers(options = {}) {
  const params = new URLSearchParams();
  if (options.type) params.set("type", options.type);
  if (options.category) params.set("category", options.category);
  const query = params.toString();
  return apiFetchList(query ? `/customers?${query}` : "/customers");
}

export function createCustomer(payload) {
  return apiFetch("/customers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateCustomer(id, payload) {
  return apiFetch(`/customers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteCustomer(id) {
  return apiFetch(`/customers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listCustomerContacts() {
  return apiFetchList("/customer-contacts");
}

export function createCustomerContact(payload) {
  return apiFetch("/customer-contacts", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateCustomerContact(id, payload) {
  return apiFetch(`/customer-contacts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteCustomerContact(id) {
  return apiFetch(`/customer-contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function listAddressBook() {
  return apiFetchList("/address-book");
}

export function listHiddenAddressHistory() {
  return apiFetchList("/address-history-hidden");
}

export function hideAddressHistory(payload) {
  return apiFetch("/address-history-hidden", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
