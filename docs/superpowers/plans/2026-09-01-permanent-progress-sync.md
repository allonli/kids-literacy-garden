# Permanent Progress Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the existing browser learning record, migrate it once to Aliyun SQLite, keep it permanently synchronized across family devices, and make correct answers advance immediately.

**Architecture:** Keep `kids-literacy:v1` as the synchronous local cache and add a client sync controller that uploads versioned full-state snapshots to same-origin Next.js APIs. Store the authoritative state and opaque device sessions in a SQLite file outside the application release directory; use compare-and-swap revisions to reject stale devices. Deploy backup tooling and a systemd timer before enabling the original-browser migration.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, JavaScript modules, Node.js 22 built-in `node:sqlite`, Node test runner, CSS, Playwright or in-app browser automation, nginx, systemd, Aliyun Linux.

**Spec:** `docs/superpowers/specs/2026-09-01-permanent-progress-sync-design.md`

## Global Constraints

- Preserve `kids-literacy:v1`; never rename, clear, or overwrite it with blank data during login or migration.
- Persist the database at `/var/lib/kids-literacy/progress.sqlite`, backups at `/var/backups/kids-literacy/`, and application releases at `/opt/kids-literacy-garden`.
- Generate one six-digit family code at deployment; store only its salted `scrypt` hash in `LITERACY_FAMILY_CODE_HASH`.
- Store the raw device token only in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie; persist only its SHA-256 hash and expire it after 180 days.
- A migration writes only when server progress is empty; a blank new browser must never initialize server progress without explicit reauthentication and confirmation.
- Every normal save carries `baseRevision`; stale writes receive HTTP 409 and cannot overwrite newer server progress.
- Local state changes are synchronous and remain usable offline; network saving is serialized in the background and retains the latest full snapshot.
- Correct answers advance synchronously after speech ends; incorrect answers still enter the auto-speaking restudy card.
- Keep the current uncommitted single-example-word, speech-lock, restudy-card, and sticky-action behavior intact.
- Require Node.js `>=22.22.0` on the Aliyun server so the built-in SQLite database and backup APIs are available.
- Use the standard Next.js Node server (`next build` and `next start`) for Aliyun and Vercel; do not bundle the Node-only SQLite API into the legacy vinext/Cloudflare worker target.
- Production release must pass unit, API integration, lint, build, real desktop/iPad browser, offline recovery, cross-device, database restart, and rollback-safety checks.
- Do not log the family code, raw cookie token, or full learning state.

---

### Task 0: Seal the currently deployed interaction baseline

**Files:**
- Modify already present: `README.md`
- Modify already present: `components/LiteracyApp.tsx`
- Modify already present: `components/RecognitionCard.tsx`
- Modify already present: `components/WordStudyCard.tsx`
- Modify already present: `package.json`
- Create already present: `lib/session-flow.mjs`
- Create already present: `tests/session-flow.test.mjs`

**Interfaces:**
- Produces: committed `getVisibleExampleWords(words)`, `getAnswerDestination(session, correct)`, `shouldAutoSpeak(view)`, and `canNavigateFromCard(isSpeaking)` behavior.
- Consumes: the existing `LiteracyApp`, `RecognitionCard`, `WordStudyCard`, and `kids-literacy:v1` state without changing its shape.

- [ ] **Step 1: Verify only the known baseline files are dirty**

Run:

```powershell
git status --short
git diff --check
```

Expected: only the seven paths listed above are modified/untracked; `git diff --check` prints no errors. If any additional user file is dirty, leave it unstaged and record it before continuing.

- [ ] **Step 2: Run the focused baseline tests**

Run:

```powershell
node --test tests/session-flow.test.mjs tests/review-flow.test.mjs
```

Expected: all tests pass, including one visible example word, incorrect-to-restudy routing, auto-speech selection, and speech navigation lock.

- [ ] **Step 3: Run the complete baseline verification**

Run:

```powershell
npm run test:unit
npm run lint
npm run build
```

Expected: every command exits 0 before permanent-storage code starts.

- [ ] **Step 4: Commit only the baseline interaction work**

```powershell
git add README.md components/LiteracyApp.tsx components/RecognitionCard.tsx components/WordStudyCard.tsx package.json lib/session-flow.mjs tests/session-flow.test.mjs
git commit -m "feat: refine literacy review sessions"
```

Expected: the interaction baseline has its own reviewable commit and the working tree contains only this plan if it has not yet been committed.

### Task 1: Shared state validation and durable local sync metadata

**Files:**
- Create: `lib/progress-state.mjs`
- Create: `lib/progress-sync.mjs`
- Modify: `lib/storage.mjs`
- Create: `tests/progress-state.test.mjs`
- Create: `tests/progress-sync.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `MAX_PROGRESS_BYTES`, `isLiteracyState(value)`, `assertLiteracyState(value)`, `SYNC_STORAGE_KEY`, `CONFLICT_STORAGE_KEY`, `loadSyncMeta(storage)`, `saveSyncMeta(meta, storage)`, `saveConflictSnapshot(snapshot, storage)`, `clearConflictSnapshot(storage)`, and `reduceSyncMeta(meta, event)`.
- `reduceSyncMeta` consumes events `{ type: "START_CHECK" | "QUEUE" | "SAVING" | "SAVED" | "OFFLINE" | "CONFLICT" | "ERROR", revision?, at?, message? }` and produces `{ revision, pending, phase, lastSavedAt, message }`.
- Consumes: existing `loadState()` and `saveState()` under the unchanged key `kids-literacy:v1`.

- [ ] **Step 1: Write failing state and metadata tests**

Create `tests/progress-state.test.mjs` with a valid `LiteracyState` fixture and assertions:

```js
test("accepts a complete version-one literacy state", () => {
  assert.equal(isLiteracyState(validState), true);
  assert.equal(assertLiteracyState(validState), validState);
});

test("rejects blank, wrong-version, and malformed item state", () => {
  for (const value of [null, {}, { ...validState, version: 2 }, { ...validState, items: [{}] }]) {
    assert.equal(isLiteracyState(value), false);
  }
});
```

Create `tests/progress-sync.test.mjs`:

```js
test("queues offline work without losing the last confirmed revision", () => {
  const queued = reduceSyncMeta({ revision: 7, pending: false, phase: "saved", lastSavedAt: null, message: null }, { type: "QUEUE" });
  const offline = reduceSyncMeta(queued, { type: "OFFLINE" });
  assert.deepEqual(offline, { revision: 7, pending: true, phase: "offline", lastSavedAt: null, message: "网络断开，等待同步" });
});

test("clears pending only after the server confirms a new revision", () => {
  const result = reduceSyncMeta({ revision: 7, pending: true, phase: "saving", lastSavedAt: null, message: null }, { type: "SAVED", revision: 8, at: "2026-09-01T08:00:00.000Z" });
  assert.equal(result.revision, 8);
  assert.equal(result.pending, false);
  assert.equal(result.phase, "saved");
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/progress-state.test.mjs tests/progress-sync.test.mjs
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement strict shared validation**

Implement `lib/progress-state.mjs` without importing server-only modules:

```js
export const MAX_PROGRESS_BYTES = 5 * 1024 * 1024;

const STAGES = new Set(["LEARNING", "DAILY", "WEEKLY", "TWO_WEEKLY", "MASTERED"]);

export function isLiteracyState(value) {
  return Boolean(value && value.version === 1
    && value.settings && typeof value.settings === "object"
    && Array.isArray(value.importWarnings)
    && Array.isArray(value.history)
    && Array.isArray(value.items)
    && value.items.every((item) => typeof item.id === "string"
      && typeof item.char === "string"
      && STAGES.has(item.stage)
      && Number.isInteger(item.stageStreak)
      && Number.isInteger(item.learningCorrect)
      && Array.isArray(item.words)
      && Array.isArray(item.customWords)
      && Array.isArray(item.hiddenWords)));
}

export function assertLiteracyState(value) {
  if (!isLiteracyState(value)) throw new TypeError("学习进度格式无效");
  const json = JSON.stringify(value);
  const bytes = typeof TextEncoder === "function"
    ? new TextEncoder().encode(json).byteLength
    : Buffer.byteLength(json, "utf8");
  if (bytes > MAX_PROGRESS_BYTES) throw new RangeError("学习进度超过 5MB");
  return value;
}
```

This keeps the byte-length check browser-safe, with `Buffer.byteLength` only as the Node fallback.

- [ ] **Step 4: Implement sync metadata storage and reducer**

Keep `STORAGE_KEY = "kids-literacy:v1"` unchanged in `lib/storage.mjs`. Add the two new keys in `lib/progress-sync.mjs`:

```js
export const SYNC_STORAGE_KEY = "kids-literacy:sync:v1";
export const CONFLICT_STORAGE_KEY = "kids-literacy:conflict:v1";

export const EMPTY_SYNC_META = {
  revision: 0,
  pending: false,
  phase: "checking",
  lastSavedAt: null,
  message: null,
};
```

`loadSyncMeta` must return a validated copy of `EMPTY_SYNC_META` when JSON is missing or malformed. `saveConflictSnapshot` stores only the last rejected local state plus `{ detectedAt, serverRevision }`; it never replaces `kids-literacy:v1`.

- [ ] **Step 5: Verify GREEN and register tests**

Add both test files to `test:unit`, then run:

```powershell
npm run test:unit
```

Expected: all existing and new tests pass.

- [ ] **Step 6: Commit**

```powershell
git add package.json lib/storage.mjs lib/progress-state.mjs lib/progress-sync.mjs tests/progress-state.test.mjs tests/progress-sync.test.mjs
git commit -m "feat: add progress sync state model"
```

### Task 2: SQLite progress and device-session repository

**Files:**
- Create: `lib/server/progress-db.mjs`
- Create: `tests/progress-db.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `openProgressDb(path)`, returning `{ getProgress, migrateProgress, updateProgress, createSession, getSession, touchSession, close }`.
- `getProgress(familyId)` returns `null` or `{ state, revision, updatedAt }`.
- `migrateProgress(familyId, state, now)` returns `{ created: boolean, progress }`; only an empty family row may be inserted.
- `updateProgress(familyId, state, baseRevision, now)` returns `{ ok: true, progress }` or `{ ok: false, conflict }`.
- Session methods consume only token hashes; raw tokens never cross this repository boundary.
- Consumes: `assertLiteracyState(state)` from Task 1 and Node 22 `DatabaseSync` from `node:sqlite`.

- [ ] **Step 1: Write failing repository tests against a temporary database**

Create `tests/progress-db.test.mjs` using `mkdtemp` and cleanup in `afterEach`:

```js
test("migrates exactly once and round-trips the complete state", () => {
  const db = openProgressDb(dbPath);
  const first = db.migrateProgress("default", validState, now);
  const second = db.migrateProgress("default", differentState, later);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(db.getProgress("default").state, validState);
});

test("rejects a stale revision without changing stored progress", () => {
  const db = openProgressDb(dbPath);
  db.migrateProgress("default", validState, now);
  assert.equal(db.updateProgress("default", changedState, 0, later).ok, false);
  assert.deepEqual(db.getProgress("default").state, validState);
});

test("expires device sessions", () => {
  const db = openProgressDb(dbPath);
  db.createSession("token-hash", "default", now, expiresAt);
  assert.equal(db.getSession("token-hash", beforeExpiry).familyId, "default");
  assert.equal(db.getSession("token-hash", afterExpiry), null);
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/progress-db.test.mjs
```

Expected: FAIL because `lib/server/progress-db.mjs` does not exist.

- [ ] **Step 3: Implement schema initialization and repository transactions**

On `openProgressDb(path)`, create the parent directory, enable `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, and run this idempotent schema:

```sql
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
```

Use `INSERT ... ON CONFLICT DO NOTHING` for migration and `UPDATE ... WHERE family_id = ? AND revision = ?` for compare-and-swap saves. Parse stored JSON through `assertLiteracyState` before returning it.

Raise `package.json`'s Node engine floor from `>=22.13.0` to `>=22.22.0`, matching the production runtime and backup API requirement.

- [ ] **Step 4: Verify transaction and persistence behavior**

Run:

```powershell
node --test tests/progress-db.test.mjs
npm run test:unit
```

Expected: tests prove first-writer migration, stale-write rejection, reopen persistence, and session expiry; all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add package.json lib/server/progress-db.mjs tests/progress-db.test.mjs
git commit -m "feat: persist literacy progress in sqlite"
```

### Task 3: Family-code authentication and request protection

**Files:**
- Create: `lib/server/family-auth.mjs`
- Create: `lib/server/login-rate-limit.mjs`
- Create: `lib/server/request-security.mjs`
- Create: `scripts/hash-family-code.mjs`
- Create: `tests/family-auth.test.mjs`
- Create: `tests/login-rate-limit.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `hashFamilyCode(code, salt?)`, `verifyFamilyCode(code, encodedHash)`, `createDeviceToken() -> { raw, hash }`, `hashDeviceToken(raw)`, `SESSION_COOKIE_NAME`, `createSessionCookie(raw, production)`, and `readCookie(request, name)`.
- Produces: `createLoginRateLimiter({ maxFailures: 5, windowMs: 600000 })` with `check(key, now)`, `fail(key, now)`, and `clear(key)`.
- Produces: `getRequestOrigin(request)`, `assertSameOrigin(request)`, and `getClientAddress(request)`.
- Consumes: session repository methods from Task 2; family code format is exactly six ASCII digits.

- [ ] **Step 1: Write failing authentication and rate-limit tests**

Create `tests/family-auth.test.mjs`:

```js
test("hashes and verifies only the exact six-digit family code", async () => {
  const encoded = await hashFamilyCode("482731", Buffer.alloc(16, 7));
  assert.equal(await verifyFamilyCode("482731", encoded), true);
  assert.equal(await verifyFamilyCode("482732", encoded), false);
  assert.equal(await verifyFamilyCode("48 2731", encoded), false);
});

test("stores a different hash from the raw device token", () => {
  const token = createDeviceToken();
  assert.notEqual(token.raw, token.hash);
  assert.equal(hashDeviceToken(token.raw), token.hash);
});

test("creates a protected 180-day cookie", () => {
  const cookie = createSessionCookie("raw-token", true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=15552000/);
});
```

Create `tests/login-rate-limit.test.mjs` and assert the sixth failure in ten minutes is rejected, a success clears failures, and the window resets after 600000 ms.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/family-auth.test.mjs tests/login-rate-limit.test.mjs
```

Expected: FAIL because the security modules are missing.

- [ ] **Step 3: Implement cryptography, cookies, and proxy-aware origin checks**

Encode the family hash as `scrypt$<saltHex>$<derivedKeyHex>`, derive 64 bytes, and compare with `timingSafeEqual`. Generate 32 random bytes for device tokens and encode with `base64url`; persist `sha256(raw)`.

For write requests, compute the expected origin using the first `x-forwarded-proto`, then `x-forwarded-host` or `host`:

```js
export function assertSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== getRequestOrigin(request)) {
    const error = new Error("跨站写入已拒绝");
    error.status = 403;
    throw error;
  }
}
```

The hash script accepts one six-digit argument and prints only the encoded hash. It must never echo the raw code.

- [ ] **Step 4: Verify GREEN and script behavior**

Run:

```powershell
node --test tests/family-auth.test.mjs tests/login-rate-limit.test.mjs
node scripts/hash-family-code.mjs 482731
npm run test:unit
```

Expected: tests pass; the script outputs one `scrypt$...` line and does not contain `482731`.

- [ ] **Step 5: Commit**

```powershell
git add package.json lib/server/family-auth.mjs lib/server/login-rate-limit.mjs lib/server/request-security.mjs scripts/hash-family-code.mjs tests/family-auth.test.mjs tests/login-rate-limit.test.mjs
git commit -m "feat: add family device authentication"
```

### Task 4: Authenticated progress API routes

**Files:**
- Create: `lib/server/progress-api.mjs`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/progress/route.ts`
- Create: `app/api/progress/migrate/route.ts`
- Create: `tests/progress-api.test.mjs`
- Create: `tests/production-server.test.mjs`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: route-independent handlers `login(request, deps)`, `getProgress(request, deps)`, `migrateProgress(request, deps)`, and `putProgress(request, deps)` returning Web `Response` objects.
- Route files provide `{ db, familyCodeHash, rateLimiter, production, now }`, export `runtime = "nodejs"`, and delegate directly to `progress-api.mjs`.
- Consumes: Task 1 validation, Task 2 repository, and Task 3 auth/security helpers.
- API response shapes are `{ status: "empty" }`, `{ status: "ready", state, revision, updatedAt }`, `{ status: "migrated", state, revision, updatedAt }`, and errors `{ error, code }`.

- [ ] **Step 1: Write failing API integration tests with an injected temporary repository**

Create `tests/progress-api.test.mjs` covering:

```js
test("login sets a protected cookie without returning the family code", async () => {
  const response = await login(sameOriginJsonRequest("/api/auth/login", { code: "482731" }), deps);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /kids_literacy_device=/);
  assert.doesNotMatch(await response.text(), /482731/);
});

test("an empty server migrates the original local state only once", async () => {
  const first = await migrateProgress(authenticatedRequest({ state: validState }), deps);
  const second = await migrateProgress(authenticatedRequest({ state: differentState }), deps);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).state, validState);
});

test("a stale save returns 409 and the authoritative revision", async () => {
  await migrateProgress(authenticatedRequest({ state: validState }), deps);
  const response = await putProgress(authenticatedRequest({ state: changedState, baseRevision: 0 }), deps);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).revision, 1);
});
```

Also assert 401 without a device cookie, 403 for a mismatched `Origin`, 400 for malformed state, 413 above 5 MB, and 429 after five failed family-code attempts.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/progress-api.test.mjs
```

Expected: FAIL because API handlers and routes do not exist.

- [ ] **Step 3: Implement the injectable API handlers**

Use one helper to authenticate every progress request:

```js
async function requireFamily(request, deps) {
  const raw = readCookie(request, SESSION_COOKIE_NAME);
  if (!raw) throw httpError(401, "LOGIN_REQUIRED", "请先输入家庭码");
  const session = deps.db.getSession(hashDeviceToken(raw), deps.now());
  if (!session) throw httpError(401, "SESSION_EXPIRED", "登录已过期");
  deps.db.touchSession(hashDeviceToken(raw), deps.now());
  return session.familyId;
}
```

Read request bodies through one 5 MB limiter before parsing JSON. `POST migrate` returns status 201 only when it created revision 1; otherwise it returns the existing authoritative progress. `PUT` returns 409 with the current revision and timestamp but not a second unrequested copy of state; the client follows with `GET`.

- [ ] **Step 4: Add thin Node route adapters**

Each route constructs the repository from `process.env.LITERACY_DB_PATH`, defaulting only in development to `.data/progress.sqlite`. Production startup must throw a clear error if `LITERACY_DB_PATH` or `LITERACY_FAMILY_CODE_HASH` is missing. Cache one database handle and one in-process rate limiter per server process.

Switch the primary runtime scripts to the standard Next.js Node server while retaining an explicitly named legacy build only for reference:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "build:vinext": "vinext build"
  }
}
```

Replace the old `dist/server/index.js` worker import in `tests/rendered-html.test.mjs` with source-level accessibility/render contracts. Add `tests/production-server.test.mjs`: after `next build`, spawn `node_modules/next/dist/bin/next start -H 127.0.0.1 -p <freePort>` with temporary `LITERACY_DB_PATH` and hash, poll `/` until HTTP 200, assert the Chinese app shell, then terminate the child in `after`. Register it after the build in `npm test` so the actual Node production server is exercised.

- [ ] **Step 5: Verify API behavior and production build**

Run:

```powershell
node --test tests/progress-api.test.mjs
npm run test:unit
npm run lint
$env:LITERACY_DB_PATH = "$PWD\.data\build-progress.sqlite"
$env:LITERACY_FAMILY_CODE_HASH = (node scripts/hash-family-code.mjs 482731).Trim()
npm run build
node --test tests/production-server.test.mjs
Remove-Item -Recurse -Force -LiteralPath "$PWD\.data"
```

Expected: all commands pass, route handlers are included in the production build, and the temporary build database is removed only after its resolved path is confirmed inside the worktree.

- [ ] **Step 6: Commit**

```powershell
git add package.json lib/server/progress-api.mjs app/api/auth/login/route.ts app/api/progress/route.ts app/api/progress/migrate/route.ts tests/progress-api.test.mjs tests/production-server.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: expose versioned progress api"
```

### Task 5: Client synchronization controller and family access UI

**Files:**
- Create: `components/usePermanentProgress.ts`
- Create: `components/FamilyAccessGate.tsx`
- Create: `components/SyncStatus.tsx`
- Modify: `app/globals.css`
- Create: `tests/permanent-progress-contract.test.mjs`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `usePermanentProgress(createInitialState)` returning `{ state, setState, hydrated, access, sync, login, createFresh, retry }`.
- `access` is `"checking" | "login-required" | "needs-original-device" | "ready"`.
- `sync` is `{ phase: "checking" | "saving" | "saved" | "offline" | "conflict" | "error", message: string | null, lastSavedAt: string | null }`.
- `login(code)` authenticates, then GETs server progress; it migrates only when server is empty and `loadState()` returned a pre-existing valid state.
- `createFresh(code)` reauthenticates and migrates `createInitialState()` only after the gate's explicit confirmation.
- `setState` has the React `Dispatch<SetStateAction<LiteracyState>>` signature and synchronously updates `kids-literacy:v1` before queueing background sync.
- Consumes: Tasks 1 and 4.

- [ ] **Step 1: Write failing source contracts for the safety-critical flow**

Create `tests/permanent-progress-contract.test.mjs`:

```js
test("preserves the legacy local key and requires original-device migration", async () => {
  const [hook, storage] = await Promise.all([
    readFile(new URL("../components/usePermanentProgress.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/storage.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(storage, /kids-literacy:v1/);
  assert.match(hook, /needs-original-device/);
  assert.match(hook, /\/api\/progress\/migrate/);
  assert.doesNotMatch(hook, /removeItem\(STORAGE_KEY\)/);
});

test("serializes saves and handles offline plus revision conflict", async () => {
  const hook = await readFile(new URL("../components/usePermanentProgress.ts", import.meta.url), "utf8");
  assert.match(hook, /baseRevision/);
  assert.match(hook, /response\.status === 409/);
  assert.match(hook, /addEventListener\("online"/);
  assert.match(hook, /visibilitychange/);
});
```

Extend the rendered/source contract to require the Chinese messages `旧学习进度已永久保存`, `请先在原来学习的设备上登录并保存进度`, `网络断开，等待同步`, and a `重试` control.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/permanent-progress-contract.test.mjs
```

Expected: FAIL because the hook and UI components do not exist.

- [ ] **Step 3: Implement initialization and original-device migration**

In the hook's mount effect:

```ts
const saved = loadState() as LiteracyState | null;
const hasLegacyState = Boolean(saved && isLiteracyState(saved));
if (hasLegacyState) setInternalState(saved!);

const response = await fetch("/api/progress", { credentials: "same-origin", cache: "no-store" });
if (response.status === 401) setAccess("login-required");
else if ((await response.clone().json()).status === "empty") {
  if (hasLegacyState) await migrate(saved!);
  else setAccess("needs-original-device");
} else applyAuthoritativeServerState(await response.json());
```

Use an abort controller and an operation generation counter so stale initialization or save responses cannot update a newer page state. Applying server state must call `saveState(serverState)` and update revision, but must not mark that server-applied state as a new local edit.

- [ ] **Step 4: Implement ordered optimistic saves and recovery**

Maintain refs for `confirmedRevision`, `pendingSnapshot`, `saveInFlight`, and `lastServerJson`. Every local change saves synchronously and replaces `pendingSnapshot`. One `flush()` loop uploads snapshots serially:

Implement the dispatch-compatible setter by calculating from `stateRef.current` outside React's internal setter, then calling `saveState(next)`, updating the ref, calling `setInternalState(next)`, and queueing the snapshot in that order. This prevents React Strict Mode from repeating local-storage/network side effects inside a functional state updater.

```ts
while (pendingSnapshotRef.current && accessRef.current === "ready") {
  const snapshot = pendingSnapshotRef.current;
  pendingSnapshotRef.current = null;
  const response = await fetch("/api/progress", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: snapshot, baseRevision: revisionRef.current }),
  });
  if (response.status === 409) return resolveConflict(snapshot);
  if (!response.ok) return retainOffline(snapshot);
  revisionRef.current = (await response.json()).revision;
}
```

On conflict, save the rejected snapshot to `kids-literacy:conflict:v1`, GET server progress, use it as authoritative, and show `另一台设备已有更新，已载入最新进度，请重新完成刚才的操作`. On network error, put the latest snapshot back and keep local learning available. Add `online` and `visibilitychange` listeners and remove them on unmount.

- [ ] **Step 5: Implement access gate and save status UI**

`FamilyAccessGate` renders:

- six-digit numeric input with `inputMode="numeric"` and no persistence;
- login error without revealing whether server progress exists;
- original-device warning when `access === "needs-original-device"`;
- a two-step `创建全新进度` flow that asks for the code again and uses `window.confirm("服务器还没有学习进度。确定创建全新进度吗？此操作只适用于没有旧设备进度的家庭。")`.

`SyncStatus` maps phases to the exact messages in the spec and renders a `重试` button only for offline/error states. Add compact, touch-safe styles that do not cover learning controls.

- [ ] **Step 6: Verify GREEN**

Run:

```powershell
node --test tests/permanent-progress-contract.test.mjs tests/rendered-html.test.mjs
npm run test:unit
npm run lint
```

Expected: all tests pass and TypeScript/ESLint accept the hook and components.

- [ ] **Step 7: Commit**

```powershell
git add package.json components/usePermanentProgress.ts components/FamilyAccessGate.tsx components/SyncStatus.tsx app/globals.css tests/permanent-progress-contract.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: synchronize progress across family devices"
```

### Task 6: Integrate permanent state and immediate correct-answer progression

**Files:**
- Modify: `components/LiteracyApp.tsx`
- Modify: `components/ParentPanel.tsx`
- Modify: `lib/session-flow.mjs`
- Modify: `tests/session-flow.test.mjs`
- Modify: `tests/permanent-progress-contract.test.mjs`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- `LiteracyApp` consumes Task 5's hook instead of its local hydration/save effects and renders `FamilyAccessGate` plus `SyncStatus`.
- Produces: `getImmediateAnswerStep(index, total) -> { done: boolean, nextIndex: number }` in `lib/session-flow.mjs`.
- `ParentPanel` copy states that progress is permanently saved and shared; resetting creates the initial state and synchronizes it as an intentional remote reset after confirmation.

- [ ] **Step 1: Write failing immediate-progression tests**

Add to `tests/session-flow.test.mjs`:

```js
test("advances correct answers immediately or finishes the batch", () => {
  assert.deepEqual(getImmediateAnswerStep(0, 2), { done: false, nextIndex: 1 });
  assert.deepEqual(getImmediateAnswerStep(1, 2), { done: true, nextIndex: 1 });
});
```

Add source contracts asserting that `LiteracyApp` calls `usePermanentProgress`, renders `SyncStatus`, and that neither `answerLearning` nor `answerReview` schedules a success `setTimeout` or uses `getReviewFeedbackDelay`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/session-flow.test.mjs tests/permanent-progress-contract.test.mjs
```

Expected: FAIL because the helper and integration do not exist.

- [ ] **Step 3: Replace local-only hydration with the permanent-progress hook**

At the top of `LiteracyApp`:

```tsx
const {
  state, setState, hydrated, access, sync, login, createFresh, retry,
} = usePermanentProgress(initialState);
```

Remove the component's old `loadState`/`saveState` effects. Render the access gate until `access === "ready"`, but if a temporary network error occurs after local data was hydrated, keep the learning UI available and show the offline status. Render `SyncStatus` inside the top bar on every ready learning view.

- [ ] **Step 4: Remove correct-answer delays without weakening speech lock or undo**

For learning correct answers, record state and immediately use `getImmediateAnswerStep(queueIndex, nextQueue.length)` to increment `queueIndex` or show summary. For review correct answers, preserve `{ state, reviewIndex }` in `undoState`, record the answer, then call `continueReview(answeredIndex)` synchronously. Do not render positive feedback blocks.

Keep these branches unchanged in meaning:

```tsx
if (getAnswerDestination("review", correct) === "restudy") {
  setRestudyContext({ itemId: id, source: "review", answeredIndex });
  setView("restudy");
  return;
}
```

All answer buttons remain disabled while `isSpeaking`; `finishRestudyCard` continues to reject navigation until speech ends.

- [ ] **Step 5: Make reset wording match server behavior**

Change the parent-center copy to `学习进度会自动永久保存，并同步到使用同一家庭码的设备。` Change the confirmation to `确定清空所有设备上的学习进度并重新开始吗？服务器备份不会立即删除。` The reset must call `setState(initialState())`; it must not call `resetState()` before the synchronized replacement is safely queued.

- [ ] **Step 6: Verify GREEN and regress existing behavior**

Run:

```powershell
npm run test:unit
npm test
npm run lint
npm run build
```

Expected: all tests/builds pass; one-word display, restudy auto-speech, speech lock, undo, status search, and immediate correct progression remain covered.

- [ ] **Step 7: Commit**

```powershell
git add components/LiteracyApp.tsx components/ParentPanel.tsx lib/session-flow.mjs tests/session-flow.test.mjs tests/permanent-progress-contract.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: save answers immediately and permanently"
```

### Task 7: Backup tooling, service configuration, and operator documentation

**Files:**
- Create: `scripts/backup-progress.mjs`
- Create: `tests/backup-progress.test.mjs`
- Create: `deploy/kids-literacy-garden.service`
- Create: `deploy/kids-literacy-backup.service`
- Create: `deploy/kids-literacy-backup.timer`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `backupProgress({ databasePath, backupDirectory, now, keepDays }) -> Promise<{ backupPath, removed }>` using the `node:sqlite` backup API.
- CLI reads `LITERACY_DB_PATH`, optional `LITERACY_BACKUP_DIR`, and retains 30 daily backups.
- The systemd timer runs daily and the service uses the same unprivileged account and environment file as the application.

- [ ] **Step 1: Write failing backup tests**

Create a temporary SQLite progress database, run two dated backups, and assert both reopen with the same progress. Create one file older than 30 days and one newer file, then assert only the old managed backup is removed:

```js
test("creates a consistent restorable backup and prunes only expired managed files", async () => {
  const result = await backupProgress({ databasePath, backupDirectory, now, keepDays: 30 });
  assert.match(basename(result.backupPath), /^progress-\d{8}-\d{6}\.sqlite$/);
  const restored = openProgressDb(result.backupPath);
  assert.deepEqual(restored.getProgress("default").state, validState);
  assert.equal(existsSync(expiredManagedBackup), false);
  assert.equal(existsSync(unrelatedFile), true);
});
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests/backup-progress.test.mjs
```

Expected: FAIL because the backup module is missing.

- [ ] **Step 3: Implement safe backup and retention**

Use `backup(sourceDatabase, destinationPath)` from `node:sqlite`. Create the backup directory with mode `0700`; name files `progress-YYYYMMDD-HHmmss.sqlite`. Prune only files matching that exact pattern whose timestamp is older than 30 days. Never delete the live database, `-wal`, or `-shm` files.

- [ ] **Step 4: Add systemd units and README runbook**

The timer uses `OnCalendar=daily`, `Persistent=true`, and the service runs:

```ini
ExecStart=/usr/bin/node /opt/kids-literacy-garden/scripts/backup-progress.mjs
```

The application unit uses `User=www-data`, `Group=www-data`, `WorkingDirectory=/opt/kids-literacy-garden`, `EnvironmentFile=/etc/kids-literacy-garden.env`, `Environment=NODE_ENV=production`, `Environment=HOSTNAME=127.0.0.1`, `Environment=PORT=17303`, and:

```ini
ExecStart=/usr/bin/node /opt/kids-literacy-garden/node_modules/next/dist/bin/next start
Restart=on-failure
```

Before installation, verify `command -v node` is `/usr/bin/node`; if the host reports a different absolute path, replace `/usr/bin/node` consistently in both checked-in unit files and rerun their tests/build review before deployment.

Document:

- required `LITERACY_DB_PATH=/var/lib/kids-literacy/progress.sqlite` and `LITERACY_FAMILY_CODE_HASH`;
- how to generate the hash without logging the raw code;
- local test commands;
- original-device-first migration and the five stage-count check;
- daily backup location, retention, manual backup, and restore procedure;
- deploy rollback rule that never replaces `/var/lib/kids-literacy`.

- [ ] **Step 5: Verify backup, docs, and full build**

Run:

```powershell
node --test tests/backup-progress.test.mjs
npm run test:unit
npm run lint
npm run build
```

Expected: all commands pass; the README contains the two persistent server paths and original-device migration warning.

- [ ] **Step 6: Commit**

```powershell
git add package.json scripts/backup-progress.mjs tests/backup-progress.test.mjs deploy/kids-literacy-garden.service deploy/kids-literacy-backup.service deploy/kids-literacy-backup.timer README.md
git commit -m "ops: add permanent progress backups"
```

### Task 8: Local browser acceptance, Aliyun deployment, and protected migration

**Files:**
- Create during verification: `output/playwright/permanent-progress/` screenshots and trace files (ignored artifacts)
- Modify only if a verified defect is found: the smallest affected source/test file
- Server state: `/opt/kids-literacy-garden`, `/var/lib/kids-literacy`, `/var/backups/kids-literacy`, `/etc/systemd/system/kids-literacy-garden.service`, and `/etc/systemd/system/kids-literacy-backup.*`

**Interfaces:**
- Consumes: all previous tasks and the existing SSH key `C:\Users\allon\.ssh\aliyun_106_14_134_49` for `root@106.14.134.49`.
- Produces: a verified `https://z.allon.me`, one family code delivered to the parent, migrated original learning progress, daily backup timer, and a release record containing before/after stage counts without exposing individual state JSON.

- [ ] **Step 1: Run the complete automated release gate**

```powershell
git status --short
git diff --check
npm run test:unit
npm test
npm run lint
npm run build
```

Expected: working tree is clean except ignored browser artifacts; every verification command exits 0.

- [ ] **Step 2: Run a local two-context browser script before touching production**

Start the production server with a temporary database and generated test hash. In browser context A, seed `kids-literacy:v1` with a fixture containing distinct stage counts and custom settings, log in, and verify `旧学习进度已永久保存`. Refresh and confirm exact counts. In context B, log in with the same code and confirm identical counts/settings. Answer correctly and verify the character changes in the same animation frame after the click; confirm no old speech continues. Save desktop and `820x1180` screenshots.

Then block the API or set the context offline, answer once, confirm `网络断开，等待同步`, restore network, click `重试`, and confirm `已永久保存`. Finally create a stale revision in context B and confirm it receives the conflict message and cannot overwrite context A.

- [ ] **Step 3: Back up the current production app and prepare persistent storage**

Resolve and verify each target remains under the named server directory before moving/copying. Over SSH:

```bash
systemctl status kids-literacy-garden --no-pager
install -d -m 700 -o www-data -g www-data /var/lib/kids-literacy /var/backups/kids-literacy
cp -a /opt/kids-literacy-garden /opt/kids-literacy-garden.backup-$(date +%Y%m%d-%H%M%S)
```

If a database already exists, run the new backup script before release. Do not copy, replace, or delete `/var/lib/kids-literacy` during the app backup.

- [ ] **Step 4: Generate and install production authentication without exposing the code in logs**

Generate a random six-digit code locally using a cryptographically secure generator, compute its hash locally, and write only the hash plus `LITERACY_DB_PATH` to the service environment file. Do not pass the raw code as an SSH command argument, environment value in shell history, or service file. Keep the raw code only long enough to deliver it to the parent and perform first login.

- [ ] **Step 5: Deploy the application and backup timer**

Upload the exact committed source/build, install production dependencies, and run the standard `next build` in a new timestamped release directory. Atomically point `/opt/kids-literacy-garden` to the new release only after a successful build. Install the application unit and the two backup units, then run:

```bash
systemctl daemon-reload
systemctl restart kids-literacy-garden
systemctl enable --now kids-literacy-backup.timer
systemctl start kids-literacy-backup.service
systemctl status kids-literacy-garden kids-literacy-backup.timer --no-pager
journalctl -u kids-literacy-garden -n 100 --no-pager
```

Expected: app and timer are active, manual backup succeeds, logs contain no family code or full state, and nginx still returns HTTP 200 for `https://z.allon.me`.

- [ ] **Step 6: Pause blank-browser production testing until the original browser migrates**

Open `https://z.allon.me` in the original Brave profile that currently holds the real `kids-literacy:v1`. Before entering the family code, record counts for `待学习`, `待复习`, `每周复习`, `每两周复习`, and `已掌握`, plus learning settings. Enter the family code once. Require the exact success text `旧学习进度已永久保存`; refresh and compare every recorded count and setting. If any value differs, stop, keep the original local storage untouched, inspect the server backup/database, and do not log in from a second device.

- [ ] **Step 7: Complete production user-operation acceptance**

After Step 6 succeeds:

1. Log in on a second browser context and compare all five stage counts and settings.
2. Start a review, wait for speech to finish, click `会`, and confirm the next character appears immediately.
3. Click `不会`, confirm the restudy page automatically speaks and `我学好了，下一个` remains locked until speech ends.
4. Go offline, answer, verify the pending message, reconnect, and verify permanent save.
5. Create a controlled stale tab, verify the conflict warning and authoritative reload.
6. Restart `kids-literacy-garden`, refresh both devices, and confirm state survives.
7. Check no console errors, horizontal overflow, API 5xx, or secret-bearing logs; save final desktop and iPad screenshots.

Failure recovery: keep using the original browser-local copy, roll the application symlink back to the pre-release backup if the UI/API fails, and leave `/var/lib/kids-literacy/progress.sqlite` untouched. Restore a database backup only after stopping the service and verifying the selected backup in a temporary SQLite open.

- [ ] **Step 8: Commit any verified surgical fix, push, and record release state**

If acceptance required a code fix, add its failing regression test first, commit only the affected files, rerun Steps 1, 2, and 7, then push the verified branch. Record the deployed commit hash, backup filename, migration confirmation time, and before/after aggregate counts; never record the family code or raw progress JSON.

Expected: the original progress is permanently stored, the second device matches, correct answers advance immediately, offline recovery succeeds, and a service restart preserves all progress.
