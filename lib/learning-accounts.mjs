import { assertLiteracyState } from "./progress-state.mjs";

export const DEFAULT_ACCOUNT_ID = "default";
export const DEFAULT_ACCOUNT_NAME = "原有账户";

export function normalizeAccountName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if ([...name].length < 1 || [...name].length > 20) {
    throw new TypeError("账户名称需要 1–20 个字符");
  }
  return name;
}

export function createFreshAccountState(sourceState) {
  const source = structuredClone(assertLiteracyState(sourceState));
  // 只复制教材和学习设置，原账户的成绩及复习清单不能成为新账户的起点。
  return {
    version: /** @type {const} */ (1),
    settings: source.settings,
    importWarnings: [],
    history: [],
    items: source.items.map((item) => ({
      ...item,
      stage: /** @type {const} */ ("LEARNING"),
      stageStreak: 0,
      learningCorrect: 0,
      unfamiliar: true,
      lastCountedDate: null,
      nextDue: null,
    })),
  };
}
