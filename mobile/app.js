const api = require("./utils/api");
const { createRealtimeClient } = require("./utils/realtime");
const { clearSession, getSession, isSessionExpired, setSession } = require("./utils/session");

App({
  globalData: {
    account: null,
    realtimeStatus: "disconnected"
  },
  realtimeClient: null,
  realtimeListeners: [],

  onLaunch() {
    const session = getSession();
    this.globalData.account = session.account || null;
    if (session.token && !isSessionExpired(session.expiresAt)) {
      this.ensureRealtimeConnection();
    }
  },

  setAccount(account) {
    this.globalData.account = account || null;
    if (account) this.ensureRealtimeConnection();
  },

  clearAccount() {
    this.closeRealtimeConnection();
    clearSession();
    this.globalData.account = null;
  },

  notifyRealtimeChange(event) {
    this.realtimeListeners.slice().forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        console.warn("Realtime listener failed", error);
      }
    });
  },

  registerRealtimeListener(listener) {
    if (typeof listener !== "function") return function noop() {};
    if (this.realtimeListeners.indexOf(listener) < 0) {
      this.realtimeListeners.push(listener);
    }
    this.ensureRealtimeConnection();
    return () => {
      this.realtimeListeners = this.realtimeListeners.filter((item) => item !== listener);
    };
  },

  ensureRealtimeConnection() {
    const session = getSession();
    if (!session.token || isSessionExpired(session.expiresAt)) {
      this.closeRealtimeConnection();
      return;
    }
    if (!this.realtimeClient) {
      this.realtimeClient = createRealtimeClient({
        getToken: () => getSession().token,
        onChange: (event) => this.notifyRealtimeChange(event),
        onStatus: (status) => {
          this.globalData.realtimeStatus = status;
        }
      });
    }
    this.realtimeClient.connect();
  },

  closeRealtimeConnection() {
    if (this.realtimeClient) {
      this.realtimeClient.disconnect();
      this.realtimeClient = null;
    }
    this.globalData.realtimeStatus = "disconnected";
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
      this.ensureRealtimeConnection();
      return account;
    } catch (error) {
      this.clearAccount();
      return null;
    }
  }
});
