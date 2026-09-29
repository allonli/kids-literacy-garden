import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import { assertLiteracyState } from "../progress-state.mjs";
import { DEFAULT_ACCOUNT_ID, DEFAULT_ACCOUNT_NAME, createFreshAccountState, normalizeAccountName } from "../learning-accounts.mjs";

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapProgress(row) {
  if (!row) return null;
  return {
    state: assertLiteracyState(JSON.parse(row.state_json)),
    revision: Number(row.revision),
    updatedAt: row.updated_at,
  };
}

function mapSession(row) {
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    familyId: row.family_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
}

export function openProgressDb(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      family_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_sessions (
      token_hash TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS device_sessions_expires_at ON device_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS learning_accounts (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL,
      name TEXT NOT NULL,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (family_id, name)
    );
  `);

  const selectProgress = database.prepare("SELECT state_json, revision, updated_at FROM progress WHERE family_id = ?");
  const insertProgress = database.prepare("INSERT INTO progress (family_id, state_json, revision, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(family_id) DO NOTHING");
  const updateProgressRow = database.prepare("UPDATE progress SET state_json = ?, revision = revision + 1, updated_at = ? WHERE family_id = ? AND revision = ?");
  const insertSession = database.prepare(`
    INSERT OR REPLACE INTO device_sessions (token_hash, family_id, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const selectSession = database.prepare(`
    SELECT token_hash, family_id, created_at, last_seen_at, expires_at
    FROM device_sessions WHERE token_hash = ? AND expires_at > ?
  `);
  const updateSession = database.prepare("UPDATE device_sessions SET last_seen_at = ? WHERE token_hash = ?");
  const selectAccounts = database.prepare("SELECT id, name FROM learning_accounts WHERE family_id = ? ORDER BY created_at, rowid");
  const selectAccountProgress = database.prepare("SELECT state_json, revision, updated_at FROM learning_accounts WHERE family_id = ? AND id = ?");
  const insertAccount = database.prepare(`
    INSERT INTO learning_accounts (id, family_id, name, state_json, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(family_id, name) DO NOTHING
  `);
  const updateAccountRow = database.prepare("UPDATE learning_accounts SET state_json = ?, revision = revision + 1, updated_at = ? WHERE family_id = ? AND id = ? AND revision = ?");

  function getProgress(familyId) {
    return mapProgress(selectProgress.get(familyId));
  }

  function getAccountProgress(familyId, accountId) {
    return accountId === DEFAULT_ACCOUNT_ID ? getProgress(familyId) : mapProgress(selectAccountProgress.get(familyId, accountId));
  }

  function updateProgress(familyId, state, baseRevision, now) {
    assertLiteracyState(state);
    const result = updateProgressRow.run(JSON.stringify(state), iso(now), familyId, baseRevision);
    const progress = getProgress(familyId);
    if (result.changes === 1) return { ok: true, progress };
    return { ok: false, conflict: { revision: progress?.revision ?? 0, updatedAt: progress?.updatedAt ?? null } };
  }

  return {
    getProgress,
    getAccountProgress,
    updateProgress,

    exportFamilySnapshot(familyId) {
      // 仅在读事务中取得同一时刻的全部账户，不更新任何成绩、版本或会话。
      database.exec("BEGIN");
      try {
        const accounts = [{ id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME }, ...selectAccounts.all(familyId)];
        const snapshot = accounts.flatMap((account) => {
          const progress = getAccountProgress(familyId, account.id);
          return progress ? [{ ...account, ...progress }] : [];
        });
        database.exec("COMMIT");
        return snapshot;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },

    listAccounts(familyId) {
      return [{ id: DEFAULT_ACCOUNT_ID, name: DEFAULT_ACCOUNT_NAME }, ...selectAccounts.all(familyId).map(({ id, name }) => ({ id, name }))];
    },

    createAccount(familyId, value, sourceAccountId, now) {
      const name = normalizeAccountName(value);
      if (name === DEFAULT_ACCOUNT_NAME) {
        throw Object.assign(new Error("这个账户名称已存在，请换一个名称"), { status: 409, code: "ACCOUNT_NAME_EXISTS" });
      }
      // 一次事务同时固定源字库并写入账户，失败时不留下空账户。
      database.exec("BEGIN IMMEDIATE");
      try {
        const source = getAccountProgress(familyId, sourceAccountId);
        if (!source) {
          throw Object.assign(new Error(sourceAccountId === DEFAULT_ACCOUNT_ID ? "请先保存原有账户的学习进度" : "学习账户不存在"), {
            status: sourceAccountId === DEFAULT_ACCOUNT_ID ? 409 : 404,
            code: sourceAccountId === DEFAULT_ACCOUNT_ID ? "SOURCE_NOT_READY" : "ACCOUNT_NOT_FOUND",
          });
        }
        const fresh = assertLiteracyState(createFreshAccountState(source.state));
        const id = randomUUID();
        const timestamp = iso(now);
        const result = insertAccount.run(id, familyId, name, JSON.stringify(fresh), timestamp, timestamp);
        if (result.changes !== 1) {
          throw Object.assign(new Error("这个账户名称已存在，请换一个名称"), { status: 409, code: "ACCOUNT_NAME_EXISTS" });
        }
        database.exec("COMMIT");
        return { id, name };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },

    updateAccountProgress(familyId, accountId, state, baseRevision, now) {
      if (accountId === DEFAULT_ACCOUNT_ID) return updateProgress(familyId, state, baseRevision, now);
      assertLiteracyState(state);
      const result = updateAccountRow.run(JSON.stringify(state), iso(now), familyId, accountId, baseRevision);
      const progress = getAccountProgress(familyId, accountId);
      if (result.changes === 1) return { ok: true, progress };
      return { ok: false, conflict: { revision: progress?.revision ?? 0, updatedAt: progress?.updatedAt ?? null } };
    },

    migrateProgress(familyId, state, now) {
      assertLiteracyState(state);
      const result = insertProgress.run(familyId, JSON.stringify(state), iso(now));
      return { created: result.changes === 1, progress: getProgress(familyId) };
    },

    createSession(tokenHash, familyId, createdAt, expiresAt) {
      const created = iso(createdAt);
      insertSession.run(tokenHash, familyId, created, created, iso(expiresAt));
    },

    getSession(tokenHash, now) {
      return mapSession(selectSession.get(tokenHash, iso(now)));
    },

    touchSession(tokenHash, now) {
      updateSession.run(iso(now), tokenHash);
    },

    close() {
      database.close();
    },
  };
}
