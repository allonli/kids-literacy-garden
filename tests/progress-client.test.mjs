import assert from "node:assert/strict";
import test from "node:test";

import { CONFLICT_STORAGE_KEY } from "../lib/progress-sync.mjs";
import { STORAGE_KEY } from "../lib/storage.mjs";
import { createProgressSyncController } from "../lib/progress-client.mjs";

function state(batchSize = 5, stage = "DAILY") {
  return {
    version: 1,
    settings: { batchSize, learningRepetitions: 3, dailyGoal: 3, weeklyGoal: 3, biweeklyGoal: 3, masteredSample: 2 },
    importWarnings: [],
    history: [],
    items: [{
      id: "山", char: "山", pinyin: "shān", stage, stageStreak: 1, learningCorrect: 3,
      unfamiliar: false, lastCountedDate: "2026-09-01", nextDue: "2026-09-02",
      words: ["大山"], customWords: [], hiddenWords: [],
    }],
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function response(body, status = 200) {
  return Response.json(body, { status });
}

test("migrates existing local progress when the authenticated server is empty", async () => {
  const original = state(7, "WEEKLY");
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(original) });
  const calls = [];
  const controller = createProgressSyncController({
    initialState: () => state(), storage,
    fetch: async (url, options = {}) => {
      calls.push([url, options]);
      if (url === "/api/progress") return response({ status: "empty" });
      return response({ status: "migrated", state: original, revision: 1, updatedAt: "2026-09-01T08:00:00.000Z" }, 201);
    },
  });

  await controller.start();

  assert.equal(controller.snapshot().access, "ready");
  assert.equal(controller.snapshot().sync.message, "旧学习进度已永久保存");
  assert.deepEqual(controller.snapshot().state, original);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), original);
  assert.equal(calls.filter(([url]) => url === "/api/progress/migrate").length, 1);
});

test("starts only once when React development effects run twice", async () => {
  const original = state(7);
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(original) });
  let requests = 0;
  const controller = createProgressSyncController({
    initialState: () => state(), storage,
    fetch: async (url) => {
      requests += 1;
      if (url === "/api/progress") return response({ status: "empty" });
      return response({ status: "migrated", state: original, revision: 1, updatedAt: "2026-09-01T08:00:00.000Z" }, 201);
    },
  });

  await Promise.all([controller.start(), controller.start()]);

  assert.equal(requests, 2);
});

test("never initializes an empty server from a blank browser automatically", async () => {
  const storage = memoryStorage();
  const calls = [];
  const controller = createProgressSyncController({
    initialState: () => state(), storage,
    fetch: async (url) => {
      calls.push(url);
      return response({ status: "empty" });
    },
  });

  await controller.start();

  assert.equal(controller.snapshot().access, "needs-original-device");
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.deepEqual(calls, ["/api/progress"]);
});

test("loads server progress into a new device local cache", async () => {
  const serverState = state(9, "MASTERED");
  const storage = memoryStorage();
  const controller = createProgressSyncController({
    initialState: () => state(), storage,
    fetch: async () => response({ status: "ready", state: serverState, revision: 4, updatedAt: "2026-09-01T08:00:00.000Z" }),
  });

  await controller.start();

  assert.equal(controller.snapshot().access, "ready");
  assert.equal(controller.snapshot().sync.revision, 4);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), serverState);
});

test("returns to saved status after a read-only network outage", async () => {
  const serverState = state(5);
  let failNext = false;
  const controller = createProgressSyncController({
    initialState: () => state(), storage: memoryStorage(),
    fetch: async () => {
      if (failNext) {
        failNext = false;
        throw new TypeError("offline");
      }
      return response({ status: "ready", state: serverState, revision: 3, updatedAt: "2026-09-01T08:00:00.000Z" });
    },
  });
  await controller.start();
  failNext = true;
  await controller.checkLatest();
  assert.equal(controller.snapshot().sync.phase, "offline");

  await controller.retry();
  assert.equal(controller.snapshot().sync.phase, "saved");
  assert.equal(controller.snapshot().sync.revision, 3);
});

test("saves locally while offline and uploads the latest snapshot on retry", async () => {
  const serverState = state(5);
  const storage = memoryStorage();
  let online = false;
  const controller = createProgressSyncController({
    initialState: () => state(), storage,
    fetch: async (url, options = {}) => {
      if (!options.method) return response({ status: "ready", state: serverState, revision: 1, updatedAt: "2026-09-01T08:00:00.000Z" });
      if (!online) throw new TypeError("offline");
      const submitted = JSON.parse(options.body);
      assert.equal(submitted.baseRevision, 1);
      assert.equal(submitted.state.settings.batchSize, 8);
      return response({ status: "ready", state: submitted.state, revision: 2, updatedAt: "2026-09-01T08:01:00.000Z" });
    },
  });
  await controller.start();

  await controller.update((current) => ({ ...current, settings: { ...current.settings, batchSize: 8 } }));
  assert.equal(controller.snapshot().sync.phase, "offline");
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).settings.batchSize, 8);

  online = true;
  await controller.retry();
  assert.equal(controller.snapshot().sync.phase, "saved");
  assert.equal(controller.snapshot().sync.revision, 2);
});

test("does not discard queued daily-list changes when a background read finishes during saving", async () => {
  const original = state();
  original.dailySession = { date: "2026-09-05", pendingIds: ["山"], retryIds: [], completedIds: [] };
  const storage = memoryStorage();
  const writes = [];
  let reads = 0;
  let finishRead;
  let finishFirstSave;
  const controller = createProgressSyncController({
    initialState: () => state(), storage,
    fetch: async (_url, options = {}) => {
      if (!options.method) {
        if (++reads === 1) return response({ status: "ready", state: original, revision: 1 });
        return new Promise((resolve) => { finishRead = resolve; });
      }
      const submitted = JSON.parse(options.body);
      writes.push(submitted);
      if (writes.length === 1) return new Promise((resolve) => { finishFirstSave = resolve; });
      return response({ status: "ready", state: submitted.state, revision: 3 });
    },
  });
  await controller.start();
  const checking = controller.checkLatest();
  const savingFirst = controller.update((current) => ({ ...current, weekendReview: { weekStart: "2026-08-31", characterIds: ["山"] } }));
  const savingSecond = controller.update((current) => ({ ...current, dailySession: { ...current.dailySession, pendingIds: [], retryIds: ["山"] } }));
  const latest = structuredClone(controller.snapshot().state);
  const firstSaved = { status: "ready", state: writes[0].state, revision: 2 };

  finishRead(response(firstSaved));
  await checking;
  assert.deepEqual(controller.snapshot().state, latest);
  assert.equal(controller.snapshot().sync.pending, true);
  finishFirstSave(response(firstSaved));
  await Promise.all([savingFirst, savingSecond]);

  assert.equal(writes.length, 2);
  assert.equal(writes[1].baseRevision, 2);
  assert.deepEqual(writes[1].state, latest);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), latest);
  assert.equal(controller.snapshot().sync.phase, "saved");
  assert.equal(controller.snapshot().sync.revision, 3);
});

test("does not start a background read while a save is in flight", async () => {
  let reads = 0;
  let finishSave;
  const controller = createProgressSyncController({
    initialState: () => state(), storage: memoryStorage(),
    fetch: async (_url, options = {}) => {
      if (!options.method) {
        reads += 1;
        return response({ status: "ready", state: state(), revision: 1 });
      }
      return new Promise((resolve) => { finishSave = resolve; });
    },
  });
  await controller.start();
  const saving = controller.update(state(8));
  const checking = controller.checkLatest();
  finishSave(response({ status: "ready", state: state(8), revision: 2 }));
  await Promise.all([saving, checking]);
  assert.equal(reads, 1);
  assert.equal(controller.snapshot().state.settings.batchSize, 8);
  assert.equal(controller.snapshot().sync.phase, "saved");
});

test("rejects stale local changes, keeps a conflict copy, and loads the server state", async () => {
  const original = state(5);
  const rejected = state(8);
  const authoritative = state(6, "TWO_WEEKLY");
  const storage = memoryStorage();
  let getCount = 0;
  const controller = createProgressSyncController({
    initialState: () => state(), storage,
    now: () => new Date("2026-09-01T08:02:00.000Z"),
    fetch: async (url, options = {}) => {
      if (!options.method) {
        getCount += 1;
        return getCount === 1
          ? response({ status: "ready", state: original, revision: 2, updatedAt: "2026-09-01T08:00:00.000Z" })
          : response({ status: "ready", state: authoritative, revision: 3, updatedAt: "2026-09-01T08:01:00.000Z" });
      }
      return response({ error: "另一台设备已有更新", code: "REVISION_CONFLICT", revision: 3 }, 409);
    },
  });
  await controller.start();

  await controller.update(rejected);

  assert.equal(controller.snapshot().sync.phase, "conflict");
  assert.deepEqual(controller.snapshot().state, authoritative);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), authoritative);
  assert.deepEqual(JSON.parse(storage.getItem(CONFLICT_STORAGE_KEY)).state, rejected);
});
