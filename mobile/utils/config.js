const API_BASE_STORAGE_KEY = "hanye_mobile_api_base_url";
const DEFAULT_API_BASE_URL = "http://localhost:8080/api";

function normalizeApiBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return DEFAULT_API_BASE_URL;
  return /\/api$/i.test(text) ? text : `${text}/api`;
}

function getApiBaseUrl() {
  if (typeof wx === "undefined") return DEFAULT_API_BASE_URL;
  return normalizeApiBaseUrl(wx.getStorageSync(API_BASE_STORAGE_KEY) || DEFAULT_API_BASE_URL);
}

function setApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value);
  wx.setStorageSync(API_BASE_STORAGE_KEY, normalized);
  return normalized;
}

module.exports = {
  API_BASE_STORAGE_KEY,
  DEFAULT_API_BASE_URL,
  getApiBaseUrl,
  normalizeApiBaseUrl,
  setApiBaseUrl
};
