"use client";

import { useMemo, useState } from "react";
import { CharacterStatusBoard } from "./CharacterStatusBoard";
import { addNewCharacters, setCustomWords, updateSettings } from "@/lib/learning-engine.mjs";
import { getSuggestedWords } from "@/lib/word-recommendation.mjs";
import type { LiteracySettings, LiteracyState } from "@/lib/types";

type Props = {
  state: LiteracyState;
  onChange: (state: LiteracyState) => void;
  onReset: () => void;
  onClose: () => void;
};

const SETTING_ROWS = [
  ["batchSize", "每轮取字数", "一次学习多少个字", 1, 20],
  ["learningRepetitions", "每字认读遍数", "单字独立读对多少遍", 1, 10],
  ["dailyGoal", "待复习升级次数", "不同日期连续答对", 1, 10],
  ["weeklyGoal", "每周升级次数", "每次到期答对", 1, 10],
  ["biweeklyGoal", "每两周升级次数", "每次到期答对", 1, 10],
] as const;

export function ParentPanel({ state, onChange, onReset, onClose }: Props) {
  const [newCharacters, setNewCharacters] = useState("");
  const [selectedChar, setSelectedChar] = useState(state.items[0]?.char ?? "");
  const [customText, setCustomText] = useState("");
  const selected = state.items.find((item) => item.char === selectedChar);
  const learnedSet = useMemo(() => new Set<string>(state.items.map((item) => item.char)), [state.items]);
  const suggestions = selected ? [
    ...(selected.customWords ?? []),
    ...getSuggestedWords(selected.char, learnedSet),
  ].filter((word, index, all) => !selected.hiddenWords?.includes(word) && all.indexOf(word) === index).slice(0, 5) : [];

  function changeSetting(key: keyof LiteracySettings, delta: number, minimum: number, maximum: number) {
    const value = Math.min(maximum, Math.max(minimum, state.settings[key] + delta));
    onChange(updateSettings(state, { [key]: value }));
  }

  function addCharacters() {
    onChange(addNewCharacters(state, newCharacters));
    setNewCharacters("");
  }

  function addCustomWords() {
    if (!selected) return;
    const additions = customText.split(/[、,，\s]+/).filter(Boolean);
    onChange(setCustomWords(state, selected.char, [...selected.customWords, ...additions]));
    setCustomText("");
  }

  function hideWord(word: string) {
    onChange({
      ...state,
      items: state.items.map((item) => item.char === selectedChar
        ? { ...item, hiddenWords: [...new Set([...(item.hiddenWords ?? []), word])] }
        : item),
    });
  }

  return (
    <main className="main-stage">
      <div className="section-head">
        <div><p className="eyebrow">家长中心</p><h1>调整学习方式</h1><p>设置会保存在这台设备的浏览器中。</p></div>
        <button className="btn btn-ghost btn-small back-button" type="button" onClick={onClose}>返回首页</button>
      </div>
      <div className="parent-layout">
        <section className="subpanel">
          <h2>学习设置</h2>
          <div className="settings-grid">
            {SETTING_ROWS.map(([key, label, help, min, max]) => (
              <div className="setting-row" key={key}>
                <div><label>{label}</label><small>{help}</small></div>
                <div className="number-control">
                  <button type="button" aria-label={`${label}减一`} onClick={() => changeSetting(key, -1, min, max)}>−</button>
                  <output aria-label={label}>{state.settings[key]}</output>
                  <button type="button" aria-label={`${label}加一`} onClick={() => changeSetting(key, 1, min, max)}>＋</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="subpanel">
          <h2>添加新学的字</h2>
          <p>可以一次输入多个汉字，重复字会自动忽略。</p>
          <div className="inline-form">
            <input aria-label="新学汉字" value={newCharacters} onChange={(event) => setNewCharacters(event.target.value)} placeholder="例如：春风花草" />
            <button className="btn btn-primary" type="button" onClick={addCharacters} disabled={!newCharacters.trim()}>加入待学习</button>
          </div>
          <div className="warning-note">已导入 {state.items.length} 个不同汉字；原表有 {state.importWarnings.length} 条重复或无效内容，系统已自动处理。</div>
        </section>

        <CharacterStatusBoard items={state.items} settings={state.settings} />

        <section className="subpanel">
          <h2>维护组词</h2>
          <div className="field">
            <label htmlFor="character-select">选择汉字</label>
            <select id="character-select" value={selectedChar} onChange={(event) => setSelectedChar(event.target.value)}>
              {state.items.map((item) => <option key={item.id} value={item.char}>{item.char} · {item.stage}</option>)}
            </select>
          </div>
          <div className="word-editor-list">
            {suggestions.map((word) => <span className="editable-word" key={word}>{word}<button type="button" aria-label={`隐藏${word}`} onClick={() => hideWord(word)}>隐藏</button></span>)}
          </div>
          <div className="inline-form">
            <input aria-label="自定义组词" value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder={`输入含“${selectedChar}”的词，用逗号分隔`} />
            <button className="btn btn-secondary" type="button" onClick={addCustomWords} disabled={!customText.trim()}>添加组词</button>
          </div>
        </section>

        <section className="subpanel">
          <h2>数据与恢复</h2>
          <p>学习记录只保存在当前浏览器。清空后会恢复到首次导入状态。</p>
          <button className="btn btn-again" type="button" onClick={() => window.confirm("确定清空这台设备上的学习进度吗？") && onReset()}>清空并重新开始</button>
        </section>
      </div>
    </main>
  );
}
