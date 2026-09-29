import assert from "node:assert/strict";
import test from "node:test";

import {
  canNavigateFromCard,
  getAnswerDestination,
  getImmediateAnswerStep,
  getVisibleExampleWords,
  shouldAutoSpeak,
} from "../lib/session-flow.mjs";

test("shows only the highest-ranked example word", () => {
  assert.deepEqual(getVisibleExampleWords(["木桥", "天桥", "大桥"]), ["木桥"]);
  assert.deepEqual(getVisibleExampleWords([]), []);
});

test("routes an incorrect answer through the restudy card", () => {
  assert.equal(getAnswerDestination("learning", false), "restudy");
  assert.equal(getAnswerDestination("review", false), "restudy");
  assert.equal(getAnswerDestination("learning", true), "next");
  assert.equal(getAnswerDestination("review", true), "next");
});

test("advances correct answers immediately or finishes the batch", () => {
  assert.deepEqual(getImmediateAnswerStep(0, 2), { done: false, nextIndex: 1 });
  assert.deepEqual(getImmediateAnswerStep(1, 2), { done: true, nextIndex: 1 });
});

test("locks card navigation while pronunciation is playing", () => {
  assert.equal(canNavigateFromCard(true), false);
  assert.equal(canNavigateFromCard(false), true);
});

test("automatically reads only the incorrect-answer restudy card", () => {
  assert.equal(shouldAutoSpeak("restudy"), true);
  assert.equal(shouldAutoSpeak("study"), false);
  assert.equal(shouldAutoSpeak("recognition"), false);
});
