export function getVisibleExampleWords(words) {
  return words.slice(0, 1);
}

export function getAnswerDestination(_sessionKind, correct) {
  return correct ? "next" : "restudy";
}

export function getImmediateAnswerStep(index, total) {
  const done = index + 1 >= total;
  return { done, nextIndex: done ? index : index + 1 };
}

export function canNavigateFromCard(isSpeaking) {
  return !isSpeaking;
}

export function shouldAutoSpeak(view) {
  return view === "restudy";
}
