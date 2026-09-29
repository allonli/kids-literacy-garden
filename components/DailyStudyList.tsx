"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { CharacterDialog } from "./CharacterDialog";
import { CharacterDetails } from "./CharacterDetails";
import { CharacterEditor } from "./CharacterEditor";
import { getCharacterPinyin, getCharacterWords, updateCharacter } from "@/lib/character-editing.mjs";
import { deferSessionItem, getWeekendItems, markSessionKnown, recordListAnswer, resumeDailySession, startRetryRound, toggleWeekendCharacter } from "@/lib/study-list.mjs";
import { dateKey } from "@/lib/learning-engine.mjs";
import type { LiteracyItem, LiteracyState } from "@/lib/types";

type Props = {
  state: LiteracyState;
  onChange: Dispatch<SetStateAction<LiteracyState>>;
  onClose: () => void;
};

export function DailyStudyList({ state, onChange, onClose }: Props) {
  const [dialog, setDialog] = useState<{ id: string; editing: boolean; relearning: boolean } | null>(null);
  const [notice, setNotice] = useState("");
  const clickTimers = useRef(new Map<string, number>());
  const session = state.dailySession;
  const learnedSet = useMemo(() => new Set(state.items.map((item) => item.char)), [state.items]);
  const byId = useMemo(() => new Map(state.items.map((item) => [item.id, item])), [state.items]);
  const weekendIds = new Set((getWeekendItems(state) as LiteracyItem[]).map((item) => item.id));
  const current = dialog ? byId.get(dialog.id) : null;

  useEffect(() => {
    const timers = clickTimers.current;
    return () => { timers.forEach((timer) => window.clearTimeout(timer)); timers.clear(); };
  }, []);

  useEffect(() => {
    function refreshDate() {
      if (session?.date === dateKey(new Date())) return;
      clickTimers.current.forEach((timer) => window.clearTimeout(timer));
      clickTimers.current.clear();
      setDialog(null);
      onChange((previous) => ({ ...previous, dailySession: resumeDailySession(previous) }));
      setNotice("新的一天，已更新今天需要学习的字。");
    }
    const midnight = new Date(`${dateKey(new Date())}T00:00:00+08:00`).getTime() + 86400000;
    const timer = window.setTimeout(refreshDate, Math.max(0, midnight - Date.now()) + 100);
    window.addEventListener("focus", refreshDate);
    document.addEventListener("visibilitychange", refreshDate);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshDate);
      document.removeEventListener("visibilitychange", refreshDate);
    };
  }, [session?.date, onChange]);

  function clearClicks() {
    clickTimers.current.forEach((timer) => window.clearTimeout(timer));
    clickTimers.current.clear();
  }

  function cancelClick(id: string) {
    const timer = clickTimers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    clickTimers.current.delete(id);
  }

  function leaveList() {
    const pendingIds = [...clickTimers.current.keys()];
    clearClicks();
    pendingIds.forEach(markKnown);
    onClose();
  }

  function markKnown(id: string) {
    onChange((previous) => {
      if (!previous.dailySession?.pendingIds.includes(id)) return previous;
      return { ...recordListAnswer(previous, id, true), dailySession: markSessionKnown(previous.dailySession, id) };
    });
    setNotice(`“${byId.get(id)?.char}”已学会，已从今日列表移除。`);
  }

  function markUnknown(id: string) {
    cancelClick(id);
    // 先保存不会的字，再打开详情；关闭弹窗或刷新都不会丢失待复习队列。
    onChange((previous) => {
      if (!previous.dailySession?.pendingIds.includes(id)) return previous;
      return { ...recordListAnswer(previous, id, false), dailySession: deferSessionItem(previous.dailySession, id) };
    });
    setDialog({ id, editing: false, relearning: true });
    setNotice(`“${byId.get(id)?.char}”已放到列表末尾，稍后集中复习。`);
  }

  function clickCharacter(id: string, detail: number) {
    if (detail === 0) { markKnown(id); return; }
    const pending = clickTimers.current.get(id);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      clickTimers.current.delete(id);
      markUnknown(id);
      return;
    }
    // 等待第二次点击，避免双击的第一次点击被误记为“学会”。每个字独立计时。
    clickTimers.current.set(id, window.setTimeout(() => {
      clickTimers.current.delete(id);
      markKnown(id);
    }, 500));
  }

  function openEditor(id: string) {
    cancelClick(id);
    setDialog({ id, editing: true, relearning: false });
  }

  function renderItem(id: string, deferred = false) {
    const item = byId.get(id);
    if (!item) return null;
    return <article className={`daily-character-card${deferred ? " deferred" : ""}`} key={id}>
      <button className="daily-character" type="button" aria-label={`${item.char}，${deferred ? "查看详情" : "单击学会，双击不会"}`}
        onClick={(event) => deferred ? setDialog({ id, editing: false, relearning: true }) : clickCharacter(id, event.detail)}
        onDoubleClick={(event) => event.preventDefault()}>{item.char}</button>
      <div className="daily-card-actions">
        <button className="btn btn-ghost btn-small" type="button" aria-label={`编辑${item.char}`} onClick={() => openEditor(id)}>编辑</button>
        {!deferred && <button className="btn btn-again btn-small" type="button" aria-label={`${item.char}不会，打开详情`} onClick={() => markUnknown(id)}>不会</button>}
        <button className="btn btn-secondary btn-small" type="button" aria-label={`${weekendIds.has(id) ? "移出" : "加入"}本周末复习：${item.char}`}
          aria-pressed={weekendIds.has(id)} onClick={() => onChange((previous) => toggleWeekendCharacter(previous, id))}>{weekendIds.has(id) ? "已加入周末" : "加入周末"}</button>
      </div>
    </article>;
  }

  if (!session) return null;
  return <main className="main-stage">
    <div className="section-head"><div><p className="eyebrow">列表学习</p><h1>今天要学的字</h1><p>单击汉字表示学会；双击表示不会，打开详情学习。</p></div><button className="btn btn-ghost btn-small" type="button" onClick={leaveList}>返回首页</button></div>
    <section className="panel daily-study-panel">
      <p className="daily-progress">待认读 {session.pendingIds.length} 个 · 稍后复习 {session.retryIds.length} 个 · 已学会 {session.completedIds.length} 个</p>
      <p className="daily-help">单击后稍等半秒，汉字就会消失。也可以点“不会”打开详情。</p>
      <p className="daily-notice" role="status">{notice || "学习进度会自动保存并同步。"}</p>
      {session.pendingIds.length > 0 && <div className="daily-character-grid" aria-label="今日待认读列表">{session.pendingIds.map((id) => renderItem(id))}</div>}
      {session.retryIds.length > 0 && <section className="daily-retry-section" aria-labelledby="retry-heading">
        <h2 id="retry-heading">本轮不会的字 · 最后一起复习</h2>
        <p>{session.pendingIds.length ? "先完成上面的字，再集中复习这些字。" : "这一遍已完成，再试着认读下面这些字。"}</p>
        <div className="daily-character-grid" aria-label="稍后复习列表">{session.retryIds.map((id) => renderItem(id, true))}</div>
        <button className="btn btn-primary" type="button" disabled={session.pendingIds.length > 0} onClick={() => {
          clearClicks();
          onChange((previous) => previous.dailySession ? { ...previous, dailySession: startRetryRound(previous.dailySession) } : previous);
          setNotice("开始集中复习：单击学会，双击继续学习。");
        }}>集中复习不会的字（{session.retryIds.length}）</button>
      </section>}
      {session.pendingIds.length === 0 && session.retryIds.length === 0 && <div className="empty-state"><div className="empty-icon">🌼</div><h2>今天的列表学完啦</h2><p>已学会 {session.completedIds.length} 个字，下次复习已经安排好。</p><button className="btn btn-primary" type="button" onClick={onClose}>回到首页</button></div>}
    </section>
    {dialog && current && <CharacterDialog title={`${current.char} · ${dialog.editing ? "编辑汉字" : "汉字详情"}`} onClose={() => setDialog(null)}>
      {dialog.editing ? <CharacterEditor item={current} words={getCharacterWords(current, learnedSet)} onCancel={() => setDialog({ ...dialog, editing: false })} onSave={(patch) => {
        // 先验证，错误会由编辑表单展示；成功时使用最新状态保留其它已完成操作。
        updateCharacter(state, current.id, patch);
        onChange((previous) => {
          const updated = updateCharacter(previous, current.id, patch);
          return { ...updated, dailySession: resumeDailySession(updated) };
        });
        setDialog({ ...dialog, editing: false });
        setNotice(`“${current.char}”的修改已保存。`);
      }} /> : <>
        <CharacterDetails key={current.id} item={current} pinyin={getCharacterPinyin(current)} words={getCharacterWords(current, learnedSet)} onEdit={() => setDialog({ ...dialog, editing: true })}
          inWeekend={weekendIds.has(current.id)} onToggleWeekend={() => onChange((previous) => toggleWeekendCharacter(previous, current.id))}
          onSpeak={(text) => { if ("speechSynthesis" in window) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "zh-CN"; utterance.rate = 0.72; window.speechSynthesis.speak(utterance); } }} />
        <div className="study-action-bar"><button className="btn btn-primary" type="button" onClick={() => setDialog(null)}>{dialog.relearning ? "学完了，放到最后复习" : "返回列表"}</button></div>
      </>}
    </CharacterDialog>}
  </main>;
}
