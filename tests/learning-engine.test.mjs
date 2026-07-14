import assert from "node:assert/strict";
import test from "node:test";

import {
  addNewCharacters,
  buildLearningQueue,
  createInitialState,
  getDueItems,
  mergeImportedCharacters,
  recordLearningAnswer,
  recordReviewAnswer,
  selectLearningBatch,
  selectReviewBatch,
  setCustomWords,
  updateSettings,
} from "../lib/learning-engine.mjs";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-07-14T08:00:00+08:00");

test("import rejects non-Chinese values and keeps the most urgent duplicate stage", () => {
  const result = mergeImportedCharacters([
    { char: "文", stage: "WEEKLY" },
    { char: "文", stage: "DAILY" },
    { char: "花", stage: "TWO_WEEKLY" },
    { char: "花", stage: "TWO_WEEKLY" },
    { char: "x", stage: "DAILY" },
  ]);

  assert.deepEqual(result.items.map(({ char, stage }) => ({ char, stage })), [
    { char: "文", stage: "DAILY" },
    { char: "花", stage: "TWO_WEEKLY" },
  ]);
  assert.equal(result.warnings.filter((warning) => warning.type === "duplicate").length, 2);
  assert.equal(result.warnings.find((warning) => warning.type === "invalid")?.value, "x");
});

test("learning batch prioritizes unfamiliar characters and honors the configured size", () => {
  const state = createInitialState([
    { char: "新", stage: "LEARNING", unfamiliar: false },
    { char: "桥", stage: "LEARNING", unfamiliar: true },
    { char: "词", stage: "LEARNING", unfamiliar: true },
    { char: "语", stage: "LEARNING", unfamiliar: false },
  ], now);
  state.settings.batchSize = 3;

  assert.deepEqual(selectLearningBatch(state).map((item) => item.char), ["桥", "词", "新"]);
});

test("learning repetitions are interleaved and a character graduates only after enough correct readings", () => {
  const queue = buildLearningQueue(["桥", "词"], 3);
  assert.deepEqual(queue, ["桥", "词", "桥", "词", "桥", "词"]);
  assert.ok(queue.every((id, index) => index === 0 || id !== queue[index - 1]));

  let state = createInitialState([{ char: "桥", stage: "LEARNING", unfamiliar: true }], now);
  state = recordLearningAnswer(state, "桥", true, now);
  state = recordLearningAnswer(state, "桥", false, now);
  state = recordLearningAnswer(state, "桥", true, now);
  assert.equal(state.items[0].stage, "LEARNING");
  assert.equal(state.items[0].learningCorrect, 2);
  state = recordLearningAnswer(state, "桥", true, now);
  assert.equal(state.items[0].stage, "DAILY");
  assert.equal(state.items[0].nextDue, "2026-07-15");
});

test("review counts once per date, promotes through stages, and wrong answers return to learning", () => {
  let state = createInitialState([{ char: "文", stage: "DAILY" }], now);
  state.items[0].nextDue = "2026-07-14";

  state = recordReviewAnswer(state, "文", true, now);
  state = recordReviewAnswer(state, "文", true, now);
  assert.equal(state.items[0].stageStreak, 1);
  state = recordReviewAnswer(state, "文", true, new Date(now.getTime() + DAY));
  state = recordReviewAnswer(state, "文", true, new Date(now.getTime() + DAY * 2));
  assert.equal(state.items[0].stage, "WEEKLY");
  assert.equal(state.items[0].stageStreak, 0);
  assert.equal(state.items[0].nextDue, "2026-07-23");

  state = recordReviewAnswer(state, "文", false, new Date(now.getTime() + DAY * 9));
  assert.equal(state.items[0].stage, "LEARNING");
  assert.equal(state.items[0].unfamiliar, true);
  assert.equal(state.items[0].stageStreak, 0);
});

test("due items exclude future reviews and include configured mastered sampling", () => {
  const state = createInitialState([
    { char: "今", stage: "DAILY" },
    { char: "明", stage: "WEEKLY" },
    { char: "会", stage: "MASTERED" },
    { char: "读", stage: "MASTERED" },
  ], now);
  state.items[0].nextDue = "2026-07-14";
  state.items[1].nextDue = "2026-07-20";
  state.settings.masteredSample = 1;

  assert.deepEqual(getDueItems(state, now).map((item) => item.char), ["今", "会"]);
});

test("review sessions honor the configured batch size", () => {
  const state = createInitialState([
    { char: "今", stage: "DAILY" },
    { char: "明", stage: "DAILY" },
    { char: "天", stage: "DAILY" },
  ], now);
  state.settings.batchSize = 2;
  assert.deepEqual(selectReviewBatch(state, now).map((item) => item.char), ["今", "明"]);
});

test("parent settings are clamped and newly added characters enter learning once", () => {
  let state = createInitialState([{ char: "桥", stage: "DAILY" }], now);
  state = updateSettings(state, { batchSize: 99, learningRepetitions: 0, masteredSample: 4 });
  assert.equal(state.settings.batchSize, 20);
  assert.equal(state.settings.learningRepetitions, 1);
  assert.equal(state.settings.masteredSample, 4);

  state = addNewCharacters(state, "新桥x词");
  assert.deepEqual(state.items.slice(-2).map(({ char, stage }) => ({ char, stage })), [
    { char: "新", stage: "LEARNING" },
    { char: "词", stage: "LEARNING" },
  ]);
});

test("parent custom words keep only unique short phrases containing the target character", () => {
  let state = createInitialState([{ char: "桥", stage: "LEARNING" }], now);
  state = setCustomWords(state, "桥", ["木桥", "木桥", "天桥", "大路", "这是一座很长的桥"]);
  assert.deepEqual(state.items[0].customWords, ["木桥", "天桥"]);
});
