import assert from "node:assert/strict";
import test from "node:test";

import { assertLiteracyState, isLiteracyState } from "../lib/progress-state.mjs";

const validState = {
  version: 1,
  settings: {
    batchSize: 5,
    learningRepetitions: 3,
    dailyGoal: 3,
    weeklyGoal: 3,
    biweeklyGoal: 3,
    masteredSample: 2,
  },
  importWarnings: [],
  history: [{ char: "山", correct: true, kind: "review", at: "2026-09-01T08:00:00.000Z" }],
  items: [{
    id: "山",
    char: "山",
    pinyin: "shān",
    stage: "DAILY",
    stageStreak: 1,
    learningCorrect: 3,
    unfamiliar: false,
    lastCountedDate: "2026-09-01",
    nextDue: "2026-09-02",
    words: ["大山"],
    customWords: [],
    hiddenWords: [],
  }],
};

test("accepts a complete version-one literacy state", () => {
  assert.equal(isLiteracyState(validState), true);
  assert.equal(assertLiteracyState(validState), validState);
});

test("accepts optional edited words and study lists without changing legacy progress", () => {
  const state = structuredClone(validState);
  state.items[0].editedWords = [];
  state.weekendReview = { weekStart: "2026-08-31", characterIds: ["山"] };
  state.dailySession = { date: "2026-09-05", pendingIds: [], retryIds: ["山"], completedIds: [] };
  assert.equal(assertLiteracyState(state), state);
  state.items[0].editedWords = ["山河", "大山"];
  assert.equal(isLiteracyState(state), true);
  assert.equal(isLiteracyState(validState), true);
});

test("rejects malformed optional edited words and nested study-list arrays", () => {
  for (const editedWords of [null, "大山", {}, ["大山", 1], [["大山"]]]) {
    const state = structuredClone(validState);
    state.items[0].editedWords = editedWords;
    assert.equal(isLiteracyState(state), false);
  }
  for (const weekendReview of [null, [], "weekend", {}, { weekStart: "2026-08-31", characterIds: "山" },
    { weekStart: "2026-08-31", characterIds: [null] }]) {
    assert.equal(isLiteracyState({ ...validState, weekendReview }), false);
  }
  const dailySession = { date: "2026-09-05", pendingIds: [], retryIds: [], completedIds: [] };
  for (const invalidSession of [null, [], "daily", {}, { ...dailySession, pendingIds: "山" },
    { ...dailySession, retryIds: [1] }, { ...dailySession, completedIds: [null] }]) {
    assert.equal(isLiteracyState({ ...validState, dailySession: invalidSession }), false);
  }
});

test("requires real calendar dates in optional study lists", () => {
  for (const date of [null, 20260905, "", "2026-9-5", "2026-09-05T00:00:00Z", "2026-13-01", "2026-02-30", "2026-02-29"]) {
    assert.equal(isLiteracyState({ ...validState, weekendReview: { weekStart: date, characterIds: [] } }), false);
    assert.equal(isLiteracyState({ ...validState, dailySession: { date, pendingIds: [], retryIds: [], completedIds: [] } }), false);
  }
  assert.equal(isLiteracyState({ ...validState, dailySession: { date: "2028-02-29", pendingIds: [], retryIds: [], completedIds: [] } }), true);
});

test("rejects blank, wrong-version, and malformed item state", () => {
  const invalidValues = [
    null,
    {},
    { ...validState, version: 2 },
    { ...validState, settings: { ...validState.settings, batchSize: 0 } },
    { ...validState, items: [{}] },
  ];

  for (const value of invalidValues) assert.equal(isLiteracyState(value), false);
});

test("rejects progress larger than five megabytes", () => {
  const oversized = {
    ...validState,
    history: [{ char: "山", correct: true, kind: "review", at: "x".repeat(5 * 1024 * 1024) }],
  };

  assert.throws(() => assertLiteracyState(oversized), /超过 5MB/);
});
