import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lifetime = 24 * 3600_000;
const hash = (value) => createHash("sha256").update(value).digest("hex");

export function createBackupStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  function read(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
  function write(path, value) {
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" }); renameSync(temporary, path); }
    finally { rmSync(temporary, { force: true }); }
  }
  const ownerPath = (familyId) => join(directory, `family-${hash(familyId)}.json`);
  const documentPath = (digest) => join(directory, `backup-${digest}.json`);
  function active(familyId, now) {
    const index = read(ownerPath(familyId));
    if (!index) return null;
    if (index.expiresAt <= now.toISOString()) {
      rmSync(documentPath(index.digest), { force: true }); rmSync(ownerPath(familyId), { force: true });
      return null;
    }
    return index;
  }
  return {
    create(familyId, document, now) {
      const previous = read(ownerPath(familyId));
      const token = randomBytes(32).toString("hex"), digest = hash(token);
      const expiresAt = new Date(now.getTime() + lifetime).toISOString();
      write(documentPath(digest), { familyId, expiresAt, document });
      try { write(ownerPath(familyId), { digest, expiresAt }); }
      catch (error) { rmSync(documentPath(digest), { force: true }); throw error; }
      if (previous) rmSync(documentPath(previous.digest), { force: true });
      return { token, expiresAt };
    },
    status(familyId, now) { const entry = active(familyId, now); return entry ? { active: true, expiresAt: entry.expiresAt } : { active: false }; },
    revoke(familyId) {
      const previous = read(ownerPath(familyId));
      if (previous) rmSync(documentPath(previous.digest), { force: true });
      rmSync(ownerPath(familyId), { force: true });
    },
    download(token, now) {
      if (!/^[a-f0-9]{64}$/.test(token)) return null;
      const digest = hash(token), entry = read(documentPath(digest));
      if (!entry) return null;
      if (entry.expiresAt <= now.toISOString()) { rmSync(documentPath(digest), { force: true }); return null; }
      if (active(entry.familyId, now)?.digest !== digest) return null;
      return entry.document;
    },
  };
}
