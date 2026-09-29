"use client";

import { useId, useState } from "react";
import { STATUS_STAGES } from "@/lib/character-status.mjs";
import type { LiteracyItem } from "@/lib/types";

type Props = {
  item: LiteracyItem;
  words: string[];
  pinyin: string;
  onSpeak: (text: string) => void;
  onEdit: () => void;
  onToggleWeekend: () => void;
  inWeekend: boolean;
  onDelete?: () => void;
};

function DetailsContent({ item, words, pinyin, onSpeak, onEdit, onToggleWeekend, inWeekend, onDelete }: Props) {
  const [showAnswer, setShowAnswer] = useState(false);
  const answerId = useId();
  const stageLabel = STATUS_STAGES.find((option) => option.value === item.stage)?.label;

  return (
    <section className="character-details" aria-label={`${item.char}的学习详情`}>
      <span className="counter-badge">{stageLabel}</span>
      <div className="big-character">{item.char}</div>
      <button className="btn btn-secondary" type="button" aria-expanded={showAnswer} aria-controls={answerId} onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? "隐藏拼音和组词" : "显示拼音和组词"}</button>
      <div id={answerId} hidden={!showAnswer} className="character-answer">
        <p className="pinyin">{pinyin || "暂未填写拼音"}</p>
        <div className="word-list" aria-label="组词">
          {words.length ? words.map((word) => <span className="word-pill" key={word}>{word}</span>) : <p className="study-tip">暂无组词，可点击编辑添加。</p>}
        </div>
      </div>
      <p className="study-tip">先试着认一认，再显示拼音和组词一起读。</p>
      <div className="character-detail-actions">
        <button className="btn btn-secondary" type="button" onClick={() => onSpeak(`${item.char}，${words.join("，")}`)}>🔊 播放读音</button>
        <button className="btn btn-ghost" type="button" onClick={onEdit}>编辑这个字</button>
        <button className="btn btn-ghost" type="button" aria-pressed={inWeekend} onClick={onToggleWeekend}>{inWeekend ? "移出本周末复习" : "加入本周末复习"}</button>
        {onDelete && <button className="btn btn-again" type="button" onClick={onDelete}>删除这个字</button>}
      </div>
    </section>
  );
}

export function CharacterDetails(props: Props) {
  return <DetailsContent key={props.item.id} {...props} />;
}
