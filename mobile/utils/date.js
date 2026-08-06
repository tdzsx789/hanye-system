function pad(value) {
  return String(value).padStart(2, "0");
}

function inputDateFromDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseInputDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function todayInputValue() {
  return inputDateFromDate(new Date());
}

function addDaysToInputDate(value, offset) {
  const date = parseInputDate(value) || new Date();
  date.setDate(date.getDate() + Number(offset || 0));
  return inputDateFromDate(date);
}

function normalizeInputDate(value) {
  return parseInputDate(value) ? String(value) : todayInputValue();
}

function formatDateLabel(value) {
  const date = parseInputDate(value);
  if (!date) return value || "";
  const week = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 周${week}`;
}

function isBeforeDate(left, right) {
  const leftDate = parseInputDate(left);
  const rightDate = parseInputDate(right);
  if (!leftDate || !rightDate) return false;
  return leftDate.getTime() < rightDate.getTime();
}

function daysUntilInputDate(target, reference) {
  const targetDate = parseInputDate(target);
  const referenceDate = parseInputDate(reference) || parseInputDate(todayInputValue());
  if (!targetDate || !referenceDate) return null;
  return Math.round((targetDate.getTime() - referenceDate.getTime()) / 86400000);
}

module.exports = {
  addDaysToInputDate,
  daysUntilInputDate,
  formatDateLabel,
  inputDateFromDate,
  isBeforeDate,
  normalizeInputDate,
  parseInputDate,
  todayInputValue
};
