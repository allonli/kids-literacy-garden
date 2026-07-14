"use client";

type Props = {
  item: { char: string };
  pinyin: string;
  words: string[];
  position: number;
  total: number;
  onSpeak: (text: string) => void;
  onNext: () => void;
};

function HighlightedWord({ word, target }: { word: string; target: string }) {
  const parts = word.split(target);
  return <span>{parts.map((part, index) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <mark>{target}</mark>}</span>)}</span>;
}

export function WordStudyCard({ item, pinyin, words, position, total, onSpeak, onNext }: Props) {
  return (
    <section className="learning-card" aria-labelledby="study-title">
      <p className="eyebrow">先在词语里认识它 · {position}/{total}</p>
      <div className="big-character" aria-label={item.char}>{item.char}</div>
      <p className="pinyin" id="study-title">{pinyin}</p>
      <div className="word-list" aria-label="推荐组词">
        {words.map((word) => <span className="word-pill" key={word}><HighlightedWord word={word} target={item.char} /></span>)}
      </div>
      <p className="study-tip">请把这个字和词语一起读一遍，再进入单字认读。</p>
      <div className="study-action-bar">
        <button className="btn btn-secondary" type="button" onClick={() => onSpeak(`${item.char}，${words.join("，")}`)}>🔊 播放读音</button>
        <button className="btn btn-primary" type="button" onClick={onNext}>我学好了，下一个</button>
      </div>
    </section>
  );
}
