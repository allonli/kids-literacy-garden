import assert from "node:assert/strict";
import test from "node:test";

import { assertSameOrigin, getClientAddress, getRequestOrigin } from "../lib/server/request-security.mjs";

test("uses trusted proxy headers to reconstruct the public origin", () => {
  const request = new Request("http://127.0.0.1:17303/api/progress", {
    headers: {
      host: "127.0.0.1:17303",
      "x-forwarded-host": "z.allon.me",
      "x-forwarded-proto": "https",
      origin: "https://z.allon.me",
    },
  });
  assert.equal(getRequestOrigin(request), "https://z.allon.me");
  assert.doesNotThrow(() => assertSameOrigin(request));
});

test("rejects a cross-origin write", () => {
  const request = new Request("https://z.allon.me/api/progress", {
    headers: { host: "z.allon.me", origin: "https://attacker.example" },
  });
  assert.throws(() => assertSameOrigin(request), (error) => error.status === 403);
});

test("uses the first forwarded client address", () => {
  const request = new Request("https://z.allon.me/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.7, 127.0.0.1" },
  });
  assert.equal(getClientAddress(request), "203.0.113.7");
});
