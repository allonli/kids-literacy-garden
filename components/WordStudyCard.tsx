"use client";

import { useEffect, useId, useRef, useState } from "react";

type Props = {
  item: { char: string };
  pinyin: string;
  words: string[];
  position: number;
  total: number;
  autoSpeak?: boolean;
  speaking?: boolean;
  onSpeak: (text: string) => boolean;
  onNext: () => void;
  onEdit?: () => void;
};

function HighlightedWord({ word, target }: { word: string; target: string }) {
  const parts = word.split(target);
  return <span>{parts.map((part, index) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <mark>{target}</mark>}</span>)}</span>;
}

function StudyCard({ item, pinyin, words, position, total, autoSpeak = false, speaking = false, onSpeak, onNext, onEdit }: Props) {
  const speechText = `${item.char}，${words.join("，")}`;
  const [showAnswer, setShowAnswer] = useState(false);
  const answerId = useId();
  const [autoSpeechFinished, setAutoSpeechFinished] = useState(!autoSpeak);
  const observedAutoSpeechRef = useRef(false);

  useEffect(() => {
    if (!autoSpeak || onSpeak(speechText)) return;
    const timer = window.setTimeout(() => setAutoSpeechFinished(true), 0);
    return () => window.clearTimeout(timer);
  }, [autoSpeak, onSpeak, speechText]);

  useEffect(() => {
    if (!autoSpeak) return;
    if (speaking) observedAutoSpeechRef.current = true;
    else if (observedAutoSpeechRef.current) {
      const timer = window.setTimeout(() => setAutoSpeechFinished(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, [autoSpeak, speaking]);

  const controlsDisabled = speaking || !autoSpeechFinished;

  return (
    <section className="learning-card" aria-labelledby="study-title">
      <p className="eyebrow" id="study-title">先在词语里认识它 · {position}/{total}</p>
      <div className="big-character" aria-label={item.char}>{item.char}</div>
      <button className="btn btn-secondary" type="button" aria-expanded={showAnswer} aria-controls={answerId} onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? "隐藏拼音和组词" : "显示拼音和组词"}</button>
      <div id={answerId} hidden={!showAnswer} className="character-answer">
        <p className="pinyin">{pinyin}</p>
        <div className="word-list" aria-label="推荐组词">
          {words.map((word) => <span className="word-pill" key={word}><HighlightedWord word={word} target={item.char} /></span>)}
        </div>
      </div>
      <p className="study-tip">先试着认一认，再显示拼音和组词一起读。</p>
      {onEdit && <button className="btn btn-ghost btn-small" type="button" disabled={controlsDisabled} onClick={onEdit}>编辑这个字</button>}
      <div className="study-action-bar">
        <button className="btn btn-secondary" type="button" disabled={controlsDisabled} onClick={() => onSpeak(speechText)}>{speaking ? "🔊 正在播放…" : "🔊 播放读音"}</button>
        <button className="btn btn-primary" type="button" disabled={controlsDisabled} onClick={onNext}>我学好了，下一个</button>
      </div>
    </section>
  );
}

export function WordStudyCard(props: Props) {
  // 切换汉字后重新隐藏答案，同时为自动发音建立独立的卡片状态。
  return <StudyCard key={props.item.char} {...props} />;
}
