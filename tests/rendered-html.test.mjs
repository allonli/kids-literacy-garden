import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps iPad accessibility and removes the starter preview", async () => {
  const [page, layout, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /width:\s*"device-width"/);
  assert.match(layout, /viewportFit:\s*"cover"/);
  assert.match(css, /min-height:\s*56px/);
  assert.match(css, /env\(safe-area-inset-(top|bottom)\)/);
  assert.match(css, /@media\s*\(min-width:\s*760px\)/);
  assert.doesNotMatch(page, /_sites-preview|SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("provides a searchable stage-based character status board", async () => {
  const [board, parentPanel] = await Promise.all([
    readFile(new URL("../components/CharacterStatusBoard.tsx", import.meta.url), "utf8").catch(() => ""),
    readFile(new URL("../components/ParentPanel.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(board, /全部汉字学习情况/);
  assert.match(board, /aria-label="搜索汉字"/);
  assert.match(board, /STATUS_STAGES/);
  assert.match(board, /filterStatusItems/);
  assert.match(board, /没有找到这个字/);
  assert.match(parentPanel, /<CharacterStatusBoard items=\{state\.items\} settings=\{state\.settings\}/);
  assert.match(parentPanel, /onEditCharacter=/);
  assert.match(parentPanel, /onViewCharacter=/);
});

test("keeps the new-learning next action reachable above the safe area", async () => {
  const [wordStudyCard, css] = await Promise.all([
    readFile(new URL("../components/WordStudyCard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(wordStudyCard, /className="study-action-bar"/);
  assert.match(css, /\.study-action-bar\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.study-action-bar\s*\{[^}]*bottom:/s);
  assert.match(css, /\.study-action-bar\s*\{[^}]*env\(safe-area-inset-bottom\)/s);
});
