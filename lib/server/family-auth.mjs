import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SESSION_SECONDS = 180 * 24 * 60 * 60;

export const SESSION_COOKIE_NAME = "kids_literacy_device";

function assertFamilyCode(code) {
  if (!/^\d{6}$/.test(code)) throw new TypeError("家庭码必须是六位数字");
}

export async function hashFamilyCode(code, salt = randomBytes(16)) {
  assertFamilyCode(code);
  const derived = await scrypt(code, salt, 64);
  return `scrypt$${Buffer.from(salt).toString("hex")}$${Buffer.from(derived).toString("hex")}`;
}

export async function verifyFamilyCode(code, encodedHash) {
  if (!/^\d{6}$/.test(code) || typeof encodedHash !== "string") return false;
  const [algorithm, saltHex, expectedHex, extra] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !expectedHex || extra) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = await scrypt(code, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length > 0 && timingSafeEqual(expected, Buffer.from(actual));
  } catch {
    return false;
  }
}

export function hashDeviceToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

export function createDeviceToken() {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashDeviceToken(raw) };
}

export function createSessionCookie(raw, production) {
  const secure = production ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(raw)}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function readCookie(request, name) {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0 || segment.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export const DEVICE_SESSION_SECONDS = SESSION_SECONDS;
