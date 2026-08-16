import { apiFetch } from "./client.js";

export function listExpiryReminders() {
  return apiFetch("/reminders/expiry");
}

export function acknowledgeExpiryReminders(keys = []) {
  return apiFetch("/reminders/expiry/ack", {
    method: "POST",
    body: JSON.stringify({ keys })
  });
}
