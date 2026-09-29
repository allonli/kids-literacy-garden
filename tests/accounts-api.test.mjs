import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as api from "../lib/server/progress-api.mjs";
import { openProgressDb } from "../lib/server/progress-db.mjs";
import { createDeviceToken } from "../lib/server/family-auth.mjs";

const now = new Date("2026-09-16T08:00:00.000Z");
const state = {
  version: 1,
  settings: { batchSize: 5, learningRepetitions: 3, dailyGoal: 3, weeklyGoal: 3, biweeklyGoal: 3, masteredSample: 2 },
  importWarnings: [], history: [],
  items: [{ id: "山", char: "山", pinyin: "shān", stage: "MASTERED", stageStreak: 3, learningCorrect: 3,
    unfamiliar: false, lastCountedDate: "2026-09-16", nextDue: null,
    words: ["大山"], customWords: [], hiddenWords: [], editedWords: [] }],
};

async function withDeps(run) {
  const directory = mkdtempSync(join(tmpdir(), "literacy-accounts-api-"));
  const db = openProgressDb(join(directory, "progress.sqlite"));
  const token = createDeviceToken();
  db.createSession(token.hash, "default", now, new Date("2026-09-17T08:00:00.000Z"));
  const deps = { db, production: true, now: () => now };
  const cookie = `kids_literacy_device=${token.raw}`;
  try { return await run(deps, cookie); }
  finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}

function request(path, { body, cookie, origin = "https://z.allon.me", headers = {} } = {}) {
  return new Request(`https://z.allon.me${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("lists and creates learners without changing the original account", () => withDeps(async (deps, cookie) => {
  assert.equal(typeof api.listAccounts, "function");
  assert.equal(typeof api.createAccount, "function");
  deps.db.migrateProgress("default", state, now);
  const listed = await api.listAccounts(request("/api/accounts", { cookie }), deps);
  assert.deepEqual(await listed.json(), { accounts: [{ id: "default", name: "原有账户" }] });
  const created = await api.createAccount(request("/api/accounts", { cookie, body: { name: " 妹妹 ", sourceAccountId: "default" } }), deps);
  assert.equal(created.status, 201);
  const { account, accounts } = await created.json();
  assert.equal(account.name, "妹妹");
  assert.deepEqual(accounts, [{ id: "default", name: "原有账户" }, account]);
  const original = await (await api.getProgress(request("/api/progress", { cookie }), deps)).json();
  const fresh = await (await api.getProgress(request(`/api/account-progress?accountId=${account.id}`, { cookie }), deps)).json();
  assert.equal(original.accountId, "default");
  assert.equal(fresh.accountId, account.id);
  assert.deepEqual(original.state, state);
  assert.equal(fresh.state.items[0].stage, "LEARNING");
  const edited = structuredClone(fresh.state);
  edited.weekendReview = { weekStart: "2026-09-14", characterIds: ["山"] };
  edited.dailySession = { date: "2026-09-16", pendingIds: [], retryIds: ["山"], completedIds: [] };
  edited.items[0].pinyin = "shān edited";
  const saved = await api.putProgress(request(`/api/account-progress?accountId=${account.id}`, { cookie, body: { state: edited, baseRevision: 1 } }), deps);
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).accountId, account.id);
  assert.deepEqual(deps.db.getProgress("default").state, state);
  assert.deepEqual(deps.db.getAccountProgress("default", account.id).state, edited);
  const duplicate = await api.createAccount(request("/api/accounts", { cookie, body: { name: "妹妹", sourceAccountId: "default" } }), deps);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, "ACCOUNT_NAME_EXISTS");
  assert.equal(deps.db.listAccounts("default").length, 2);
}));

test("rejects unknown and cross-family accounts for reads, writes, migration and creation", () => withDeps(async (deps, cookie) => {
  assert.equal(typeof api.createAccount, "function");
  deps.db.migrateProgress("default", state, now);
  deps.db.migrateProgress("other-family", state, now);
  const foreign = deps.db.createAccount("other-family", "别人的账户", "default", now);
  for (const id of [foreign.id, "unknown"]) {
    const path = `/api/account-progress?accountId=${id}`;
    assert.equal((await api.getProgress(request(path, { cookie }), deps)).status, 404);
    assert.equal((await api.putProgress(request(path, { cookie, body: { state, baseRevision: 1 } }), deps)).status, 404);
    assert.equal((await api.createAccount(request("/api/accounts", { cookie, body: { name: "妹妹", sourceAccountId: id } }), deps)).status, 404);
  }
  const account = deps.db.createAccount("default", "妹妹", "default", now);
  const migrated = await api.migrateProgress(request(`/api/progress/migrate?accountId=${account.id}`, { cookie, body: { state } }), deps);
  assert.equal(migrated.status, 400);
  assert.deepEqual(deps.db.getProgress("default").state, state);
  assert.equal(deps.db.getAccountProgress("default", account.id).revision, 1);
  assert.equal(deps.db.getAccountProgress("other-family", foreign.id).revision, 1);
}));

test("new-account routes require explicit identity and legacy routes never accept another learner", () => withDeps(async (deps, cookie) => {
  deps.db.migrateProgress("default", state, now);
  const account = deps.db.createAccount("default", "妹妹", "default", now);
  const original = deps.db.getProgress("default");
  for (const path of ["/api/account-progress", "/api/account-progress?accountId=", "/api/account-progress?accountId=default", `/api/progress?accountId=${account.id}`]) {
    assert.equal((await api.getProgress(request(path, { cookie }), deps)).status, 400);
    assert.equal((await api.putProgress(request(path, { cookie, body: { state, baseRevision: 1 } }), deps)).status, 400);
  }
  assert.deepEqual(deps.db.getProgress("default"), original);
  assert.equal(deps.db.getAccountProgress("default", account.id).revision, 1);
  const defaultResponse = await api.getProgress(request("/api/progress?accountId=default", { cookie }), deps);
  assert.equal(defaultResponse.status, 200);
  assert.equal((await defaultResponse.json()).accountId, "default");
}));

test("requires authentication, same-origin creation, valid names and a ready source", () => withDeps(async (deps, cookie) => {
  assert.equal(typeof api.listAccounts, "function");
  assert.equal(typeof api.createAccount, "function");
  assert.equal((await api.listAccounts(request("/api/accounts"), deps)).status, 401);
  assert.equal((await api.createAccount(request("/api/accounts", { body: { name: "妹妹", sourceAccountId: "default" } }), deps)).status, 401);
  const body = { name: "妹妹", sourceAccountId: "default" };
  assert.equal((await api.createAccount(request("/api/accounts", { cookie, body }), deps)).status, 409);
  deps.db.migrateProgress("default", state, now);
  assert.equal((await api.createAccount(request("/api/accounts", { cookie, body, origin: "https://attacker.example" }), deps)).status, 403);
  assert.equal((await api.createAccount(request("/api/accounts", { cookie, body, headers: { "content-length": String(5 * 1024 * 1024 + 1) } }), deps)).status, 413);
  for (const name of ["", " ", "字".repeat(21), null]) {
    assert.equal((await api.createAccount(request("/api/accounts", { cookie, body: { ...body, name } }), deps)).status, 400);
  }
  assert.equal((await api.createAccount(request("/api/accounts", { cookie, body: { name: "妹妹" } }), deps)).status, 400);
  assert.deepEqual(deps.db.listAccounts("default"), [{ id: "default", name: "原有账户" }]);
}));
