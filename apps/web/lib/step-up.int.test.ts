/**
 * Account deletion, email change and password notices against real Postgres. Skipped unless
 * INTEGRATION=1; run with `bun run --filter @receipt-ocr/web test:int` after `bun run db:migrate`,
 * with DATABASE_URL, BETTER_AUTH_URL and BETTER_AUTH_SECRET set.
 */
import { createDb, eq, member, rateLimit, session, sql, user, verification } from "@receipt-ocr/db";
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

const tag = `int-stepup-${Date.now()}`;
const password = "int-password-123";
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const sessionCookie = (headers: Headers) =>
  headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => c?.includes("session_token="))
    .join("; ");

const lastLinkTo = (to: string) => {
  const mail = sent.filter((m) => m.to === to).at(-1);
  return mail?.text.match(/https?:\/\/\S+/)?.[0];
};

describe.skipIf(!enabled)(
  "step-up for account deletion and email change",
  { timeout: 30_000 },
  () => {
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

    /** Makes every session of the user older than `freshAge`. */
    const ageSessions = (userId: string) =>
      db
        .update(session)
        .set({ createdAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(session.userId, userId));

    const exists = async (userId: string) =>
      (await db.select({ id: user.id }).from(user).where(eq(user.id, userId))).length === 1;

    const errorOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return null;
      } catch (error) {
        if (error instanceof APIError) return { status: error.statusCode, code: error.body?.code };
        throw error;
      }
    };

    /** Through the HTTP handler, as the browser calls it (body parsed by Better Auth's router). */
    const post = (path: string, cookie: string, body: unknown) =>
      auth.handler(
        new Request(`${origin}/api/auth${path}`, {
          method: "POST",
          headers: { cookie, origin, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );

    const requestDeletion = async (account: { email: string; cookie: string }) => {
      const res = await auth.api.deleteUser({
        headers: new Headers({ cookie: account.cookie }),
        body: {},
      });
      expect(res).toEqual({ success: true, message: "Verification email sent" });
      const link = lastLinkTo(account.email);
      expect(link).toMatch(/\/app\/settings\/delete-account\?token=[0-9a-z]{32}$/);
      return new URL(link!).searchParams.get("token")!;
    };

    // Importing the auth module cold can take a while on a busy runner.
    beforeAll(async () => {
      ({ auth } = await import("./auth"));
      // These HTTP calls share one client IP; earlier local runs would leave it at its hourly limit.
      await db.delete(rateLimit).where(sql`${rateLimit.key} like ${"%|/delete-user"}`);
    }, 60_000);

    afterAll(async () => {
      for (const id of created) {
        await db.execute(
          sql`delete from organization where id in (select organization_id from member where user_id = ${id})`,
        );
        await db.delete(user).where(eq(user.id, id));
      }
    });

    it("a delete request without the emailed link only sends the link, even with the password", async () => {
      const a = await newUser("request");
      await requestDeletion(a);
      const withPassword = await auth.api.deleteUser({
        headers: new Headers({ cookie: a.cookie }),
        body: { password },
      });
      expect(withPassword.message).toBe("Verification email sent");
      expect(await exists(a.id)).toBe(true);
      expect(sent.filter((m) => m.to === a.email).at(-1)?.subject).toBe(
        "Confirm deleting your ReceiptOCR account",
      );
    });

    it("needs a fresh session to request deletion or change the email", async () => {
      const a = await newUser("stale");
      await ageSessions(a.id);
      const headers = new Headers({ cookie: a.cookie });
      expect(await errorOf(auth.api.deleteUser({ headers, body: {} }))).toEqual({
        status: 403,
        code: "SESSION_NOT_FRESH",
      });
      expect(
        await errorOf(
          auth.api.changeEmail({ headers, body: { newEmail: `${tag}-stale-new@example.com` } }),
        ),
      ).toEqual({ status: 403, code: "SESSION_NOT_FRESH" });
      const http = await post("/delete-user", a.cookie, {});
      expect(http.status).toBe(403);
      // Sign-up's verification email is the only one sent.
      expect(sent.filter((m) => m.to === a.email).map((m) => m.subject)).toEqual([
        "Confirm your ReceiptOCR email",
      ]);

      // Signing in again gives a fresh session that may.
      const again = await auth.api.signInEmail({
        body: { email: a.email, password },
        returnHeaders: true,
      });
      const fresh = await auth.api.deleteUser({
        headers: new Headers({ cookie: sessionCookie(again.headers) }),
        body: {},
      });
      expect(fresh.message).toBe("Verification email sent");
    });

    it("the emailed link deletes the account once, from a session of any age", async () => {
      const a = await newUser("confirm");
      const token = await requestDeletion(a);
      await ageSessions(a.id);
      const res = await post("/delete-user", a.cookie, { token });
      expect(res.status).toBe(200);
      expect(await exists(a.id)).toBe(false);
      // The browser's session cookie is cleared, so the confirm page can leave the app shell.
      expect(res.headers.getSetCookie().find((c) => c.includes("session_token="))).toMatch(
        /Max-Age=0/i,
      );
      const left = await db.select().from(verification).where(eq(verification.value, a.id));
      expect(left).toHaveLength(0);
    });

    it("a sole owner of a shared workspace gets no link, and a link already sent survives", async () => {
      const a = await newUser("sole");
      const other = await newUser("member");
      const token = await requestDeletion(a);
      const [own] = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, a.id));
      const memberId = `${tag}-sole-member`;
      await db.insert(member).values({
        id: memberId,
        organizationId: own!.organizationId,
        userId: other.id,
        role: "member",
      });

      const sentBefore = sent.length;
      expect(
        await errorOf(
          auth.api.deleteUser({ headers: new Headers({ cookie: a.cookie }), body: {} }),
        ),
      ).toEqual({ status: 400, code: "WORKSPACE_NEEDS_OWNER" });
      expect(sent.length).toBe(sentBefore);

      const refused = await post("/delete-user", a.cookie, { token });
      expect(refused.status).toBe(400);
      const body = (await refused.json()) as { code?: string; message?: string };
      expect(body.code).toBe("WORKSPACE_NEEDS_OWNER");
      expect(body.message).toMatch(
        /^You own .+, which has other members\. Make one of them an owner/,
      );
      expect(await exists(a.id)).toBe(true);

      // Once the workspace is theirs alone again, the same link still deletes.
      await db.delete(member).where(eq(member.id, memberId));
      expect((await post("/delete-user", a.cookie, { token })).status).toBe(200);
      expect(await exists(a.id)).toBe(false);
    });

    it("a link is single use: once spent (here by another account) it no longer deletes", async () => {
      const owner = await newUser("owner");
      const other = await newUser("other");
      const token = await requestDeletion(owner);
      const wrong = await post("/delete-user", other.cookie, { token });
      expect(wrong.status).toBe(404);
      expect(await exists(other.id)).toBe(true);
      const replay = await post("/delete-user", owner.cookie, { token });
      expect(replay.status).toBe(404);
      expect(((await replay.json()) as { code?: string }).code).toBe("INVALID_TOKEN");
      expect(await exists(owner.id)).toBe(true);
    });

    it("an expired link does not delete", async () => {
      const a = await newUser("expired");
      const token = await requestDeletion(a);
      await db
        .update(verification)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(verification.value, a.id));
      const res = await post("/delete-user", a.cookie, { token });
      expect(res.status).toBe(404);
      expect(await exists(a.id)).toBe(true);
    });

    it("emails a notice after a password change, and not after a wrong current password", async () => {
      const a = await newUser("change");
      const headers = new Headers({ cookie: a.cookie });
      expect(
        await errorOf(
          auth.api.changePassword({
            headers,
            body: { currentPassword: "wrong-password", newPassword: `${password}-2` },
          }),
        ),
      ).toMatchObject({ status: 400 });
      expect(sent.some((m) => m.to === a.email && m.subject.includes("password was changed"))).toBe(
        false,
      );

      await auth.api.changePassword({
        headers,
        body: { currentPassword: password, newPassword: `${password}-2` },
      });
      const notice = sent.filter((m) => m.to === a.email).at(-1);
      expect(notice?.subject).toBe("Your ReceiptOCR password was changed");
      expect(notice?.text).toContain(`${origin}/forgot-password`);
    });

    it("emails a notice after a password reset", async () => {
      const a = await newUser("reset");
      await auth.api.requestPasswordReset({
        body: { email: a.email, redirectTo: "/reset-password" },
      });
      const token = new URL(lastLinkTo(a.email)!).pathname.split("/").at(-1)!;
      await auth.api.resetPassword({ body: { token, newPassword: `${password}-2` } });
      expect(sent.filter((m) => m.to === a.email).at(-1)?.subject).toBe(
        "Your ReceiptOCR password was changed",
      );
    });

    it("an email change is approved by the current address, then confirmed by the new one", async () => {
      const a = await newUser("email");
      await db.update(user).set({ emailVerified: true }).where(eq(user.id, a.id));
      const newEmail = `${tag}-email-new@example.com`;
      await auth.api.changeEmail({
        headers: new Headers({ cookie: a.cookie }),
        body: { newEmail, callbackURL: "/app/settings" },
      });

      const notice = sent.filter((m) => m.to === a.email).at(-1);
      expect(notice?.subject).toBe("Approve your ReceiptOCR email change");
      expect(notice?.text).toContain(`from ${a.email} to ${newEmail}`);
      expect(sent.some((m) => m.to === newEmail)).toBe(false);

      const open = (link: string) =>
        auth.handler(new Request(link, { headers: { cookie: a.cookie } }));
      expect((await open(lastLinkTo(a.email)!)).status).toBe(302);
      const [stillOld] = await db.select({ email: user.email }).from(user).where(eq(user.id, a.id));
      expect(stillOld?.email).toBe(a.email);

      expect((await open(lastLinkTo(newEmail)!)).status).toBe(302);
      const [changed] = await db.select({ email: user.email }).from(user).where(eq(user.id, a.id));
      expect(changed?.email).toBe(newEmail);
    });

    it("caps email-change attempts per address the same whether the new address is taken or free", async () => {
      const a = await newUser("oracle");
      const taken = await newUser("taken");
      await db.update(user).set({ emailVerified: true }).where(eq(user.id, a.id));
      const headers = new Headers({ cookie: a.cookie });
      const change = (newEmail: string) => auth.api.changeEmail({ headers, body: { newEmail } });
      for (let i = 0; i < 3; i++) expect(await change(taken.email)).toEqual({ status: true });
      // Nothing was sent for the taken address, yet the cap is used up for both kinds of answer.
      expect(sent.some((m) => m.to === a.email && m.subject.startsWith("Approve"))).toBe(false);
      expect(await errorOf(change(taken.email))).toMatchObject({ status: 429 });
      expect(await errorOf(change(`${tag}-oracle-free@example.com`))).toMatchObject({
        status: 429,
      });
    });

    it("Better Auth's GET delete callback is off: a valid token there deletes nothing", async () => {
      const a = await newUser("callback");
      const token = await requestDeletion(a);
      const res = await auth.handler(
        new Request(`${origin}/api/auth/delete-user/callback?token=${token}`, {
          headers: { cookie: a.cookie },
        }),
      );
      expect(res.status).toBe(404);
      expect(await exists(a.id)).toBe(true);
      // The token is untouched, so the confirm page still works.
      expect((await post("/delete-user", a.cookie, { token })).status).toBe(200);
      expect(await exists(a.id)).toBe(false);
    });

    it("emails the notice when an admin sets a user's password", async () => {
      const admin = await newUser("admin");
      const target = await newUser("target");
      await db.update(user).set({ role: "admin" }).where(eq(user.id, admin.id));
      await auth.api.setUserPassword({
        headers: new Headers({ cookie: admin.cookie }),
        body: { userId: target.id, newPassword: `${password}-admin` },
      });
      expect(sent.filter((m) => m.to === target.email).at(-1)?.subject).toBe(
        "Your ReceiptOCR password was changed",
      );
    });
  },
);
