import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";

import { hashFamilyCode } from "../lib/server/family-auth.mjs";
import { createInitialState } from "../lib/learning-engine.mjs";
import { deleteCharacter } from "../lib/character-editing.mjs";

let child;
let origin;
let directory;
let output = "";

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js 提前退出：\n${output}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Next.js 未在时限内启动：\n${output}`);
}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), "literacy-next-"));
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [
    resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port),
  ], {
    cwd: resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      LITERACY_DB_PATH: join(directory, "progress.sqlite"),
      LITERACY_FAMILY_CODE_HASH: await hashFamilyCode("482731", Buffer.alloc(16, 4)),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  await waitForServer(origin);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolveExit) => child.once("exit", resolveExit));
  }
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test("serves the Chinese application shell from the production Node server", async () => {
  const response = await fetch(origin);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /识字小花园/);
  assert.match(html, /正在检查永久保存状态/);
});

test("serves authenticated migration through the production API routes", async () => {
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ code: "482731" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const progress = await fetch(`${origin}/api/progress`, { headers: { cookie } });
  assert.equal(progress.status, 200);
  assert.deepEqual(await progress.json(), { status: "empty", accountId: "default" });
});

test("persists new learning fields through the production Node API", async () => {
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ code: "482731" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const headers = { "content-type": "application/json", origin, cookie };
  const state = createInitialState([{ char: "山", stage: "LEARNING" }], new Date("2026-09-05T08:00:00Z"));
  state.items[0].pinyin = "shān";
  state.items[0].editedWords = ["山河"];
  state.weekendReview = { weekStart: "2026-08-31", characterIds: ["山"] };
  state.dailySession = { date: "2026-09-05", pendingIds: ["山"], retryIds: [], completedIds: [] };
  const migrated = await fetch(`${origin}/api/progress/migrate`, {
    method: "POST", headers, body: JSON.stringify({ state }),
  });
  assert.equal(migrated.status, 201);
  assert.deepEqual((await migrated.json()).state, state);

  state.items[0].editedWords = [];
  state.dailySession = { ...state.dailySession, pendingIds: [], retryIds: ["山"] };
  const saved = await fetch(`${origin}/api/progress`, {
    method: "PUT", headers, body: JSON.stringify({ state, baseRevision: 1 }),
  });
  assert.equal(saved.status, 200);
  const reloaded = await fetch(`${origin}/api/progress`, { headers: { cookie } });
  assert.deepEqual((await reloaded.json()).state, state);

  const malformed = { ...state, weekendReview: { ...state.weekendReview, characterIds: null } };
  const rejected = await fetch(`${origin}/api/progress`, {
    method: "PUT", headers, body: JSON.stringify({ state: malformed, baseRevision: 2 }),
  });
  assert.equal(rejected.status, 400);
  const preserved = await fetch(`${origin}/api/progress`, { headers: { cookie } });
  assert.deepEqual((await preserved.json()).state, state);
});

test("creates and switches isolated learning accounts through production routes", async () => {
  const unauthenticated = await fetch(`${origin}/api/accounts`);
  assert.equal(unauthenticated.status, 401);
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ code: "482731" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const headers = { "content-type": "application/json", origin, cookie };
  const original = await (await fetch(`${origin}/api/progress`, { headers })).json();
  const created = await fetch(`${origin}/api/accounts`, {
    method: "POST", headers, body: JSON.stringify({ name: "测试学习者", sourceAccountId: "default" }),
  });
  assert.equal(created.status, 201);
  const { account } = await created.json();
  const listed = await (await fetch(`${origin}/api/accounts`, { headers })).json();
  assert.deepEqual(listed.accounts, [{ id: "default", name: "原有账户" }, account]);
  const accountUrl = `${origin}/api/account-progress?accountId=${account.id}`;
  const fresh = await (await fetch(accountUrl, { headers })).json();
  assert.equal(fresh.accountId, account.id);
  assert.equal(fresh.state.items[0].stage, "LEARNING");
  assert.deepEqual(fresh.state.items[0].editedWords, original.state.items[0].editedWords);
  assert.equal(fresh.state.weekendReview, undefined);
  assert.equal(fresh.state.dailySession, undefined);
  const changed = structuredClone(fresh.state);
  changed.items[0].stage = "MASTERED";
  changed.weekendReview = { weekStart: "2026-09-14", characterIds: ["山"] };
  const saved = await fetch(accountUrl, {
    method: "PUT", headers, body: JSON.stringify({ state: changed, baseRevision: fresh.revision }),
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.accountId, account.id);
  assert.deepEqual((await (await fetch(accountUrl, { headers })).json()).state, changed);
  assert.deepEqual(await (await fetch(`${origin}/api/progress`, { headers })).json(), original);
  const stale = await fetch(accountUrl, {
    method: "PUT", headers, body: JSON.stringify({ state: fresh.state, baseRevision: fresh.revision }),
  });
  assert.equal(stale.status, 409);
  const missing = await fetch(`${origin}/api/account-progress?accountId=unknown`, { headers });
  assert.equal(missing.status, 404);
  for (const path of ["/api/account-progress", "/api/account-progress?accountId=default", `/api/progress?accountId=${account.id}`]) {
    assert.equal((await fetch(`${origin}${path}`, { headers })).status, 400);
    const rejected = await fetch(`${origin}${path}`, {
      method: "PUT", headers, body: JSON.stringify({ state: changed, baseRevision: original.revision }),
    });
    assert.equal(rejected.status, 400);
  }
  assert.deepEqual(await (await fetch(`${origin}/api/progress`, { headers })).json(), original);
});

test("persists deleting the last character and its references in one account without changing the original", async () => {
  const login = await fetch(`${origin}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ code: "482731" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const headers = { "content-type": "application/json", origin, cookie };
  const original = await (await fetch(`${origin}/api/progress`, { headers })).json();
  const created = await fetch(`${origin}/api/accounts`, {
    method: "POST", headers, body: JSON.stringify({ name: "删除测试账户", sourceAccountId: "default" }),
  });
  assert.equal(created.status, 201);
  const { account } = await created.json();
  const accountUrl = `${origin}/api/account-progress?accountId=${account.id}`;
  const fresh = await (await fetch(accountUrl, { headers })).json();
  const current = fresh.state;
  current.history = [{ char: "山", correct: true, kind: "list", at: "2026-09-16T08:00:00.000Z" }];
  current.weekendReview = { weekStart: "2026-09-14", characterIds: ["山"] };
  current.dailySession = { date: "2026-09-16", pendingIds: ["山"], retryIds: ["山"], completedIds: ["山"] };
  const prepared = await fetch(accountUrl, {
    method: "PUT", headers, body: JSON.stringify({ state: current, baseRevision: fresh.revision }),
  });
  assert.equal(prepared.status, 200);
  const revision = (await prepared.json()).revision;
  const deleted = deleteCharacter(current, "山");
  const saved = await fetch(accountUrl, {
    method: "PUT", headers, body: JSON.stringify({ state: deleted, baseRevision: revision }),
  });
  assert.equal(saved.status, 200);
  const reloaded = await (await fetch(accountUrl, { headers })).json();
  assert.equal(reloaded.accountId, account.id);
  assert.equal(reloaded.revision, revision + 1);
  assert.deepEqual(reloaded.state, deleted);
  assert.deepEqual(reloaded.state.items, []);
  assert.deepEqual(reloaded.state.history, []);
  assert.deepEqual(reloaded.state.weekendReview.characterIds, []);
  for (const field of ["pendingIds", "retryIds", "completedIds"]) assert.deepEqual(reloaded.state.dailySession[field], []);
  assert.deepEqual(await (await fetch(`${origin}/api/progress`, { headers })).json(), original);
});
