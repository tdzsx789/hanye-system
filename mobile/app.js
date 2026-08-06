const api = require("./utils/api");
const { clearSession, getSession, isSessionExpired, setSession } = require("./utils/session");

App({
  globalData: {
    account: null
  },

  onLaunch() {
    const session = getSession();
    this.globalData.account = session.account || null;
  },

  setAccount(account) {
    this.globalData.account = account || null;
  },

  clearAccount() {
    clearSession();
    this.globalData.account = null;
  },

  async ensureLogin() {
    const session = getSession();
    if (!session.token || isSessionExpired(session.expiresAt)) {
      this.clearAccount();
      return null;
    }
    try {
      const result = await api.getCurrentAccount();
      const account = result && result.account ? result.account : session.account;
      if (account) {
        setSession({
          token: session.token,
          expiresAt: session.expiresAt,
          account
        });
      }
      this.setAccount(account);
      return account;
    } catch (error) {
      this.clearAccount();
      return null;
    }
  }
});
