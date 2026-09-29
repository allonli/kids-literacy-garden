"use client";

import { useMemo, useState } from "react";
import {
  filterStatusItems,
  getNextReviewLabel,
  getStageCounts,
  getStageProgress,
  STATUS_STAGES,
} from "@/lib/character-status.mjs";
import type { LearningStage, LiteracyItem, LiteracySettings } from "@/lib/types";

type StatusStage = "ALL" | LearningStage;

type Props = {
  items: LiteracyItem[];
  settings: LiteracySettings;
  onEditCharacter: (id: string) => void;
  onViewCharacter: (id: string) => void;
  onToggleWeekend: (id: string) => void;
  onDeleteCharacter: (id: string) => void;
  weekendIds: string[];
};

export function CharacterStatusBoard({ items, settings, onEditCharacter, onViewCharacter, onToggleWeekend, onDeleteCharacter, weekendIds }: Props) {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState<StatusStage>("ALL");
  const counts = useMemo(() => getStageCounts(items), [items]);
  const visibleItems = useMemo(() => filterStatusItems(items, query, stage), [items, query, stage]);

  return (
    <section className="subpanel status-board">
      <div className="status-board-heading">
        <div>
          <h2>全部汉字学习情况</h2>
          <p>按当前学习阶段查看，也可以直接搜索汉字。</p>
        </div>
        <strong>{visibleItems.length} 个字</strong>
      </div>

      <div className="status-search">
        <label htmlFor="character-status-search">搜索汉字</label>
        <input
          id="character-status-search"
          aria-label="搜索汉字"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="输入一个或多个汉字"
        />
      </div>

      <div className="status-filters" aria-label="按学习阶段筛选">
        {STATUS_STAGES.map((option) => (
          <button
            className="status-filter"
            type="button"
            key={option.value}
            aria-pressed={stage === option.value}
            onClick={() => setStage(option.value as StatusStage)}
          >
            <span>{option.label}</span>
            <strong>{counts[option.value]}</strong>
          </button>
        ))}
      </div>

      {visibleItems.length > 0 ? (
        <div className="status-card-grid" aria-live="polite">
          {visibleItems.map((item: LiteracyItem) => {
            const meta = STATUS_STAGES.find((option) => option.value === item.stage);
            const progress = getStageProgress(item, settings);
            const inWeekend = weekendIds.includes(item.id);
            return (
              <article className="status-card status-card-with-actions" key={item.id} aria-label={`${item.char}的学习情况`}>
                <div className="status-card-overview">
                  <button className="status-character status-character-button" type="button" aria-label={`查看${item.char}的详情`} onClick={() => onViewCharacter(item.id)}>{item.char}</button>
                  <div className="status-card-copy">
                    <strong>{meta?.label}</strong>
                    {progress && <span>{progress}</span>}
                    <small>{getNextReviewLabel(item)}</small>
                  </div>
                </div>
                <div className="status-card-actions">
                  <button className="btn btn-ghost btn-small" type="button" aria-label={`编辑${item.char}`} onClick={() => onEditCharacter(item.id)}>编辑</button>
                  <button className="btn btn-secondary btn-small" type="button" aria-label={`将${item.char}${inWeekend ? "移出" : "加入"}本周末复习`} aria-pressed={inWeekend} onClick={() => onToggleWeekend(item.id)}>{inWeekend ? "移出周末" : "加入周末"}</button>
                  <button className="btn btn-again btn-small status-card-delete" type="button" aria-label={`删除${item.char}`} onClick={() => onDeleteCharacter(item.id)}>删除</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="status-empty" role="status">没有找到这个字，请清空搜索或切换分类。</div>
      )}
    </section>
  );
}
