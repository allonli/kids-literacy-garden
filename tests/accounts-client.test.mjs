import assert from "node:assert/strict";
import test from "node:test";

import { createProgressSyncController } from "../lib/progress-client.mjs";
import { CONFLICT_STORAGE_KEY, SYNC_STORAGE_KEY } from "../lib/progress-sync.mjs";
import * as storageApi from "../lib/storage.mjs";

const ACCOUNT_A = "e1e0b2fa-b2ab-4c38-88bb-dc8604970917";
const ACCOUNT_B = "f2fc31ad-9a4b-4ad3-bcdc-68c3e25402eb";
const UPDATED_AT = "2026-09-16T08:00:00.000Z";

function state(batchSize = 5) {
  return {
    version: 1,
    settings: { batchSize, learningRepetitions: 3, dailyGoal: 3, weeklyGoal: 3, biweeklyGoal: 3, masteredSample: 2 },
    importWarnings: [], history: [],
    items: [{
      id: "山", char: "山", pinyin: "shān", stage: "DAILY", stageStreak: 1, learningCorrect: 3,
      unfamiliar: false, lastCountedDate: "2026-09-15", nextDue: "2026-09-16",
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

function key(accountId, name = storageApi.STORAGE_KEY) {
  return accountId === "default" ? name : `kids-literacy:account:${encodeURIComponent(accountId)}:${name}`;
}

function read(storage, accountId, name) {
  return JSON.parse(storage.getItem(key(accountId, name)));
}

function ready(accountId, savedState = state(), revision = 1) {
  return Response.json({ status: "ready", accountId, state: savedState, revision, updatedAt: UPDATED_AT });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function controller(accountId, storage, fetch) {
  return createProgressSyncController({ accountId, storage, fetch, initialState: () => state() });
}

test("account storage isolates every key and keeps the default account's legacy keys", () => {
  const storage = memoryStorage();
  assert.equal(storageApi.accountStorage(storage, "default"), storage);
  const accountA = storageApi.accountStorage(storage, ACCOUNT_A);
  const accountB = storageApi.accountStorage(storage, ACCOUNT_B);
  for (const name of [storageApi.STORAGE_KEY, SYNC_STORAGE_KEY, CONFLICT_STORAGE_KEY]) {
    storage.setItem(name, "original");
    accountA.setItem(name, "A");
    accountB.setItem(name, "B");
    assert.equal(storage.getItem(key(ACCOUNT_A, name)), "A");
    assert.equal(accountA.getItem(name), "A");
    assert.equal(accountB.getItem(name), "B");
    accountA.removeItem(name);
    assert.equal(accountA.getItem(name), null);
    assert.equal(accountB.getItem(name), "B");
    assert.equal(storage.getItem(name), "original");
  }
});

test("accounts at the same revision save only to their own endpoint and cache", async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push([url, options.method ?? "GET"]);
    const accountId = new URL(url, "http://localhost").searchParams.get("accountId");
    assert.ok([ACCOUNT_A, ACCOUNT_B].includes(accountId));
    return ready(accountId, options.method === "PUT" ? JSON.parse(options.body).state : state(accountId === ACCOUNT_A ? 6 : 7), options.method === "PUT" ? 2 : 1);
  };
  const options = { accountId: ACCOUNT_A, storage, fetch, initialState: () => state() };
  const accountA = createProgressSyncController(options);
  const accountB = controller(ACCOUNT_B, storage, fetch);
  await Promise.all([accountA.start(), accountB.start()]);
  options.accountId = ACCOUNT_B;
  await Promise.all([accountA.update(state(8)), accountB.update(state(9))]);

  assert.equal(accountA.snapshot().accountId, ACCOUNT_A);
  assert.equal(accountB.snapshot().accountId, ACCOUNT_B);
  assert.equal(accountA.snapshot().sync.revision, 2);
  assert.equal(accountB.snapshot().sync.revision, 2);
  assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 8);
  assert.equal(read(storage, ACCOUNT_B).settings.batchSize, 9);
  assert.equal(read(storage, ACCOUNT_A, SYNC_STORAGE_KEY).revision, 2);
  assert.equal(read(storage, ACCOUNT_B, SYNC_STORAGE_KEY).revision, 2);
  assert.equal(storage.getItem(storageApi.STORAGE_KEY), null);
  for (const id of [ACCOUNT_A, ACCOUNT_B]) {
    assert.deepEqual(calls.filter(([url]) => url.endsWith(id)), [[`/api/account-progress?accountId=${id}`, "GET"], [`/api/account-progress?accountId=${id}`, "PUT"]]);
  }
});

for (const hasAccountCache of [false, true]) {
  test(`a non-default account never migrates legacy progress${hasAccountCache ? " even with its own old cache" : ""}`, async () => {
    const original = state(9);
    const storage = memoryStorage({
      [storageApi.STORAGE_KEY]: JSON.stringify(original),
      ...(hasAccountCache ? { [key(ACCOUNT_B)]: JSON.stringify(state(7)) } : {}),
    });
    const calls = [];
    const accountB = controller(ACCOUNT_B, storage, async (url, options = {}) => {
      calls.push([url, options.method ?? "GET"]);
      return Response.json({ status: "empty", accountId: ACCOUNT_B });
    });
    await accountB.start();
    assert.deepEqual(calls, [[`/api/account-progress?accountId=${ACCOUNT_B}`, "GET"]]);
    assert.deepEqual(JSON.parse(storage.getItem(storageApi.STORAGE_KEY)), original);
    assert.notEqual(accountB.snapshot().state.settings.batchSize, original.settings.batchSize);
    assert.notEqual(accountB.snapshot().access, "ready");
  });
}

test("default account still restores and migrates the original unprefixed cache", async () => {
  const original = state(8);
  const storage = memoryStorage({ [storageApi.STORAGE_KEY]: JSON.stringify(original) });
  const calls = [];
  const account = createProgressSyncController({
    storage, initialState: () => state(),
    fetch: async (url, options = {}) => {
      calls.push(url);
      if (url === "/api/progress") return Response.json({ status: "empty" });
      assert.deepEqual(JSON.parse(options.body).state, original);
      return Response.json({ status: "migrated", state: original, revision: 1, updatedAt: UPDATED_AT }, { status: 201 });
    },
  });
  await account.start();
  assert.equal(account.snapshot().accountId, "default");
  assert.equal(account.snapshot().access, "ready");
  assert.deepEqual(account.snapshot().state, original);
  assert.deepEqual(calls, ["/api/progress", "/api/progress/migrate"]);
  assert.deepEqual(JSON.parse(storage.getItem(storageApi.STORAGE_KEY)), original);
});

test("an offline account resumes its own queue after visiting another account", async () => {
  const storage = memoryStorage();
  const writes = [];
  let online = false;
  const fetch = async (url, options = {}) => {
    const accountId = new URL(url, "http://localhost").searchParams.get("accountId");
    if (!options.method) return ready(accountId, state(accountId === ACCOUNT_A ? 5 : 6));
    if (!online) throw new TypeError("offline");
    const submitted = JSON.parse(options.body);
    writes.push({ accountId, ...submitted });
    return ready(accountId, submitted.state, 2);
  };
  const firstA = controller(ACCOUNT_A, storage, fetch);
  await firstA.start();
  await firstA.update(state(9));
  firstA.destroy();
  assert.equal(read(storage, ACCOUNT_A, SYNC_STORAGE_KEY).pending, true);

  online = true;
  const accountB = controller(ACCOUNT_B, storage, fetch);
  await accountB.start();
  assert.equal(accountB.snapshot().state.settings.batchSize, 6);
  assert.equal(writes.length, 0);
  const resumedA = controller(ACCOUNT_A, storage, fetch);
  await resumedA.start();
  assert.deepEqual(writes.map(({ accountId, baseRevision, state: saved }) => [accountId, baseRevision, saved.settings.batchSize]), [[ACCOUNT_A, 1, 9]]);
  assert.equal(read(storage, ACCOUNT_A, SYNC_STORAGE_KEY).pending, false);
  assert.equal(read(storage, ACCOUNT_B).settings.batchSize, 6);
});

for (const operation of ["start", "checkLatest"]) {
  test(`a late ${operation} GET from a destroyed controller cannot overwrite a newly opened account`, async () => {
    const storage = memoryStorage();
    const late = deferred();
    let firstRead = true;
    const old = controller(ACCOUNT_A, storage, async () => {
      if (operation === "checkLatest" && firstRead) { firstRead = false; return ready(ACCOUNT_A); }
      return late.promise;
    });
    if (operation === "checkLatest") await old.start();
    const reading = old[operation]();
    old.destroy();
    const destroyedSnapshot = structuredClone(old.snapshot());
    const reopened = controller(ACCOUNT_A, storage, async () => ready(ACCOUNT_A, state(9), 5));
    await reopened.start();
    const cache = storage.getItem(key(ACCOUNT_A));
    const syncCache = storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY));
    late.resolve(ready(ACCOUNT_A, state(6), 2));
    await reading;
    assert.deepEqual(old.snapshot(), destroyedSnapshot);
    assert.equal(storage.getItem(key(ACCOUNT_A)), cache);
    assert.equal(storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY)), syncCache);
    assert.equal(reopened.snapshot().state.settings.batchSize, 9);
  });
}

for (const result of ["success", "network failure"]) {
  test(`a destroyed controller's late PUT ${result} cannot clear a reopened account's newer offline queue`, async () => {
    const storage = memoryStorage();
    const late = deferred();
    const old = controller(ACCOUNT_A, storage, async (_url, options = {}) => options.method ? late.promise : ready(ACCOUNT_A));
    await old.start();
    const saving = old.update(state(7));
    old.destroy();
    const destroyedSnapshot = structuredClone(old.snapshot());
    let writes = 0;
    const reopened = controller(ACCOUNT_A, storage, async (_url, options = {}) => {
      if (!options.method) return ready(ACCOUNT_A);
      if (++writes === 1) return ready(ACCOUNT_A, JSON.parse(options.body).state, 2);
      throw new TypeError("offline");
    });
    await reopened.start();
    await reopened.update(state(9));
    const cache = storage.getItem(key(ACCOUNT_A));
    const syncCache = storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY));
    if (result === "success") late.resolve(ready(ACCOUNT_A, state(7), 2));
    else late.reject(new TypeError("offline"));
    await saving;
    assert.deepEqual(old.snapshot(), destroyedSnapshot);
    assert.equal(storage.getItem(key(ACCOUNT_A)), cache);
    assert.equal(storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY)), syncCache);
    assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 9);
    assert.equal(read(storage, ACCOUNT_A, SYNC_STORAGE_KEY).pending, true);
  });
}

test("destroy disables updates and retries without dropping its saved pending snapshot", async () => {
  const storage = memoryStorage();
  let requests = 0;
  const account = controller(ACCOUNT_A, storage, async (_url, options = {}) => {
    requests += 1;
    if (options.method) throw new TypeError("offline");
    return ready(ACCOUNT_A);
  });
  await account.start();
  await account.update(state(8));
  account.destroy();
  const snapshot = structuredClone(account.snapshot());
  const syncCache = storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY));
  await account.update(state(9));
  await account.retry();
  await account.checkLatest();
  assert.equal(requests, 2);
  assert.deepEqual(account.snapshot(), snapshot);
  assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 8);
  assert.equal(storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY)), syncCache);
});

for (const returnedAccount of [ACCOUNT_B, undefined]) {
  test(`a ${returnedAccount ? "mismatched" : "missing"} account in the first server response is never accepted or cached`, async () => {
    const storage = memoryStorage();
    const account = controller(ACCOUNT_A, storage, async () => ready(returnedAccount, state(9)));
    await account.start();
    assert.notEqual(account.snapshot().access, "ready");
    assert.notEqual(account.snapshot().state.settings.batchSize, 9);
    assert.equal(storage.getItem(key(ACCOUNT_A)), null);
    assert.notEqual(account.snapshot().sync.phase, "saved");
  });
}

for (const revision of [2, 3]) {
  test(`a background response from another account at revision ${revision} cannot be accepted`, async () => {
    const storage = memoryStorage();
    let requests = 0;
    const account = controller(ACCOUNT_A, storage, async () => ++requests === 1 ? ready(ACCOUNT_A, state(6), 2) : ready(ACCOUNT_B, state(9), revision));
    await account.start();
    await account.checkLatest();
    assert.equal(account.snapshot().state.settings.batchSize, 6);
    assert.equal(account.snapshot().sync.revision, 2);
    assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 6);
    assert.notEqual(account.snapshot().sync.phase, "saved");
  });
}

test("a PUT response for another account keeps the local change pending", async () => {
  const storage = memoryStorage();
  const account = controller(ACCOUNT_A, storage, async (_url, options = {}) => options.method ? ready(ACCOUNT_B, state(9), 3) : ready(ACCOUNT_A, state(6), 2));
  await account.start();
  await account.update(state(8));
  assert.equal(account.snapshot().sync.revision, 2);
  assert.equal(account.snapshot().sync.pending, true);
  assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 8);
  assert.notEqual(account.snapshot().sync.phase, "saved");
});

test("conflict recovery keeps each account's rejected snapshot and server state separate", async () => {
  const storage = memoryStorage();
  const reads = new Map();
  const fetch = async (url, options = {}) => {
    const accountId = new URL(url, "http://localhost").searchParams.get("accountId");
    if (options.method) return Response.json({ code: "REVISION_CONFLICT", revision: 2 }, { status: 409 });
    const count = (reads.get(accountId) ?? 0) + 1;
    reads.set(accountId, count);
    return ready(accountId, state(accountId === ACCOUNT_A ? 6 : 7), count);
  };
  const accountA = controller(ACCOUNT_A, storage, fetch);
  const accountB = controller(ACCOUNT_B, storage, fetch);
  await Promise.all([accountA.start(), accountB.start()]);
  await accountB.update(state(9));
  const conflictB = storage.getItem(key(ACCOUNT_B, CONFLICT_STORAGE_KEY));
  await accountA.update(state(8));
  assert.equal(accountA.snapshot().sync.phase, "conflict");
  assert.equal(accountB.snapshot().sync.phase, "conflict");
  assert.equal(read(storage, ACCOUNT_A, CONFLICT_STORAGE_KEY).state.settings.batchSize, 8);
  assert.equal(storage.getItem(key(ACCOUNT_B, CONFLICT_STORAGE_KEY)), conflictB);
  assert.equal(read(storage, ACCOUNT_B, CONFLICT_STORAGE_KEY).state.settings.batchSize, 9);
  assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 6);
  assert.equal(read(storage, ACCOUNT_B).settings.batchSize, 7);
  assert.equal(storage.getItem(CONFLICT_STORAGE_KEY), null);
});

test("conflict recovery refuses a latest-state response from a different account", async () => {
  const storage = memoryStorage();
  let reads = 0;
  const account = controller(ACCOUNT_A, storage, async (_url, options = {}) => {
    if (options.method) return Response.json({ code: "REVISION_CONFLICT", revision: 2 }, { status: 409 });
    return ++reads === 1 ? ready(ACCOUNT_A, state(6)) : ready(ACCOUNT_B, state(9), 2);
  });
  await account.start();
  await account.update(state(8));
  assert.equal(account.snapshot().state.settings.batchSize, 8);
  assert.equal(account.snapshot().sync.pending, true);
  assert.equal(account.snapshot().sync.revision, 1);
  assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 8);
  assert.equal(storage.getItem(key(ACCOUNT_A, CONFLICT_STORAGE_KEY)), null);
});

for (const operation of ["start", "login", "createFresh"]) {
  test(`a destroyed controller cannot begin ${operation}`, async () => {
    const storage = memoryStorage();
    let requests = 0;
    const account = controller("default", storage, async () => { requests += 1; return ready("default"); });
    account.destroy();
    const snapshot = structuredClone(account.snapshot());
    await account[operation]("482731");
    assert.equal(requests, 0);
    assert.deepEqual(account.snapshot(), snapshot);
    assert.equal(storage.getItem(SYNC_STORAGE_KEY), null);
  });
}

test("a login finishing after switching accounts cannot bootstrap or modify cache", async () => {
  const storage = memoryStorage();
  const late = deferred();
  const calls = [];
  const old = controller(ACCOUNT_A, storage, async (url) => { calls.push(url); return late.promise; });
  const loggingIn = old.login("482731");
  old.destroy();
  const snapshot = structuredClone(old.snapshot());
  const reopened = controller(ACCOUNT_A, storage, async () => ready(ACCOUNT_A, state(9), 4));
  await reopened.start();
  const syncCache = storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY));
  late.resolve(Response.json({ status: "authenticated" }));
  assert.equal(await loggingIn, false);
  assert.deepEqual(calls, ["/api/auth/login"]);
  assert.deepEqual(old.snapshot(), snapshot);
  assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 9);
  assert.equal(storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY)), syncCache);
});

test("an old migration response cannot replace the default account after reopening", async () => {
  const storage = memoryStorage({ [storageApi.STORAGE_KEY]: JSON.stringify(state(7)) });
  const migrationStarted = deferred();
  const late = deferred();
  const old = controller("default", storage, async (url) => {
    if (url === "/api/progress") return Response.json({ status: "empty" });
    assert.equal(url, "/api/progress/migrate");
    migrationStarted.resolve();
    return late.promise;
  });
  const starting = old.start();
  await migrationStarted.promise;
  old.destroy();
  const snapshot = structuredClone(old.snapshot());
  const reopened = controller("default", storage, async () => ready("default", state(9), 4));
  await reopened.start();
  const syncCache = storage.getItem(SYNC_STORAGE_KEY);
  late.resolve(Response.json({ status: "migrated", state: state(7), revision: 1, updatedAt: UPDATED_AT }));
  await starting;
  assert.deepEqual(old.snapshot(), snapshot);
  assert.equal(read(storage, "default").settings.batchSize, 9);
  assert.equal(storage.getItem(SYNC_STORAGE_KEY), syncCache);
});

test("switching during explicit fresh initialization cancels without rejecting the UI action", async () => {
  const storage = memoryStorage();
  const migrationStarted = deferred();
  const late = deferred();
  const old = controller("default", storage, async (url) => {
    if (url === "/api/auth/login") return Response.json({ status: "authenticated" });
    assert.equal(url, "/api/progress/migrate");
    migrationStarted.resolve();
    return late.promise;
  });
  const creating = old.createFresh("482731");
  await migrationStarted.promise;
  old.destroy();
  const snapshot = structuredClone(old.snapshot());
  const reopened = controller("default", storage, async () => ready("default", state(9), 4));
  await reopened.start();
  const syncCache = storage.getItem(SYNC_STORAGE_KEY);
  late.resolve(Response.json({ status: "migrated", state: state(), revision: 1, updatedAt: UPDATED_AT }));
  assert.equal(await creating, false);
  assert.deepEqual(old.snapshot(), snapshot);
  assert.equal(read(storage, "default").settings.batchSize, 9);
  assert.equal(storage.getItem(SYNC_STORAGE_KEY), syncCache);
});

test("a conflict read finishing after switching cannot replace the reopened account or its conflict copy", async () => {
  const storage = memoryStorage();
  const conflictStarted = deferred();
  const late = deferred();
  let reads = 0;
  const old = controller(ACCOUNT_A, storage, async (_url, options = {}) => {
    if (options.method) return Response.json({ code: "REVISION_CONFLICT", revision: 2 }, { status: 409 });
    if (++reads === 1) return ready(ACCOUNT_A);
    conflictStarted.resolve();
    return late.promise;
  });
  await old.start();
  const saving = old.update(state(7));
  await conflictStarted.promise;
  old.destroy();
  const snapshot = structuredClone(old.snapshot());
  const reopened = controller(ACCOUNT_A, storage, async () => ready(ACCOUNT_A, state(9), 5));
  await reopened.start();
  const syncCache = storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY));
  const conflictCache = storage.getItem(key(ACCOUNT_A, CONFLICT_STORAGE_KEY));
  late.resolve(ready(ACCOUNT_A, state(6), 2));
  await saving;
  assert.deepEqual(old.snapshot(), snapshot);
  assert.equal(read(storage, ACCOUNT_A).settings.batchSize, 9);
  assert.equal(storage.getItem(key(ACCOUNT_A, SYNC_STORAGE_KEY)), syncCache);
  assert.equal(storage.getItem(key(ACCOUNT_A, CONFLICT_STORAGE_KEY)), conflictCache);
});
