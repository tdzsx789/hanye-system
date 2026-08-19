import { apiFetch, apiFetchList } from "./client.js";

export function getDispatchPlan(date) {
  return apiFetch(`/dispatch-plans/${encodeURIComponent(date)}`);
}

export function saveDispatchPlan(date, rows = [], options = {}) {
  return apiFetch(`/dispatch-plans/${encodeURIComponent(date)}`, {
    method: "PUT",
    body: JSON.stringify({
      rows,
      baseRows: Array.isArray(options.baseRows) ? options.baseRows : [],
      updatedAt: options.updatedAt || ""
    })
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

export function listRecycleDispatchPlans() {
  return apiFetchList("/dispatch-plans/recycle");
}

export function recycleDispatchPlanRow(date, row = {}) {
  return apiFetch("/dispatch-plans/recycle", {
    method: "POST",
    body: JSON.stringify({ date, row })
  });
}

export function deleteDispatchPlanRows(date, refs = []) {
  const rows = Array.isArray(refs) ? refs : [refs];
  return apiFetch(`/dispatch-plans/${encodeURIComponent(date)}/rows`, {
    method: "DELETE",
    body: JSON.stringify({ refs: rows })
  });
}

export function restoreRecycleDispatchPlan(id) {
  return apiFetch(`/dispatch-plans/recycle/${encodeURIComponent(id)}/restore`, {
    method: "POST"
  });
}
