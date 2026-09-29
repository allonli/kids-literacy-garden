"use client";

import { useMemo, useState } from "react";
import { CharacterDetails } from "./CharacterDetails";
import { CharacterDialog } from "./CharacterDialog";
import { CharacterEditor } from "./CharacterEditor";
import { filterStatusItems, STATUS_STAGES } from "@/lib/character-status.mjs";
import { getCharacterPinyin, getCharacterWords, updateCharacter } from "@/lib/character-editing.mjs";
import { getWeekendItems, getWeekStart, recordListAnswer, toggleWeekendCharacter } from "@/lib/study-list.mjs";
import type { LiteracyItem, LiteracyState } from "@/lib/types";

type Props = {
  state: LiteracyState;
  onChange: (state: LiteracyState) => void;
  onClose: () => void;
};

function weekDateLabel(weekStart: string, offset: number, includeYear = false) {
  const date = new Date(`${weekStart}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + offset);
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: includeYear ? "numeric" : undefined, month: "long", day: "numeric" }).format(date);
}

export function WeekendReview({ state, onChange, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const now = new Date();
  const weekStart = getWeekStart(now);
  const items = getWeekendItems(state, now) as LiteracyItem[];
  const selectedIds = new Set(items.map((item) => item.id));
  const selected = state.items.find((item) => item.id === selectedId);
  const learnedSet = useMemo(() => new Set(state.items.map((item) => item.char)), [state.items]);
  const choices = useMemo(() => filterStatusItems(state.items, query), [state.items, query]) as LiteracyItem[];

  function openCharacter(item: LiteracyItem, edit = false) {
    setSelectedId(item.id);
    setEditing(edit);
    setNotice("");
  }

  function toggleCharacter(item: LiteracyItem) {
    const included = selectedIds.has(item.id);
    onChange(toggleWeekendCharacter(state, item.id, new Date()) as LiteracyState);
    setNotice(included ? `已将「${item.char}」移出本周末复习清单。` : `已将「${item.char}」加入本周末复习清单。`);
  }

  function finishReview(item: LiteracyItem, correct: boolean) {
    const answeredAt = new Date();
    let next = recordListAnswer(state, item.id, correct, answeredAt) as LiteracyState;
    // 完成后移出本周清单；不会的字保留，方便继续复习。
    if (correct && getWeekendItems(next, answeredAt).some((entry: LiteracyItem) => entry.id === item.id)) {
      next = toggleWeekendCharacter(next, item.id, answeredAt) as LiteracyState;
    }
    onChange(next);
    setSelectedId(null);
    setNotice(correct ? `「${item.char}」已复习完成，并移出本周末清单。` : `「${item.char}」已记录为不会，保留在本周末清单中。`);
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) {
      setNotice("当前浏览器不支持播放读音，可以点击显示按钮查看拼音。");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.72;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <main className="main-stage weekend-review">
      <div className="section-head weekend-heading">
        <div>
          <p className="eyebrow">自己选字，周末再巩固</p>
          <h1>本周末复习清单</h1>
          <p className="weekend-dates">
            <span>本周：{weekDateLabel(weekStart, 0)}—{weekDateLabel(weekStart, 6)}</span>
            <span>周末：{weekDateLabel(weekStart, 5)}—{weekDateLabel(weekStart, 6)}</span>
          </p>
        </div>
        <button className="btn btn-ghost btn-small back-button" type="button" onClick={onClose}>返回首页</button>
      </div>

      <section className="panel weekend-list" aria-labelledby="weekend-list-title">
        <div className="weekend-toolbar">
          <div>
            <h2 id="weekend-list-title">待复习 <span className="weekend-count">{items.length} 个字</span></h2>
            <p>点击汉字查看详情，复习完成后从清单移出。</p>
          </div>
          <div className="weekend-toolbar-actions">
            <button className="btn btn-secondary btn-small" type="button" disabled={items.length === 0} onClick={() => window.print()}>打印清单</button>
            <button className="btn btn-primary btn-small" type="button" aria-expanded={adding} aria-controls="weekend-picker" onClick={() => setAdding(!adding)}>
              {adding ? "收起添加" : "添加汉字"}
            </button>
          </div>
        </div>

        <p className="weekend-notice" role="status" aria-live="polite">{notice}</p>

        {adding && (
          <section className="weekend-picker" id="weekend-picker" aria-labelledby="weekend-picker-title">
            <h3 id="weekend-picker-title">选择要复习的字</h3>
            <p>从全部汉字中手动选择，再点一次可以取消。</p>
            <div className="field">
              <label htmlFor="weekend-character-search">搜索要添加的汉字</label>
              <input id="weekend-character-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入一个或多个汉字" />
            </div>
            {choices.length > 0 ? (
              <div className="weekend-choice-grid">
                {choices.map((item) => (
                  <button className="weekend-choice" type="button" key={item.id} aria-pressed={selectedIds.has(item.id)} aria-label={`${selectedIds.has(item.id) ? "取消" : "添加"}「${item.char}」`} onClick={() => toggleCharacter(item)}>
                    <strong>{item.char}</strong>
                    <span>{selectedIds.has(item.id) ? "✓ 已添加" : "+ 添加"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="weekend-no-results">{state.items.length === 0 ? "还没有汉字，请先到家长中心添加。" : "没有找到这个字，请修改或清空搜索。"}</p>
            )}
          </section>
        )}

        {items.length > 0 ? (
          <div className="weekend-card-grid">
            {items.map((item) => (
              <article className="weekend-card" key={item.id}>
                <div className="weekend-card-heading">
                  <button className="weekend-character" type="button" aria-label={`学习「${item.char}」`} onClick={() => openCharacter(item)}>{item.char}</button>
                  <div className="weekend-card-copy">
                    <span>{STATUS_STAGES.find((stage) => stage.value === item.stage)?.label}</span>
                    <button className="btn btn-secondary btn-small" type="button" aria-label={`编辑「${item.char}」`} onClick={() => openCharacter(item, true)}>编辑</button>
                  </div>
                </div>
                <div className="weekend-card-actions">
                  <button className="btn btn-ghost btn-small" type="button" aria-label={`移出「${item.char}」`} onClick={() => toggleCharacter(item)}>移出</button>
                  <button className="btn btn-good btn-small" type="button" aria-label={`复习完成「${item.char}」`} onClick={() => finishReview(item, true)}>复习完成</button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="weekend-empty">
            <strong>本周末清单还是空的</strong>
            <p>点击“添加汉字”选择本周末想复习的字。</p>
            <small>清单按周保存，每周都由你自己选字。</small>
          </div>
        )}
      </section>

      {/* 独立打印区只包含本周选中的字，避免把答案、选字区或详情弹窗打印出来。 */}
      <section className="weekend-print" aria-label="周末复习打印清单">
        <h1>本周末复习清单</h1>
        <p>周末：{weekDateLabel(weekStart, 5, true)}—{weekDateLabel(weekStart, 6, true)} · 共 {items.length} 个字</p>
        <div className="weekend-print-grid">
          {items.map((item) => <div className="weekend-print-character" key={item.id}>{item.char}</div>)}
        </div>
      </section>

      {selected && (
        <CharacterDialog title={editing ? `编辑「${selected.char}」` : `学习「${selected.char}」`} onClose={() => setSelectedId(null)}>
          {notice && <p className="weekend-notice">{notice}</p>}
          {editing ? (
            <CharacterEditor
              key={selected.id}
              item={selected}
              words={getCharacterWords(selected, learnedSet)}
              onCancel={() => setEditing(false)}
              onSave={(patch) => {
                onChange(updateCharacter(state, selected.id, patch, new Date()) as LiteracyState);
                setEditing(false);
                setNotice(`「${selected.char}」的拼音、组词和学习状态已保存。`);
              }}
            />
          ) : (
            <>
              <CharacterDetails
                key={selected.id}
                item={selected}
                words={getCharacterWords(selected, learnedSet)}
                pinyin={getCharacterPinyin(selected)}
                onSpeak={speak}
                onEdit={() => setEditing(true)}
                onToggleWeekend={() => toggleCharacter(selected)}
                inWeekend={selectedIds.has(selected.id)}
              />
              {selectedIds.has(selected.id) && (
                <div className="weekend-detail-actions">
                  <button className="btn btn-again" type="button" onClick={() => finishReview(selected, false)}>还需复习</button>
                  <button className="btn btn-good" type="button" onClick={() => finishReview(selected, true)}>复习完成，移出清单</button>
                </div>
              )}
            </>
          )}
        </CharacterDialog>
      )}
    </main>
  );
}
