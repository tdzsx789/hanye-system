const API_BASE_STORAGE_KEY = "hanye_mobile_api_base_url";
const LOCAL_API_BASE_URL = "http://127.0.0.1:8080/api";
const PRODUCTION_API_BASE_URL = "https://oa.hanyeltd.com/api";
const DEFAULT_API_BASE_URL = PRODUCTION_API_BASE_URL;

function getRuntimeEnvVersion() {
  if (typeof wx === "undefined" || typeof wx.getAccountInfoSync !== "function") {
    return "develop";
  }
  try {
    const accountInfo = wx.getAccountInfoSync();
    return accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.envVersion
      ? accountInfo.miniProgram.envVersion
      : "develop";
  } catch (error) {
    return "develop";
  }
}

function isDevToolsRuntime() {
  if (typeof wx === "undefined" || typeof wx.getSystemInfoSync !== "function") {
    return false;
  }
  try {
    const systemInfo = wx.getSystemInfoSync();
    return String(systemInfo.platform || "").toLowerCase() === "devtools";
  } catch (error) {
    return false;
  }
}

function getDefaultApiBaseUrl() {
  return getRuntimeEnvVersion() === "develop" && isDevToolsRuntime()
    ? LOCAL_API_BASE_URL
    : PRODUCTION_API_BASE_URL;
}

function normalizeApiBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) return getDefaultApiBaseUrl();
  return /\/api$/i.test(text) ? text : `${text}/api`;
}

function getApiBaseUrl() {
  if (typeof wx === "undefined") return getDefaultApiBaseUrl();
  return normalizeApiBaseUrl(wx.getStorageSync(API_BASE_STORAGE_KEY) || getDefaultApiBaseUrl());
}

function setApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value);
  wx.setStorageSync(API_BASE_STORAGE_KEY, normalized);
  return normalized;
}

function resetApiBaseUrl() {
  return setApiBaseUrl(getDefaultApiBaseUrl());
}

module.exports = {
  API_BASE_STORAGE_KEY,
  DEFAULT_API_BASE_URL,
  LOCAL_API_BASE_URL,
  PRODUCTION_API_BASE_URL,
  getApiBaseUrl,
  getDefaultApiBaseUrl,
  normalizeApiBaseUrl,
  resetApiBaseUrl,
  setApiBaseUrl
};
