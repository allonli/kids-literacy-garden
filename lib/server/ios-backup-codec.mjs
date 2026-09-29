import { createHash } from "node:crypto";
import { assertLiteracyState } from "../progress-state.mjs";
import { getCharacterPinyin, getCharacterWords } from "../character-editing.mjs";

const namespace = Buffer.from("078d4f3c37154d8b8f88f81845919925", "hex");
export const BACKUP_ORIGIN = "https://z.allon.me";

// 与 iOS 的 convert_website.py 共用 UUID v5 命名空间及规范 JSON 身份算法。
function stableID(value) {
  const bytes = createHash("sha1").update(namespace).update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function isoSeconds(date) { return new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z"); }
function dateKey(date) { return new Date(new Date(date).getTime() + 8 * 3600_000).toISOString().slice(0, 10); }
function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isHan(value) {
  if (typeof value !== "string" || [...value].length !== 1) return false;
  const c = value.codePointAt(0);
  return (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x20000 && c <= 0x2ee5f) || (c >= 0x30000 && c <= 0x323af);
}
function words(value, char) {
  if (!Array.isArray(value) || value.some((word) => typeof word !== "string" || [...word.trim()].length < 2 || [...word.trim()].length > 4 || ![...word.trim()].every(isHan) || !word.includes(char))) throw new Error(`“${char}”的组词不适合导入，请先在家长中心修正。`);
  return [...new Set(value.map((word) => word.trim()))];
}

export function convertAccounts(accounts, { familyId, exportedAt = new Date() }) {
  if (!accounts.length) throw new Error("还没有已保存的学习档案，请先完成同步。");
  const usedNames = new Set();
  const profiles = accounts.map((account, ordinal) => {
    const state = assertLiteracyState(account.state);
    const ranges = { batchSize: [1, 20], learningRepetitions: [1, 10], dailyGoal: [1, 10], weeklyGoal: [1, 10], biweeklyGoal: [1, 10], masteredSample: [0, 10] };
    for (const [setting, [low, high]] of Object.entries(ranges)) {
      const value = state.settings[setting];
      if (!Number.isInteger(value) || value < low || value > high) throw new Error(`学习设置 ${setting} 超出 App 支持范围，请先调整。`);
    }
    let name = account.name.trim();
    if (!name || [...name].length > 20) throw new Error("档案昵称应为 1–20 个字符。");
    let suffix = 2;
    while (usedNames.has(name)) { const ending = `（导入${suffix++}）`; name = [...account.name.trim()].slice(0, 20 - [...ending].length).join("") + ending; }
    usedNames.add(name);
    const key = `profile:${ordinal}:${account.id}`;
    const profileID = stableID(key), references = new Map(), seen = new Set();
    const learned = new Set(state.items.map((item) => item.char));
    const items = state.items.map((item) => {
      if (!isHan(item.char) || typeof item.id !== "string" || !item.id) throw new Error("字库含无效汉字或条目标识，请先核对。");
      if ([item.learningCorrect, item.stageStreak].some((count) => !Number.isInteger(count) || count < 0 || count > 1_000_000)) throw new Error("学习计数超出 App 支持范围，请先核对。");
      if ([item.nextDue, item.lastCountedDate].some((day) => day != null && !validDay(day))) throw new Error("复习日期无效，请先核对。");
      if (seen.has(item.char)) throw new Error("同一档案含重复汉字，请先核对。");
      seen.add(item.char);
      const id = stableID(`${key}:item:${item.id}:${item.char}`);
      for (const reference of [item.id, item.char]) {
        if (references.has(reference) && references.get(reference) !== id) throw new Error("汉字 ID 与其他条目冲突。");
        references.set(reference, id);
      }
      if (["LEARNING", "MASTERED"].includes(item.stage) && item.nextDue != null) throw new Error("待学习和已掌握字不应有固定复习日期，请先核对。");
      const effective = words(getCharacterWords(item, learned), item.char);
      return {
        seed: { id, character: item.char, pinyin: getCharacterPinyin(item).trim(), words: effective,
          wordsEdited: Object.hasOwn(item, "editedWords") || Boolean(item.customWords?.length || item.hiddenWords?.length) },
        progress: { stage: item.stage, learningCorrect: item.learningCorrect ?? 0, stageCorrect: item.stageStreak ?? 0,
          unfamiliar: item.unfamiliar ?? false, nextReview: item.nextDue ?? null, lastReviewDay: item.lastCountedDate ?? null },
      };
    });
    function resolve(id) { if (!references.has(id)) throw new Error("历史或清单引用了已不存在的汉字，请先核对。"); return references.get(id); }
    function resolveList(ids) { const result = ids.map(resolve); if (new Set(result).size !== result.length) throw new Error("学习清单含重复汉字。"); return result; }
    const sourceMap = { learning: "guided", review: "guided", guided: "guided", list: "today", today: "today", weekend: "weekend" };
    const eventIDs = new Set();
    const history = state.history.map((event, index) => {
      if (!event || typeof event.correct !== "boolean" || typeof event.at !== "string" || !validDay(event.at.slice(0, 10)) || !/(Z|[+-]\d{2}:\d{2})$/.test(event.at) || !Number.isFinite(new Date(event.at).getTime())) throw new Error("历史结果或带时区的时间无效，请先核对。");
      if (!sourceMap[event.kind ?? "review"]) throw new Error("无法识别历史学习来源。");
      const id = stableID(`${key}:event:${event.id ?? index}`);
      if (eventIDs.has(id)) throw new Error("学习事件 ID 重复。");
      eventIDs.add(id);
      return { id, profileID, itemID: resolve(event.itemId ?? event.char), correct: event.correct,
        source: sourceMap[event.kind ?? "review"], day: dateKey(event.at), timestamp: isoSeconds(event.at) };
    });
    const s = state.settings;
    const profile = { id: profileID, name, settings: { batchSize: s.batchSize, learningRepeats: s.learningRepetitions, dailyTarget: s.dailyGoal, weeklyTarget: s.weeklyGoal, twoWeeklyTarget: s.biweeklyGoal, masteredSample: s.masteredSample }, items, history };
    if (state.dailySession) {
      const d = state.dailySession;
      profile.daily = { day: d.date, pending: resolveList(d.pendingIds), later: resolveList(d.retryIds), completed: resolveList(d.completedIds) };
      const ids = [...profile.daily.pending, ...profile.daily.later, ...profile.daily.completed];
      if (new Set(ids).size !== ids.length) throw new Error("今日三个队列之间存在重复汉字。");
    }
    if (state.weekendReview) {
      if (new Date(`${state.weekendReview.weekStart}T00:00:00Z`).getUTCDay() !== 1) throw new Error("周末清单起始日必须是周一，请先核对。");
      profile.weekend = { week: state.weekendReview.weekStart, itemIDs: resolveList(state.weekendReview.characterIds) };
    }
    return profile;
  });
  const id = stableID(createHash("sha256").update(canonical(profiles), "utf8").digest("hex"));
  return { version: 1, id, exportedAt: isoSeconds(exportedAt), profiles,
    source: { kind: "kids-literacy-garden", origin: BACKUP_ORIGIN,
      profiles: accounts.map((account, index) => ({ profileID: profiles[index].id, sourceID: stableID(`source:${BACKUP_ORIGIN}:${familyId}:${account.id}`), revision: account.revision })) } };
}
