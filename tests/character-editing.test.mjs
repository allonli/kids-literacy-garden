import assert from "node:assert/strict";
import test from "node:test";

import { addNewCharacters, createInitialState, STAGE_ORDER } from "../lib/learning-engine.mjs";
import { getPinyin } from "../lib/word-recommendation.mjs";
import { getCharacterPinyin, getCharacterWords, updateCharacter } from "../lib/character-editing.mjs";
import * as editing from "../lib/character-editing.mjs";
import { getTodayItems, resumeDailySession } from "../lib/study-list.mjs";

const now = new Date("2026-09-05T23:30:00+08:00");

test("saved pinyin takes priority and old empty values still use the dictionary", () => {
  assert.equal(getCharacterPinyin({ char: "行", pinyin: "  háng  " }), "háng");
  assert.equal(getCharacterPinyin({ char: "行", pinyin: " " }), getPinyin("行"));
  assert.equal(getCharacterPinyin({ char: "桥" }), "qiáo");
});

test("legacy words preserve custom priority, imported words, hidden filtering and deduplication", () => {
  const item = { char: "桥", customWords: ["石桥", "木桥"], words: ["石桥", "吊桥"], hiddenWords: ["木桥"] };
  assert.deepEqual(getCharacterWords(item, new Set()), ["石桥", "吊桥", "天桥"]);
  assert.ok(getCharacterWords({ char: "桥" }).length > 0);
});

test("edited words explicitly replace recommendations, including an empty list", () => {
  const item = { char: "桥", editedWords: ["木桥"], hiddenWords: ["木桥"], words: ["天桥"] };
  assert.deepEqual(getCharacterWords(item), ["木桥"]);
  assert.deepEqual(getCharacterWords({ ...item, editedWords: [] }), []);
});

test("content edits preserve all existing progress and do not mutate the source", () => {
  const state = createInitialState([{ char: "桥", stage: "WEEKLY", stageStreak: 2, learningCorrect: 1,
    unfamiliar: true, lastCountedDate: "2026-09-04", nextDue: "2026-09-10" }], now);
  const before = structuredClone(state);
  const next = updateCharacter(state, "桥", { pinyin: " qiáo ", words: ["木桥", "木桥", "天桥"], stage: "WEEKLY" }, now);
  assert.deepEqual(state, before);
  assert.equal(next.items[0].pinyin, "qiáo");
  assert.deepEqual(next.items[0].editedWords, ["木桥", "天桥"]);
  for (const field of ["stageStreak", "learningCorrect", "unfamiliar", "lastCountedDate", "nextDue"]) {
    assert.equal(next.items[0][field], before.items[0][field]);
  }
  assert.equal(next.history.length, 0);
});

test("every manual stage change resets progress and schedules from Shanghai today", () => {
  const expectedDue = { LEARNING: null, DAILY: "2026-09-05", WEEKLY: "2026-09-12", TWO_WEEKLY: "2026-09-19", MASTERED: null };
  for (const stage of STAGE_ORDER) {
    const oldStage = stage === "DAILY" ? "WEEKLY" : "DAILY";
    const state = createInitialState([{ char: "桥", stage: oldStage, stageStreak: 2, learningCorrect: 2,
      unfamiliar: true, lastCountedDate: "2026-09-04" }], now);
    const next = updateCharacter(state, "桥", { pinyin: "qiáo", words: [], stage }, now);
    assert.equal(next.items[0].stage, stage);
    assert.equal(next.items[0].stageStreak, 0);
    assert.equal(next.items[0].learningCorrect, 0);
    assert.equal(next.items[0].lastCountedDate, null);
    assert.equal(next.items[0].unfamiliar, stage === "LEARNING");
    assert.equal(next.items[0].nextDue, expectedDue[stage]);
  }
});

test("invalid edits report Chinese errors and leave the old state intact", () => {
  const state = createInitialState([{ char: "桥", stage: "DAILY" }], now);
  const original = structuredClone(state);
  const patch = { pinyin: "qiáo", words: ["木桥"], stage: "DAILY" };
  assert.throws(() => updateCharacter(state, "桥", { ...patch, pinyin: " " }, now), /拼音/);
  for (const words of [["桥"], ["大路"], ["这是一座桥"], ["桥1"], ["桥🙂"], [null]]) {
    assert.throws(() => updateCharacter(state, "桥", { ...patch, words }, now), /组词/);
  }
  assert.throws(() => updateCharacter(state, "桥", { ...patch, stage: "UNKNOWN" }, now), /学习状态/);
  assert.throws(() => updateCharacter(state, "陌", patch, now), /汉字/);
  assert.deepEqual(state, original);
});

test("deleting a character removes its history and all list references without changing other data", () => {
  assert.equal(typeof editing.deleteCharacter, "function");
  const state = createInitialState([{ id: "bridge-id", char: "桥", stage: "DAILY" }, { char: "水", stage: "LEARNING" }], now);
  state.history = [
    { char: "桥", correct: true, kind: "list", at: now.toISOString() },
    { char: "水", correct: false, kind: "learning", at: now.toISOString() },
    { char: "桥", correct: false, kind: "review", at: "2026-09-04T08:00:00.000Z" },
  ];
  state.weekendReview = { weekStart: "2026-08-31", characterIds: ["bridge-id", "水", "bridge-id"], note: "保留" };
  state.dailySession = { date: "2026-09-05", pendingIds: ["bridge-id", "水"], retryIds: ["bridge-id"], completedIds: ["bridge-id"], note: "保留" };
  state.importWarnings = [{ type: "duplicate", value: "桥" }];
  state.extraField = { keep: true };
  const original = structuredClone(state);
  const deleted = editing.deleteCharacter(state, "bridge-id");
  assert.deepEqual(state, original);
  assert.deepEqual(deleted, {
    ...state,
    items: [state.items[1]],
    history: [state.history[1]],
    weekendReview: { ...state.weekendReview, characterIds: ["水"] },
    dailySession: { ...state.dailySession, pendingIds: ["水"], retryIds: [], completedIds: [] },
  });
  assert.equal(deleted.settings, state.settings);
  assert.equal(deleted.items[0], state.items[1]);
});

test("deletion is idempotent and only matches an existing character id", () => {
  assert.equal(typeof editing.deleteCharacter, "function");
  const state = createInitialState([{ id: "bridge-id", char: "桥", stage: "LEARNING" }], now);
  assert.equal(editing.deleteCharacter(state, "unknown"), state);
  assert.equal(editing.deleteCharacter(state, "桥"), state);
  const deleted = editing.deleteCharacter(state, "bridge-id");
  assert.equal(editing.deleteCharacter(deleted, "bridge-id"), deleted);
});

test("deleting the last character allows an empty library and keeps absent optional fields absent", () => {
  assert.equal(typeof editing.deleteCharacter, "function");
  const state = createInitialState([{ char: "桥", stage: "LEARNING" }], now);
  const deleted = editing.deleteCharacter(state, "桥");
  assert.deepEqual(deleted.items, []);
  assert.deepEqual(deleted.history, []);
  assert.equal(Object.hasOwn(deleted, "weekendReview"), false);
  assert.equal(Object.hasOwn(deleted, "dailySession"), false);
  assert.deepEqual(state.items.map((item) => item.char), ["桥"]);
});

test("re-adding a deleted character cannot inherit today's completion or deferred queue", () => {
  assert.equal(typeof editing.deleteCharacter, "function");
  const state = createInitialState([{ char: "桥", stage: "DAILY" }], now);
  state.history = [{ char: "桥", correct: true, kind: "list", at: now.toISOString() }];
  state.dailySession = { date: "2026-09-05", pendingIds: [], retryIds: ["桥"], completedIds: ["桥"] };
  const deleted = editing.deleteCharacter(state, "桥");
  const added = addNewCharacters(deleted, "桥");
  const review = updateCharacter(added, "桥", { pinyin: "qiáo", words: ["木桥"], stage: "DAILY" }, now);
  assert.deepEqual(getTodayItems(review, now).map((item) => item.id), ["桥"]);
  assert.deepEqual(resumeDailySession(review, now), { date: "2026-09-05", pendingIds: ["桥"], retryIds: [], completedIds: [] });
  assert.deepEqual(review.history, []);
});
