import { SESSION_COOKIE_NAME, readCookie, hashDeviceToken } from "./family-auth.mjs";
import { assertSameOrigin, getClientAddress } from "./request-security.mjs";
import { convertAccounts } from "./ios-backup-codec.mjs";

const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
function json(value, status = 200, extra = {}) { return Response.json(value, { status, headers: { ...headers, ...extra } }); }
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function errorResponse(error) { return json({ error: error.status ? error.message : "备份暂时不可用，请重试；学习进度没有改变。" }, error.status ?? 500); }
function family(request, deps) {
  const token = readCookie(request, SESSION_COOKIE_NAME);
  const session = token && deps.db.getSession(hashDeviceToken(token), deps.now());
  if (!session) fail(401, "登录已过期，请重新输入家庭码。");
  return session.familyId;
}
export async function createBackup(request, deps) {
  try {
    assertSameOrigin(request);
    const familyId = family(request, deps), now = deps.now();
    const key = `${familyId}:${getClientAddress(request)}`;
    const limited = deps.backupRateLimiter.check(key, now.getTime());
    if (!limited.allowed) return json({ error: "备份生成过于频繁，请稍后再试。" }, 429, { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) });
    deps.backupRateLimiter.fail(key, now.getTime());
    const accounts = deps.db.exportFamilySnapshot(familyId);
    if (!accounts.length) fail(409, "还没有已保存的学习档案，请先完成同步。");
    let document;
    try { document = convertAccounts(accounts, { familyId, exportedAt: now }); }
    catch (error) { fail(422, error.message); }
    if (Buffer.byteLength(JSON.stringify(document)) > 50_000_000) fail(413, "备份超过 App 支持的 50 MB，请联系支持协助分批导出。");
    const { token, expiresAt } = deps.backupStore.create(familyId, document, now);
    return json({ path: `/api/ios-backups/${token}`, expiresAt, exportedAt: document.exportedAt,
      profiles: document.profiles.map((profile) => ({ name: profile.name, characters: profile.items.length })) }, 201);
  } catch (error) { return errorResponse(error); }
}
export async function getBackupStatus(request, deps) {
  try { return json(deps.backupStore.status(family(request, deps), deps.now())); }
  catch (error) { return errorResponse(error); }
}
export async function revokeBackup(request, deps) {
  try { assertSameOrigin(request); deps.backupStore.revoke(family(request, deps)); return json({ active: false }); }
  catch (error) { return errorResponse(error); }
}
export async function downloadBackup(token, deps) {
  try {
    const document = deps.backupStore.download(token, deps.now());
    if (!document) return json({ error: "备份链接已失效，请回到网站家长中心重新生成。" }, 404);
    return json(document, 200, { "content-disposition": `attachment; filename="literacy-garden-${document.exportedAt.slice(0, 10)}.json"` });
  } catch (error) { return errorResponse(error); }
}
