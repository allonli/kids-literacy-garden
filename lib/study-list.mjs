import { dateKey, getDueItems, recordReviewAnswer } from "./learning-engine.mjs";

export function getWeekStart(now = new Date()) {
  const day = new Date(`${dateKey(now)}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export function getWeekendItems(state, now = new Date()) {
  if (state.weekendReview?.weekStart !== getWeekStart(now)) return [];
  const byId = new Map(state.items.map((item) => [item.id, item]));
  return [...new Set(state.weekendReview.characterIds)]
    .map((id) => byId.get(id))
    .filter(Boolean);
}

export function toggleWeekendCharacter(state, characterId, now = new Date()) {
  const item = state.items.find((candidate) => candidate.id === characterId || candidate.char === characterId);
  if (!item) return state;
  const weekStart = getWeekStart(now);
  const ids = getWeekendItems(state, now).map((candidate) => candidate.id);
  const characterIds = ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id];
  return { ...state, weekendReview: { weekStart, characterIds } };
}

export function getTodayItems(state, now = new Date()) {
  const today = dateKey(now);
  const completed = new Set((state.history ?? []).filter((entry) => {
    if (entry.kind !== "list" || !entry.correct) return false;
    const answeredAt = new Date(entry.at);
    return !Number.isNaN(answeredAt.getTime()) && dateKey(answeredAt) === today;
  }).map((entry) => entry.char));
  const items = [...state.items.filter((item) => item.stage === "LEARNING"), ...getDueItems(state, now)];
  const seen = new Set();
  return items.filter((item) => {
    // 答对之后又改回待学习或答错的字，需要允许当天重新学习。
    if ((completed.has(item.char) && item.stage !== "LEARNING") || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function recordListAnswer(state, characterId, correct, now = new Date()) {
  const item = state.items.find((candidate) => candidate.id === characterId || candidate.char === characterId);
  if (!item) return state;
  let next;
  if (item.stage === "LEARNING") {
    const updated = {
      ...item,
      stage: correct ? "DAILY" : "LEARNING",
      learningCorrect: 0,
      stageStreak: 0,
      unfamiliar: !correct,
      lastCountedDate: null,
      nextDue: correct ? dateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000)) : null,
    };
    next = { ...state, items: state.items.map((candidate) => candidate.id === item.id ? updated : candidate) };
  } else {
    next = recordReviewAnswer(state, item.id, correct, now);
  }
  // 复习复用原阶段规则，但一次列表操作只记一条历史。
  return { ...next, history: [...(state.history ?? []), { char: item.char, correct, kind: "list", at: now.toISOString() }] };
}

export function createDailySession(state, now = new Date()) {
  return {
    date: dateKey(now),
    pendingIds: getTodayItems(state, now).map((item) => item.id),
    retryIds: [],
    completedIds: [],
  };
}

export function resumeDailySession(state, now = new Date()) {
  const current = state.dailySession;
  if (!current || current.date !== dateKey(now)) return createDailySession(state, now);
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const todayItems = getTodayItems(state, now);
  const eligibleIds = new Set(todayItems.map((item) => item.id));
  const pendingIds = [...new Set(current.pendingIds)].filter((id) => eligibleIds.has(id));
  const retryIds = [...new Set(current.retryIds)].filter((id) => eligibleIds.has(id) && !pendingIds.includes(id));
  // 周末清单或其它学习入口完成的字也要从当前队列移出；改回待学习后可再次加入。
  const completedIds = [...new Set([...current.completedIds, ...current.pendingIds, ...current.retryIds])]
    .filter((id) => byId.has(id) && !eligibleIds.has(id));
  const tracked = new Set([...pendingIds, ...retryIds, ...completedIds]);
  for (const id of todayItems.map((item) => item.id)) {
    if (!tracked.has(id)) {
      pendingIds.push(id);
      tracked.add(id);
    }
  }
  return { date: current.date, pendingIds, retryIds, completedIds };
}

export function markSessionKnown(session, characterId) {
  if (!session.pendingIds.includes(characterId)) return session;
  return {
    ...session,
    pendingIds: session.pendingIds.filter((id) => id !== characterId),
    completedIds: [...new Set([...session.completedIds, characterId])],
  };
}

export function deferSessionItem(session, characterId) {
  if (!session.pendingIds.includes(characterId)) return session;
  return {
    ...session,
    pendingIds: session.pendingIds.filter((id) => id !== characterId),
    retryIds: [...new Set([...session.retryIds, characterId])],
  };
}

export function startRetryRound(session) {
  if (session.pendingIds.length > 0 || session.retryIds.length === 0) return session;
  return { ...session, pendingIds: [...session.retryIds], retryIds: [] };
}
