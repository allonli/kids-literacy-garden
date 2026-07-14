import assert from "node:assert/strict";
import test from "node:test";

import { rankWords } from "../lib/word-recommendation.mjs";

test("curated child-friendly words outrank dictionary candidates", () => {
  const result = rankWords(
    "情",
    ["情报部门", "感情", "事情", "心情"],
    new Set(["心", "事"]),
    ["心情", "事情"],
  );
  assert.deepEqual(result, ["心情", "事情", "感情"]);
});

test("words made from learned companion characters rank ahead of unknown companions", () => {
  const result = rankWords(
    "桥",
    ["桥梁", "木桥", "石桥", "桥头"],
    new Set(["木", "头"]),
  );
  assert.deepEqual(result.slice(0, 2), ["木桥", "桥头"]);
});

test("ranking removes duplicates and keeps at most three natural short suggestions", () => {
  const result = rankWords("清", ["清水", "清水", "清早", "清清楚楚", "清理"], new Set(["水", "早"]));
  assert.deepEqual(result, ["清水", "清早", "清理"]);
});
