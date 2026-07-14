export type LearningStage = "LEARNING" | "DAILY" | "WEEKLY" | "TWO_WEEKLY" | "MASTERED";

export type LiteracySettings = {
  batchSize: number;
  learningRepetitions: number;
  dailyGoal: number;
  weeklyGoal: number;
  biweeklyGoal: number;
  masteredSample: number;
};

export type LiteracyItem = {
  id: string;
  char: string;
  pinyin: string;
  stage: LearningStage;
  stageStreak: number;
  learningCorrect: number;
  unfamiliar: boolean;
  lastCountedDate: string | null;
  nextDue: string | null;
  words: string[];
  customWords: string[];
  hiddenWords: string[];
};

export type LiteracyState = {
  version: 1;
  settings: LiteracySettings;
  importWarnings: Array<{ type: string; value?: string }>;
  history: Array<{ char: string; correct: boolean; kind: string; at: string }>;
  items: LiteracyItem[];
};
