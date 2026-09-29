import { dirname, join, resolve } from "node:path";

import { createLoginRateLimiter } from "./login-rate-limit.mjs";
import { openProgressDb } from "./progress-db.mjs";
import { createBackupStore } from "./ios-backup-store.mjs";

let dependencies;

export function getProgressApiDependencies() {
  if (dependencies) return dependencies;
  const production = process.env.NODE_ENV === "production";
  const databasePath = process.env.LITERACY_DB_PATH || (production ? "" : resolve(".data/progress.sqlite"));
  const familyCodeHash = process.env.LITERACY_FAMILY_CODE_HASH;
  if (!databasePath) throw new Error("生产环境缺少 LITERACY_DB_PATH");
  if (!familyCodeHash) throw new Error("缺少 LITERACY_FAMILY_CODE_HASH");
  dependencies = {
    db: openProgressDb(databasePath),
    familyCodeHash,
    rateLimiter: createLoginRateLimiter({ maxFailures: 5, windowMs: 600_000 }),
    backupRateLimiter: createLoginRateLimiter({ maxFailures: 6, windowMs: 600_000 }),
    backupStore: createBackupStore(process.env.LITERACY_IOS_BACKUP_DIR || join(dirname(databasePath), "ios-backups")),
    production,
    now: () => new Date(),
  };
  return dependencies;
}
