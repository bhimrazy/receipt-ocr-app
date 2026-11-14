import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { verifyPassword as verifyBetterAuthHash } from "better-auth/crypto";

/** OWASP Password Storage Cheat Sheet's scrypt row with 32 MiB per hash (checked 2026-11-14). */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_BYTES = 64;
const PREFIX = "$scrypt$";
// A stored hash names its own cost; these caps stop an edited row from asking for seconds of CPU or GBs of memory.
const MAX_MEMORY = 64 * 1024 * 1024; // 128·N·r bytes
const MAX_WORK = 2 ** 23; // N·r·p
/**
 * A wrong password against a Better Auth hash (`N=2^14, r=16, p=1`) pays this too, so it takes as long as an unknown
 * address, for which Better Auth hashes the submitted password at `SCRYPT_PARAMS`. Otherwise the timing tells which
 * addresses have accounts. Measured: 80 ms + 170 ms against 260 ms (r=16 runs faster per unit of N·r·p than r=8).
 */
const LEGACY_PAD = { N: 2 ** 14, r: 16, p: 2 } as const;

type Params = { N: number; r: number; p: number };

function derive(password: string, salt: string, { N, r, p }: Params): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // scrypt needs 128·N·r bytes plus a little; Node's default 32 MiB cap is exactly 128·N·r at the current cost.
    const maxmem = 2 * 128 * N * r + 1024 * 1024;
    scrypt(password.normalize("NFKC"), salt, KEY_BYTES, { N, r, p, maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * `$scrypt$N=32768,r=8,p=3$<salt hex>$<key hex>`. The parameters travel with the hash, so a later
 * cost increase leaves every stored hash verifiable.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(password, salt, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `${PREFIX}N=${N},r=${r},p=${p}$${salt}$${key.toString("hex")}`;
}

const FORMAT = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

function parse(hash: string) {
  const match = FORMAT.exec(hash);
  if (!match) return null;
  const params = { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
  const { N, r, p } = params;
  const valid =
    N >= 2 &&
    (N & (N - 1)) === 0 &&
    r >= 1 &&
    p >= 1 &&
    128 * N * r <= MAX_MEMORY &&
    N * r * p <= MAX_WORK;
  return valid ? { params, salt: match[4]!, key: Buffer.from(match[5]!, "hex") } : null;
}

/** Whether a stored hash was made with older parameters than `SCRYPT_PARAMS` (or Better Auth's format). */
export function needsRehash(hash: string): boolean {
  const parsed = parse(hash);
  if (!parsed) return true;
  const { N, r, p } = SCRYPT_PARAMS;
  return parsed.params.N !== N || parsed.params.r !== r || parsed.params.p !== p;
}

/** Checks this module's hashes and Better Auth's own `<salt>:<key>` ones (`N=2^14, r=16, p=1`). */
export async function verifyPassword({ hash, password }: { hash: string; password: string }) {
  if (!hash.startsWith(PREFIX)) {
    if (await verifyBetterAuthHash({ hash, password })) return true;
    await derive(password, "0".repeat(32), LEGACY_PAD);
    return false;
  }
  const parsed = parse(hash);
  if (!parsed) return false;
  return timingSafeEqual(await derive(password, parsed.salt, parsed.params), parsed.key);
}
