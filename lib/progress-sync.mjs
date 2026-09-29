export const SYNC_STORAGE_KEY = "kids-literacy:sync:v1";
export const CONFLICT_STORAGE_KEY = "kids-literacy:conflict:v1";

export const EMPTY_SYNC_META = Object.freeze({
  revision: 0,
  pending: false,
  phase: "checking",
  lastSavedAt: null,
  message: null,
});

const PHASES = new Set(["checking", "saving", "saved", "offline", "conflict", "error"]);

function validMeta(value) {
  return Boolean(value
    && Number.isInteger(value.revision)
    && value.revision >= 0
    && typeof value.pending === "boolean"
    && PHASES.has(value.phase)
    && (value.lastSavedAt === null || typeof value.lastSavedAt === "string")
    && (value.message === null || typeof value.message === "string"));
}

export function loadSyncMeta(storage = globalThis.localStorage) {
  if (!storage) return { ...EMPTY_SYNC_META };
  try {
    const parsed = JSON.parse(storage.getItem(SYNC_STORAGE_KEY));
    return validMeta(parsed) ? parsed : { ...EMPTY_SYNC_META };
  } catch {
    return { ...EMPTY_SYNC_META };
  }
}

export function saveSyncMeta(meta, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(SYNC_STORAGE_KEY, JSON.stringify(meta));
}

export function saveConflictSnapshot(snapshot, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(CONFLICT_STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearConflictSnapshot(storage = globalThis.localStorage) {
  if (!storage) return;
  storage.removeItem(CONFLICT_STORAGE_KEY);
}

export function reduceSyncMeta(meta, event) {
  switch (event.type) {
    case "START_CHECK":
      return { ...meta, phase: "checking", message: null };
    case "QUEUE":
      return { ...meta, pending: true, phase: "saving", message: "保存中…" };
    case "SAVING":
      return { ...meta, pending: true, phase: "saving", message: "保存中…" };
    case "SAVED":
      return { revision: event.revision, pending: false, phase: "saved", lastSavedAt: event.at, message: event.message ?? "已永久保存" };
    case "OFFLINE":
      return { ...meta, pending: true, phase: "offline", message: "网络断开，等待同步" };
    case "CONFLICT":
      return { ...meta, revision: event.revision ?? meta.revision, pending: false, phase: "conflict", message: event.message ?? "另一台设备已有更新，已载入最新进度，请重新完成刚才的操作" };
    case "ERROR":
      return { ...meta, pending: true, phase: "error", message: event.message ?? "保存失败，请重试" };
    default:
      return meta;
  }
}
