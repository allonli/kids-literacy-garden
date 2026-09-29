import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFLICT_STORAGE_KEY,
  EMPTY_SYNC_META,
  SYNC_STORAGE_KEY,
  clearConflictSnapshot,
  loadSyncMeta,
  reduceSyncMeta,
  saveConflictSnapshot,
  saveSyncMeta,
} from "../lib/progress-sync.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("queues offline work without losing the confirmed revision", () => {
  const queued = reduceSyncMeta({ ...EMPTY_SYNC_META, revision: 7, phase: "saved" }, { type: "QUEUE" });
  const offline = reduceSyncMeta(queued, { type: "OFFLINE" });

  assert.deepEqual(offline, {
    revision: 7,
    pending: true,
    phase: "offline",
    lastSavedAt: null,
    message: "网络断开，等待同步",
  });
});

test("clears pending only after the server confirms a new revision", () => {
  const result = reduceSyncMeta(
    { ...EMPTY_SYNC_META, revision: 7, pending: true, phase: "saving" },
    { type: "SAVED", revision: 8, at: "2026-09-01T08:00:00.000Z" },
  );

  assert.deepEqual(result, {
    revision: 8,
    pending: false,
    phase: "saved",
    lastSavedAt: "2026-09-01T08:00:00.000Z",
    message: "已永久保存",
  });
});

test("round-trips valid metadata and falls back from malformed JSON", () => {
  const storage = memoryStorage();
  const meta = { ...EMPTY_SYNC_META, revision: 4, phase: "saved", lastSavedAt: "2026-09-01T08:00:00.000Z" };
  saveSyncMeta(meta, storage);
  assert.deepEqual(loadSyncMeta(storage), meta);

  storage.setItem(SYNC_STORAGE_KEY, "not-json");
  assert.deepEqual(loadSyncMeta(storage), EMPTY_SYNC_META);
});

test("keeps and clears the last rejected snapshot separately", () => {
  const storage = memoryStorage();
  const snapshot = { state: { version: 1 }, detectedAt: "2026-09-01T08:00:00.000Z", serverRevision: 9 };
  saveConflictSnapshot(snapshot, storage);
  assert.deepEqual(JSON.parse(storage.getItem(CONFLICT_STORAGE_KEY)), snapshot);
  clearConflictSnapshot(storage);
  assert.equal(storage.getItem(CONFLICT_STORAGE_KEY), null);
});
