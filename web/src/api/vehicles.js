import { apiFetch, apiFetchList } from "./client.js";

export function listVehicles() {
  return apiFetchList("/vehicles");
}

export function saveVehicle(currentPlate, payload) {
  const path = currentPlate ? `/vehicles/${encodeURIComponent(currentPlate)}` : "/vehicles";
  return apiFetch(path, {
    method: currentPlate ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteVehicle(plate) {
  return apiFetch(`/vehicles/${encodeURIComponent(plate)}`, { method: "DELETE" });
}

export function listVehicleExpenses() {
  return apiFetchList("/vehicle-expenses");
}

export function saveVehicleExpense(id, payload) {
  return apiFetch(id ? `/vehicle-expenses/${id}` : "/vehicle-expenses", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteVehicleExpense(id) {
  return apiFetch(`/vehicle-expenses/${id}`, { method: "DELETE" });
}

export function listDrivers() {
  return apiFetchList("/drivers");
}

export function saveDriver(id, payload) {
  return apiFetch(id ? `/drivers/${id}` : "/drivers", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteDriver(id) {
  return apiFetch(`/drivers/${id}`, { method: "DELETE" });
}

export function listDriverWageRules() {
  return apiFetchList("/driver-wage-rules");
}

export function saveDriverWageRule(id, payload) {
  return apiFetch(id ? `/driver-wage-rules/${id}` : "/driver-wage-rules", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteDriverWageRule(id) {
  return apiFetch(`/driver-wage-rules/${id}`, { method: "DELETE" });
}

export function listDriverAdjustments() {
  return apiFetchList("/driver-adjustments");
}

export function saveDriverAdjustment(id, payload) {
  return apiFetch(id ? `/driver-adjustments/${id}` : "/driver-adjustments", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteDriverAdjustment(id) {
  return apiFetch(`/driver-adjustments/${id}`, { method: "DELETE" });
}
