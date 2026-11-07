/**
 * Two-factor sign-in and step-up against real Postgres. Skipped unless
 * INTEGRATION=1 (see auth.int.test.ts for the setup). Codes come from the
 * test's own RFC 6238 helper (lib/totp.ts), fed the key from the otpauth URI.
 */
import {
  adminAuditLog,
  and,
  createDb,
  eq,
  session,
  sql,
  stepUpCodes,
  stepUpEvents,
  twoFactor,
  user,
  verification,
} from "@receipt-ocr/db";
import type { SendEmailInput } from "@receipt-ocr/email";
import { APIError } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hotp, base32Decode, totpStep } from "./totp";

const enabled = process.env.INTEGRATION === "1";
const sent: SendEmailInput[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@receipt-ocr/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/email")>()),
  sendEmail: async (_config: unknown, input: SendEmailInput) => {
    sent.push(input);
    return { delivered: true };
  },
}));

const tag = `int-2fa-${Date.now()}`;
const password = "int-password-123";

const cookieFrom = (headers: Headers, name: string) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((c) => c.includes(`${name}=`) && !c.endsWith("="))
    .join("; ");

/** The code for a time step relative to now (0 = current, 1 = next). */
const codeAt = (key: string, offset = 0) => hotp(base32Decode(key), totpStep() + offset);

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof APIError) {
      return { status: error.statusCode, code: (error.body as { code?: string })?.code };
    }
    throw error;
  }
};

describe.skipIf(!enabled)("two-factor sign-in and step-up against Postgres", () => {
  const db = createDb(process.env.DATABASE_URL ?? "");
  let auth: typeof import("./auth").auth;
  let stepUp: typeof import("./step-up");
  let check: typeof import("./step-up-check");

  beforeAll(async () => {
    ({ auth } = await import("./auth"));
    stepUp = await import("./step-up");
    check = await import("./step-up-check");
  });

  afterAll(async () => {
    await db.execute(
      sql`delete from organization where id in (select m.organization_id from member m join "user" u on u.id = m.user_id where u.email like ${`${tag}%`})`,
    );
    await db.delete(user).where(sql`${user.email} like ${`${tag}%`}`);
  });

  async function signUp(name: string) {
    const email = `${tag}-${name}@example.com`;
    const result = await auth.api.signUpEmail({
      body: { email, password, name },
      returnHeaders: true,
    });
    return {
      email,
      userId: result.response.user.id,
      headers: new Headers({ cookie: cookieFrom(result.headers, "session_token") }),
    };
  }

  async function caller(headers: Headers) {
    const current = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    if (!current) throw new Error("no session");
    return { session: current.session, user: current.user, ip: null, headers };
  }

  /** Passes an emailed-code step-up (accounts with no factor yet), reading the code from the mail. */
  async function emailStepUp(headers: Headers, action: "two_factor.enable" | "account.delete") {
    const who = await caller(headers);
    expect(await stepUp.sendStepUpCode(who, action)).toEqual({ ok: true });
    const code = sent.at(-1)!.text.match(/\b\d{6}\b/)![0];
    expect(await stepUp.verifyStepUp(who, { action, method: "email", code })).toEqual({ ok: true });
  }

  /** Enrols an authenticator; returns the base32 key and the rotated session's headers. */
  async function enrol(headers: Headers) {
    // Enrolling needs a fresh check too.
    expect(await failure(auth.api.enableTwoFactor({ body: { password }, headers }))).toMatchObject({
      status: 403,
      code: "STEP_UP_REQUIRED",
    });
    await emailStepUp(headers, "two_factor.enable");
    const enabledResult = await auth.api.enableTwoFactor({ body: { password }, headers });
    if (enabledResult.method !== "totp") throw new Error("expected a TOTP enrolment");
    const key = new URL(enabledResult.totpURI).searchParams.get("secret")!;
    const verified = await auth.api.verifyTOTP({
      body: { code: codeAt(key) },
      headers,
      returnHeaders: true,
    });
    const rotated = new Headers({ cookie: cookieFrom(verified.headers, "session_token") });
    return { key, backupCodes: enabledResult.backupCodes, headers: rotated };
  }

  it("enrols, signs in with a code (auth_method mfa), and a backup code works once", async () => {
    const account = await signUp("enrol");
    sent.length = 0;
    const { key, backupCodes } = await enrol(account.headers);

    const [row] = await db.select().from(user).where(eq(user.id, account.userId));
    expect(row?.twoFactorEnabled).toBe(true);
    const [stored] = await db.select().from(twoFactor).where(eq(twoFactor.userId, account.userId));
    // Sealed at rest: neither the key nor a backup code appears in the row.
    expect(stored?.secret).not.toContain(key);
    expect(stored?.backupCodes).not.toContain(backupCodes[0]);
    expect(sent.at(-1)?.subject).toContain("Two-step sign-in is on");

    // The password step answers with a challenge and no session.
    const signIn = await auth.api.signInEmail({
      body: { email: account.email, password },
      returnHeaders: true,
    });
    expect(signIn.response).toMatchObject({ twoFactorRedirect: true });
    expect(cookieFrom(signIn.headers, "session_token")).toBe("");
    const challenge = new Headers({ cookie: cookieFrom(signIn.headers, "two_factor") });

    expect(
      await failure(auth.api.verifyTOTP({ body: { code: "000000" }, headers: challenge })),
    ).toMatchObject({ code: "INVALID_CODE" });
    const done = await auth.api.verifyTOTP({
      body: { code: codeAt(key) },
      headers: challenge,
      returnHeaders: true,
    });
    const [created] = await db
      .select({ authMethod: session.authMethod })
      .from(session)
      .where(eq(session.token, done.response.token));
    expect(created?.authMethod).toBe("mfa");

    // A backup code signs in once, then no more.
    const again = await auth.api.signInEmail({
      body: { email: account.email, password },
      returnHeaders: true,
    });
    const challenge2 = new Headers({ cookie: cookieFrom(again.headers, "two_factor") });
    await auth.api.verifyBackupCode({ body: { code: backupCodes[0]! }, headers: challenge2 });
    const third = await auth.api.signInEmail({
      body: { email: account.email, password },
      returnHeaders: true,
    });
    const challenge3 = new Headers({ cookie: cookieFrom(third.headers, "two_factor") });
    expect(
      await failure(
        auth.api.verifyBackupCode({ body: { code: backupCodes[0]! }, headers: challenge3 }),
      ),
    ).toMatchObject({ code: "INVALID_BACKUP_CODE" });
  });

  it("requires a fresh TOTP step-up for a password change, and refuses a replayed code", async () => {
    const account = await signUp("stepup");
    const { key, headers } = await enrol(account.headers);
    const change = () =>
      auth.api.changePassword({
        body: { currentPassword: password, newPassword: password },
        headers,
      });
    expect(await failure(change())).toEqual({ status: 403, code: "STEP_UP_REQUIRED" });

    const who = await caller(headers);
    await expect(check.requireStepUp(who, "account.change_password")).rejects.toBeInstanceOf(
      check.StepUpRequiredError,
    );
    // Email isn't offered once a factor exists (refused before any attempt is recorded).
    expect(
      await stepUp.verifyStepUp(who, {
        action: "account.change_password",
        method: "email",
        code: "123456",
      }),
    ).toMatchObject({ ok: false });

    const code = codeAt(key, 1);
    expect(
      await stepUp.verifyStepUp(who, { action: "account.change_password", method: "totp", code }),
    ).toEqual({ ok: true });
    await check.requireStepUp(who, "account.change_password");
    expect(await failure(change())).toBeNull();

    // The same code again (still inside its window) is refused.
    expect(
      await stepUp.verifyStepUp(who, { action: "account.change_password", method: "totp", code }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/already used/) });

    const events = await db
      .select({ outcome: stepUpEvents.outcome, method: stepUpEvents.method })
      .from(stepUpEvents)
      .where(
        and(
          eq(stepUpEvents.userId, account.userId),
          eq(stepUpEvents.action, "account.change_password"),
        ),
      );
    expect(events.map((e) => `${e.method}:${e.outcome}`).sort()).toEqual([
      "totp:failed",
      "totp:verified",
    ]);
  });

  it("emails a hashed, session-bound code to a user without 2FA, and locks after 5 failures", async () => {
    const account = await signUp("email");
    const who = await caller(account.headers);
    sent.length = 0;
    expect(await stepUp.sendStepUpCode(who, "account.delete")).toEqual({ ok: true });
    const code = sent.at(-1)?.text.match(/\b\d{6}\b/)?.[0];
    expect(code).toBeTruthy();
    expect(sent.at(-1)?.subject).not.toContain(code!);
    const [stored] = await db
      .select({ hash: stepUpCodes.codeHash })
      .from(stepUpCodes)
      .where(eq(stepUpCodes.userId, account.userId));
    expect(stored?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.hash).not.toContain(code!);

    const wrong = code === "000000" ? "111111" : "000000";
    expect(
      await stepUp.verifyStepUp(who, { action: "account.delete", method: "email", code: wrong }),
    ).toMatchObject({ ok: false });
    expect(
      await stepUp.verifyStepUp(who, { action: "account.delete", method: "email", code: code! }),
    ).toEqual({ ok: true });
    // Single use.
    expect(
      await stepUp.verifyStepUp(who, { action: "account.delete", method: "email", code: code! }),
    ).toMatchObject({ ok: false });

    for (let i = 0; i < 4; i++) {
      await stepUp.verifyStepUp(who, { action: "account.delete", method: "email", code: wrong });
    }
    expect(
      await stepUp.verifyStepUp(who, { action: "account.delete", method: "email", code: wrong }),
    ).toMatchObject({ ok: false, locked: true });
  });

  it("disables only after step-up, forgetting every trusted device", async () => {
    const account = await signUp("disable");
    const { key, headers } = await enrol(account.headers);
    await db.insert(verification).values({
      id: `${tag}-trust`,
      identifier: `${tag}-trust-device`,
      value: account.userId,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await failure(auth.api.disableTwoFactor({ body: { password }, headers }))).toEqual({
      status: 403,
      code: "STEP_UP_REQUIRED",
    });
    const who = await caller(headers);
    await stepUp.verifyStepUp(who, {
      action: "two_factor.disable",
      method: "totp",
      code: codeAt(key),
    });
    sent.length = 0;
    await auth.api.disableTwoFactor({ body: { password }, headers });
    const [row] = await db.select().from(user).where(eq(user.id, account.userId));
    expect(row?.twoFactorEnabled).toBe(false);
    const trust = await db
      .select()
      .from(verification)
      .where(eq(verification.value, account.userId));
    expect(trust).toEqual([]);
    expect(sent.at(-1)?.subject).toContain("is off");
  });

  it("never hands out the TOTP secret again, even to its own session", async () => {
    const account = await signUp("uri");
    const { headers } = await enrol(account.headers);
    expect(await failure(auth.api.getTOTPURI({ body: { password }, headers }))).toMatchObject({
      status: 404,
    });
  });

  it("refuses factor changes from an impersonation session", async () => {
    const account = await signUp("impersonated");
    const who = await caller(account.headers);
    await db
      .update(session)
      .set({ impersonatedBy: account.userId })
      .where(eq(session.id, who.session.id));
    expect(
      await failure(auth.api.enableTwoFactor({ body: { password }, headers: account.headers })),
    ).toMatchObject({ status: 403, code: "IMPERSONATING" });
    expect(await stepUp.sendStepUpCode(who, "account.delete")).toMatchObject({ ok: false });
  });

  it("an admin reset clears the authenticator, trust and sessions, with an audit row", async () => {
    const account = await signUp("reset");
    await enrol(account.headers);
    const { resetSecondFactor } = await import("@receipt-ocr/core");
    const { runtime } = await import("./runtime");
    const result = await runtime.runPromise(
      resetSecondFactor(
        { id: account.userId, email: account.email },
        {
          actor: { id: account.userId, email: "admin@example.com" },
          reason: "lost phone, ticket 1",
        },
      ),
    );
    expect(result.authenticator).toBe(true);
    expect(result.sessions).toBeGreaterThan(0);
    const [row] = await db.select().from(user).where(eq(user.id, account.userId));
    expect(row?.twoFactorEnabled).toBe(false);
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, account.userId))).toEqual(
      [],
    );
    expect(await db.select().from(session).where(eq(session.userId, account.userId))).toEqual([]);
    const audit = await db
      .select()
      .from(adminAuditLog)
      .where(
        and(
          eq(adminAuditLog.targetId, account.userId),
          eq(adminAuditLog.action, "user.two_factor_reset"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.reason).toBe("lost phone, ticket 1");
  });
});
