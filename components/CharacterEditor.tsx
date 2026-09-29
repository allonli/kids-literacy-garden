"use client";

import { useId, useState, type FormEvent } from "react";
import { getCharacterPinyin } from "@/lib/character-editing.mjs";
import { STATUS_STAGES } from "@/lib/character-status.mjs";
import type { LearningStage, LiteracyItem } from "@/lib/types";

export type CharacterEditPatch = { pinyin: string; words: string[]; stage: LearningStage };

type Props = {
  item: LiteracyItem;
  words: string[];
  onSave: (patch: CharacterEditPatch) => void;
  onCancel: () => void;
};

function EditorForm({ item, words, onSave, onCancel }: Props) {
  const inputId = useId();
  const [pinyin, setPinyin] = useState(() => getCharacterPinyin(item));
  const [wordText, setWordText] = useState(words.join("、"));
  const [stage, setStage] = useState<LearningStage>(item.stage);
  const [error, setError] = useState("");

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      onSave({ pinyin, words: wordText.split(/[、,，;；\s]+/u).filter(Boolean), stage });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败，请检查内容后重试。");
    }
  }

  return (
    <form className="character-editor" onSubmit={save}>
      <p className="character-editor-intro">编辑「{item.char}」的拼音、组词和当前学习状态。</p>
      <div className="field">
        <label htmlFor={`${inputId}-pinyin`}>拼音</label>
        <input id={`${inputId}-pinyin`} value={pinyin} onChange={(event) => setPinyin(event.target.value)} placeholder="例如：chūn" autoComplete="off" required />
      </div>
      <div className="field">
        <label htmlFor={`${inputId}-words`}>组词</label>
        <textarea id={`${inputId}-words`} value={wordText} onChange={(event) => setWordText(event.target.value)} rows={3} placeholder={`输入含“${item.char}”的词，用逗号、顿号或换行分隔`} aria-describedby={`${inputId}-words-help`} />
        <small id={`${inputId}-words-help`}>每个词语需含“{item.char}”，由 2–4 个汉字组成。保存后只显示这里填写的词语；留空可清除组词。</small>
      </div>
      <div className="field">
        <label htmlFor={`${inputId}-stage`}>当前学习状态</label>
        <select id={`${inputId}-stage`} value={stage} onChange={(event) => setStage(event.target.value as LearningStage)}>
          {STATUS_STAGES.filter((option) => option.value !== "ALL").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <small>更改学习阶段后，将重新安排该阶段的学习进度和复习时间。</small>
      </div>
      {error && <p className="character-error" role="alert">{error}</p>}
      <div className="character-editor-actions">
        <button className="btn btn-ghost" type="button" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" type="submit">保存修改</button>
      </div>
    </form>
  );
}

export function CharacterEditor(props: Props) {
  return <EditorForm key={props.item.id} {...props} />;
}
