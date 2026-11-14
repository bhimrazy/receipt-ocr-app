import { hashPassword as betterAuthHash } from "better-auth/crypto";
import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, SCRYPT_PARAMS, verifyPassword } from "@/lib/password";

describe("password hashing", { timeout: 20_000 }, () => {
  it("stores OWASP's scrypt cost in the hash and verifies it", async () => {
    expect(SCRYPT_PARAMS).toEqual({ N: 32768, r: 8, p: 3 });
    const hash = await hashPassword("correct horse");
    expect(hash).toMatch(/^\$scrypt\$N=32768,r=8,p=3\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(await verifyPassword({ hash, password: "correct horse" })).toBe(true);
    expect(await verifyPassword({ hash, password: "correct horsf" })).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("still verifies Better Auth's own hashes and marks them for an upgrade", async () => {
    const legacy = await betterAuthHash("old password");
    expect(legacy).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await verifyPassword({ hash: legacy, password: "old password" })).toBe(true);
    expect(await verifyPassword({ hash: legacy, password: "wrong" })).toBe(false);
    expect(needsRehash(legacy)).toBe(true);
  });

  it("verifies a hash made with other parameters and marks it for an upgrade", async () => {
    const current = await hashPassword("pw");
    const [, , , salt] = current.split("$");
    const key = scryptSync("pw", salt!, 64, { N: 2 ** 14, r: 8, p: 1 }).toString("hex");
    const older = `$scrypt$N=16384,r=8,p=1$${salt}$${key}`;
    expect(await verifyPassword({ hash: older, password: "pw" })).toBe(true);
    expect(needsRehash(older)).toBe(true);
  });

  it("refuses a hash whose stored cost is out of bounds or malformed", async () => {
    const hash = await hashPassword("pw");
    const tampered = hash.replace("N=32768", `N=${2 ** 24}`);
    expect(await verifyPassword({ hash: tampered, password: "pw" })).toBe(false);
    expect(await verifyPassword({ hash: hash.replace("N=32768", "N=30000"), password: "pw" })).toBe(
      false,
    );
    expect(await verifyPassword({ hash: "$scrypt$garbage", password: "pw" })).toBe(false);
  });

  const withParams = (salt: string, N: number, r: number, p: number) =>
    `$scrypt$N=${N},r=${r},p=${p}$${salt}$${scryptSync("pw", salt, 64, { N, r, p, maxmem: 2 ** 28 }).toString("hex")}`;

  it("verifies a hash at the memory bound (128·N·r = 64 MiB)", async () => {
    const salt = "ab".repeat(16);
    expect(await verifyPassword({ hash: withParams(salt, 2 ** 16, 8, 1), password: "pw" })).toBe(
      true,
    );
  });

  it("refuses, without deriving, a hash over the memory or work bound", async () => {
    const salt = "ab".repeat(16);
    const key = "00".repeat(64);
    const over = [
      { N: 2 ** 17, r: 8, p: 1 }, // 128 MiB
      { N: 2 ** 15, r: 8, p: 33 }, // N·r·p just over 2^23
      { N: 2 ** 20, r: 32, p: 16 }, // 4 GiB
      { N: 2 ** 32, r: 1, p: 1 }, // past 32-bit integers
    ];
    for (const { N, r, p } of over) {
      const started = performance.now();
      expect(
        await verifyPassword({
          hash: `$scrypt$N=${N},r=${r},p=${p}$${salt}$${key}`,
          password: "pw",
        }),
      ).toBe(false);
      expect(performance.now() - started).toBeLessThan(20);
    }
  });

  it("pads a wrong password against a Better Auth hash to the current cost", async () => {
    const legacy = await betterAuthHash("old password");
    // The fastest of three runs, to keep a busy runner's noise out.
    const time = async (run: () => Promise<unknown>) => {
      let best = Infinity;
      for (let i = 0; i < 3; i++) {
        const started = performance.now();
        await run();
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const unknownAddress = await time(() => hashPassword("wrong"));
    const wrong = await time(() => verifyPassword({ hash: legacy, password: "wrong" }));
    // Unpadded, it is about a third of the unknown-address time.
    expect(wrong).toBeGreaterThan(unknownAddress * 0.7);
  });
});
