const DISPATCH_STATUS_OPTIONS = ["预排", "已派车", "通关中", "已签收", "异常滞留"];
const DISPATCH_PLAN_DEFAULT_STATUS = "预排";
const DISPATCH_LOCKED_STATUS = "通关中";
const DISPATCH_STATUS_TO_ORDER_STATUS = {
  预排: "预排",
  待预排: "预排",
  已预排: "预排",
  已派车: "预排",
  通关中: "通关中",
  已签收: "已签收",
  异常滞留: "费用待确认"
};

const STATUS_CLASS_MAP = {
  预排: "status-planned",
  已派车: "status-dispatched",
  通关中: "status-crossing",
  已签收: "status-signed",
  异常滞留: "status-exception"
};

const STATUS_ACTION_LABELS = {
  预排: "退回预排",
  已派车: "确认派车",
  通关中: "进入通关",
  已签收: "确认签收",
  异常滞留: "异常滞留"
};

const DIRECTION_OPTIONS = ["出口", "进口"];
const TONNAGE_OPTIONS = ["3T", "5T", "8T", "10T", "12T", "20尺柜", "40尺柜", "45尺柜"];
const PORT_OPTIONS = ["深圳湾海关", "莲塘海关", "文锦渡海关", "大桥海关"];
const VEHICLE_SOURCE_OPTIONS = ["本公司车辆", "外派车辆"];
const TRANSPORT_MODE_OPTIONS = ["单司机", "双司机", "口岸转国内车"];
const BUSINESS_TYPE_OPTIONS = ["运输", "运输+报关"];
const DISPATCH_LOAD_TIME_OPTIONS = [];

for (let index = 0; index < 96; index += 1) {
  const totalMinutes = index * 15;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  DISPATCH_LOAD_TIME_OPTIONS.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
}

module.exports = {
  BUSINESS_TYPE_OPTIONS,
  DIRECTION_OPTIONS,
  DISPATCH_LOAD_TIME_OPTIONS,
  DISPATCH_LOCKED_STATUS,
  DISPATCH_PLAN_DEFAULT_STATUS,
  DISPATCH_STATUS_OPTIONS,
  DISPATCH_STATUS_TO_ORDER_STATUS,
  PORT_OPTIONS,
  STATUS_ACTION_LABELS,
  STATUS_CLASS_MAP,
  TONNAGE_OPTIONS,
  TRANSPORT_MODE_OPTIONS,
  VEHICLE_SOURCE_OPTIONS
};
