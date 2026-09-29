"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ParentPanel } from "./ParentPanel";
import { RecognitionCard } from "./RecognitionCard";
import { WordStudyCard } from "./WordStudyCard";
import { DailyStudyList } from "./DailyStudyList";
import { WeekendReview } from "./WeekendReview";
import { CharacterDialog } from "./CharacterDialog";
import { CharacterEditor } from "./CharacterEditor";
import { FamilyAccessGate } from "./FamilyAccessGate";
import { SyncStatus } from "./SyncStatus";
import { AccountMenu } from "./AccountMenu";
import { usePermanentProgress } from "./usePermanentProgress";
import { SEED_CHARACTERS } from "@/data/seed-characters.mjs";
import {
  buildLearningQueue,
  createInitialState,
  getDueItems,
  recordLearningAnswer,
  recordReviewAnswer,
  selectLearningBatch,
  selectReviewBatch,
  updateSettings,
} from "@/lib/learning-engine.mjs";
import { getCharacterPinyin, getCharacterWords, updateCharacter } from "@/lib/character-editing.mjs";
import { getTodayItems, getWeekendItems, resumeDailySession } from "@/lib/study-list.mjs";
import { getNextReviewStep } from "@/lib/review-flow.mjs";
import { canNavigateFromCard, getAnswerDestination, getImmediateAnswerStep, getVisibleExampleWords, shouldAutoSpeak } from "@/lib/session-flow.mjs";
import { createFreshAccountState } from "@/lib/learning-accounts.mjs";
import type { LiteracyItem, LiteracyState } from "@/lib/types";

type View = "home" | "preview" | "study" | "recognition" | "restudy" | "review" | "summary" | "parent" | "daily-list" | "weekend";
type Mode = "parent" | "list";
type RestudyContext =
  | { itemId: string; source: "learning"; nextQueue: string[] }
  | { itemId: string; source: "review"; answeredIndex: number };

function initialState(): LiteracyState { return createInitialState(SEED_CHARACTERS, new Date()) as LiteracyState; }

export function LiteracyApp() {
  const [accountId, setAccountId] = useState(() => {
    try {
      const saved = globalThis.localStorage?.getItem("kids-literacy:active-account:v1");
      return saved && /^(default|[a-f0-9-]{36})$/.test(saved) ? saved : "default";
    } catch { return "default"; }
  });

  function selectAccount(id: string) {
    try { localStorage.setItem("kids-literacy:active-account:v1", id); } catch { /* 当前页面仍可切换。 */ }
    setAccountId(id);
  }

  // 账户切换时重新挂载学习界面，清除旧账户的队列、撤销快照、弹窗和计时器。
  return <LearningAccount key={accountId} accountId={accountId} onSelectAccount={selectAccount} />;
}

function LearningAccount({ accountId, onSelectAccount }: { accountId: string; onSelectAccount: (id: string) => void }) {
  const { state, setState, hydrated, access, sync, login, createFresh, retry, stop } = usePermanentProgress(initialState, accountId);
  const [view, setView] = useState<View>("home");
  const [mode, setMode] = useState<Mode>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sessionSettings, setSessionSettings] = useState({ batchSize: 5, learningRepetitions: 3 });
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [studyIndex, setStudyIndex] = useState(0);
  const [learningQueue, setLearningQueue] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [undoState, setUndoState] = useState<{ state: LiteracyState; reviewIndex: number } | null>(null);
  const [restudyContext, setRestudyContext] = useState<RestudyContext | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speechTokenRef = useRef(0);
  const isSpeakingRef = useRef(false);
  const [summary, setSummary] = useState({ title: "今天完成啦", detail: "每一次认真读，都让记忆更牢。" });

  useEffect(() => () => {
    speechTokenRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const learnedSet = useMemo(() => new Set<string>(state.items.map((item) => item.char)), [state.items]);
  const learningItems = state.items.filter((item) => item.stage === "LEARNING");
  const dueItems = getDueItems(state, new Date()) as LiteracyItem[];
  const masteredCount = state.items.filter((item) => item.stage === "MASTERED").length;

  function wordsFor(item: LiteracyItem) {
    return getVisibleExampleWords(getCharacterWords(item, learnedSet));
  }

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) {
      isSpeakingRef.current = false;
      return false;
    }

    // 每次发音使用独立令牌，旧语音被取消时不能提前解锁新卡片。
    const token = speechTokenRef.current + 1;
    speechTokenRef.current = token;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.72;
    const finish = () => {
      if (speechTokenRef.current !== token) return;
      isSpeakingRef.current = false;
      setIsSpeaking(false);
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    isSpeakingRef.current = true;
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  function begin(selectedMode: Mode) {
    setMode(selectedMode);
    if (selectedMode === "list") {
      setState((previous) => ({ ...previous, dailySession: resumeDailySession(previous) }));
      setView("daily-list");
      return;
    }
    setSessionSettings({ batchSize: state.settings.batchSize, learningRepetitions: state.settings.learningRepetitions });
    if (learningItems.length > 0) setView("preview");
    else if (dueItems.length > 0) beginReview(selectedMode);
    else {
      setSummary({ title: "今天都完成啦", detail: "现在没有到期的字，可以去家长中心添加新字。" });
      setView("summary");
    }
  }

  function previewBatch() {
    return selectLearningBatch({ ...state, settings: { ...state.settings, batchSize: sessionSettings.batchSize } });
  }

  function beginStudy() {
    const items = previewBatch();
    const ids = items.map((item: LiteracyItem) => item.id);
    setBatchIds(ids);
    setStudyIndex(0);
    setLearningQueue(buildLearningQueue(ids, sessionSettings.learningRepetitions));
    setQueueIndex(0);
    setView("study");
  }

  function finishStudyCard() {
    if (!canNavigateFromCard(isSpeakingRef.current)) return;
    if (studyIndex + 1 < batchIds.length) setStudyIndex(studyIndex + 1);
    else setView("recognition");
  }

  function answerLearning(correct: boolean) {
    const id = learningQueue[queueIndex];
    const current = state.items.find((item) => item.id === id);
    if (!current) return;
    setState(recordLearningAnswer(state, id, correct, new Date()));
    const nextQueue = correct ? learningQueue : [...learningQueue, id];
    if (getAnswerDestination("learning", correct) === "restudy") {
      setLearningQueue(nextQueue);
      setRestudyContext({ itemId: id, source: "learning", nextQueue });
      setView("restudy");
      return;
    }
    const next = getImmediateAnswerStep(queueIndex, nextQueue.length);
    if (next.done) {
      setSummary({ title: "这一轮完成啦", detail: `${batchIds.length} 个字已经完成认读，明天开始进入待复习。` });
      setView("summary");
    } else setQueueIndex(next.nextIndex);
  }

  function beginReview(selectedMode = mode) {
    setMode(selectedMode);
    const ids = (selectReviewBatch(state, new Date()) as LiteracyItem[]).map((item) => item.id);
    if (ids.length === 0) {
      setSummary({ title: "今天都完成啦", detail: "没有到期的字，休息一下吧。" });
      setView("summary");
      return;
    }
    setReviewIds(ids);
    setReviewIndex(0);
    setUndoState(null);
    setView("review");
  }

  function answerReview(correct: boolean) {
    const id = reviewIds[reviewIndex];
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    const answeredIndex = reviewIndex;
    setUndoState({ state, reviewIndex: answeredIndex });
    setState(recordReviewAnswer(state, id, correct, new Date()));
    if (getAnswerDestination("review", correct) === "restudy") {
      setRestudyContext({ itemId: id, source: "review", answeredIndex });
      setView("restudy");
      return;
    }
    continueReview(answeredIndex);
  }

  function continueReview(answeredIndex: number) {
    const next = getNextReviewStep(answeredIndex, reviewIds.length);
    if (next.done) {
      setSummary({ title: "今天复习完成", detail: `完成了 ${reviewIds.length} 个字，系统已经安排好下次复习。` });
      setView("summary");
    } else {
      setReviewIndex(next.nextIndex);
      setView("review");
    }
  }

  function finishRestudyCard() {
    if (!restudyContext || !canNavigateFromCard(isSpeakingRef.current)) return;
    const context = restudyContext;
    setRestudyContext(null);
    if (context.source === "review") {
      continueReview(context.answeredIndex);
      return;
    }
    if (queueIndex + 1 >= context.nextQueue.length) {
      setSummary({ title: "这一轮完成啦", detail: `${batchIds.length} 个字已经完成认读，明天开始进入待复习。` });
      setView("summary");
    } else {
      setQueueIndex((value) => value + 1);
      setView("recognition");
    }
  }

  function undo() {
    if (!undoState) return;
    setState(undoState.state);
    setReviewIndex(undoState.reviewIndex);
    setUndoState(null);
  }

  function resetAll() {
    setState(accountId === "default" ? initialState() : createFreshAccountState(state));
    setView("home");
  }

  function switchAccount(id: string) {
    if (id === accountId) return;
    stop();
    onSelectAccount(id);
  }

  const currentStudy = state.items.find((item) => item.id === batchIds[studyIndex]);
  const currentLearning = state.items.find((item) => item.id === learningQueue[queueIndex]);
  const currentReview = state.items.find((item) => item.id === reviewIds[reviewIndex]);
  const currentRestudy = state.items.find((item) => item.id === restudyContext?.itemId);
  const editingItem = state.items.find((item) => item.id === editingId);

  if (!hydrated || access !== "ready") return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">字</span><span className="brand-text">识字小花园<small>每天一点点，记得更牢</small></span></div></header>
      <FamilyAccessGate access={access} message={sync.message} onLogin={login} onCreateFresh={createFresh} />
      {accountId !== "default" && access !== "checking" && <div className="main-stage"><button className="btn btn-secondary" type="button" onClick={() => switchAccount("default")}>返回原有账户</button></div>}
    </div>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">字</span><span className="brand-text">识字小花园<small>每天一点点，记得更牢</small></span></div>
        <div className="topbar-actions">
          <SyncStatus phase={sync.phase} message={sync.message} lastSavedAt={sync.lastSavedAt} onRetry={() => { void retry(); }} />
          {view === "home" && <button className="btn btn-ghost btn-small" type="button" onClick={() => setView("parent")}>家长中心</button>}
        </div>
        <AccountMenu accountId={accountId} blocked={sync.pending || sync.phase === "saving"} canSwitch={view === "home"} onSelect={switchAccount} />
      </header>

      {view === "home" && <main className="main-stage">
        <section className="hero"><p className="eyebrow">今天的识字时间</p><h1>今天想怎么学？</h1><p>打开今天的汉字清单，会的轻点一下，不会的双击再学。</p></section>
        <section className="panel">
          <div className="mode-grid" aria-label="选择学习模式">
            <button className="mode-button" type="button" aria-pressed={mode === "parent"} onClick={() => setMode("parent")}><span className="mode-icon">👨‍👩‍👧</span><span className="mode-copy"><strong>家长陪学</strong><span>家长听孩子读，判断会不会</span></span></button>
            <button className="mode-button" type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}><span className="mode-icon">📋</span><span className="mode-copy"><strong>列表学习</strong><span>今日全部汉字，不会的最后一起复习</span></span></button>
          </div>
          <div className="stats-grid"><div className="stat"><strong>{learningItems.length}</strong><span>待学习</span></div><div className="stat"><strong>{getTodayItems(state).filter((item: LiteracyItem) => item.stage !== "LEARNING").length}</strong><span>今天复习</span></div><div className="stat"><strong>{masteredCount}</strong><span>已掌握</span></div></div>
          <button className="btn btn-primary" style={{ width: "100%" }} type="button" onClick={() => begin(mode)}>{mode === "list" ? "开始列表学习" : "开始学习"}</button>
          <button className="btn btn-secondary" style={{ width: "100%", marginTop: 12 }} type="button" onClick={() => setView("weekend")}>本周末复习清单（{getWeekendItems(state).length}）</button>
        </section>
      </main>}

      {view === "preview" && <main className="main-stage">
        <div className="section-head"><div><p className="eyebrow">本轮预览</p><h1>先学这 {previewBatch().length} 个字</h1><p>不熟悉的字会排在前面。</p></div><button className="btn btn-ghost btn-small" onClick={() => setView("home")}>返回</button></div>
        <section className="panel">
          <div className="character-cloud">{previewBatch().map((item: LiteracyItem) => <span className="character-chip" key={item.id}>{item.char}</span>)}</div>
          {mode === "parent" && <div className="settings-grid">
            <div className="setting-row"><div><label>本轮取字数</label><small>只影响这一次</small></div><div className="number-control"><button onClick={() => setSessionSettings({ ...sessionSettings, batchSize: Math.max(1, sessionSettings.batchSize - 1) })}>−</button><output>{sessionSettings.batchSize}</output><button onClick={() => setSessionSettings({ ...sessionSettings, batchSize: Math.min(20, sessionSettings.batchSize + 1) })}>＋</button></div></div>
            <div className="setting-row"><div><label>每字读对几遍</label><small>会穿插出现，不会连续重复</small></div><div className="number-control"><button onClick={() => setSessionSettings({ ...sessionSettings, learningRepetitions: Math.max(1, sessionSettings.learningRepetitions - 1) })}>−</button><output>{sessionSettings.learningRepetitions}</output><button onClick={() => setSessionSettings({ ...sessionSettings, learningRepetitions: Math.min(10, sessionSettings.learningRepetitions + 1) })}>＋</button></div></div>
          </div>}
          <div className="button-row two" style={{ marginTop: 22 }}><button className="btn btn-secondary" onClick={() => setState(updateSettings(state, sessionSettings))}>保存为以后默认</button><button className="btn btn-primary" onClick={beginStudy}>开始学习组词</button></div>
        </section>
      </main>}

      {view === "study" && currentStudy && <main className="main-stage"><div className="progress-track"><div className="progress-fill" style={{ width: `${((studyIndex + 1) / batchIds.length) * 100}%` }} /></div><WordStudyCard item={currentStudy} pinyin={getCharacterPinyin(currentStudy)} words={wordsFor(currentStudy)} position={studyIndex + 1} total={batchIds.length} speaking={isSpeaking} onSpeak={speak} onNext={finishStudyCard} onEdit={() => setEditingId(currentStudy.id)} /></main>}

      {view === "recognition" && currentLearning && <main className="main-stage"><div className="progress-track"><div className="progress-fill" style={{ width: `${(queueIndex / Math.max(1, learningQueue.length)) * 100}%` }} /></div><RecognitionCard key={queueIndex} char={currentLearning.char} pinyin={getCharacterPinyin(currentLearning)} word={wordsFor(currentLearning)[0]} correctCount={currentLearning.learningCorrect} targetCount={sessionSettings.learningRepetitions} parentMode={mode === "parent"} disabled={isSpeaking} onAnswer={answerLearning} onEdit={() => setEditingId(currentLearning.id)} /></main>}

      {view === "restudy" && currentRestudy && <main className="main-stage"><WordStudyCard item={currentRestudy} pinyin={getCharacterPinyin(currentRestudy)} words={wordsFor(currentRestudy)} position={1} total={1} autoSpeak={shouldAutoSpeak(view)} speaking={isSpeaking} onSpeak={speak} onNext={finishRestudyCard} onEdit={() => setEditingId(currentRestudy.id)} /></main>}

      {view === "review" && currentReview && <main className="main-stage"><div className="section-head"><div><p className="eyebrow">到期复习 · {reviewIndex + 1}/{reviewIds.length}</p><h1>先读，再判断</h1></div>{undoState && <button className="btn btn-ghost btn-small" disabled={isSpeaking} onClick={undo}>撤销上一步</button>}</div><RecognitionCard key={reviewIndex} char={currentReview.char} pinyin={getCharacterPinyin(currentReview)} word={wordsFor(currentReview)[0]} correctCount={currentReview.stageStreak} targetCount={currentReview.stage === "MASTERED" ? 1 : state.settings[`${currentReview.stage === "DAILY" ? "daily" : currentReview.stage === "WEEKLY" ? "weekly" : "biweekly"}Goal`] ?? 3} parentMode={mode === "parent"} disabled={isSpeaking} onAnswer={answerReview} onEdit={() => setEditingId(currentReview.id)} /></main>}

      {view === "summary" && <main className="main-stage"><section className="panel empty-state"><div className="empty-icon">🌼</div><h2>{summary.title}</h2><p>{summary.detail}</p><div className="button-row two" style={{ marginTop: 24 }}><button className="btn btn-secondary" onClick={() => setView("home")}>回到首页</button><button className="btn btn-primary" onClick={() => begin(mode)}>继续下一轮</button></div></section></main>}

      {view === "parent" && <ParentPanel state={state} onChange={setState} onReset={resetAll} onClose={() => setView("home")} />}
      {view === "daily-list" && <DailyStudyList state={state} onChange={setState} onClose={() => setView("home")} />}
      {view === "weekend" && <WeekendReview state={state} onChange={setState} onClose={() => setView("home")} />}
      {editingItem && <CharacterDialog title={`编辑汉字：${editingItem.char}`} onClose={() => setEditingId(null)}>
        <CharacterEditor item={editingItem} words={getCharacterWords(editingItem, learnedSet)} onCancel={() => setEditingId(null)} onSave={(patch) => {
          updateCharacter(state, editingItem.id, patch);
          setState((previous) => updateCharacter(previous, editingItem.id, patch));
          setEditingId(null);
        }} />
      </CharacterDialog>}
    </div>
  );
}
