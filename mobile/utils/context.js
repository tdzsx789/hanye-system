const DISPATCH_FORM_CONTEXT_KEY = "hanye_mobile_dispatch_form_context";
const DISPATCH_DATE_KEY = "hanye_mobile_dispatch_date";

function setDispatchFormContext(context) {
  wx.setStorageSync(DISPATCH_FORM_CONTEXT_KEY, context || {});
}

function getDispatchFormContext() {
  return wx.getStorageSync(DISPATCH_FORM_CONTEXT_KEY) || {};
}

function clearDispatchFormContext() {
  wx.removeStorageSync(DISPATCH_FORM_CONTEXT_KEY);
}

module.exports = {
  DISPATCH_DATE_KEY,
  clearDispatchFormContext,
  getDispatchFormContext,
  setDispatchFormContext
};
