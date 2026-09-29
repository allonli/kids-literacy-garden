import { DEVICE_SESSION_SECONDS, SESSION_COOKIE_NAME, createDeviceToken, createSessionCookie, hashDeviceToken, readCookie, verifyFamilyCode } from "./family-auth.mjs";
import { assertSameOrigin, getClientAddress } from "./request-security.mjs";
import { MAX_PROGRESS_BYTES, assertLiteracyState } from "../progress-state.mjs";
import { DEFAULT_ACCOUNT_ID, normalizeAccountName } from "../learning-accounts.mjs";

const FAMILY_ID = "default";

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_PROGRESS_BYTES) throw httpError(413, "PAYLOAD_TOO_LARGE", "学习进度超过 5MB");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PROGRESS_BYTES) {
    throw httpError(413, "PAYLOAD_TOO_LARGE", "学习进度超过 5MB");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, "INVALID_JSON", "请求格式无效");
  }
}

function errorResponse(error) {
  const status = Number(error?.status) || (error instanceof RangeError ? 413 : 400);
  const code = error?.code || (status === 403 ? "CROSS_ORIGIN" : status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST");
  return json({ error: error instanceof Error ? error.message : "请求失败", code }, status);
}

function progressBody(status, progress, accountId = DEFAULT_ACCOUNT_ID) {
  return {
    status,
    accountId,
    state: progress.state,
    revision: progress.revision,
    updatedAt: progress.updatedAt,
  };
}

function requestAccountId(request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  // 新账户使用旧版不存在的路由；服务回滚后也不能误写原账户。
  if (url.pathname === "/api/account-progress") {
    if (!accountId || accountId === DEFAULT_ACCOUNT_ID) throw httpError(400, "INVALID_ACCOUNT", "请选择需要读取或保存的学习账户");
    return accountId;
  }
  if (accountId !== null && accountId !== DEFAULT_ACCOUNT_ID) throw httpError(400, "INVALID_ACCOUNT_ROUTE", "新学习账户请使用专用进度接口");
  return DEFAULT_ACCOUNT_ID;
}

function requireAccount(familyId, accountId, deps) {
  const progress = deps.db.getAccountProgress(familyId, accountId);
  if (!progress && accountId !== DEFAULT_ACCOUNT_ID) throw httpError(404, "ACCOUNT_NOT_FOUND", "学习账户不存在");
  return progress;
}

async function requireFamily(request, deps) {
  const raw = readCookie(request, SESSION_COOKIE_NAME);
  if (!raw) throw httpError(401, "LOGIN_REQUIRED", "请先输入家庭码");
  const tokenHash = hashDeviceToken(raw);
  const now = deps.now();
  const session = deps.db.getSession(tokenHash, now);
  if (!session) throw httpError(401, "SESSION_EXPIRED", "登录已过期，请重新输入家庭码");
  deps.db.touchSession(tokenHash, now);
  return session.familyId;
}

export async function login(request, deps) {
  try {
    assertSameOrigin(request);
    const address = getClientAddress(request);
    const now = deps.now();
    const limit = deps.rateLimiter.check(address, now.getTime());
    if (!limit.allowed) {
      return json(
        { error: "尝试次数过多，请稍后再试", code: "RATE_LIMITED" },
        429,
        { "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)) },
      );
    }

    const body = await readJson(request);
    if (!await verifyFamilyCode(body?.code, deps.familyCodeHash)) {
      deps.rateLimiter.fail(address, now.getTime());
      throw httpError(401, "INVALID_CODE", "家庭码不正确");
    }

    deps.rateLimiter.clear(address);
    const token = createDeviceToken();
    const expiresAt = new Date(now.getTime() + DEVICE_SESSION_SECONDS * 1000);
    deps.db.createSession(token.hash, FAMILY_ID, now, expiresAt);
    return json(
      { status: "authenticated" },
      200,
      { "set-cookie": createSessionCookie(token.raw, deps.production) },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function getProgress(request, deps) {
  try {
    const familyId = await requireFamily(request, deps);
    const accountId = requestAccountId(request);
    const progress = requireAccount(familyId, accountId, deps);
    return progress ? json(progressBody("ready", progress, accountId)) : json({ status: "empty", accountId });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function migrateProgress(request, deps) {
  try {
    assertSameOrigin(request);
    const familyId = await requireFamily(request, deps);
    if ((new URL(request.url).searchParams.get("accountId") ?? DEFAULT_ACCOUNT_ID) !== DEFAULT_ACCOUNT_ID) throw httpError(400, "MIGRATION_NOT_ALLOWED", "只有原有账户可以迁移旧设备进度");
    const body = await readJson(request);
    const state = assertLiteracyState(body?.state);
    const result = deps.db.migrateProgress(familyId, state, deps.now());
    return json(progressBody(result.created ? "migrated" : "ready", result.progress), result.created ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function putProgress(request, deps) {
  try {
    assertSameOrigin(request);
    const familyId = await requireFamily(request, deps);
    const accountId = requestAccountId(request);
    requireAccount(familyId, accountId, deps);
    const body = await readJson(request);
    if (!Number.isInteger(body?.baseRevision) || body.baseRevision < 0) {
      throw httpError(400, "INVALID_REVISION", "服务器版本号无效");
    }
    const state = assertLiteracyState(body.state);
    const result = deps.db.updateAccountProgress(familyId, accountId, state, body.baseRevision, deps.now());
    if (!result.ok) {
      return json({ error: "另一台设备已有更新", code: "REVISION_CONFLICT", accountId, ...result.conflict }, 409);
    }
    return json(progressBody("ready", result.progress, accountId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function listAccounts(request, deps) {
  try {
    const familyId = await requireFamily(request, deps);
    return json({ accounts: deps.db.listAccounts(familyId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function createAccount(request, deps) {
  try {
    assertSameOrigin(request);
    const familyId = await requireFamily(request, deps);
    const body = await readJson(request);
    const name = normalizeAccountName(body?.name);
    if (typeof body?.sourceAccountId !== "string") throw httpError(400, "INVALID_SOURCE", "请选择要复制字库的学习账户");
    const account = deps.db.createAccount(familyId, name, body.sourceAccountId, deps.now());
    return json({ account, accounts: deps.db.listAccounts(familyId) }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
