import { hashPassword as betterAuthHash } from "better-auth/crypto";
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
    const { scryptSync } = await import("node:crypto");
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
});
