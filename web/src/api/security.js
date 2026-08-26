import { apiFetch } from "./client.js";

export function listAuditLogs({ page = 1, pageSize = 100 } = {}) {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize)
  });
  return apiFetch(`/audit-logs?${query.toString()}`);
}
