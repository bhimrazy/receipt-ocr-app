/**
 * Password hashes against real Postgres: sign-up stores the OWASP-cost format, a password stored in Better Auth's
 * older format still signs in and is re-hashed on that sign-in, and a wrong password, an unverified address or a
 * password reset in between changes nothing. Skipped unless INTEGRATION=1.
 */
import { account, and, createDb, eq, sql, user } from "@receipt-ocr/db";
import { hashPassword as betterAuthHash } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const enabled = process.env.INTEGRATION === "1";

vi.mock("server-only", () => ({}));
vi.mock("@receipt-ocr/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/email")>()),
  sendEmail: async () => ({ delivered: true }),
}));

const tag = `int-pwhash-${Date.now()}`;
const email = `${tag}@example.com`;
const password = "int-password-123";
const CURRENT = /^\$scrypt\$N=32768,r=8,p=3\$/;

describe.skipIf(!enabled)("password hash upgrade", { timeout: 30_000 }, () => {
  const db = createDb(process.env.DATABASE_URL ?? "");
  let auth: typeof import("@/lib/auth").auth;
  let upgradePasswordHash: typeof import("@/lib/password-upgrade").upgradePasswordHash;
  let userId: string;

  const credential = () => and(eq(account.userId, userId), eq(account.providerId, "credential"));
  const storedHash = async () =>
    (await db.select({ password: account.password }).from(account).where(credential()))[0]
      ?.password;
  const storeHash = (hash: string) =>
    db.update(account).set({ password: hash }).where(credential());
  const setUser = (fields: { emailVerified?: boolean; twoFactorEnabled?: boolean }) =>
    db.update(user).set(fields).where(eq(user.id, userId));

  const signIn = (pw: string) =>
    auth.api.signInEmail({ body: { email, password: pw } }).then(
      (response) => response as Record<string, unknown>,
      () => null,
    );

  beforeAll(async () => {
    // CI's int run turns verification off; production has it on, and one case below needs it.
    vi.stubEnv("AUTH_REQUIRE_EMAIL_VERIFICATION", "true");
    ({ auth } = await import("@/lib/auth"));
    ({ upgradePasswordHash } = await import("@/lib/password-upgrade"));
    const res = await auth.api.signUpEmail({ body: { email, password, name: "Hash" } });
    userId = res.user.id;
  }, 60_000);

  beforeEach(() => setUser({ emailVerified: true, twoFactorEnabled: false }));

  afterAll(async () => {
    vi.unstubAllEnvs();
    await db.execute(
      sql`delete from organization where id in (select organization_id from member where user_id = ${userId})`,
    );
    await db.delete(user).where(eq(user.id, userId));
  });

  it("stores a new password with the parameters in the hash", async () => {
    expect(await storedHash()).toMatch(CURRENT);
    expect(await signIn(password)).not.toBeNull();
  });

  it("signs in with an older Better Auth hash and re-hashes it", async () => {
    const legacy = await betterAuthHash(password);
    await storeHash(legacy);

    expect(await signIn("not-the-password")).toBeNull();
    expect(await storedHash()).toBe(legacy);

    expect(await signIn(password)).not.toBeNull();
    expect(await storedHash()).toMatch(CURRENT);
    expect(await signIn(password)).not.toBeNull();
  });

  it("re-hashes on a sign-in that goes on to two-step sign-in", async () => {
    await storeHash(await betterAuthHash(password));
    await setUser({ twoFactorEnabled: true });

    expect(await signIn(password)).toMatchObject({ twoFactorRedirect: true });
    expect(await storedHash()).toMatch(CURRENT);
  });

  it("does not re-hash when the address isn't verified", async () => {
    const legacy = await betterAuthHash(password);
    await storeHash(legacy);
    await setUser({ emailVerified: false });

    expect(await signIn(password)).toBeNull();
    expect(await storedHash()).toBe(legacy);
  });

  it("keeps a password reset that landed after the sign-in's check", async () => {
    // An older instance writes the reset in Better Auth's format, so it still looks due for an upgrade.
    const reset = await betterAuthHash("the-new-password");
    await storeHash(reset);

    await upgradePasswordHash(db, email, password);
    expect(await storedHash()).toBe(reset);
  });

  it("keeps a password reset that commits while the upgrade is in flight", async () => {
    await storeHash(await betterAuthHash(password));
    const reset = await betterAuthHash("the-new-password");

    // The reset holds the row, uncommitted, so the upgrade reads the old hash and its update waits on the lock.
    let commit!: () => void;
    const gate = new Promise<void>((resolve) => (commit = resolve));
    let resetHeld!: () => void;
    const held = new Promise<void>((resolve) => (resetHeld = resolve));
    const resetting = db.transaction(async (tx) => {
      await tx.update(account).set({ password: reset }).where(credential());
      resetHeld();
      await gate;
    });
    await held;

    const upgrading = upgradePasswordHash(db, email, password);
    let blocked = false;
    for (let waited = 0; !blocked && waited < 10_000; waited += 20) {
      const { rows } = await db.execute<{ waiting: number }>(
        sql`select count(*)::int as waiting from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'update "account"%'`,
      );
      blocked = rows[0]!.waiting > 0;
      if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    commit();
    await resetting;
    await upgrading;

    expect(blocked).toBe(true);
    expect(await storedHash()).toBe(reset);
  });
});
