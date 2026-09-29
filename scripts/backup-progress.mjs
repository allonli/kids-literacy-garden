import { mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

const DAY_MS = 24 * 60 * 60 * 1000;
const MANAGED_BACKUP = /^progress-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.sqlite$/;

function pad(value) {
  return String(value).padStart(2, "0");
}

function backupName(now) {
  return `progress-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}.sqlite`;
}

function timestampFromName(name) {
  const match = MANAGED_BACKUP.exec(name);
  if (!match) return null;
  return Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6]),
  );
}

export async function backupProgress({ databasePath, backupDirectory, now = new Date(), keepDays = 30 }) {
  if (!databasePath) throw new Error("缺少 LITERACY_DB_PATH");
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const backupPath = join(backupDirectory, backupName(now));
  const source = new DatabaseSync(databasePath);
  try {
    await backup(source, backupPath);
  } finally {
    source.close();
  }

  const cutoff = now.getTime() - keepDays * DAY_MS;
  const removed = [];
  for (const name of readdirSync(backupDirectory)) {
    const timestamp = timestampFromName(name);
    if (timestamp === null || timestamp >= cutoff || name === basename(backupPath)) continue;
    const candidate = join(backupDirectory, name);
    rmSync(candidate, { force: true });
    removed.push(candidate);
  }
  return { backupPath, removed };
}

export function isSameExecutable(entryPath, modulePath) {
  if (!entryPath) return false;
  try {
    // 发布目录使用 current 软链接时，入口路径和模块真实路径仍应视为同一文件。
    return realpathSync(entryPath) === realpathSync(modulePath);
  } catch {
    return resolve(entryPath) === resolve(modulePath);
  }
}

const isMain = isSameExecutable(process.argv[1], fileURLToPath(import.meta.url));
if (isMain) {
  const result = await backupProgress({
    databasePath: process.env.LITERACY_DB_PATH,
    backupDirectory: process.env.LITERACY_BACKUP_DIR || "/var/backups/kids-literacy",
    keepDays: 30,
  });
  process.stdout.write(`${result.backupPath}\n`);
}
