import { dateKey, STAGE_ORDER } from "./learning-engine.mjs";
import { getPinyin, getSuggestedWords } from "./word-recommendation.mjs";

export function getCharacterPinyin(item) {
  return item.pinyin?.trim() || getPinyin(item.char);
}

export function getCharacterWords(item, learnedSet = new Set()) {
  // 显式编辑可以清空组词，不能再用推荐词把用户删除的内容补回来。
  if (Array.isArray(item.editedWords)) return [...item.editedWords];
  return [...(item.customWords ?? []), ...(item.words ?? []), ...getSuggestedWords(item.char, learnedSet)]
    .filter((word, index, all) => !item.hiddenWords?.includes(word) && all.indexOf(word) === index)
    .slice(0, 3);
}

export function updateCharacter(state, characterId, patch, now = new Date()) {
  const current = state.items.find((item) => item.id === characterId || item.char === characterId);
  if (!current) throw new Error("没有找到要编辑的汉字。");
  if (typeof patch.pinyin !== "string" || !patch.pinyin.trim()) throw new Error("请输入拼音。");
  if (!STAGE_ORDER.includes(patch.stage)) throw new Error("请选择有效的学习状态。");
  if (!Array.isArray(patch.words) || patch.words.some((word) => typeof word !== "string"
    || !/^\p{Script=Han}{2,4}$/u.test(word.trim()) || !word.trim().includes(current.char))) {
    throw new Error(`每个组词需要由 2—4 个汉字组成，并包含“${current.char}”。`);
  }

  const updated = {
    ...current,
    pinyin: patch.pinyin.trim(),
    editedWords: [...new Set(patch.words.map((word) => word.trim()))],
    stage: patch.stage,
  };
  if (current.stage !== patch.stage) {
    const days = patch.stage === "WEEKLY" ? 7 : patch.stage === "TWO_WEEKLY" ? 14 : 0;
    Object.assign(updated, {
      stageStreak: 0,
      learningCorrect: 0,
      unfamiliar: patch.stage === "LEARNING",
      lastCountedDate: null,
      nextDue: patch.stage === "LEARNING" || patch.stage === "MASTERED"
        ? null
        : dateKey(new Date(now.getTime() + days * 24 * 60 * 60 * 1000)),
    });
  }
  return { ...state, items: state.items.map((item) => item.id === current.id ? updated : item) };
}

export function deleteCharacter(state, characterId) {
  const current = state.items.find((item) => item.id === characterId);
  if (!current) return state;
  const next = {
    ...state,
    items: state.items.filter((item) => item.id !== current.id),
    // 历史按汉字记录，清除后重新添加不会被旧的当天答题结果排除。
    history: state.history.filter((entry) => entry.char !== current.char),
  };
  if (state.weekendReview) {
    next.weekendReview = {
      ...state.weekendReview,
      characterIds: state.weekendReview.characterIds.filter((id) => id !== current.id),
    };
  }
  if (state.dailySession) {
    next.dailySession = {
      ...state.dailySession,
      pendingIds: state.dailySession.pendingIds.filter((id) => id !== current.id),
      retryIds: state.dailySession.retryIds.filter((id) => id !== current.id),
      completedIds: state.dailySession.completedIds.filter((id) => id !== current.id),
    };
  }
  return next;
}
