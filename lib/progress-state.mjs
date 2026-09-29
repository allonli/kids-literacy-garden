export const MAX_PROGRESS_BYTES = 5 * 1024 * 1024;

const STAGES = new Set(["LEARNING", "DAILY", "WEEKLY", "TWO_WEEKLY", "MASTERED"]);
const POSITIVE_SETTING_KEYS = ["batchSize", "learningRepetitions", "dailyGoal", "weeklyGoal", "biweeklyGoal"];

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isOptionalDate(value) {
  return value === null || typeof value === "string";
}

function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isWeekendReview(value) {
  return Boolean(value && !Array.isArray(value)
    && isDateKey(value.weekStart) && isStringArray(value.characterIds));
}

function isDailySession(value) {
  return Boolean(value && !Array.isArray(value) && isDateKey(value.date)
    && isStringArray(value.pendingIds) && isStringArray(value.retryIds) && isStringArray(value.completedIds));
}

function isItem(item) {
  return Boolean(item
    && typeof item.id === "string"
    && typeof item.char === "string"
    && typeof item.pinyin === "string"
    && STAGES.has(item.stage)
    && Number.isInteger(item.stageStreak)
    && item.stageStreak >= 0
    && Number.isInteger(item.learningCorrect)
    && item.learningCorrect >= 0
    && typeof item.unfamiliar === "boolean"
    && isOptionalDate(item.lastCountedDate)
    && isOptionalDate(item.nextDue)
    && isStringArray(item.words)
    && isStringArray(item.customWords)
    && isStringArray(item.hiddenWords)
    && (item.editedWords === undefined || isStringArray(item.editedWords)));
}

export function isLiteracyState(value) {
  if (!value || value.version !== 1 || !value.settings || typeof value.settings !== "object") return false;
  if (!POSITIVE_SETTING_KEYS.every((key) => Number.isInteger(value.settings[key]) && value.settings[key] >= 1)) return false;
  if (!Number.isInteger(value.settings.masteredSample) || value.settings.masteredSample < 0) return false;
  if (!Array.isArray(value.importWarnings) || !Array.isArray(value.history) || !Array.isArray(value.items)) return false;
  // 新字段允许缺省以兼容旧存档；存在时校验嵌套结构，避免同步后页面无法恢复队列。
  if (value.weekendReview !== undefined && !isWeekendReview(value.weekendReview)) return false;
  if (value.dailySession !== undefined && !isDailySession(value.dailySession)) return false;
  return value.items.every(isItem);
}

export function assertLiteracyState(value) {
  if (!isLiteracyState(value)) throw new TypeError("学习进度格式无效");
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > MAX_PROGRESS_BYTES) throw new RangeError("学习进度超过 5MB");
  return value;
}
