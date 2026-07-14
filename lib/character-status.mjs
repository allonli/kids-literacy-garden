export const STATUS_STAGES = [
  { value: "ALL", label: "全部" },
  { value: "LEARNING", label: "待学习" },
  { value: "DAILY", label: "待复习" },
  { value: "WEEKLY", label: "每周复习" },
  { value: "TWO_WEEKLY", label: "每两周复习" },
  { value: "MASTERED", label: "已掌握" },
];

export function getStageCounts(items) {
  const counts = Object.fromEntries(STATUS_STAGES.map(({ value }) => [value, 0]));
  counts.ALL = items.length;
  for (const item of items) {
    if (Object.hasOwn(counts, item.stage)) counts[item.stage] += 1;
  }
  return counts;
}

export function filterStatusItems(items, query, stage = "ALL") {
  const wanted = new Set([...query.replace(/\s/g, "")]);
  return items.filter((item) => (
    (stage === "ALL" || item.stage === stage)
    && (wanted.size === 0 || wanted.has(item.char))
  ));
}

export function getStageProgress(item, settings) {
  if (item.stage === "MASTERED") return null;
  if (item.stage === "LEARNING") {
    return `已读对 ${item.learningCorrect}/${settings.learningRepetitions} 遍`;
  }
  const goal = item.stage === "DAILY"
    ? settings.dailyGoal
    : item.stage === "WEEKLY"
      ? settings.weeklyGoal
      : settings.biweeklyGoal;
  return `连续答对 ${item.stageStreak}/${goal} 次`;
}

export function getNextReviewLabel(item) {
  if (item.stage === "LEARNING") return "完成新学后安排";
  if (item.stage === "MASTERED") return "已完成全部阶段";
  return item.nextDue ? `下次复习：${item.nextDue}` : "等待安排复习";
}
