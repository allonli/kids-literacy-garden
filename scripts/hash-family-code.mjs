import { stdin, stdout } from "node:process";

import { hashFamilyCode } from "../lib/server/family-auth.mjs";

async function readStdin() {
  let value = "";
  for await (const chunk of stdin) value += chunk;
  return value.trim();
}

const code = process.argv[2] ?? await readStdin();
stdout.write(`${await hashFamilyCode(code)}\n`);
