"use client";

import { useMemo, useState } from "react";
import { CharacterStatusBoard } from "./CharacterStatusBoard";
import { CharacterDialog } from "./CharacterDialog";
import { CharacterDetails } from "./CharacterDetails";
import { CharacterEditor, type CharacterEditPatch } from "./CharacterEditor";
import { addNewCharacters, updateSettings } from "@/lib/learning-engine.mjs";
import { deleteCharacter, getCharacterPinyin, getCharacterWords, updateCharacter } from "@/lib/character-editing.mjs";
import { getWeekendItems, toggleWeekendCharacter } from "@/lib/study-list.mjs";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<"details" | "edit">("details");
  const [editFromDetails, setEditFromDetails] = useState(false);
  const [notice, setNotice] = useState("");
  const selected = state.items.find((item) => item.id === selectedId);
  const learnedSet = useMemo(() => new Set<string>(state.items.map((item) => item.char)), [state.items]);
  const weekendIds = getWeekendItems(state, new Date()).map((item) => item.id);

  function changeSetting(key: keyof LiteracySettings, delta: number, minimum: number, maximum: number) {
    const value = Math.min(maximum, Math.max(minimum, state.settings[key] + delta));
    onChange(updateSettings(state, { [key]: value }));
  }

  function addCharacters() {
    onChange(addNewCharacters(state, newCharacters));
    setNewCharacters("");
  }

  function openCharacter(id: string, mode: "details" | "edit") {
    setNotice("");
    setSelectedId(id);
    setDialogMode(mode);
    setEditFromDetails(false);
  }

  function toggleWeekend(id: string) {
    const item = state.items.find((candidate) => candidate.id === id);
    onChange(toggleWeekendCharacter(state, id, new Date()));
    setNotice(`「${item?.char ?? ""}」已${weekendIds.includes(id) ? "移出" : "加入"}本周末复习清单。`);
  }

  function saveCharacter(patch: CharacterEditPatch) {
    if (!selected) return;
    onChange(updateCharacter(state, selected.id, patch, new Date()));
    setNotice(`「${selected.char}」的修改已保存。`);
    if (editFromDetails) setDialogMode("details");
    else setSelectedId(null);
  }

  function cancelEditing() {
    if (editFromDetails) setDialogMode("details");
    else setSelectedId(null);
  }

  function removeCharacter(id: string) {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    if (!window.confirm(`从当前学习账户删除「${item.char}」？该字的拼音、组词、学习记录及今日/周末清单将一并移除，其他账户不受影响。需要时可重新添加，原记录不会恢复。`)) return;
    onChange(deleteCharacter(state, id));
    if (selectedId === id) setSelectedId(null);
    setNotice(`已从当前学习账户删除「${item.char}」。`);
  }

  function speak(text: string) {
    if (!("speechSynthesis" in window)) {
      setNotice("当前浏览器不支持语音朗读，请显示拼音和组词后一起读。");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.8;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <main className="main-stage">
      <div className="section-head">
        <div><p className="eyebrow">家长中心</p><h1>调整学习方式</h1><p>学习进度会自动永久保存，并同步到使用同一家庭码的设备。</p></div>
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

        <CharacterStatusBoard items={state.items} settings={state.settings} weekendIds={weekendIds} onViewCharacter={(id) => openCharacter(id, "details")} onEditCharacter={(id) => openCharacter(id, "edit")} onToggleWeekend={toggleWeekend} onDeleteCharacter={removeCharacter} />

        <section className="subpanel">
          <h2>维护汉字资料</h2>
          <p>在上方列表点击汉字查看详情，点击“编辑”可修改拼音、全部组词和当前学习状态。点击“加入周末”可放入本周末复习清单。</p>
          <p>点击“删除”并确认，可从当前账户移除这个字及其学习记录，其他账户不受影响。</p>
          <p>详情中的拼音和组词默认隐藏，点击显示按钮后再查看。</p>
        </section>

        <section className="subpanel">
          <h2>数据与恢复</h2>
          <p>仅清空当前学习账户，并同步到所有设备；其他账户不受影响，服务器的每日备份不会立即删除。</p>
          <button className="btn btn-again" type="button" onClick={() => window.confirm("确定清空当前学习账户在所有设备上的进度并重新开始吗？其他账户不受影响，服务器备份不会立即删除。") && onReset()}>清空并重新开始</button>
        </section>
      </div>
      <p className="character-notice" role="status">{!selected && notice}</p>
      {selected && (
        <CharacterDialog title={`${dialogMode === "edit" ? "编辑汉字" : "汉字详情"} · ${selected.char}`} onClose={() => setSelectedId(null)}>
          {dialogMode === "edit" ? (
            <CharacterEditor item={selected} words={getCharacterWords(selected, learnedSet)} onSave={saveCharacter} onCancel={cancelEditing} />
          ) : (
            <CharacterDetails
              item={selected}
              words={getCharacterWords(selected, learnedSet)}
              pinyin={getCharacterPinyin(selected)}
              onSpeak={speak}
              onEdit={() => { setNotice(""); setEditFromDetails(true); setDialogMode("edit"); }}
              inWeekend={weekendIds.includes(selected.id)}
              onToggleWeekend={() => toggleWeekend(selected.id)}
              onDelete={() => removeCharacter(selected.id)}
            />
          )}
          <p className="character-notice" role="status">{notice}</p>
        </CharacterDialog>
      )}
    </main>
  );
}
