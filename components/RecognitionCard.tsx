"use client";

import { useId, useState } from "react";

type Props = {
  char: string;
  pinyin: string;
  word?: string;
  correctCount: number;
  targetCount: number;
  parentMode: boolean;
  disabled?: boolean;
  onAnswer: (correct: boolean) => void;
  onEdit?: () => void;
};

function RecognitionContent({ char, pinyin, word, correctCount, targetCount, parentMode, disabled = false, onAnswer, onEdit }: Props) {
  const [showAnswer, setShowAnswer] = useState(false);
  const answerId = useId();
  return (
    <section className="learning-card" aria-labelledby="recognition-title">
      <p className="eyebrow" id="recognition-title">现在单独认这个字</p>
      <span className="counter-badge">已读对 {correctCount}/{targetCount} 遍</span>
      <div className="big-character" aria-label={char}>{char}</div>
      <button className="btn btn-secondary" type="button" aria-expanded={showAnswer} aria-controls={answerId} onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? "隐藏拼音和组词" : "显示拼音和组词"}</button>
      <div id={answerId} hidden={!showAnswer} className="character-answer">
        <p className="pinyin">{pinyin}</p>
        {word && <div className="word-list" aria-label="示例词"><span className="word-pill">{word}</span></div>}
      </div>
      <p className="study-tip">先大声读出来，再选择结果。</p>
      {onEdit && <button className="btn btn-ghost btn-small" type="button" disabled={disabled} onClick={onEdit}>编辑这个字</button>}
      <div className="recognition-actions">
        <button className="btn btn-again" type="button" disabled={disabled} onClick={() => onAnswer(false)}>{parentMode ? "不会" : "再学一下"}</button>
        <button className="btn btn-good" type="button" disabled={disabled} onClick={() => onAnswer(true)}>{parentMode ? "会" : "我会"}</button>
      </div>
    </section>
  );
}

export function RecognitionCard(props: Props) {
  return <RecognitionContent key={props.char} {...props} />;
}
