"use client";

import { useEffect, useMemo, useState } from "react";
import { ParentPanel } from "./ParentPanel";
import { RecognitionCard } from "./RecognitionCard";
import { WordStudyCard } from "./WordStudyCard";
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
import { loadState, resetState, saveState } from "@/lib/storage.mjs";
import { getPinyin, getSuggestedWords } from "@/lib/word-recommendation.mjs";
import type { LiteracyItem, LiteracyState } from "@/lib/types";

type View = "home" | "preview" | "study" | "recognition" | "review" | "summary" | "parent";
type Mode = "parent" | "child";

function initialState(): LiteracyState { return createInitialState(SEED_CHARACTERS, new Date()) as LiteracyState; }

export function LiteracyApp() {
  const [state, setState] = useState<LiteracyState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("home");
  const [mode, setMode] = useState<Mode>("parent");
  const [sessionSettings, setSessionSettings] = useState({ batchSize: 5, learningRepetitions: 3 });
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [studyIndex, setStudyIndex] = useState(0);
  const [learningQueue, setLearningQueue] = useState<string[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [reviewIds, setReviewIds] = useState<string[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [feedback, setFeedback] = useState<{ correct: boolean; char: string } | null>(null);
  const [undoState, setUndoState] = useState<LiteracyState | null>(null);
  const [summary, setSummary] = useState({ title: "今天完成啦", detail: "每一次认真读，都让记忆更牢。" });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = loadState() as LiteracyState | null;
      if (saved?.version === 1 && Array.isArray(saved.items)) setState(saved);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => { if (hydrated) saveState(state); }, [state, hydrated]);

  const learnedSet = useMemo(() => new Set<string>(state.items.map((item) => item.char)), [state.items]);
  const learningItems = state.items.filter((item) => item.stage === "LEARNING");
  const dueItems = getDueItems(state, new Date()) as LiteracyItem[];
  const masteredCount = state.items.filter((item) => item.stage === "MASTERED").length;

  function wordsFor(item: LiteracyItem) {
    return [...(item.customWords ?? []), ...getSuggestedWords(item.char, learnedSet)]
      .filter((word, index, all) => !item.hiddenWords?.includes(word) && all.indexOf(word) === index)
      .slice(0, 3);
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.72;
    window.speechSynthesis.speak(utterance);
  }

  function begin(selectedMode: Mode) {
    setMode(selectedMode);
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
    if (studyIndex + 1 < batchIds.length) setStudyIndex(studyIndex + 1);
    else setView("recognition");
  }

  function answerLearning(correct: boolean) {
    const id = learningQueue[queueIndex];
    const current = state.items.find((item) => item.id === id);
    if (!current) return;
    setUndoState(state);
    setState(recordLearningAnswer(state, id, correct, new Date()));
    const nextQueue = correct ? learningQueue : [...learningQueue, id];
    if (!correct) setLearningQueue(nextQueue);
    setFeedback({ correct, char: current.char });
    setTimeout(() => {
      setFeedback(null);
      if (queueIndex + 1 >= nextQueue.length) {
        setSummary({ title: "这一轮完成啦", detail: `${batchIds.length} 个字已经完成认读，明天开始进入待复习。` });
        setView("summary");
      } else setQueueIndex((value) => value + 1);
    }, 650);
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
    setFeedback(null);
    setView("review");
  }

  function answerReview(correct: boolean) {
    const id = reviewIds[reviewIndex];
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    setUndoState(state);
    setState(recordReviewAnswer(state, id, correct, new Date()));
    setFeedback({ correct, char: item.char });
  }

  function continueReview() {
    setFeedback(null);
    if (reviewIndex + 1 >= reviewIds.length) {
      setSummary({ title: "今天复习完成", detail: `完成了 ${reviewIds.length} 个字，系统已经安排好下次复习。` });
      setView("summary");
    } else setReviewIndex((value) => value + 1);
  }

  function undo() {
    if (!undoState) return;
    setState(undoState);
    setUndoState(null);
    setFeedback(null);
  }

  function resetAll() {
    resetState();
    setState(initialState());
    setView("home");
  }

  const currentStudy = state.items.find((item) => item.id === batchIds[studyIndex]);
  const currentLearning = state.items.find((item) => item.id === learningQueue[queueIndex]);
  const currentReview = state.items.find((item) => item.id === reviewIds[reviewIndex]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">字</span><span className="brand-text">识字小花园<small>每天一点点，记得更牢</small></span></div>
        {view === "home" && <button className="btn btn-ghost btn-small" type="button" onClick={() => setView("parent")}>家长中心</button>}
      </header>

      {view === "home" && <main className="main-stage">
        <section className="hero"><p className="eyebrow">今天的识字时间</p><h1>今天想怎么学？</h1><p>先在词语里认识新字，再把字单独读出来。一次只做一件事。</p></section>
        <section className="panel">
          <div className="mode-grid" aria-label="选择学习模式">
            <button className="mode-button" type="button" aria-pressed={mode === "parent"} onClick={() => setMode("parent")}><span className="mode-icon">👨‍👩‍👧</span><span className="mode-copy"><strong>家长陪学</strong><span>家长听孩子读，判断会不会</span></span></button>
            <button className="mode-button" type="button" aria-pressed={mode === "child"} onClick={() => setMode("child")}><span className="mode-icon">🌱</span><span className="mode-copy"><strong>孩子自己学</strong><span>先读出来，再播放答案自查</span></span></button>
          </div>
          <div className="stats-grid"><div className="stat"><strong>{learningItems.length}</strong><span>待学习</span></div><div className="stat"><strong>{dueItems.length}</strong><span>今天复习</span></div><div className="stat"><strong>{masteredCount}</strong><span>已掌握</span></div></div>
          <button className="btn btn-primary" style={{ width: "100%" }} type="button" onClick={() => begin(mode)}>开始学习</button>
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

      {view === "study" && currentStudy && <main className="main-stage"><div className="progress-track"><div className="progress-fill" style={{ width: `${((studyIndex + 1) / batchIds.length) * 100}%` }} /></div><WordStudyCard item={currentStudy} pinyin={getPinyin(currentStudy.char)} words={wordsFor(currentStudy)} position={studyIndex + 1} total={batchIds.length} onSpeak={speak} onNext={finishStudyCard} /></main>}

      {view === "recognition" && currentLearning && <main className="main-stage"><div className="progress-track"><div className="progress-fill" style={{ width: `${(queueIndex / Math.max(1, learningQueue.length)) * 100}%` }} /></div><RecognitionCard char={currentLearning.char} correctCount={currentLearning.learningCorrect} targetCount={sessionSettings.learningRepetitions} parentMode={mode === "parent"} disabled={Boolean(feedback)} onAnswer={answerLearning} />{feedback && <div className={`feedback ${feedback.correct ? "good" : "again"}`}><strong>{feedback.correct ? "读对了！" : "再看一次"}</strong>{feedback.correct ? "稍后还会再见到它。" : `${feedback.char} · ${getPinyin(feedback.char)} · ${wordsFor(currentLearning).join("、")}`}</div>}</main>}

      {view === "review" && currentReview && <main className="main-stage"><div className="section-head"><div><p className="eyebrow">到期复习 · {reviewIndex + 1}/{reviewIds.length}</p><h1>先读，再判断</h1></div>{undoState && <button className="btn btn-ghost btn-small" onClick={undo}>撤销上一步</button>}</div><RecognitionCard char={currentReview.char} correctCount={currentReview.stageStreak} targetCount={currentReview.stage === "MASTERED" ? 1 : state.settings[`${currentReview.stage === "DAILY" ? "daily" : currentReview.stage === "WEEKLY" ? "weekly" : "biweekly"}Goal`] ?? 3} parentMode={mode === "parent"} disabled={Boolean(feedback)} onAnswer={answerReview} />{feedback && <div className={`feedback ${feedback.correct ? "good" : "again"}`}><strong>{feedback.correct ? "答对了" : "先回去学一学"}</strong><div>{getPinyin(currentReview.char)} · {wordsFor(currentReview).join("、")}</div><button className="btn btn-secondary btn-small" style={{ marginTop: 12 }} onClick={() => speak(`${currentReview.char}，${wordsFor(currentReview).join("，")}`)}>🔊 播放答案</button><button className="btn btn-primary btn-small" style={{ marginTop: 12, marginLeft: 8 }} onClick={continueReview}>下一个</button></div>}</main>}

      {view === "summary" && <main className="main-stage"><section className="panel empty-state"><div className="empty-icon">🌼</div><h2>{summary.title}</h2><p>{summary.detail}</p><div className="button-row two" style={{ marginTop: 24 }}><button className="btn btn-secondary" onClick={() => setView("home")}>回到首页</button><button className="btn btn-primary" onClick={() => begin(mode)}>继续下一轮</button></div></section></main>}

      {view === "parent" && <ParentPanel state={state} onChange={setState} onReset={resetAll} onClose={() => setView("home")} />}
    </div>
  );
}
