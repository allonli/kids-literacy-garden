import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openProgressDb } from "../lib/server/progress-db.mjs";
import { hashFamilyCode } from "../lib/server/family-auth.mjs";
import { createLoginRateLimiter } from "../lib/server/login-rate-limit.mjs";
import { getProgress, login, migrateProgress, putProgress } from "../lib/server/progress-api.mjs";
import { createProgressSyncController } from "../lib/progress-client.mjs";
import { STORAGE_KEY } from "../lib/storage.mjs";

const validState = {
  version: 1,
  settings: { batchSize: 5, learningRepetitions: 3, dailyGoal: 3, weeklyGoal: 3, biweeklyGoal: 3, masteredSample: 2 },
  importWarnings: [],
  history: [],
  items: [{
    id: "山", char: "山", pinyin: "shān", stage: "DAILY", stageStreak: 1, learningCorrect: 3,
    unfamiliar: false, lastCountedDate: "2026-09-01", nextDue: "2026-09-02",
    words: ["大山"], customWords: [], hiddenWords: [],
  }],
};

async function withDeps(run) {
  const directory = mkdtempSync(join(tmpdir(), "literacy-api-"));
  const db = openProgressDb(join(directory, "progress.sqlite"));
  const deps = {
    db,
    familyCodeHash: await hashFamilyCode("482731", Buffer.alloc(16, 9)),
    rateLimiter: createLoginRateLimiter({ maxFailures: 5, windowMs: 600_000 }),
    production: true,
    now: () => new Date("2026-09-01T08:00:00.000Z"),
  };
  try {
    return await run(deps);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

function request(path, { body, cookie, origin = "https://z.allon.me", headers = {} } = {}) {
  return new Request(`https://z.allon.me${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function authenticatedCookie(deps) {
  const response = await login(request("/api/auth/login", { body: { code: "482731" } }), deps);
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

test("login sets a protected cookie without returning the family code", () => withDeps(async (deps) => {
  const response = await login(request("/api/auth/login", { body: { code: "482731" } }), deps);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /kids_literacy_device=/);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.doesNotMatch(text, /482731/);
}));

test("requires an unexpired device session for progress", () => withDeps(async (deps) => {
  const response = await getProgress(request("/api/progress"), deps);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "请先输入家庭码", code: "LOGIN_REQUIRED" });
}));

test("an empty server migrates the original local state only once", () => withDeps(async (deps) => {
  const cookie = await authenticatedCookie(deps);
  const first = await migrateProgress(request("/api/progress/migrate", { body: { state: validState }, cookie }), deps);
  const changedState = structuredClone(validState);
  changedState.settings.batchSize = 8;
  const second = await migrateProgress(request("/api/progress/migrate", { body: { state: changedState }, cookie }), deps);

  assert.equal(first.status, 201);
  assert.equal((await first.json()).status, "migrated");
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).state, validState);
}));

test("a stale save returns 409 and preserves the authoritative progress", () => withDeps(async (deps) => {
  const cookie = await authenticatedCookie(deps);
  await migrateProgress(request("/api/progress/migrate", { body: { state: validState }, cookie }), deps);
  const changedState = structuredClone(validState);
  changedState.settings.batchSize = 9;
  const saved = await putProgress(request("/api/progress", { body: { state: changedState, baseRevision: 1 }, cookie }), deps);
  const stale = await putProgress(request("/api/progress", { body: { state: validState, baseRevision: 1 }, cookie }), deps);

  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 2);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).revision, 2);
  assert.deepEqual((await (await getProgress(request("/api/progress", { cookie }), deps)).json()).state, changedState);
}));

test("round-trips edited words and study lists through the sync client and SQLite", () => withDeps(async (deps) => {
  const cookie = await authenticatedCookie(deps);
  const values = new Map([[STORAGE_KEY, JSON.stringify(validState)]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const fetchProgress = (path, options = {}) => {
    const incoming = request(path, { cookie, body: options.body ? JSON.parse(options.body) : undefined });
    if (path.endsWith("/migrate")) return migrateProgress(incoming, deps);
    return options.method === "PUT" ? putProgress(incoming, deps) : getProgress(incoming, deps);
  };
  const controller = createProgressSyncController({ initialState: () => validState, storage, fetch: fetchProgress });
  await controller.start();
  const updated = structuredClone(validState);
  updated.items[0].editedWords = ["山河", "大山"];
  updated.weekendReview = { weekStart: "2026-08-31", characterIds: ["山"] };
  updated.dailySession = { date: "2026-09-05", pendingIds: [], retryIds: ["山"], completedIds: [] };
  await controller.update(updated);
  assert.equal(controller.snapshot().sync.phase, "saved");
  assert.deepEqual(deps.db.getProgress("default").state, updated);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), updated);

  const reloaded = createProgressSyncController({ initialState: () => validState, storage, fetch: fetchProgress });
  await reloaded.start();
  assert.deepEqual(reloaded.snapshot().state, updated);
  const cleared = structuredClone(updated);
  cleared.items[0].editedWords = [];
  cleared.dailySession = { ...cleared.dailySession, retryIds: [], completedIds: ["山"] };
  await reloaded.update(cleared);
  assert.deepEqual(deps.db.getProgress("default").state, cleared);

  const malformed = { ...cleared, dailySession: { ...cleared.dailySession, retryIds: "山" } };
  const rejected = await putProgress(request("/api/progress", { cookie, body: { state: malformed, baseRevision: 3 } }), deps);
  assert.equal(rejected.status, 400);
  assert.equal(deps.db.getProgress("default").revision, 3);
  assert.deepEqual(deps.db.getProgress("default").state, cleared);
}));

test("rejects cross-origin, malformed, and oversized writes", () => withDeps(async (deps) => {
  const cookie = await authenticatedCookie(deps);
  const crossOrigin = await migrateProgress(request("/api/progress/migrate", {
    body: { state: validState }, cookie, origin: "https://attacker.example",
  }), deps);
  const malformed = await migrateProgress(request("/api/progress/migrate", { body: { state: {} }, cookie }), deps);
  const oversized = await migrateProgress(request("/api/progress/migrate", {
    body: { state: validState }, cookie, headers: { "content-length": String(5 * 1024 * 1024 + 1) },
  }), deps);

  assert.equal(crossOrigin.status, 403);
  assert.equal(malformed.status, 400);
  assert.equal(oversized.status, 413);
}));

test("rate-limits the sixth failed family-code attempt", () => withDeps(async (deps) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await login(request("/api/auth/login", { body: { code: "000000" } }), deps);
    assert.equal(response.status, 401);
  }
  const blocked = await login(request("/api/auth/login", { body: { code: "000000" } }), deps);
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers.get("retry-after"), /^\d+$/);
}));
