import { assertLiteracyState, isLiteracyState } from "./progress-state.mjs";
import {
  clearConflictSnapshot,
  loadSyncMeta,
  reduceSyncMeta,
  saveConflictSnapshot,
  saveSyncMeta,
} from "./progress-sync.mjs";
import { accountStorage, loadState, saveState } from "./storage.mjs";

async function readBody(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function createProgressSyncController(options) {
  const accountId = options.accountId ?? "default";
  const storage = accountStorage(options.storage ?? globalThis.localStorage, accountId);
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const abortController = new AbortController();
  const now = options.now ?? (() => new Date());
  const listeners = new Set();
  let state = options.initialState();
  let hydrated = false;
  let access = "checking";
  let sync = loadSyncMeta(storage);
  let hadLegacyState = false;
  let pendingSnapshot = sync.pending ? loadState(storage) : null;
  let saveInFlight = null;
  let startPromise = null;
  let destroyed = false;

  function snapshot() {
    return { accountId, state, hydrated, access, sync };
  }

  function emit() {
    if (destroyed) return;
    for (const listener of listeners) listener(snapshot());
  }

  function setSync(event) {
    if (destroyed) return;
    sync = reduceSyncMeta(sync, event);
    saveSyncMeta(sync, storage);
    emit();
  }

  function applyServer(payload, message) {
    if (destroyed) return;
    const nextState = assertLiteracyState(payload.state);
    state = nextState;
    saveState(nextState, storage);
    pendingSnapshot = null;
    access = "ready";
    clearConflictSnapshot(storage);
    setSync({ type: "SAVED", revision: payload.revision, at: payload.updatedAt, message });
  }

  async function requestProgress() {
    return fetchImpl(progressUrl(), { credentials: "same-origin", cache: "no-store", signal: abortController.signal });
  }

  function progressUrl() {
    // 新账户使用旧程序不存在的地址，回滚时也不能把新账户写进原账户。
    return accountId === "default" ? "/api/progress" : `/api/account-progress?accountId=${encodeURIComponent(accountId)}`;
  }

  async function readProgressBody(response) {
    const payload = await readBody(response);
    if (destroyed) throw new Error("学习账户已切换");
    if (response.ok && payload.accountId !== accountId && !(accountId === "default" && payload.accountId === undefined)) {
      throw Object.assign(new Error("学习账户信息不匹配，请刷新页面后重试"), { code: "ACCOUNT_MISMATCH" });
    }
    return payload;
  }

  async function resolveConflict(rejectedState) {
    const conflictState = pendingSnapshot ?? rejectedState;
    pendingSnapshot = null;
    const detectedAt = now().toISOString();
    const response = await requestProgress();
    if (!response.ok) throw new Error("无法读取服务器最新进度");
    const payload = await readProgressBody(response);
    if (payload.status !== "ready") throw new Error("服务器进度状态异常");
    saveConflictSnapshot({ state: conflictState, detectedAt, serverRevision: payload.revision }, storage);
    state = assertLiteracyState(payload.state);
    saveState(state, storage);
    access = "ready";
    sync = reduceSyncMeta(sync, {
      type: "CONFLICT",
      revision: payload.revision,
      message: "另一台设备已有更新，已载入最新进度，请重新完成刚才的操作",
    });
    saveSyncMeta(sync, storage);
    emit();
  }

  async function migrate(localState) {
    if (accountId !== "default") throw new Error("新学习账户不能导入原账户的旧缓存");
    const response = await fetchImpl("/api/progress/migrate", {
      method: "POST",
      credentials: "same-origin",
      signal: abortController.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: assertLiteracyState(localState) }),
    });
    const payload = await readProgressBody(response);
    if (!response.ok) throw new Error(payload.error || "旧学习进度保存失败");
    applyServer(payload, payload.status === "migrated" ? "旧学习进度已永久保存" : "已载入服务器学习进度");
  }

  async function bootstrap() {
    setSync({ type: "START_CHECK" });
    try {
      const response = await requestProgress();
      if (destroyed) return;
      if (response.status === 401) {
        access = "login-required";
        sync = { ...sync, phase: "error", message: "请输入家庭码以永久保存学习进度" };
        saveSyncMeta(sync, storage);
        emit();
        return;
      }
      const payload = await readProgressBody(response);
      if (response.status === 404 || (payload.status === "empty" && accountId !== "default")) {
        access = "login-required";
        setSync({ type: "ERROR", message: "找不到这个学习账户，请返回原有账户后重新选择" });
        return;
      }
      if (!response.ok) throw new Error(payload.error || "无法读取学习进度");
      if (payload.status === "empty") {
        if (hadLegacyState) await migrate(state);
        else {
          access = "needs-original-device";
          sync = { ...sync, phase: "error", message: "请先在原来学习的设备上登录并保存进度" };
          saveSyncMeta(sync, storage);
          emit();
        }
        return;
      }

      if (sync.pending && pendingSnapshot) {
        access = "ready";
        if (payload.revision === sync.revision) await flush();
        else await resolveConflict(pendingSnapshot);
        return;
      }
      applyServer(payload, "已永久保存");
    } catch (error) {
      if (destroyed) return;
      if (error.code === "ACCOUNT_MISMATCH") {
        access = "login-required";
        setSync({ type: "ERROR", message: error.message });
        return;
      }
      if (hadLegacyState) {
        access = "ready";
        pendingSnapshot = pendingSnapshot ?? state;
      } else {
        access = "login-required";
      }
      setSync({ type: "OFFLINE" });
    }
  }

  async function authenticate(code) {
    if (destroyed) return false;
    access = "checking";
    emit();
    try {
      const response = await fetchImpl("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        signal: abortController.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await readBody(response);
      if (destroyed) return false;
      if (!response.ok) {
        access = "login-required";
        sync = { ...sync, phase: "error", message: payload.error || "家庭码验证失败" };
        saveSyncMeta(sync, storage);
        emit();
        return false;
      }
      return true;
    } catch {
      if (destroyed) return false;
      access = "login-required";
      setSync({ type: "OFFLINE" });
      return false;
    }
  }

  async function flush() {
    if (destroyed || saveInFlight || access !== "ready" || !pendingSnapshot) return saveInFlight;
    saveInFlight = (async () => {
      while (!destroyed && pendingSnapshot && access === "ready") {
        const submitting = pendingSnapshot;
        pendingSnapshot = null;
        setSync({ type: "SAVING" });
        try {
          const response = await fetchImpl(progressUrl(), {
            method: "PUT",
            credentials: "same-origin",
            signal: abortController.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: submitting, baseRevision: sync.revision }),
          });
          if (destroyed) return;
          if (response.status === 409) {
            await resolveConflict(submitting);
            return;
          }
          const payload = await readProgressBody(response);
          if (response.status === 401) {
            pendingSnapshot = pendingSnapshot ?? submitting;
            access = "login-required";
            sync = { ...sync, pending: true, phase: "error", message: "登录已过期，请重新输入家庭码" };
            saveSyncMeta(sync, storage);
            emit();
            return;
          }
          if (!response.ok) throw new Error(payload.error || "保存失败");
          sync = reduceSyncMeta(sync, { type: "SAVED", revision: payload.revision, at: payload.updatedAt });
          if (pendingSnapshot) sync = reduceSyncMeta(sync, { type: "QUEUE" });
          saveSyncMeta(sync, storage);
          emit();
        } catch (error) {
          if (destroyed) return;
          pendingSnapshot = pendingSnapshot ?? submitting;
          setSync(error.code === "ACCOUNT_MISMATCH" ? { type: "ERROR", message: error.message } : { type: "OFFLINE" });
          return;
        }
      }
    })().finally(() => { saveInFlight = null; });
    return saveInFlight;
  }

  async function checkLatest() {
    if (destroyed) return;
    if (saveInFlight || pendingSnapshot) return flush();
    const requestedState = state;
    const requestedRevision = sync.revision;
    try {
      const response = await requestProgress();
      const payload = await readProgressBody(response);
      // 后台读取期间可能发生新的本地操作，旧响应不能覆盖状态或清空待保存队列。
      if (destroyed || saveInFlight || pendingSnapshot || state !== requestedState || sync.revision !== requestedRevision) return;
      if (response.status === 401) {
        access = "login-required";
        sync = { ...sync, phase: "error", message: "登录已过期，请重新输入家庭码" };
        saveSyncMeta(sync, storage);
        emit();
        return;
      }
      if (!response.ok) throw new Error();
      if (payload.status === "ready" && payload.revision > sync.revision) {
        applyServer(payload, "已载入最新进度");
      } else if (payload.status === "ready") {
        setSync({ type: "SAVED", revision: sync.revision, at: payload.updatedAt });
      }
    } catch (error) {
      if (destroyed || saveInFlight || pendingSnapshot || state !== requestedState || sync.revision !== requestedRevision) return;
      setSync(error.code === "ACCOUNT_MISMATCH" ? { type: "ERROR", message: error.message } : { type: "OFFLINE" });
    }
  }

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (destroyed) return Promise.resolve();
      if (!startPromise) startPromise = (async () => {
        const saved = loadState(storage);
        hadLegacyState = isLiteracyState(saved);
        if (hadLegacyState) state = saved;
        hydrated = true;
        emit();
        await bootstrap();
      })();
      return startPromise;
    },
    async login(code) {
      if (!await authenticate(code)) return false;
      await bootstrap();
      return access === "ready";
    },
    async createFresh(code) {
      if (!await authenticate(code)) return false;
      try {
        await migrate(options.initialState());
        return !destroyed;
      } catch (error) {
        if (destroyed) return false;
        access = "needs-original-device";
        setSync({ type: "ERROR", message: error.message || "创建学习进度失败，请重试" });
        return false;
      }
    },
    async update(action) {
      if (destroyed) return;
      const nextState = assertLiteracyState(typeof action === "function" ? action(state) : action);
      state = nextState;
      hadLegacyState = true;
      saveState(nextState, storage);
      pendingSnapshot = nextState;
      setSync({ type: "QUEUE" });
      await flush();
    },
    retry() {
      return pendingSnapshot ? flush() : checkLatest();
    },
    checkLatest,
    destroy() {
      destroyed = true;
      abortController.abort();
      listeners.clear();
    },
  };
}
