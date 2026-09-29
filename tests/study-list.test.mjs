import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../lib/learning-engine.mjs";
import { updateCharacter } from "../lib/character-editing.mjs";
import { createDailySession, deferSessionItem, getTodayItems, getWeekendItems, getWeekStart,
  markSessionKnown, recordListAnswer, resumeDailySession, startRetryRound, toggleWeekendCharacter } from "../lib/study-list.mjs";

const now = new Date("2026-09-05T08:00:00+08:00");

test("week boundaries follow Shanghai Monday, including cross-year weeks", () => {
  assert.equal(getWeekStart(now), "2026-08-31");
  assert.equal(getWeekStart(new Date("2026-09-06T15:59:59Z")), "2026-08-31");
  assert.equal(getWeekStart(new Date("2026-09-06T16:00:00Z")), "2026-09-07");
  assert.equal(getWeekStart(new Date("2027-01-01T00:00:00+08:00")), "2026-12-28");
});

test("legacy state starts an empty weekend list and toggles in selected order without mutating", () => {
  const state = createInitialState([{ char: "桥", stage: "LEARNING" }, { char: "文", stage: "MASTERED" }], now);
  assert.deepEqual(getWeekendItems(state, now), []);
  let next = toggleWeekendCharacter(state, "文", now);
  next = toggleWeekendCharacter(next, "桥", now);
  assert.deepEqual(getWeekendItems(next, now).map((item) => item.char), ["文", "桥"]);
  assert.equal(state.weekendReview, undefined);
  next = toggleWeekendCharacter(next, "文", now);
  assert.deepEqual(getWeekendItems(next, now).map((item) => item.char), ["桥"]);
  const unknown = toggleWeekendCharacter(next, "陌", now);
  assert.deepEqual(unknown, next);
});

test("old weeks are hidden and the first new-week selection replaces the old list", () => {
  const state = createInitialState([{ char: "桥", stage: "LEARNING" }, { char: "文", stage: "DAILY" }], now);
  state.weekendReview = { weekStart: "2026-08-31", characterIds: ["桥", "桥", "不存在"] };
  assert.deepEqual(getWeekendItems(state, now).map((item) => item.char), ["桥"]);
  const monday = new Date("2026-09-07T00:00:00+08:00");
  assert.deepEqual(getWeekendItems(state, monday), []);
  const next = toggleWeekendCharacter(state, "文", monday);
  assert.deepEqual(next.weekendReview, { weekStart: "2026-09-07", characterIds: ["文"] });
  assert.deepEqual(state.weekendReview.characterIds, ["桥", "桥", "不存在"]);
});

test("today includes every learning and due character without the old batch limit", () => {
  const state = createInitialState([
    ...[..."天地玄黄宇宙洪荒"].map((char) => ({ char, stage: "LEARNING" })),
    ...[..."日月盈昃"].map((char) => ({ char, stage: "DAILY", nextDue: "2026-09-05" })),
    { char: "明", stage: "WEEKLY", nextDue: "2026-09-06" },
    { char: "会", stage: "MASTERED" },
  ], now);
  state.settings.batchSize = 1;
  state.settings.masteredSample = 1;
  assert.deepEqual(getTodayItems(state, now).map((item) => item.char), [..."天地玄黄宇宙洪荒日月盈昃会"]);
});

test("today hides successful list answers only on the matching Shanghai date", () => {
  const state = createInitialState([..."天地玄黄"].map((char) => ({ char, stage: "MASTERED" })), now);
  state.settings.masteredSample = 4;
  state.history = [
    { char: "天", correct: true, kind: "list", at: "2026-09-04T16:01:00Z" },
    { char: "地", correct: false, kind: "list", at: now.toISOString() },
    { char: "玄", correct: true, kind: "review", at: now.toISOString() },
    { char: "黄", correct: true, kind: "list", at: "2026-09-04T15:59:00Z" },
  ];
  assert.deepEqual(getTodayItems(state, now).map((item) => item.char), [..."地玄黄"]);
  assert.equal(getTodayItems(state, new Date("2026-09-06T08:00:00+08:00")).length, 4);
});

test("one known answer completes a learning character regardless of old repetition settings", () => {
  const state = createInitialState([{ char: "桥", stage: "LEARNING", learningCorrect: 2, unfamiliar: true }], now);
  state.settings.learningRepetitions = 10;
  const before = structuredClone(state);
  const next = recordListAnswer(state, "桥", true, now);
  assert.equal(next.items[0].stage, "DAILY");
  assert.equal(next.items[0].nextDue, "2026-09-06");
  assert.equal(next.items[0].learningCorrect, 0);
  assert.equal(next.items[0].unfamiliar, false);
  assert.deepEqual(next.history, [{ char: "桥", correct: true, kind: "list", at: now.toISOString() }]);
  assert.deepEqual(state, before);
  assert.deepEqual(getTodayItems(next, now), []);
});

test("review answers preserve progression but append exactly one list history entry", () => {
  const state = createInitialState([{ char: "文", stage: "DAILY", stageStreak: 2 }], now);
  const next = recordListAnswer(state, "文", true, now);
  assert.equal(next.items[0].stage, "WEEKLY");
  assert.equal(next.items[0].nextDue, "2026-09-12");
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].kind, "list");
  const again = recordListAnswer(next, "文", false, now);
  assert.equal(again.items[0].stage, "LEARNING");
  assert.equal(again.items[0].nextDue, null);
  assert.equal(again.items[0].unfamiliar, true);
  assert.equal(again.history.length, 2);
  assert.ok(again.history.every((entry) => entry.kind === "list"));
});

test("not-known learning answers reset old counters and unknown IDs never produce history", () => {
  const state = createInitialState([{ char: "桥", stage: "LEARNING", learningCorrect: 2 }], now);
  const next = recordListAnswer(state, "桥", false, now);
  assert.equal(next.items[0].learningCorrect, 0);
  assert.equal(next.items[0].stage, "LEARNING");
  assert.equal(next.items[0].unfamiliar, true);
  assert.equal(next.history.length, 1);
  assert.deepEqual(recordListAnswer(next, "陌", true, now), next);
});

test("session defers unknown characters, retries only after the current list, and finishes cleanly", () => {
  const state = createInitialState([..."天地人"].map((char) => ({ char, stage: "LEARNING" })), now);
  const session = createDailySession(state, now);
  assert.deepEqual(session, { date: "2026-09-05", pendingIds: [..."天地人"], retryIds: [], completedIds: [] });
  let next = deferSessionItem(session, "天");
  next = deferSessionItem(next, "天");
  assert.deepEqual(next.retryIds, ["天"]);
  assert.deepEqual(next.pendingIds, [..."地人"]);
  assert.deepEqual(startRetryRound(next), next);
  next = markSessionKnown(next, "地");
  next = deferSessionItem(next, "人");
  next = startRetryRound(next);
  assert.deepEqual(next.pendingIds, [..."天人"]);
  assert.deepEqual(next.retryIds, []);
  next = deferSessionItem(next, "天");
  next = markSessionKnown(next, "人");
  next = startRetryRound(next);
  next = markSessionKnown(next, "天");
  next = markSessionKnown(next, "天");
  assert.deepEqual(next.pendingIds, []);
  assert.deepEqual(next.retryIds, []);
  assert.deepEqual(next.completedIds, [..."地人天"]);
  assert.deepEqual(session.pendingIds, [..."天地人"]);
  assert.deepEqual(session.retryIds, []);
});

test("resuming keeps retry order, removes deleted characters and appends new daily items", () => {
  const state = createInitialState([..."天地人新"].map((char) => ({ char, stage: "LEARNING" })), now);
  state.dailySession = { date: "2026-09-05", pendingIds: ["地", "已删"], retryIds: ["人", "天"], completedIds: [] };
  const original = structuredClone(state);
  assert.deepEqual(resumeDailySession(state, now), {
    date: "2026-09-05", pendingIds: ["地", "新"], retryIds: ["人", "天"], completedIds: [],
  });
  assert.deepEqual(state, original);
  assert.deepEqual(resumeDailySession(state, new Date("2026-09-06T08:00:00+08:00")), {
    date: "2026-09-06", pendingIds: [..."天地人新"], retryIds: [], completedIds: [],
  });
});

test("resuming restores a completed character manually changed back to learning", () => {
  let state = createInitialState([{ char: "天", stage: "LEARNING" }], now);
  state = recordListAnswer(state, "天", true, now);
  state.dailySession = { date: "2026-09-05", pendingIds: [], retryIds: [], completedIds: ["天"] };
  assert.deepEqual(resumeDailySession(state, now).pendingIds, []);
  state.items[0].stage = "LEARNING";
  assert.deepEqual(resumeDailySession(state, now), {
    date: "2026-09-05", pendingIds: ["天"], retryIds: [], completedIds: [],
  });
});

test("resuming removes characters completed through the weekend list without recording again", () => {
  let state = createInitialState([{ char: "桥", stage: "DAILY", stageStreak: 2 }, { char: "天", stage: "LEARNING" }], now);
  state.dailySession = createDailySession(state, now);
  state = recordListAnswer(state, "桥", true, now);
  const session = resumeDailySession(state, now);
  assert.deepEqual(session.pendingIds, ["天"]);
  assert.deepEqual(session.completedIds, ["桥"]);
  assert.equal(state.items[0].stage, "WEEKLY");
  assert.equal(state.items[0].stageStreak, 0);
  assert.equal(state.history.length, 1);
});

test("resuming removes retry items learned through another entry and keeps unfinished order", () => {
  let state = createInitialState([..."天地人"].map((char) => ({ char, stage: "LEARNING" })), now);
  state.dailySession = { date: "2026-09-05", pendingIds: [], retryIds: [..."人天地"], completedIds: [] };
  state = recordListAnswer(state, "天", true, now);
  assert.deepEqual(resumeDailySession(state, now), {
    date: "2026-09-05", pendingIds: [], retryIds: [..."人地"], completedIds: ["天"],
  });
});

test("a character reset to learning after weekend completion appears even without an earlier session", () => {
  let state = createInitialState([{ char: "天", stage: "LEARNING" }], now);
  state = recordListAnswer(state, "天", true, now);
  state = updateCharacter(state, "天", { pinyin: "tiān", words: [], stage: "LEARNING" }, now);
  assert.deepEqual(getTodayItems(state, now).map((item) => item.id), ["天"]);
  assert.deepEqual(resumeDailySession(state, now).pendingIds, ["天"]);
  assert.equal(state.history.length, 1);
});

test("manually postponing a pending character removes it when the daily list resumes", () => {
  let state = createInitialState([{ char: "天", stage: "LEARNING" }], now);
  state.dailySession = createDailySession(state, now);
  state = updateCharacter(state, "天", { pinyin: "tiān", words: [], stage: "TWO_WEEKLY" }, now);
  assert.deepEqual(resumeDailySession(state, now).pendingIds, []);
  assert.equal(state.items[0].nextDue, "2026-09-19");
});
