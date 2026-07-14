import assert from "node:assert/strict";
import test from "node:test";

import {
  filterStatusItems,
  getNextReviewLabel,
  getStageCounts,
  getStageProgress,
} from "../lib/character-status.mjs";

const items = [
  { char: "新", stage: "LEARNING", learningCorrect: 1, stageStreak: 0, nextDue: null },
  { char: "花", stage: "DAILY", learningCorrect: 3, stageStreak: 2, nextDue: "2026-07-15" },
  { char: "文", stage: "WEEKLY", learningCorrect: 3, stageStreak: 1, nextDue: "2026-07-21" },
  { char: "桥", stage: "TWO_WEEKLY", learningCorrect: 3, stageStreak: 0, nextDue: "2026-07-28" },
  { char: "会", stage: "MASTERED", learningCorrect: 3, stageStreak: 0, nextDue: null },
];

const settings = {
  learningRepetitions: 3,
  dailyGoal: 3,
  weeklyGoal: 3,
  biweeklyGoal: 3,
};

test("counts every current learning stage", () => {
  assert.deepEqual(getStageCounts(items), {
    ALL: 5,
    LEARNING: 1,
    DAILY: 1,
    WEEKLY: 1,
    TWO_WEEKLY: 1,
    MASTERED: 1,
  });
});

test("combines multiple-character search with a stage filter", () => {
  assert.deepEqual(filterStatusItems(items, " 文 花 ", "WEEKLY").map(({ char }) => char), ["文"]);
  assert.deepEqual(filterStatusItems(items, "文花", "ALL").map(({ char }) => char), ["花", "文"]);
  assert.deepEqual(filterStatusItems(items, "", "DAILY").map(({ char }) => char), ["花"]);
  assert.deepEqual(filterStatusItems(items, "山", "ALL"), []);
});

test("describes stage progress", () => {
  assert.equal(getStageProgress(items[0], settings), "已读对 1/3 遍");
  assert.equal(getStageProgress(items[1], settings), "连续答对 2/3 次");
  assert.equal(getStageProgress(items[2], settings), "连续答对 1/3 次");
  assert.equal(getStageProgress(items[4], settings), null);
});

test("describes the next review for every terminal case", () => {
  assert.equal(getNextReviewLabel(items[0]), "完成新学后安排");
  assert.equal(getNextReviewLabel(items[1]), "下次复习：2026-07-15");
  assert.equal(getNextReviewLabel(items[4]), "已完成全部阶段");
});
