function unique(values) {
  return [...new Set(values)];
}

function companionCharacters(word, target) {
  return [...word].filter((char) => char !== target);
}

export function rankWords(target, candidates, learnedSet, overrides = []) {
  const valid = unique([...overrides, ...candidates]).filter(
    (word) => typeof word === "string" && word.includes(target) && word.length >= 2 && word.length <= 4,
  );
  const overrideOrder = new Map(overrides.map((word, index) => [word, index]));
  const candidateOrder = new Map(candidates.map((word, index) => [word, index]));

  return valid
    .sort((a, b) => {
      const aOverride = overrideOrder.has(a) ? overrideOrder.get(a) : Number.POSITIVE_INFINITY;
      const bOverride = overrideOrder.has(b) ? overrideOrder.get(b) : Number.POSITIVE_INFINITY;
      if (aOverride !== bOverride) return aOverride - bOverride;

      const aCompanions = companionCharacters(a, target);
      const bCompanions = companionCharacters(b, target);
      const aLearned = aCompanions.length > 0 && aCompanions.every((char) => learnedSet.has(char));
      const bLearned = bCompanions.length > 0 && bCompanions.every((char) => learnedSet.has(char));
      if (aLearned !== bLearned) return Number(bLearned) - Number(aLearned);
      if (a.length !== b.length) return a.length - b.length;
      return (candidateOrder.get(a) ?? 9999) - (candidateOrder.get(b) ?? 9999);
    })
    .slice(0, 3);
}

export function getSuggestedWords(target, learnedSet = new Set()) {
  const candidates = cnchar.words(target) ?? [];
  return rankWords(target, candidates, learnedSet, WORD_OVERRIDES[target] ?? []);
}

export function getPinyin(target) {
  const value = cnchar.spell(target, "tone") ?? "";
  return value ? `${value[0].toLocaleLowerCase()}${value.slice(1)}` : "";
}
import cnchar from "cnchar";
import wordsPlugin from "cnchar-words";

import { WORD_OVERRIDES } from "../data/word-overrides.mjs";

cnchar.use(wordsPlugin);
