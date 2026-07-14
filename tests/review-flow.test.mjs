import assert from "node:assert/strict";
import test from "node:test";

import { getNextReviewStep, getReviewFeedbackDelay } from "../lib/review-flow.mjs";

test("uses shorter correct feedback and longer incorrect feedback", () => {
  assert.equal(getReviewFeedbackDelay(true), 700);
  assert.equal(getReviewFeedbackDelay(false), 1800);
});

test("advances or completes a review batch", () => {
  assert.deepEqual(getNextReviewStep(0, 2), { done: false, nextIndex: 1 });
  assert.deepEqual(getNextReviewStep(1, 2), { done: true, nextIndex: 1 });
});
