import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openProgressDb } from "../lib/server/progress-db.mjs";
import { createDeviceToken } from "../lib/server/family-auth.mjs";
import { createLoginRateLimiter } from "../lib/server/login-rate-limit.mjs";
import { createBackupStore } from "../lib/server/ios-backup-store.mjs";
import { convertAccounts } from "../lib/server/ios-backup-codec.mjs";
import { createBackup, getBackupStatus, revokeBackup, downloadBackup } from "../lib/server/ios-backup-api.mjs";

const now = new Date("2026-09-29T12:00:00Z");
const state = {
  version: 1,
  settings: { batchSize: 2, learningRepetitions: 3, dailyGoal: 3, weeklyGoal: 3, biweeklyGoal: 3, masteredSample: 2 },
  importWarnings: [],
  items: [{ id: "bridge", char: "桥", pinyin: "qiáo", stage: "DAILY", stageStreak: 1, learningCorrect: 3,
    unfamiliar: false, lastCountedDate: "2026-09-29", nextDue: "2026-09-30", words: ["木桥"], customWords: [], hiddenWords: [], editedWords: [] }],
  history: [{ char: "桥", correct: true, kind: "list", at: "2026-09-29T10:00:00.333Z" }],
  dailySession: { date: "2026-09-29", pendingIds: [], retryIds: [], completedIds: ["bridge"] },
  weekendReview: { weekStart: "2026-09-28", characterIds: ["bridge"] },
};

function request(method = "POST", cookie, origin = "https://z.allon.me") {
  return new Request("https://z.allon.me/api/ios-backups", { method, headers: { ...(cookie ? { cookie } : {}), origin } });
}

async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "garden-ios-backup-"));
  const db = openProgressDb(join(directory, "progress.sqlite"));
  const session = createDeviceToken(), otherSession = createDeviceToken();
  db.createSession(session.hash, "default", now, new Date("2026-10-03T00:00:00Z"));
  db.createSession(otherSession.hash, "other", now, new Date("2026-10-03T00:00:00Z"));
  db.migrateProgress("default", structuredClone(state), now);
  db.migrateProgress("other", { ...structuredClone(state), history: [] }, now);
  const child = db.createAccount("default", "Test Flower", "default", now);
  const deps = { db, backupStore: createBackupStore(join(directory, "private")), backupRateLimiter: createLoginRateLimiter({ maxFailures: 3 }), now: () => now, production: true };
  try { await run({ deps, directory, child, cookie: `kids_literacy_device=${session.raw}`, otherCookie: `kids_literacy_device=${otherSession.raw}` }); }
  finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
}

test("backup preserves all family profiles, progress, empty words, history and queues without database mutation", () => fixture(async ({ deps, cookie, child, directory }) => {
  const before = deps.db.getProgress("default");
  const second = deps.db.getAccountProgress("default", child.id);
  const result = await createBackup(request("POST", cookie), deps);
  assert.equal(result.status, 201);
  const created = await result.json();
  assert.match(created.path, /^\/api\/ios-backups\/[a-f0-9]{64}$/);
  assert.equal(created.profiles.length, 2);
  const downloaded = await downloadBackup(created.path.split("/").at(-1), deps);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("cache-control"), "no-store");
  const document = await downloaded.json();
  assert.equal(document.version, 1);
  assert.equal(document.profiles.length, 2);
  const profile = document.profiles[0], item = profile.items[0];
  assert.equal(item.progress.stage, "DAILY");
  assert.equal(item.progress.nextReview, "2026-09-30");
  assert.deepEqual(item.seed.words, []);
  assert.equal(item.seed.wordsEdited, true);
  assert.equal(profile.history[0].source, "today");
  assert.deepEqual(profile.daily.completed, [item.seed.id]);
  assert.deepEqual(profile.weekend.itemIDs, [item.seed.id]);
  assert.equal(document.source.origin, "https://z.allon.me");
  assert.equal(document.source.profiles[0].revision, 1);
  assert.equal(document.source.profiles[0].profileID, profile.id);
  assert.equal(document.profiles[1].items[0].progress.stage, "LEARNING");
  assert.deepEqual(deps.db.getProgress("default"), before);
  assert.deepEqual(deps.db.getAccountProgress("default", child.id), second);
  assert.equal(statSync(join(directory, "private")).mode & 0o777, 0o700);
  for (const file of readdirSync(join(directory, "private"))) assert.equal(statSync(join(directory, "private", file)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(document).includes("kids_literacy_device"), false);
  assert.equal(JSON.stringify(document).includes(created.path), false);
}));

test("creation and revocation require session, origin, and rate limiting", () => fixture(async ({ deps, cookie }) => {
  assert.equal((await createBackup(request(), deps)).status, 401);
  assert.equal((await getBackupStatus(request("GET"), deps)).status, 401);
  assert.equal((await revokeBackup(request("DELETE"), deps)).status, 401);
  assert.equal((await createBackup(request("POST", cookie, "https://other.example"), deps)).status, 403);
  assert.equal((await revokeBackup(request("DELETE", cookie, "https://other.example"), deps)).status, 403);
  for (let i = 0; i < 3; i++) assert.equal((await createBackup(request("POST", cookie), deps)).status, 201);
  const limited = await createBackup(request("POST", cookie), deps);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
}));

test("temporary link survives restart, expires, and newer generation revokes previous link", () => fixture(async ({ deps, cookie, directory }) => {
  const first = await (await createBackup(request("POST", cookie), deps)).json();
  const firstToken = first.path.split("/").at(-1);
  deps.backupStore = createBackupStore(join(directory, "private"));
  assert.equal((await downloadBackup(firstToken, deps)).status, 200);
  const second = await (await createBackup(request("POST", cookie), deps)).json();
  assert.equal((await downloadBackup(firstToken, deps)).status, 404);
  deps.now = () => new Date(now.getTime() + 24 * 60 * 60 * 1000);
  assert.equal((await downloadBackup(second.path.split("/").at(-1), deps)).status, 404);
  assert.equal((await downloadBackup("../../progress.sqlite", deps)).status, 404);
}));

test("families cannot view or revoke each other's backup and tokens are not listed", () => fixture(async ({ deps, cookie, otherCookie }) => {
  const first = await (await createBackup(request("POST", cookie), deps)).json();
  const token = first.path.split("/").at(-1);
  const status = await (await getBackupStatus(request("GET", otherCookie), deps)).json();
  assert.equal(status.active, false);
  assert.equal((await revokeBackup(request("DELETE", otherCookie), deps)).status, 200);
  assert.equal((await downloadBackup(token, deps)).status, 200);
  const own = await (await getBackupStatus(request("GET", cookie), deps)).json();
  assert.equal(own.active, true);
  assert.equal(JSON.stringify(own).includes(token), false);
  await revokeBackup(request("DELETE", cookie), deps);
  assert.equal((await downloadBackup(token, deps)).status, 404);
}));

test("source identity survives rename or account ordering and content backup id is stable", () => {
  const accounts = [{ id: "default", name: "原有账户", state: structuredClone(state), revision: 9 }, { id: "stable-child", name: "Test", state: structuredClone(state), revision: 4 }];
  const one = convertAccounts(accounts, { familyId: "family-a", exportedAt: now });
  const two = convertAccounts(accounts, { familyId: "family-a", exportedAt: new Date("2026-09-30T00:00:00Z") });
  assert.equal(one.id, two.id);
  const reordered = convertAccounts([{ ...accounts[1], name: "Renamed" }, accounts[0]], { familyId: "family-a", exportedAt: now });
  assert.equal(one.source.profiles[1].sourceID, reordered.source.profiles[0].sourceID);
  assert.notEqual(one.source.profiles[0].sourceID, convertAccounts(accounts, { familyId: "family-b", exportedAt: now }).source.profiles[0].sourceID);
});

test("Node backup matches the Python iOS converter golden fixture exactly", () => {
  const original = JSON.parse(readFileSync(new URL("./fixtures/website-backup-source.json", import.meta.url), "utf8"));
  const expected = JSON.parse(readFileSync(new URL("./fixtures/ios-backup-v1.json", import.meta.url), "utf8"));
  const { source, ...actual } = convertAccounts(original.accounts, { familyId: "synthetic-family", exportedAt: new Date(expected.exportedAt) });
  assert.equal(source.profiles.length, expected.profiles.length);
  assert.deepEqual(actual, expected);
});

test("rejects website values that the App cannot safely import instead of issuing a broken link", () => {
  for (const mutate of [
    (s) => { s.settings.batchSize = 21; },
    (s) => { s.items[0].char = "x"; },
    (s) => { s.items[0].learningCorrect = 1_000_001; },
    (s) => { s.items[0].nextDue = "2026-02-30"; },
    (s) => { s.history[0].correct = "yes"; },
    (s) => { s.history[0].at = "2026-09-29T10:00:00"; },
    (s) => { s.weekendReview.weekStart = "2026-09-29"; },
  ]) {
    const invalid = structuredClone(state); mutate(invalid);
    assert.throws(() => convertAccounts([{ id: "default", name: "Test", state: invalid, revision: 1 }], { familyId: "synthetic", exportedAt: now }));
  }
});
