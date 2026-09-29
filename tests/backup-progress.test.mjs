import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import { openProgressDb } from "../lib/server/progress-db.mjs";
import { backupProgress, isSameExecutable } from "../scripts/backup-progress.mjs";

const validState = {
  version: 1,
  settings: { batchSize: 5, learningRepetitions: 3, dailyGoal: 3, weeklyGoal: 3, biweeklyGoal: 3, masteredSample: 2 },
  importWarnings: [], history: [],
  items: [{
    id: "山", char: "山", pinyin: "shān", stage: "WEEKLY", stageStreak: 2, learningCorrect: 3,
    unfamiliar: false, lastCountedDate: "2026-09-01", nextDue: "2026-09-08",
    words: ["大山"], customWords: [], hiddenWords: [],
  }],
};

test("restores every learning account from a complete backup and prunes only expired managed files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "literacy-backup-"));
  const databasePath = join(directory, "progress.sqlite");
  const backupDirectory = join(directory, "backups");
  mkdirSync(backupDirectory);
  const expiredManagedBackup = join(backupDirectory, "progress-20260701-000000.sqlite");
  const recentManagedBackup = join(backupDirectory, "progress-20260820-000000.sqlite");
  const unrelatedFile = join(backupDirectory, "notes.txt");
  writeFileSync(expiredManagedBackup, "expired");
  writeFileSync(recentManagedBackup, "recent");
  writeFileSync(unrelatedFile, "keep");

  const db = openProgressDb(databasePath);
  db.migrateProgress("default", validState, new Date("2026-09-01T08:00:00.000Z"));
  const account = db.createAccount("default", "妹妹", "default", new Date("2026-09-01T09:00:00.000Z"));
  const accountState = db.getAccountProgress("default", account.id).state;
  accountState.items[0].pinyin = "shān edited";
  accountState.items[0].editedWords = [];
  accountState.weekendReview = { weekStart: "2026-08-31", characterIds: ["山"] };
  accountState.dailySession = { date: "2026-09-01", pendingIds: [], retryIds: ["山"], completedIds: [] };
  db.updateAccountProgress("default", account.id, accountState, 1, new Date("2026-09-01T09:01:00.000Z"));
  const originalProgress = db.getProgress("default");
  const accountProgress = db.getAccountProgress("default", account.id);
  db.close();

  try {
    const result = await backupProgress({
      databasePath,
      backupDirectory,
      now: new Date("2026-09-02T08:09:10.000Z"),
      keepDays: 30,
    });

    assert.equal(basename(result.backupPath), "progress-20260902-080910.sqlite");
    const restored = openProgressDb(result.backupPath);
    assert.deepEqual(restored.getProgress("default"), originalProgress);
    assert.deepEqual(restored.listAccounts("default"), [{ id: "default", name: "原有账户" }, account]);
    assert.deepEqual(restored.getAccountProgress("default", account.id), accountProgress);
    restored.close();
    assert.equal(existsSync(expiredManagedBackup), false);
    assert.equal(existsSync(recentManagedBackup), true);
    assert.equal(existsSync(unrelatedFile), true);
    assert.deepEqual(result.removed, [expiredManagedBackup]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recognizes the backup entrypoint when the release directory is a symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "literacy-backup-link-"));
  const releaseDirectory = join(directory, "release");
  const currentDirectory = join(directory, "current");
  mkdirSync(releaseDirectory);
  writeFileSync(join(releaseDirectory, "backup-progress.mjs"), "// fixture");

  try {
    symlinkSync(releaseDirectory, currentDirectory, "junction");
    assert.equal(
      isSameExecutable(
        join(currentDirectory, "backup-progress.mjs"),
        join(releaseDirectory, "backup-progress.mjs"),
      ),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
