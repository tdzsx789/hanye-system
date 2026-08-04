import { apiFetchList } from "./client.js";

export function listAuditLogs() {
  return apiFetchList("/audit-logs");
}
