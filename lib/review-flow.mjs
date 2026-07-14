export function getReviewFeedbackDelay(correct) {
  return correct ? 700 : 1800;
}

export function getNextReviewStep(index, total) {
  const done = index + 1 >= total;
  return { done, nextIndex: done ? index : index + 1 };
}
