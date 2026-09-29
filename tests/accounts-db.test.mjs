import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { openProgressDb } from "../lib/server/progress-db.mjs";

const now = new Date("2026-09-16T08:00:00.000Z");
const sourceState = {
  version: 1,
  settings: { batchSize: 7, learningRepetitions: 3, dailyGoal: 3, weeklyGoal: 3, biweeklyGoal: 3, masteredSample: 2 },
  importWarnings: [],
  history: [{ char: "山", correct: true, kind: "list", at: now.toISOString() }],
  items: [{
    id: "山", char: "山", pinyin: "shān", stage: "MASTERED", stageStreak: 3, learningCorrect: 3,
    unfamiliar: false, lastCountedDate: "2026-09-16", nextDue: "2026-09-23",
    words: ["大山"], customWords: ["山河"], hiddenWords: ["高山"], editedWords: ["山水"],
  }, {
    id: "水", char: "水", pinyin: "shuǐ", stage: "DAILY", stageStreak: 1, learningCorrect: 3,
    unfamiliar: false, lastCountedDate: null, nextDue: "2026-09-17",
    words: ["山水"], customWords: [], hiddenWords: [], editedWords: [],
  }],
  weekendReview: { weekStart: "2026-09-14", characterIds: ["山"] },
  dailySession: { date: "2026-09-16", pendingIds: ["水"], retryIds: [], completedIds: ["山"] },
};

function withDatabase(run) {
  const directory = mkdtempSync(join(tmpdir(), "literacy-accounts-db-"));
  const path = join(directory, "progress.sqlite");
  const db = openProgressDb(path);
  try { return run(db, path); }
  finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("creating an account keeps the original table and resets only the new learner's progress", () => withDatabase((db, path) => {
  assert.equal(typeof db.createAccount, "function");
  db.migrateProgress("default", sourceState, now);
  const legacy = new DatabaseSync(path);
  const before = legacy.prepare("SELECT * FROM progress").all();
  const schema = legacy.prepare("SELECT sql FROM sqlite_master WHERE name = 'progress'").get().sql;
  const account = db.createAccount("default", "  妹妹  ", "default", now);
  assert.match(account.id, /^[0-9a-f-]{36}$/);
  assert.equal(account.name, "妹妹");
  const fresh = db.getAccountProgress("default", account.id);
  assert.equal(fresh.revision, 1);
  assert.deepEqual(fresh.state.settings, sourceState.settings);
  assert.deepEqual(fresh.state.history, []);
  assert.equal(fresh.state.dailySession, undefined);
  assert.equal(fresh.state.weekendReview, undefined);
  assert.equal(fresh.state.items.length, 2);
  for (const [index, item] of fresh.state.items.entries()) {
    assert.deepEqual(item, { ...sourceState.items[index], stage: "LEARNING", stageStreak: 0, learningCorrect: 0, unfamiliar: true, lastCountedDate: null, nextDue: null });
  }
  assert.deepEqual(legacy.prepare("SELECT * FROM progress").all(), before);
  assert.equal(legacy.prepare("SELECT sql FROM sqlite_master WHERE name = 'progress'").get().sql, schema);
  // 旧程序继续只更新 progress 表，不会覆盖新账户。
  legacy.prepare("UPDATE progress SET revision = revision + 1 WHERE family_id = ?").run("default");
  assert.equal(db.getAccountProgress("default", "default").revision, 2);
  assert.equal(db.getAccountProgress("default", account.id).revision, 1);
  legacy.close();
}));

test("account revisions and all study fields stay isolated even at identical revisions", () => withDatabase((db) => {
  assert.equal(typeof db.createAccount, "function");
  db.migrateProgress("default", sourceState, now);
  const account = db.createAccount("default", "弟弟", "default", now);
  const original = db.getProgress("default");
  const changed = structuredClone(sourceState);
  changed.items[0].pinyin = "shān edited";
  changed.items[0].editedWords = [];
  changed.settings.batchSize = 11;
  changed.weekendReview.characterIds = ["水"];
  changed.dailySession = { date: "2026-09-16", pendingIds: [], retryIds: ["山"], completedIds: ["水"] };
  const saved = db.updateAccountProgress("default", account.id, changed, 1, now);
  assert.equal(saved.ok, true);
  assert.equal(saved.progress.revision, 2);
  assert.deepEqual(db.getProgress("default"), original);
  assert.deepEqual(db.getAccountProgress("default", account.id).state, changed);
  const stale = db.updateAccountProgress("default", account.id, sourceState, 1, now);
  assert.equal(stale.ok, false);
  assert.deepEqual(db.getAccountProgress("default", account.id).state, changed);
  assert.equal(db.getAccountProgress("other-family", account.id), null);
  assert.equal(db.updateAccountProgress("other-family", account.id, sourceState, 2, now).ok, false);
  assert.deepEqual(db.listAccounts("other-family"), [{ id: "default", name: "原有账户" }]);
}));

test("accounts survive reopening and creation uses the selected account's latest dictionary", () => {
  const directory = mkdtempSync(join(tmpdir(), "literacy-accounts-reopen-"));
  const path = join(directory, "progress.sqlite");
  const db = openProgressDb(path);
  assert.equal(typeof db.createAccount, "function");
  db.migrateProgress("default", sourceState, now);
  const first = db.createAccount("default", "妹妹", "default", now);
  const changed = structuredClone(sourceState);
  changed.items[0].pinyin = "shān latest";
  changed.items[0].customWords = ["山林"];
  db.updateAccountProgress("default", first.id, changed, 1, now);
  db.close();
  const reopened = openProgressDb(path);
  try {
    assert.deepEqual(reopened.listAccounts("default"), [{ id: "default", name: "原有账户" }, first]);
    const second = reopened.createAccount("default", "弟弟", first.id, now);
    const copied = reopened.getAccountProgress("default", second.id).state;
    assert.equal(copied.items[0].pinyin, "shān latest");
    assert.deepEqual(copied.items[0].customWords, ["山林"]);
    assert.equal(copied.items[0].stage, "LEARNING");
    assert.deepEqual(reopened.getProgress("default").state, sourceState);
  } finally { reopened.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("rejects duplicate or invalid names and unavailable source accounts without partial records", () => withDatabase((db) => {
  assert.equal(typeof db.createAccount, "function");
  assert.throws(() => db.createAccount("default", "妹妹", "default", now), (error) => error.code === "SOURCE_NOT_READY");
  db.migrateProgress("default", sourceState, now);
  const first = db.createAccount("default", "妹妹", "default", now);
  for (const name of ["妹妹", " 妹妹 ", "原有账户"]) {
    assert.throws(() => db.createAccount("default", name, "default", now), (error) => error.code === "ACCOUNT_NAME_EXISTS");
  }
  for (const name of ["", "  ", "字".repeat(21), null, 123]) {
    assert.throws(() => db.createAccount("default", name, "default", now), /账户名称/);
  }
  assert.throws(() => db.createAccount("other-family", "他人", first.id, now), (error) => error.code === "ACCOUNT_NOT_FOUND");
  assert.deepEqual(db.listAccounts("default"), [{ id: "default", name: "原有账户" }, first]);
}));
