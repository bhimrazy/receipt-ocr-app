import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s), matching Better Auth's twoFactor
 * plugin, which keys HMAC with the UTF-8 bytes of its stored secret. Ours
 * returns which time step matched, so a step-up code can't be replayed.
 */

const PERIOD_S = 30;
const DIGITS = 6;

export function hotp(key: Uint8Array, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / PERIOD_S);

/** The time step (±1, like the plugin) that `code` matches, or null. */
export function matchTotpStep(secret: string, code: string, now = Date.now()): number | null {
  const candidate = Buffer.from(code.replace(/\s/g, ""));
  if (candidate.length !== DIGITS) return null;
  const key = Buffer.from(secret, "utf8");
  const current = totpStep(now);
  let matched: number | null = null;
  // Every candidate is computed and compared, so timing doesn't say which step matched.
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(candidate, Buffer.from(hotp(key, step))) && matched === null) {
      matched = step;
    }
  }
  return matched;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Not a base32 string");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/** The current code for a base32 key, as an authenticator app shows it (tests and e2e). */
export const totpFromBase32 = (key: string, now = Date.now()) =>
  hotp(base32Decode(key), totpStep(now));
