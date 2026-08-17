const api = require("../../utils/api");
const { DEFAULT_API_BASE_URL, setApiBaseUrl } = require("../../utils/config");
const { getSession, isSessionExpired, setSession } = require("../../utils/session");
const { hasDispatchAccess } = require("../../utils/dispatch");

Page({
  data: {
    checking: true,
    loading: false,
    password: "",
    username: ""
  },

  onLoad() {
    setApiBaseUrl(DEFAULT_API_BASE_URL);
    this.tryResumeSession();
  },

  async tryResumeSession() {
    const session = getSession();
    if (!session.token || isSessionExpired(session.expiresAt)) {
      this.setData({ checking: false });
      return;
    }
    const account = await getApp().ensureLogin();
    if (account && hasDispatchAccess(account)) {
      wx.reLaunch({ url: "/pages/dispatch/index" });
      return;
    }
    this.setData({ checking: false });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [field]: event.detail.value });
  },

  async submitLogin() {
    const username = String(this.data.username || "").trim();
    const password = String(this.data.password || "");
    if (!username || !password) {
      wx.showToast({ title: "请输入账号和密码", icon: "none" });
      return;
    }
    setApiBaseUrl(DEFAULT_API_BASE_URL);
    this.setData({ loading: true });
    try {
      const result = await api.login({ username, password });
      const account = result && result.account ? result.account : null;
      if (!hasDispatchAccess(account)) {
        wx.showToast({ title: "当前账号无排车表权限", icon: "none" });
        return;
      }
      setSession(result);
      getApp().setAccount(account);
      wx.reLaunch({ url: "/pages/dispatch/index" });
    } catch (error) {
      wx.showToast({ title: error.message || "登录失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  }
});
