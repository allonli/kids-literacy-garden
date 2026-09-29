import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openProgressDb } from "../lib/server/progress-db.mjs";

const validState = {
  version: 1,
  settings: { batchSize: 5, learningRepetitions: 3, dailyGoal: 3, weeklyGoal: 3, biweeklyGoal: 3, masteredSample: 2 },
  importWarnings: [],
  history: [],
  items: [{
    id: "山", char: "山", pinyin: "shān", stage: "DAILY", stageStreak: 1, learningCorrect: 3,
    unfamiliar: false, lastCountedDate: "2026-09-01", nextDue: "2026-09-02",
    words: ["大山"], customWords: ["山水"], hiddenWords: [],
  }],
};

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), "literacy-db-"));
  const databasePath = join(directory, "progress.sqlite");
  try {
    return run(databasePath);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("migrates exactly once and round-trips the complete state", () => withDatabase((databasePath) => {
  const db = openProgressDb(databasePath);
  const changedState = structuredClone(validState);
  changedState.items[0].stage = "MASTERED";

  const first = db.migrateProgress("default", validState, new Date("2026-09-01T08:00:00.000Z"));
  const second = db.migrateProgress("default", changedState, new Date("2026-09-01T09:00:00.000Z"));

  assert.equal(first.created, true);
  assert.equal(first.progress.revision, 1);
  assert.equal(second.created, false);
  assert.deepEqual(db.getProgress("default").state, validState);
  db.close();
}));

test("increments matching revisions and rejects stale revisions without changing data", () => withDatabase((databasePath) => {
  const db = openProgressDb(databasePath);
  const changedState = structuredClone(validState);
  changedState.settings.batchSize = 7;
  db.migrateProgress("default", validState, new Date("2026-09-01T08:00:00.000Z"));

  const saved = db.updateProgress("default", changedState, 1, new Date("2026-09-01T09:00:00.000Z"));
  const stale = db.updateProgress("default", validState, 1, new Date("2026-09-01T10:00:00.000Z"));

  assert.equal(saved.ok, true);
  assert.equal(saved.progress.revision, 2);
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict.revision, 2);
  assert.deepEqual(db.getProgress("default").state, changedState);
  db.close();
}));

test("persists progress after closing and reopening the database", () => withDatabase((databasePath) => {
  const first = openProgressDb(databasePath);
  first.migrateProgress("default", validState, new Date("2026-09-01T08:00:00.000Z"));
  first.close();

  const reopened = openProgressDb(databasePath);
  assert.deepEqual(reopened.getProgress("default"), {
    state: validState,
    revision: 1,
    updatedAt: "2026-09-01T08:00:00.000Z",
  });
  reopened.close();
}));

test("returns only unexpired device sessions", () => withDatabase((databasePath) => {
  const db = openProgressDb(databasePath);
  db.createSession(
    "token-hash",
    "default",
    new Date("2026-09-01T08:00:00.000Z"),
    new Date("2026-09-02T08:00:00.000Z"),
  );

  assert.deepEqual(db.getSession("token-hash", new Date("2026-09-02T07:59:59.000Z")), {
    tokenHash: "token-hash",
    familyId: "default",
    createdAt: "2026-09-01T08:00:00.000Z",
    lastSeenAt: "2026-09-01T08:00:00.000Z",
    expiresAt: "2026-09-02T08:00:00.000Z",
  });
  assert.equal(db.getSession("token-hash", new Date("2026-09-02T08:00:00.000Z")), null);
  db.close();
}));
