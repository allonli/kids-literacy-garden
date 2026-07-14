"use client";

type Props = {
  char: string;
  correctCount: number;
  targetCount: number;
  parentMode: boolean;
  disabled?: boolean;
  onAnswer: (correct: boolean) => void;
};

export function RecognitionCard({ char, correctCount, targetCount, parentMode, disabled = false, onAnswer }: Props) {
  return (
    <section className="learning-card" aria-labelledby="recognition-title">
      <p className="eyebrow" id="recognition-title">现在单独认这个字</p>
      <span className="counter-badge">已读对 {correctCount}/{targetCount} 遍</span>
      <div className="big-character" aria-label={char}>{char}</div>
      <p className="study-tip">先大声读出来，再选择结果。</p>
      <div className="recognition-actions">
        <button className="btn btn-again" type="button" disabled={disabled} onClick={() => onAnswer(false)}>{parentMode ? "不会" : "再学一下"}</button>
        <button className="btn btn-good" type="button" disabled={disabled} onClick={() => onAnswer(true)}>{parentMode ? "会" : "我会"}</button>
      </div>
    </section>
  );
}
