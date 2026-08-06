const TOKEN_KEY = "hanye_mobile_session_token";
const ACCOUNT_KEY = "hanye_mobile_session_account";
const EXPIRES_KEY = "hanye_mobile_session_expires_at";

function getSession() {
  const token = wx.getStorageSync(TOKEN_KEY) || "";
  const account = wx.getStorageSync(ACCOUNT_KEY) || null;
  const expiresAt = wx.getStorageSync(EXPIRES_KEY) || "";
  return { token, account, expiresAt };
}

function isSessionExpired(expiresAt) {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function setSession(payload) {
  const token = payload && payload.token ? payload.token : "";
  const account = payload && payload.account ? payload.account : null;
  const expiresAt = payload && payload.expiresAt ? payload.expiresAt : "";
  wx.setStorageSync(TOKEN_KEY, token);
  wx.setStorageSync(ACCOUNT_KEY, account);
  wx.setStorageSync(EXPIRES_KEY, expiresAt);
  return { token, account, expiresAt };
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(ACCOUNT_KEY);
  wx.removeStorageSync(EXPIRES_KEY);
}

module.exports = {
  ACCOUNT_KEY,
  EXPIRES_KEY,
  TOKEN_KEY,
  clearSession,
  getSession,
  isSessionExpired,
  setSession
};
