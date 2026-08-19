const { getApiBaseUrl } = require("./config");

const CHANGE_TYPE = "database-change";
const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

function realtimeUrl(token) {
  const apiBase = String(getApiBaseUrl() || "").replace(/\/+$/, "");
  const protocolBase = apiBase.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  return `${protocolBase}/realtime?token=${encodeURIComponent(token || "")}`;
}

function createRealtimeClient(options) {
  const source = options || {};
  const getToken = typeof source.getToken === "function" ? source.getToken : () => "";
  const onChange = typeof source.onChange === "function" ? source.onChange : () => {};
  const onStatus = typeof source.onStatus === "function" ? source.onStatus : () => {};
  let socketTask = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let closedByUser = false;
  let activeToken = "";
  let suppressNextCloseReconnect = false;

  function setStatus(status, detail) {
    onStatus(status, detail || {});
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function closeSocket(options) {
    if (!socketTask) return;
    suppressNextCloseReconnect = Boolean(options && options.suppressReconnect);
    const current = socketTask;
    socketTask = null;
    try {
      current.close({});
    } catch (error) {
      // Ignore close failures from already-closed sockets.
    }
  }

  function scheduleReconnect() {
    if (closedByUser || reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, MIN_RECONNECT_MS * Math.pow(2, Math.min(reconnectAttempts, 5)));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    setStatus("reconnecting", { delay });
  }

  function connect() {
    if (typeof wx === "undefined" || typeof wx.connectSocket !== "function") return;
    const token = getToken();
    if (!token) {
      disconnect();
      return;
    }
    if (socketTask && activeToken === token) return;
    closedByUser = false;
    activeToken = token;
    closeSocket({ suppressReconnect: true });
    setStatus("connecting");
    socketTask = wx.connectSocket({
      url: realtimeUrl(token),
      header: {
        Authorization: `Bearer ${token}`
      },
      success() {},
      fail(error) {
        setStatus("error", { error });
        scheduleReconnect();
      }
    });
    socketTask.onOpen(() => {
      reconnectAttempts = 0;
      setStatus("connected");
    });
    socketTask.onMessage((message) => {
      let data = null;
      try {
        data = JSON.parse(message && message.data ? message.data : "{}");
      } catch (error) {
        return;
      }
      if (data && data.type === CHANGE_TYPE) onChange(data);
    });
    socketTask.onError((error) => {
      setStatus("error", { error });
    });
    socketTask.onClose(() => {
      socketTask = null;
      setStatus("disconnected");
      if (suppressNextCloseReconnect) {
        suppressNextCloseReconnect = false;
        return;
      }
      scheduleReconnect();
    });
  }

  function disconnect() {
    closedByUser = true;
    clearReconnectTimer();
    closeSocket({ suppressReconnect: true });
    activeToken = "";
    setStatus("disconnected");
  }

  return {
    connect,
    disconnect,
    reconnect() {
      disconnect();
      closedByUser = false;
      connect();
    }
  };
}

module.exports = {
  createRealtimeClient
};
