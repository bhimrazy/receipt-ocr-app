/**
 * Sign-in methods against real Postgres: disconnecting Google/GitHub needs a fresh step-up and
 * never removes the last way in (checked in hooks.before, not only in the UI), connecting one
 * emails a notice, and a first password on a provider-only account needs step-up too. Skipped
 * unless INTEGRATION=1; see step-up.int.test.ts for the setup.
 */
import {
  account,
  and,
  createDb,
  eq,
  member,
  passkey,
  receipts,
  session,
  sql,
  user,
} from "@receipt-ocr/db";
import type { SendEmailInput } from "@receipt-ocr/email";
import { APIError } from "better-auth/api";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

const tag = `int-signin-${Date.now()}`;
const password = "int-password-123";
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const sessionCookie = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c?.includes("session_token="))
    .join("; ");

describe.skipIf(!enabled)("sign-in methods", { timeout: 30_000 }, () => {
  const db = createDb(process.env.DATABASE_URL ?? "");
  let auth: typeof import("./auth").auth;
  const created: string[] = [];

  async function newUser(name: string) {
    const email = `${tag}-${name}@example.com`;
    const res = await auth.api.signUpEmail({
      body: { email, password, name },
      returnHeaders: true,
    });
    created.push(res.response.user.id);
    return { email, id: res.response.user.id, cookie: sessionCookie(res.headers) };
  }

  /** A Google account row through Better Auth's adapter, so the account hooks run. */
  async function addProvider(userId: string, providerId: "google" | "github") {
    const ctx = await auth.$context;
    const row = await ctx.internalAdapter.createAccount({
      userId,
      providerId,
      accountId: `${providerId}-${userId}`,
    });
    return row.id;
  }

  const dropPassword = (userId: string) =>
    db.delete(account).where(and(eq(account.userId, userId), eq(account.providerId, "credential")));

  const accountsOf = async (userId: string) =>
    (await db.select({ p: account.providerId }).from(account).where(eq(account.userId, userId)))
      .map((r) => r.p)
      .sort();

  const errorOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return null;
    } catch (error) {
      if (error instanceof APIError) return { status: error.statusCode, code: error.body?.code };
      throw error;
    }
  };

  async function emailStepUp(
    who: { cookie: string },
    action: "account.unlink" | "account.change_password",
  ) {
    const stepUp = await import("./step-up");
    const headers = new Headers({ cookie: who.cookie });
    const current = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    const caller = { session: current!.session, user: current!.user, ip: null, headers };
    expect(await stepUp.sendStepUpCode(caller, action)).toEqual({ ok: true });
    const code = sent.at(-1)!.text.match(/\b\d{6}\b/)![0];
    expect(await stepUp.verifyStepUp(caller, { action, method: "email", code })).toEqual({
      ok: true,
    });
  }

  const unlink = (who: { cookie: string }, accountId: string) =>
    auth.api.unlinkAccount({ headers: new Headers({ cookie: who.cookie }), body: { accountId } });

  beforeAll(async () => {
    ({ auth } = await import("./auth"));
  }, 60_000);

  afterAll(async () => {
    for (const id of created) {
      await db.execute(
        sql`delete from organization where id in (select organization_id from member where user_id = ${id})`,
      );
      await db.delete(user).where(eq(user.id, id));
    }
  });

  it("links only a provider that reports the same, verified address", () => {
    expect(auth.options.account?.accountLinking).toMatchObject({
      enabled: true,
      allowDifferentEmails: false,
      trustedProviders: [],
    });
  });

  it("emails a notice when a provider is added to an existing account, not at sign-up", async () => {
    const a = await newUser("link");
    await addProvider(a.id, "github");
    expect(sent.filter((m) => m.to === a.email).at(-1)?.subject).toBe(
      "GitHub sign-in was connected to your ReceiptOCR account",
    );

    // An OAuth sign-up: the user's first account is the provider itself.
    const ctx = await auth.$context;
    const fresh = await ctx.internalAdapter.createUser(
      { email: `${tag}-oauth@example.com`, name: "OAuth", emailVerified: true },
      { method: "oauth", oauth: { providerId: "google", profile: {} } },
    );
    created.push(fresh.id);
    await addProvider(fresh.id, "google");
    expect(sent.filter((m) => m.to === fresh.email)).toEqual([]);
  });

  it("disconnecting needs a fresh step-up, then emails a notice", async () => {
    const a = await newUser("unlink");
    const google = await addProvider(a.id, "google");
    expect(await errorOf(unlink(a, google))).toEqual({ status: 403, code: "STEP_UP_REQUIRED" });
    expect(await accountsOf(a.id)).toEqual(["credential", "google"]);

    await emailStepUp(a, "account.unlink");
    expect(await unlink(a, google)).toEqual({ status: true });
    expect(await accountsOf(a.id)).toEqual(["credential"]);
    expect(sent.filter((m) => m.to === a.email).at(-1)?.subject).toBe(
      "Google sign-in was disconnected from your ReceiptOCR account",
    );
  });

  it("refuses to remove the last way to sign in, over HTTP too", async () => {
    const a = await newUser("last");
    const google = await addProvider(a.id, "google");
    await dropPassword(a.id);
    await emailStepUp(a, "account.unlink");
    expect(await errorOf(unlink(a, google))).toEqual({
      status: 400,
      code: "LAST_SIGN_IN_METHOD",
    });
    const http = await auth.handler(
      new Request(`${origin}/api/auth/unlink-account`, {
        method: "POST",
        headers: { cookie: a.cookie, origin, "content-type": "application/json" },
        body: JSON.stringify({ accountId: google }),
      }),
    );
    expect(http.status).toBe(400);
    expect(((await http.json()) as { code?: string }).code).toBe("LAST_SIGN_IN_METHOD");
    expect(await accountsOf(a.id)).toEqual(["google"]);
  });

  it("counts a passkey as a way in, so the last provider can go", async () => {
    const a = await newUser("passkey");
    const google = await addProvider(a.id, "google");
    await dropPassword(a.id);
    await db.insert(passkey).values({
      id: `${tag}-pk`,
      userId: a.id,
      publicKey: "pk",
      credentialID: `${tag}-cred`,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
    });
    // With a passkey only a passkey passes step-up; two-factor.int.test.ts covers that ceremony.
    await db
      .update(session)
      .set({ stepUpAt: new Date(), stepUpMethod: "passkey" })
      .where(eq(session.userId, a.id));
    expect(await unlink(a, google)).toEqual({ status: true });
    expect(await accountsOf(a.id)).toEqual([]);
  });

  it("refuses to delete the last passkey when no password or provider remains", async () => {
    const a = await newUser("lastpk");
    await dropPassword(a.id);
    const values = (n: number) => ({
      id: `${tag}-lpk${n}`,
      userId: a.id,
      publicKey: "pk",
      credentialID: `${tag}-lcred${n}`,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
    });
    await db.insert(passkey).values(values(1));
    await db
      .update(session)
      .set({ stepUpAt: new Date(), stepUpMethod: "passkey" })
      .where(eq(session.userId, a.id));
    const remove = (id: string) =>
      auth.api.deletePasskey({ headers: new Headers({ cookie: a.cookie }), body: { id } });
    const count = async () =>
      (await db.select({ id: passkey.id }).from(passkey).where(eq(passkey.userId, a.id))).length;
    expect(await errorOf(remove(`${tag}-lpk1`))).toEqual({
      status: 400,
      code: "LAST_SIGN_IN_METHOD",
    });
    expect(await count()).toBe(1);
    // With a second passkey one of them can go.
    await db.insert(passkey).values(values(2));
    await remove(`${tag}-lpk1`);
    expect(await count()).toBe(1);
  });

  it("the one-time prompt is due after the fifth completed receipt, and not with a passkey", async () => {
    const { securityPromptDue } = await import("@receipt-ocr/core");
    const { runtime } = await import("./runtime");
    const a = await newUser("prompt");
    const [membership] = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, a.id));
    const scan = (status: "completed" | "failed", n: number) =>
      db.insert(receipts).values(
        Array.from({ length: n }, () => ({
          organizationId: membership!.organizationId,
          userId: a.id,
          status,
        })),
      );
    const due = () => runtime.runPromise(securityPromptDue(a.id));
    await scan("completed", 4);
    await scan("failed", 3);
    expect(await due()).toBe(false);
    await scan("completed", 1);
    expect(await due()).toBe(true);
    await db.insert(passkey).values({
      id: `${tag}-pk2`,
      userId: a.id,
      publicKey: "pk",
      credentialID: `${tag}-cred2`,
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
    });
    expect(await due()).toBe(false);
  });

  it("a first password on a provider-only account needs step-up, then emails a notice", async () => {
    const { setFirstPassword } = await import("./set-password");
    const a = await newUser("setpw");
    await addProvider(a.id, "google");
    await dropPassword(a.id);
    const headers = new Headers({ cookie: a.cookie });
    const current = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
    const set = () => setFirstPassword(current!, headers, `${password}-new`);
    expect(await set()).toMatchObject({ ok: false, code: "STEP_UP_REQUIRED" });
    expect(await accountsOf(a.id)).toEqual(["google"]);
    expect(await setFirstPassword(current!, headers, "short")).toMatchObject({ ok: false });

    await emailStepUp(a, "account.change_password");
    expect(await set()).toEqual({ ok: true });
    expect(await accountsOf(a.id)).toEqual(["credential", "google"]);
    expect(sent.filter((m) => m.to === a.email).at(-1)?.subject).toBe(
      "A password was added to your ReceiptOCR account",
    );
    // Only once: a second call doesn't replace it.
    expect(await set()).toMatchObject({ ok: false });
    const signedIn = await auth.api.signInEmail({
      body: { email: a.email, password: `${password}-new` },
    });
    expect(signedIn.user.id).toBe(a.id);
  });
});
