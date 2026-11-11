import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/App.vue", import.meta.url), "utf8");
const start = source.indexOf("function financeWageStatementOrderProjectLines");
const end = source.indexOf("\nfunction financeWageStatementOrderProjectMap", start);
assert.notEqual(start, -1);
assert.notEqual(end, -1);

function createContext() {
  const context = vm.createContext({
    DRIVER_EXTRA_RULE_FIELDS: ["loadPerBoard", "unloadPerBoard", "crossSeaFee", "addPointFee", "waitingPerHour"],
    DRIVER_EXTRA_FIELD_LABELS: {
      loadPerBoard: "装货费",
      unloadPerBoard: "卸货费",
      crossSeaFee: "过海费",
      addPointFee: "加点费",
      waitingPerHour: "装货等候费"
    },
    financeWageStatementSavedCostLines() {
      return [];
    },
    financeWageStatementFeeShouldApplyToDriver(_order, fee, driver) {
      return String(fee?.driverName || "").trim() === String(driver?.name || "").trim();
    },
    financeWageStatementFeeHasStoredCost() {
      return false;
    },
    driverCostCenterFeeBreakdown() {
      return { details: [] };
    },
    financeWageStatementProjectName(value = "") {
      return String(value || "").trim();
    },
    financeWageStatementProjectCurrency(value = "") {
      return String(value || "").toUpperCase() === "RMB" || value === "人民币" ? "RMB" : "HKD";
    },
    financeWageStatementFeeLineKey(name = "", currency = "HKD") {
      return `${name}|${currency}`;
    },
    financeWageStatementIsFreightName() {
      return false;
    },
    financeWageStatementProjectLineMatchesExtraField() {
      return false;
    },
    driverExtraTripFee(order = {}, field, driver = null) {
      if (field !== "unloadPerBoard") return 0;
      return (Array.isArray(order.fees) ? order.fees : []).some((fee) =>
        fee?.name === "卸货费" && fee?.driverName === driver?.name
      ) ? 50 : 0;
    }
  });
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test("an unloading remark without a fee assignment does not create a driver wage line", () => {
  const context = createContext();
  const lines = context.financeWageStatementOrderProjectLines(
    { note: "21号卸货", fees: [] },
    { name: "李永洪" }
  );

  assert.deepEqual(lines, []);
});

test("company-covered unloading does not create a driver wage line", () => {
  const context = createContext();
  const lines = context.financeWageStatementOrderProjectLines(
    { note: "21号卸货", fees: [{ name: "卸货费", driverName: "公司承担", amount: 50 }] },
    { name: "李永洪" }
  );

  assert.deepEqual(lines, []);
});

test("an unloading fee explicitly assigned to the driver remains exportable", () => {
  const context = createContext();
  const lines = context.financeWageStatementOrderProjectLines(
    { fees: [{ name: "卸货费", driverName: "李永洪", amount: 50 }] },
    { name: "李永洪" }
  );

  assert.deepEqual(JSON.parse(JSON.stringify(lines)), [{
    name: "卸货费",
    currency: "HKD",
    key: "卸货费|HKD",
    amount: 50,
    freight: false
  }]);
});
