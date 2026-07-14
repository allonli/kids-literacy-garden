import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished literacy application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<html[^>]+lang="zh-CN"/i);
  assert.match(html, /<title>识字小花园<\/title>/i);
  assert.match(html, /今天想怎么学/);
  assert.match(html, /家长陪学/);
  assert.match(html, /孩子自己学/);
  assert.match(html, /开始学习/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project/i);
});

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
  assert.match(parentPanel, /<CharacterStatusBoard items=\{state\.items\} settings=\{state\.settings\} \/>/);
});

test("review feedback advances automatically without a manual next button", async () => {
  const literacyApp = await readFile(new URL("../components/LiteracyApp.tsx", import.meta.url), "utf8");
  assert.match(literacyApp, /getReviewFeedbackDelay/);
  assert.match(literacyApp, /getNextReviewStep/);
  assert.doesNotMatch(literacyApp, /onClick=\{continueReview\}>下一个/);
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
