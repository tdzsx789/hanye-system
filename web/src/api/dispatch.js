import { apiFetch, apiFetchList } from "./client.js";

export function getDispatchPlan(date) {
  return apiFetch(`/dispatch-plans/${encodeURIComponent(date)}`);
}

export function saveDispatchPlan(date, rows = []) {
  return apiFetch(`/dispatch-plans/${encodeURIComponent(date)}`, {
    method: "PUT",
    body: JSON.stringify({ rows })
  });
}

export function listDispatchPlans(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const params = new URLSearchParams();
  const period = typeof options === "string" ? options : source.period;
  if (period) params.set("period", period);
  if (source.start) params.set("start", source.start);
  if (source.end) params.set("end", source.end);
  const query = params.toString();
  return apiFetchList(`/dispatch-plans${query ? `?${query}` : ""}`);
}
