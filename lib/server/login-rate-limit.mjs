export function createLoginRateLimiter({ maxFailures = 5, windowMs = 600_000 } = {}) {
  const failures = new Map();

  function current(key, now) {
    const entry = failures.get(key);
    if (!entry || now - entry.startedAt >= windowMs) {
      if (entry) failures.delete(key);
      return null;
    }
    return entry;
  }

  return {
    check(key, now = Date.now()) {
      const entry = current(key, now);
      if (!entry || entry.count < maxFailures) return { allowed: true, retryAfterMs: 0 };
      return { allowed: false, retryAfterMs: Math.max(1, entry.startedAt + windowMs - now) };
    },

    fail(key, now = Date.now()) {
      const entry = current(key, now);
      failures.set(key, entry
        ? { ...entry, count: entry.count + 1 }
        : { count: 1, startedAt: now });
    },

    clear(key) {
      failures.delete(key);
    },
  };
}
