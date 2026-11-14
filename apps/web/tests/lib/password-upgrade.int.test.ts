/**
 * Password hashes against real Postgres: sign-up stores the OWASP-cost format, a password stored in Better Auth's
 * older format still signs in and is re-hashed on that sign-in, and a wrong password changes nothing. Skipped unless
 * INTEGRATION=1.
 */
import { account, and, createDb, eq, sql, user } from "@receipt-ocr/db";
import type { SendEmailInput } from "@receipt-ocr/email";
import { hashPassword as betterAuthHash } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.INTEGRATION === "1";

vi.mock("server-only", () => ({}));
vi.mock("@receipt-ocr/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/email")>()),
  sendEmail: async (_config: unknown, _input: SendEmailInput) => ({ delivered: true }),
}));

const tag = `int-pwhash-${Date.now()}`;
const email = `${tag}@example.com`;
const password = "int-password-123";

describe.skipIf(!enabled)("password hash upgrade", { timeout: 30_000 }, () => {
  const db = createDb(process.env.DATABASE_URL ?? "");
  let auth: typeof import("@/lib/auth").auth;
  let userId: string;

  const storedHash = async () =>
    (
      await db
        .select({ password: account.password })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    )[0]?.password;

  const signIn = (pw: string) =>
    auth.api.signInEmail({ body: { email, password: pw } }).then(
      () => true,
      () => false,
    );

  beforeAll(async () => {
    ({ auth } = await import("@/lib/auth"));
    const res = await auth.api.signUpEmail({ body: { email, password, name: "Hash" } });
    userId = res.user.id;
  }, 60_000);

  afterAll(async () => {
    await db.execute(
      sql`delete from organization where id in (select organization_id from member where user_id = ${userId})`,
    );
    await db.delete(user).where(eq(user.id, userId));
  });

  it("stores a new password with the parameters in the hash", async () => {
    expect(await storedHash()).toMatch(/^\$scrypt\$N=32768,r=8,p=3\$/);
    expect(await signIn(password)).toBe(true);
  });

  it("signs in with an older Better Auth hash and re-hashes it", async () => {
    const legacy = await betterAuthHash(password);
    await db
      .update(account)
      .set({ password: legacy })
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));

    expect(await signIn("not-the-password")).toBe(false);
    expect(await storedHash()).toBe(legacy);

    expect(await signIn(password)).toBe(true);
    expect(await storedHash()).toMatch(/^\$scrypt\$N=32768,r=8,p=3\$/);
    expect(await signIn(password)).toBe(true);
  });
});
