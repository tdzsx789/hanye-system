const { getApiBaseUrl } = require("./config");
const { clearSession, getSession } = require("./session");

function encodeHeaderValue(value) {
  return encodeURIComponent(String(value || ""));
}

function currentRoute() {
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
  const page = pages.length ? pages[pages.length - 1] : null;
  return page && page.route ? page.route : "";
}

function redirectToLogin() {
  if (currentRoute() === "pages/login/index") return;
  wx.reLaunch({ url: "/pages/login/index" });
}

function requestHeaders(extraHeaders) {
  const session = getSession();
  const account = session.account || {};
  const headers = Object.assign({
    "Content-Type": "application/json",
    "X-Hanye-User": encodeHeaderValue(account.username),
    "X-Hanye-Role": encodeHeaderValue(account.role),
    "X-Hanye-Display-Name": encodeHeaderValue(account.displayName)
  }, extraHeaders || {});
  if (session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  return headers;
}

function request(path, options) {
  const source = options || {};
  const url = /^https?:\/\//i.test(path) ? path : `${getApiBaseUrl()}${path}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: source.method || "GET",
      data: source.data || undefined,
      timeout: source.timeout || 20000,
      header: requestHeaders(source.headers),
      success(res) {
        const statusCode = Number(res.statusCode || 0);
        const data = res.data || {};
        if (statusCode >= 200 && statusCode < 300) {
          resolve(data);
          return;
        }
        const message = data.message || data.error || "接口请求失败";
        if (statusCode === 401 && path !== "/auth/login") {
          clearSession();
          wx.showToast({ title: "请重新登录", icon: "none" });
          redirectToLogin();
        }
        const error = new Error(message);
        error.status = statusCode;
        error.payload = data;
        reject(error);
      },
      fail(error) {
        reject(new Error(error && error.errMsg ? error.errMsg : "网络连接失败"));
      }
    });
  });
}

async function requestList(path, options) {
  const data = await request(path, options);
  return Array.isArray(data) ? data : [];
}

module.exports = {
  request,
  requestList,
  requestHeaders
};
