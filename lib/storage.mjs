export const STORAGE_KEY = "kids-literacy:v1";

// 原账户保留旧缓存键；新账户的进度、同步版本和冲突快照共用独立命名空间。
export function accountStorage(storage, accountId = "default") {
  if (!storage || accountId === "default") return storage;
  const prefix = `kids-literacy:account:${encodeURIComponent(accountId)}:`;
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
  };
}

export function loadState(storage = globalThis.localStorage) {
  if (!storage) return null;
  try {
    const value = storage.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(storage = globalThis.localStorage) {
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}
