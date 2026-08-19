import { WebSocket, WebSocketServer } from "ws";

const REALTIME_PATH = "/api/realtime";
const CHANGE_TYPE = "database-change";
const HEARTBEAT_INTERVAL_MS = 30000;

const DATA_MUTATION_ACTIONS = new Set([
  "audit",
  "create",
  "delete",
  "purge",
  "restore",
  "sync",
  "update",
  "update_status",
  "upload"
]);

function cleanText(value = "") {
  return String(value || "").trim();
}

function uniqueList(values = []) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function modulesForEntity(entityType = "", action = "") {
  const type = cleanText(entityType);
  const act = cleanText(action);
  if (type === "account" || type === "account_password" || type === "account_profile") {
    return ["accounts"];
  }
  if (type === "address_book" || type === "address_history" || type === "customer" || type === "customer_contact") {
    return ["customers", "dispatchBoard", "orders"];
  }
  if (type === "customs_business") {
    return ["customsBusiness", "financeCustomsStatements", "bossDashboard", "bossCompanyProfit"];
  }
  if (type === "other_business") {
    return ["otherBusiness", "bossDashboard", "bossCompanyProfit"];
  }
  if (type === "dispatch_plan") {
    return ["dispatchBoard", "orders", "financeCosts", "financeSupplierStatements", "financeWages", "bossDashboard", "bossCompanyProfit", "bossVehicleProfit", "bossSupplierProfit"];
  }
  if (type === "order") {
    return ["orders", "dispatchBoard", "customers", "financeCosts", "financeSupplierStatements", "financeWages", "bossDashboard", "bossCompanyProfit", "bossVehicleProfit", "bossSupplierProfit"];
  }
  if (type === "vehicle" || type === "vehicle_expense") {
    return ["vehicleDriver", "dispatchBoard", "orders", "financeWages", "bossDashboard", "bossCompanyProfit", "bossVehicleProfit", "reminders"];
  }
  if (type === "driver" || type === "driver_adjustment") {
    return ["vehicleDriver", "dispatchBoard", "orders", "financeWages", "bossDashboard", "bossCompanyProfit", "bossVehicleProfit", "reminders"];
  }
  if (type === "driver_wage_rule" || type === "driver_route_adjust_rule") {
    return ["financeWages", "financeCostCenter", "vehicleDriver", "orders"];
  }
  if (type === "cost_center_rate") {
    return ["financeCostCenter", "orders", "bossSupplierProfit"];
  }
  if (type === "vehicle_profit_exchange_rate") {
    return ["bossVehicleProfit", "bossSupplierProfit", "bossDashboard", "bossCompanyProfit"];
  }
  if (type === "company_expense") {
    return ["bossCompanyExpenses", "bossDashboard", "bossCompanyProfit"];
  }
  if (type === "statement" || (type === "customs_business" && act === "download")) {
    return ["financeCosts", "financeSupplierStatements", "financeCustomsStatements"];
  }
  if (type === "fee_item" || type === "fee_item_order") {
    return ["freight", "orders", "templates"];
  }
  if (type === "freight_rate") {
    return ["freight", "dispatchBoard", "orders"];
  }
  if (type === "template") {
    return ["templates"];
  }
  if (type === "rule") {
    return ["rules"];
  }
  if (type === "master_data") {
    return ["master", "dispatchBoard", "orders"];
  }
  if (type === "file") {
    return ["customers", "orders", "vehicleDriver"];
  }
  return [];
}

function isDatabaseChange(action = "", entityType = "") {
  const type = cleanText(entityType);
  const act = cleanText(action);
  if (type === "statement" && act === "download") return true;
  return DATA_MUTATION_ACTIONS.has(act);
}

export function realtimeEventFromAudit({ action, entityType, entityId, detail = "", actor = "" } = {}) {
  if (!isDatabaseChange(action, entityType)) return null;
  const affectedModules = uniqueList([...modulesForEntity(entityType, action), "security"]);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    type: CHANGE_TYPE,
    action: cleanText(action),
    entityType: cleanText(entityType),
    entityId: cleanText(entityId),
    detail: cleanText(detail),
    actor: {
      name: cleanText(actor) || "admin"
    },
    affectedModules,
    updatedAt: new Date().toISOString()
  };
}

function tokenFromRequest(request) {
  try {
    const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
    const token = cleanText(url.searchParams.get("token"));
    if (token) return token;
  } catch {
    // Fall through to headers.
  }
  const authorization = cleanText(request.headers.authorization);
  if (authorization.toLowerCase().startsWith("bearer ")) return authorization.slice(7).trim();
  return "";
}

function rejectSocket(socket, statusCode = 401, message = "Unauthorized") {
  socket.write(`HTTP/1.1 ${statusCode} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createRealtimeHub({ server, path = REALTIME_PATH, authenticate } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  server.on("upgrade", async (request, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(request.url || "", `http://${request.headers.host || "localhost"}`).pathname;
    } catch {
      pathname = "";
    }
    if (pathname !== path) return;

    try {
      const account = typeof authenticate === "function"
        ? await authenticate(tokenFromRequest(request))
        : null;
      if (!account) {
        rejectSocket(socket);
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request, account);
      });
    } catch (error) {
      console.warn("Realtime authentication failed", error);
      rejectSocket(socket);
    }
  });

  wss.on("connection", (ws, _request, account) => {
    ws.isAlive = true;
    ws.account = account;
    clients.add(ws);

    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("message", (rawMessage) => {
      try {
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message?.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", serverTime: new Date().toISOString() }));
        }
      } catch {
        // Ignore malformed client messages. The channel is server-driven.
      }
    });
    ws.on("close", () => {
      clients.delete(ws);
    });
    ws.on("error", () => {
      clients.delete(ws);
    });

    ws.send(JSON.stringify({
      type: "hello",
      serverTime: new Date().toISOString(),
      account: {
        id: account.id,
        username: account.username,
        displayName: account.displayName || account.username,
        role: account.role
      }
    }));
  });

  const heartbeat = setInterval(() => {
    clients.forEach((ws) => {
      if (ws.isAlive === false) {
        clients.delete(ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  return {
    broadcast(event) {
      if (!event || !clients.size) return;
      const message = JSON.stringify(event.type ? event : { type: CHANGE_TYPE, ...event });
      clients.forEach((ws) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(message, (error) => {
          if (error) clients.delete(ws);
        });
      });
    },
    close() {
      clearInterval(heartbeat);
      clients.forEach((ws) => ws.close());
      clients.clear();
      wss.close();
    },
    getClientCount() {
      return clients.size;
    }
  };
}
