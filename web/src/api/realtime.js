import { API_BASE } from "./client.js";

const CHANGE_TYPE = "database-change";
const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

function realtimeUrl(token = "") {
  const apiBase = API_BASE.replace(/\/+$/, "");
  const url = new URL(`${apiBase}/realtime`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

export function createRealtimeClient(options = {}) {
  const getToken = typeof options.getToken === "function" ? options.getToken : () => "";
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};
  let socket = null;
  let reconnectTimer = 0;
  let reconnectAttempts = 0;
  let closedByUser = false;
  let activeToken = "";

  function setStatus(status, detail = {}) {
    onStatus(status, detail);
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }

  function scheduleReconnect() {
    if (closedByUser || reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, MIN_RECONNECT_MS * (2 ** Math.min(reconnectAttempts, 5)));
    reconnectAttempts += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0;
      connect();
    }, delay);
    setStatus("reconnecting", { delay });
  }

  function closeSocket() {
    if (!socket) return;
    const current = socket;
    socket = null;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    current.close();
  }

  function connect() {
    if (typeof WebSocket === "undefined") return;
    const token = getToken();
    if (!token) {
      disconnect();
      return;
    }
    if (socket && activeToken === token && [WebSocket.CONNECTING, WebSocket.OPEN].includes(socket.readyState)) {
      return;
    }
    closedByUser = false;
    activeToken = token;
    closeSocket();
    try {
      socket = new WebSocket(realtimeUrl(token));
    } catch (error) {
      setStatus("error", { error });
      scheduleReconnect();
      return;
    }
    setStatus("connecting");
    socket.onopen = () => {
      reconnectAttempts = 0;
      setStatus("connected");
    };
    socket.onmessage = (event) => {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message?.type === CHANGE_TYPE) onChange(message);
    };
    socket.onerror = (error) => {
      setStatus("error", { error });
    };
    socket.onclose = () => {
      socket = null;
      setStatus("disconnected");
      scheduleReconnect();
    };
  }

  function disconnect() {
    closedByUser = true;
    clearReconnectTimer();
    closeSocket();
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
