export const API_BASE = "/api";

const apiClientContext = {
  getToken: () => "",
  getAccount: () => ({}),
  onUnauthorized: () => {}
};

export function configureApiClient(options = {}) {
  apiClientContext.getToken = typeof options.getToken === "function" ? options.getToken : apiClientContext.getToken;
  apiClientContext.getAccount = typeof options.getAccount === "function" ? options.getAccount : apiClientContext.getAccount;
  apiClientContext.onUnauthorized = typeof options.onUnauthorized === "function" ? options.onUnauthorized : apiClientContext.onUnauthorized;
}

function encodeHeaderValue(value) {
  return encodeURIComponent(String(value || ""));
}

export function apiRequestHeaders(headers = {}) {
  const account = apiClientContext.getAccount() || {};
  const token = apiClientContext.getToken() || "";
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-Hanye-User": encodeHeaderValue(account.username),
    "X-Hanye-Role": encodeHeaderValue(account.role),
    "X-Hanye-Display-Name": encodeHeaderValue(account.displayName),
    ...headers
  };
}

export async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: apiRequestHeaders({
      "Content-Type": "application/json",
      ...(options?.headers || {})
    })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) {
      apiClientContext.onUnauthorized();
    }
    const err = new Error(error.message || "接口请求失败");
    err.status = response.status;
    err.payload = error;
    throw err;
  }
  return response.json();
}

export async function apiFetchList(path) {
  const data = await apiFetch(path);
  return Array.isArray(data) ? data : [];
}

export async function apiDownloadErrorMessage(response, fallback) {
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const error = await response.json().catch(() => ({}));
    return error.message || fallback;
  }
  const message = await response.text().catch(() => "");
  return message || fallback;
}
