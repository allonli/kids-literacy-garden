import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_COOKIE_NAME,
  createDeviceToken,
  createSessionCookie,
  hashDeviceToken,
  hashFamilyCode,
  readCookie,
  verifyFamilyCode,
} from "../lib/server/family-auth.mjs";

test("hashes and verifies only the exact six-digit family code", async () => {
  const encoded = await hashFamilyCode("482731", Buffer.alloc(16, 7));
  assert.equal(await verifyFamilyCode("482731", encoded), true);
  assert.equal(await verifyFamilyCode("482732", encoded), false);
  assert.equal(await verifyFamilyCode("48 2731", encoded), false);
  await assert.rejects(() => hashFamilyCode("12345"), /六位数字/);
});

test("stores a different deterministic hash from the raw device token", () => {
  const token = createDeviceToken();
  assert.notEqual(token.raw, token.hash);
  assert.equal(hashDeviceToken(token.raw), token.hash);
  assert.match(token.raw, /^[A-Za-z0-9_-]+$/);
});

test("creates a protected 180-day production cookie", () => {
  const cookie = createSessionCookie("raw-token", true);
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=raw-token`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=15552000/);
});

test("reads an exact cookie without confusing similarly named cookies", () => {
  const request = new Request("https://z.allon.me/api/progress", {
    headers: { cookie: `prefix_${SESSION_COOKIE_NAME}=wrong; ${SESSION_COOKIE_NAME}=right%20token` },
  });
  assert.equal(readCookie(request, SESSION_COOKIE_NAME), "right token");
});
