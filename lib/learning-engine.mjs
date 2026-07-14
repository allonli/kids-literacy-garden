const STAGE_ORDER = ["LEARNING", "DAILY", "WEEKLY", "TWO_WEEKLY", "MASTERED"];
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = Object.freeze({
  batchSize: 5,
  learningRepetitions: 3,
  dailyGoal: 3,
  weeklyGoal: 3,
  biweeklyGoal: 3,
  masteredSample: 2,
});

function dateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function addDays(value, days) {
  return dateKey(new Date(value.getTime() + DAY_MS * days));
}

function isChineseCharacter(value) {
  return typeof value === "string" && /^\p{Script=Han}$/u.test(value);
}

function stageInterval(stage) {
  if (stage === "DAILY") return 1;
  if (stage === "WEEKLY") return 7;
  if (stage === "TWO_WEEKLY") return 14;
  return 0;
}

function goalForStage(settings, stage) {
  if (stage === "DAILY") return settings.dailyGoal;
  if (stage === "WEEKLY") return settings.weeklyGoal;
  if (stage === "TWO_WEEKLY") return settings.biweeklyGoal;
  return Number.POSITIVE_INFINITY;
}

function nextStage(stage) {
  const index = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER[Math.min(index + 1, STAGE_ORDER.length - 1)];
}

function cloneState(state) {
  return {
    ...state,
    settings: { ...state.settings },
    items: state.items.map((item) => ({
      ...item,
      words: [...(item.words ?? [])],
      hiddenWords: [...(item.hiddenWords ?? [])],
      customWords: [...(item.customWords ?? [])],
    })),
    history: [...(state.history ?? [])],
  };
}

export function mergeImportedCharacters(entries) {
  const byCharacter = new Map();
  const warnings = [];

  for (const entry of entries) {
    if (!isChineseCharacter(entry.char)) {
      warnings.push({ type: "invalid", value: entry.char });
      continue;
    }

    const current = byCharacter.get(entry.char);
    if (!current) {
      byCharacter.set(entry.char, { ...entry });
      continue;
    }

    warnings.push({
      type: "duplicate",
      value: entry.char,
      stages: [current.stage, entry.stage],
    });
    if (STAGE_ORDER.indexOf(entry.stage) < STAGE_ORDER.indexOf(current.stage)) {
      byCharacter.set(entry.char, { ...current, ...entry });
    }
  }

  return { items: [...byCharacter.values()], warnings };
}

export function createInitialState(seed, now = new Date()) {
  const imported = mergeImportedCharacters(seed);
  const today = dateKey(now);
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    importWarnings: imported.warnings,
    history: [],
    items: imported.items.map((entry) => ({
      id: entry.id ?? entry.char,
      char: entry.char,
      pinyin: entry.pinyin ?? "",
      stage: entry.stage ?? "LEARNING",
      stageStreak: entry.stageStreak ?? 0,
      learningCorrect: entry.learningCorrect ?? 0,
      unfamiliar: entry.unfamiliar ?? entry.stage === "LEARNING",
      lastCountedDate: entry.lastCountedDate ?? null,
      nextDue: entry.nextDue ?? (entry.stage === "LEARNING" || entry.stage === "MASTERED" ? null : today),
      words: [...(entry.words ?? [])],
      customWords: [...(entry.customWords ?? [])],
      hiddenWords: [...(entry.hiddenWords ?? [])],
    })),
  };
}

export function selectLearningBatch(state) {
  return state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.stage === "LEARNING")
    .sort((a, b) => Number(b.item.unfamiliar) - Number(a.item.unfamiliar) || a.index - b.index)
    .slice(0, state.settings.batchSize)
    .map(({ item }) => item);
}

export function buildLearningQueue(ids, repetitions) {
  const queue = [];
  for (let round = 0; round < repetitions; round += 1) {
    for (const id of ids) queue.push(id);
  }
  return queue;
}

export function recordLearningAnswer(state, characterId, correct, now = new Date()) {
  const next = cloneState(state);
  const item = next.items.find((candidate) => candidate.id === characterId || candidate.char === characterId);
  if (!item || item.stage !== "LEARNING") return next;

  if (correct) item.learningCorrect += 1;
  else item.unfamiliar = true;

  if (item.learningCorrect >= next.settings.learningRepetitions) {
    item.stage = "DAILY";
    item.stageStreak = 0;
    item.learningCorrect = 0;
    item.unfamiliar = false;
    item.lastCountedDate = null;
    item.nextDue = addDays(now, 1);
  }

  next.history.push({ char: item.char, correct, kind: "learning", at: now.toISOString() });
  return next;
}

export function recordReviewAnswer(state, characterId, correct, now = new Date()) {
  const next = cloneState(state);
  const item = next.items.find((candidate) => candidate.id === characterId || candidate.char === characterId);
  if (!item || item.stage === "LEARNING") return next;
  const today = dateKey(now);

  if (!correct) {
    item.stage = "LEARNING";
    item.stageStreak = 0;
    item.learningCorrect = 0;
    item.unfamiliar = true;
    item.lastCountedDate = null;
    item.nextDue = null;
  } else if (item.stage !== "MASTERED" && item.lastCountedDate !== today) {
    item.stageStreak += 1;
    item.lastCountedDate = today;
    if (item.stageStreak >= goalForStage(next.settings, item.stage)) {
      item.stage = nextStage(item.stage);
      item.stageStreak = 0;
      item.lastCountedDate = null;
    }
    item.nextDue = item.stage === "MASTERED" ? null : addDays(now, stageInterval(item.stage));
  }

  next.history.push({ char: item.char, correct, kind: "review", at: now.toISOString() });
  return next;
}

export function getDueItems(state, now = new Date()) {
  const today = dateKey(now);
  const due = state.items.filter((item) =>
    item.stage !== "LEARNING" && item.stage !== "MASTERED" && item.nextDue && item.nextDue <= today,
  );
  const mastered = state.items.filter((item) => item.stage === "MASTERED").slice(0, state.settings.masteredSample);
  return [...due, ...mastered];
}

export function selectReviewBatch(state, now = new Date()) {
  return getDueItems(state, now).slice(0, state.settings.batchSize);
}

export function updateSettings(state, patch) {
  const next = cloneState(state);
  const ranges = {
    batchSize: [1, 20],
    learningRepetitions: [1, 10],
    dailyGoal: [1, 10],
    weeklyGoal: [1, 10],
    biweeklyGoal: [1, 10],
    masteredSample: [0, 10],
  };
  for (const [key, value] of Object.entries(patch)) {
    if (!ranges[key] || !Number.isFinite(Number(value))) continue;
    const [minimum, maximum] = ranges[key];
    next.settings[key] = Math.min(maximum, Math.max(minimum, Math.round(Number(value))));
  }
  return next;
}

export function addNewCharacters(state, input) {
  const next = cloneState(state);
  const existing = new Set(next.items.map((item) => item.char));
  for (const char of [...String(input)]) {
    if (!isChineseCharacter(char) || existing.has(char)) continue;
    existing.add(char);
    next.items.push({
      id: char,
      char,
      pinyin: "",
      stage: "LEARNING",
      stageStreak: 0,
      learningCorrect: 0,
      unfamiliar: false,
      lastCountedDate: null,
      nextDue: null,
      words: [],
      customWords: [],
      hiddenWords: [],
    });
  }
  return next;
}

export function setCustomWords(state, characterId, words) {
  const next = cloneState(state);
  const item = next.items.find((candidate) => candidate.id === characterId || candidate.char === characterId);
  if (!item) return next;
  item.customWords = [...new Set(words.map((word) => String(word).trim()))].filter(
    (word) => word.includes(item.char) && word.length >= 2 && word.length <= 4,
  );
  return next;
}

export { DEFAULT_SETTINGS, STAGE_ORDER, dateKey };
