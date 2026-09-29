import assert from "node:assert/strict";
import test from "node:test";

import { createLoginRateLimiter } from "../lib/server/login-rate-limit.mjs";

test("rejects the sixth failed login within ten minutes", () => {
  const limiter = createLoginRateLimiter({ maxFailures: 5, windowMs: 600_000 });
  const now = 1_000_000;
  for (let index = 0; index < 5; index += 1) {
    assert.equal(limiter.check("203.0.113.7", now).allowed, true);
    limiter.fail("203.0.113.7", now);
  }
  assert.equal(limiter.check("203.0.113.7", now).allowed, false);
});

test("clears failures after success and expires the failure window", () => {
  const limiter = createLoginRateLimiter({ maxFailures: 1, windowMs: 600_000 });
  limiter.fail("203.0.113.7", 1_000_000);
  assert.equal(limiter.check("203.0.113.7", 1_000_001).allowed, false);
  limiter.clear("203.0.113.7");
  assert.equal(limiter.check("203.0.113.7", 1_000_001).allowed, true);
  limiter.fail("203.0.113.7", 1_000_001);
  assert.equal(limiter.check("203.0.113.7", 1_600_002).allowed, true);
});
