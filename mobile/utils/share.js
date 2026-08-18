function enableShareMenu() {
  if (typeof wx === "undefined" || typeof wx.showShareMenu !== "function") return;
  wx.showShareMenu({
    withShareTicket: true,
    menus: ["shareAppMessage", "shareTimeline"]
  });
}

function encodeQueryValue(value) {
  return encodeURIComponent(String(value || ""));
}

function dispatchSharePath(date, status) {
  const query = [];
  if (date) query.push(`date=${encodeQueryValue(date)}`);
  if (status && status !== "all") query.push(`status=${encodeQueryValue(status)}`);
  return `/pages/dispatch/index${query.length ? `?${query.join("&")}` : ""}`;
}

function dispatchCopyQuery(date, status) {
  const query = [];
  if (date) query.push(`date=${encodeQueryValue(date)}`);
  if (status && status !== "all") query.push(`status=${encodeQueryValue(status)}`);
  return query.join("&");
}

function shareImageUrl() {
  return "";
}

module.exports = {
  dispatchCopyQuery,
  dispatchSharePath,
  enableShareMenu,
  shareImageUrl
};
