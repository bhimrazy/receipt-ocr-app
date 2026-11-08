/**
 * Better Auth against real Postgres. Skipped unless INTEGRATION=1; run with
 * `bun run --filter @receipt-ocr/web test:int` after `bun run db:migrate`,
 * with DATABASE_URL and BETTER_AUTH_SECRET set.
 */
import {
  account,
  billingSubscriptions,
  createDb,
  eq,
  jobs,
  member,
  organization,
  session,
  sql,
  user,
  verification,
} from "@receipt-ocr/db";
import type { SendEmailInput } from "@receipt-ocr/email";
import { APIError } from "better-auth/api";
import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const sent: SendEmailInput[] = [];

vi.mock("@receipt-ocr/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/email")>()),
  sendEmail: async (_config: unknown, input: SendEmailInput) => {
    sent.push(input);
    return { delivered: true };
  },
}));

const tag = `int-auth-${Date.now()}`;
const email = `${tag}@example.com`;
const password = "int-password-123";

describe.skipIf(!enabled)("Better Auth hardening against Postgres", () => {
  const db = createDb(process.env.DATABASE_URL ?? "");
  let auth: typeof import("./auth").auth;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    ({ auth } = await import("./auth"));
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name: "<b>Int</b> Tester" },
      returnHeaders: true,
    });
    userId = signUp.response.user.id;
    // Only the session token is needed; the cookie cache is off.
    cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => c?.includes("session_token="))
      .join("; ");
    // A free plan allows one (personal) workspace; creating a second needs pro.
    await db.update(user).set({ plan: "pro" }).where(eq(user.id, userId));
  });

  afterAll(async () => {
    await db.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (row) {
      await db.delete(jobs).where(eq(jobs.userId, row.id));
      await db.execute(
        sql`delete from organization where id in (select organization_id from member where user_id = ${row.id})`,
      );
      await db.delete(user).where(eq(user.id, row.id));
    }
  });

  const status = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return 200;
    } catch (error) {
      if (error instanceof APIError) return error.statusCode;
      throw error;
    }
  };

  // With verification required the welcome waits for afterEmailVerification, which needs a mailbox.
  it.skipIf(process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== "false")(
    "queues exactly one welcome email job when sign-up needs no verification",
    async () => {
      const { queueWelcomeEmail } = await import("./welcome");
      await queueWelcomeEmail(userId);
      const rows = await db.select().from(jobs).where(eq(jobs.userId, userId));
      expect(rows.filter((j) => j.kind === "email.welcome")).toHaveLength(1);
    },
  );

  it("P1-1: the personal workspace built from a hostile display name is plain text", async () => {
    const [org] = await db.execute<{ name: string }>(
      sql`select o.name from organization o join member m on m.organization_id = o.id where m.user_id = ${userId}`,
    );
    expect(org?.name).toBe("bInt/b Tester's Workspace");
  });

  it("P1-1: rejects markup and over-long workspace names on create and update with 400", async () => {
    const headers = new Headers({ cookie });
    const create = (name: string, slug: string) =>
      auth.api.createOrganization({ headers, body: { name, slug: `${tag}-${slug}` } });
    expect(await status(create('Acme</strong><h1 style="color:red">locked</h1>', "a"))).toBe(400);
    expect(await status(create("x".repeat(81), "b"))).toBe(400);
    expect(await status(create("  Acme Books  ", "c"))).toBe(200);
    const [created] = await db
      .select()
      .from(organization)
      .where(eq(organization.slug, `${tag}-c`));
    expect(created?.name).toBe("Acme Books");

    const update = (name: string) =>
      auth.api.updateOrganization({
        headers,
        body: { organizationId: created!.id, data: { name } },
      });
    expect(await status(update("Acme</strong><h1>Your account is locked</h1>"))).toBe(400);
    expect(await status(update("x".repeat(20_000)))).toBe(400);
    expect(await status(update("Acme Ltd"))).toBe(200);
  });

  it("P2-2: stores reset tokens hashed, and the emailed link still works", async () => {
    sent.length = 0;
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
    const link = sent.at(-1)?.text.match(/https?:\/\/\S+/)?.[0];
    const token = link && new URL(link).pathname.split("/").at(-1);
    expect(token).toBeTruthy();
    const rows = await db.select({ identifier: verification.identifier }).from(verification);
    expect(rows.some((row) => row.identifier.includes(token!))).toBe(false);
    expect(
      await status(
        auth.api.resetPassword({ body: { token: token!, newPassword: `${password}-2` } }),
      ),
    ).toBe(200);
  });

  it("caps reset emails per address and still answers like an unknown address", async () => {
    const other = `${tag}-limit@example.com`;
    const created = await auth.api.signUpEmail({ body: { email: other, password, name: "Limit" } });
    sent.length = 0;
    for (let i = 0; i < 5; i++) {
      const res = await auth.api.requestPasswordReset({
        body: { email: other, redirectTo: "/reset-password" },
      });
      expect(res.status).toBe(true);
    }
    expect(sent.filter((mail) => mail.to === other)).toHaveLength(3);
    const unknown = await auth.api.requestPasswordReset({
      body: { email: `${tag}-nobody@example.com`, redirectTo: "/reset-password" },
    });
    expect(unknown.status).toBe(true);
    await db.execute(
      sql`delete from organization where id in (select organization_id from member where user_id = ${created.user.id})`,
    );
    await db.delete(user).where(eq(user.id, created.user.id));
  });

  it("P2-4: seals new OAuth tokens and still reads plaintext rows from before", async () => {
    // The inferred plugin context is narrower than the helpers' AuthContext parameter.
    const context = (await auth.$context) as unknown as Parameters<typeof setTokenUtil>[1];
    const sealed = await setTokenUtil("ya29.new-access-token", context);
    expect(sealed).not.toContain("ya29");
    expect(await decryptOAuthToken(sealed!, context)).toBe("ya29.new-access-token");

    await db.insert(account).values({
      id: `${tag}-acct`,
      accountId: `${tag}-google`,
      providerId: "google",
      userId,
      accessToken: "ya29.legacy-plaintext",
      refreshToken: "1//legacy-refresh",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [legacy] = await db
      .select()
      .from(account)
      .where(eq(account.id, `${tag}-acct`));
    expect(await decryptOAuthToken(legacy!.accessToken!, context)).toBe("ya29.legacy-plaintext");
    expect(await decryptOAuthToken(legacy!.refreshToken!, context)).toBe("1//legacy-refresh");
  });

  it("GHSA-c85h: refuses role lists and stores padded roles trimmed", async () => {
    // The reset above revoked earlier sessions; sign in with the new password.
    const signIn = await auth.api.signInEmail({
      body: { email, password: `${password}-2` },
      returnHeaders: true,
    });
    cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => c?.includes("session_token="))
      .join("; ");
    const headers = new Headers({ cookie });
    // Comped to Pro above, the user owns their personal workspace and "Acme Books": the
    // Pro cap of 2. A third is refused on the server, saying why.
    const third = auth.api.createOrganization({
      headers,
      body: { name: "Roles", slug: `${tag}-roles` },
    });
    await expect(third).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { message: expect.stringContaining("the most on Pro") },
    });
    const [org] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, `${tag}-c`));
    const invite = (role: string) =>
      auth.api.createInvitation({
        headers,
        body: { organizationId: org!.id, email: `${tag}-x@example.com`, role: role as "member" },
      });
    expect(await status(invite("admin, owner"))).toBe(400);
    // 1.7.16+ trims roles before our hook, so padding can no longer smuggle in a different role.
    const padded = await invite(" owner");
    expect(padded.role).toBe("owner");
    expect(await status(invite("member"))).toBe(200);
  });

  it("M3: locks sign-in per address after 10 attempts, atomically, the same for unknown addresses", async () => {
    const victim = `${tag}-victim@example.com`;
    const ghost = `${tag}-ghost@example.com`;
    const created = await auth.api.signUpEmail({ body: { email: victim, password, name: "V" } });
    const attempt = (address: string, pass: string) =>
      auth.api.signInEmail({ body: { email: address, password: pass } });
    const bodyOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return null;
      } catch (error) {
        return error instanceof APIError
          ? { code: error.statusCode, message: error.message }
          : error;
      }
    };
    // 15 parallel wrong guesses: at most 10 reach the password check (401), the rest are 429.
    for (const address of [victim, ghost]) {
      const codes = await Promise.all(
        Array.from({ length: 15 }, () => status(attempt(address, "wrong-password-1"))),
      );
      expect(codes.filter((code) => code === 401)).toHaveLength(10);
      expect(codes.filter((code) => code === 429)).toHaveLength(5);
    }
    const lockedKnown = await bodyOf(attempt(victim, password));
    const lockedUnknown = await bodyOf(attempt(ghost, password));
    expect(lockedKnown).toEqual({ code: 429, message: expect.any(String) });
    expect(lockedKnown).toEqual(lockedUnknown);
    // Not permanent: ageing the counter past the window reopens sign-in.
    await db.execute(
      sql`update rate_limit set last_request = last_request - ${16 * 60 * 1000} where id like 'signin-fail:%'`,
    );
    // The real password then clears the count, so a fresh budget of wrong guesses follows.
    expect(await status(attempt(victim, password))).toBe(200);
    for (let i = 0; i < 9; i++) expect(await status(attempt(victim, "wrong-password-1"))).toBe(401);
    expect(await status(attempt(victim, password))).toBe(200);
    await db.execute(
      sql`delete from organization where id in (select organization_id from member where user_id = ${created.user.id})`,
    );
    await db.delete(user).where(eq(user.id, created.user.id));
    await db.execute(sql`delete from rate_limit where id like 'signin-fail:%'`);
  });

  it("guards the admin plugin endpoints: no last-admin demotion, no banning or removing admins", async () => {
    const make = async (name: string, role: string) => {
      const created = await auth.api.signUpEmail({
        body: { email: `${tag}-${name}@example.com`, password, name },
        returnHeaders: true,
      });
      await db
        .update(user)
        .set({ role, emailVerified: true })
        .where(eq(user.id, created.response.user.id));
      const signIn = await auth.api.signInEmail({
        body: { email: `${tag}-${name}@example.com`, password },
        returnHeaders: true,
      });
      const cookie = signIn.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .filter((c) => c?.includes("session_token="))
        .join("; ");
      return { id: created.response.user.id, headers: new Headers({ cookie }) };
    };
    const a = await make("adm-a", "admin");
    const b = await make("adm-b", "admin");
    const plain = await make("adm-plain", "user");
    // Admin mutations need a passed factor check first; two-factor.int.test.ts covers passing one.
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, a.id));
    await db
      .update(session)
      .set({ stepUpAt: new Date(), stepUpMethod: "totp" })
      .where(eq(session.userId, a.id));
    // Isolate from admins other tests or a shared database may hold.
    await db.execute(
      sql`update "user" set banned = true where role like '%admin%' and id not in (${a.id}, ${b.id})`,
    );
    const setRole = (actor: typeof a, userId: string, role: string) =>
      auth.api.setRole({ headers: actor.headers, body: { userId, role: role as "user" } });
    expect(await status(setRole(a, a.id, "user"))).toBe(403);
    expect(await status(auth.api.banUser({ headers: a.headers, body: { userId: b.id } }))).toBe(
      403,
    );
    expect(await status(auth.api.removeUser({ headers: a.headers, body: { userId: b.id } }))).toBe(
      403,
    );
    // Ordinary users are still manageable.
    expect(await status(setRole(a, plain.id, "admin"))).toBe(200);
    expect(await status(setRole(a, plain.id, "user"))).toBe(200);
    // Last admin: with the actor itself no longer counted (banned after signing in), demoting the
    // other admin would leave none.
    await db.update(user).set({ banned: true }).where(eq(user.id, a.id));
    const lastAdmin = await auth.api
      .setRole({ headers: a.headers, body: { userId: b.id, role: "user" } })
      .catch((error: unknown) => error);
    expect(lastAdmin).toBeInstanceOf(APIError);
    expect((lastAdmin as APIError).message).toMatch(/last admin/);
    const [still] = await db.select({ role: user.role }).from(user).where(eq(user.id, b.id));
    expect(still?.role).toBe("admin");
    for (const id of [a.id, b.id, plain.id]) {
      await db.execute(
        sql`delete from organization where id in (select organization_id from member where user_id = ${id})`,
      );
      await db.delete(user).where(eq(user.id, id));
    }
  });

  it("M3: caps password-change attempts per user", async () => {
    // Past the step-up gate, which refuses before the cap counts.
    await db
      .update(session)
      .set({ stepUpAt: new Date(), stepUpMethod: "email" })
      .where(eq(session.userId, userId));
    const headers = new Headers({ cookie });
    const change = () =>
      auth.api.changePassword({
        headers,
        body: { currentPassword: "wrong-password-1", newPassword: `${password}-9` },
      });
    const results: number[] = [];
    for (let i = 0; i < 11; i++) results.push(await status(change()));
    expect(results.slice(0, 10).every((code) => code !== 429)).toBe(true);
    expect(results[10]).toBe(429);
    await db.execute(sql`delete from rate_limit where id = ${`pwchange:${userId}`}`);
  });

  // Last: it deletes this user's sessions.
  it("M-A: the buyer of a charging subscription can't be removed, demoted or leave", async () => {
    const sessionCookie = (headers: Headers) =>
      headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .filter((c) => c?.includes("session_token="))
        .join("; ");
    const ownerHeaders = new Headers({ cookie });
    const buyerEmail = `${tag}-buyer@example.com`;
    const buyerUp = await auth.api.signUpEmail({
      body: { email: buyerEmail, password, name: "Pat Payer" },
      returnHeaders: true,
    });
    const buyerHeaders = new Headers({ cookie: sessionCookie(buyerUp.headers) });
    const buyerId = buyerUp.response.user.id;

    const orgId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    await db
      .insert(organization)
      .values({ id: orgId, name: "Pays", slug: `${tag}-pays`, createdAt: new Date() });
    await db.insert(member).values([
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId,
        role: "owner",
        createdAt: new Date(),
      },
      {
        id: memberId,
        organizationId: orgId,
        userId: buyerId,
        role: "owner",
        createdAt: new Date(),
      },
    ]);
    const subscriptionId = `sub_${tag}`;
    await db.insert(billingSubscriptions).values({
      organizationId: orgId,
      userId: buyerId,
      provider: "paddle",
      providerSubscriptionId: subscriptionId,
      providerCustomerId: `ctm_${tag}`,
      status: "active",
      providerUpdatedAt: new Date(),
    });

    const message = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return "ok";
      } catch (error) {
        return error instanceof APIError ? String(error.body?.message) : String(error);
      }
    };
    const cancelHint = "Cancel the subscription in Billing, or let it end, before";
    expect(
      await message(
        auth.api.updateMemberRole({
          headers: ownerHeaders,
          body: { organizationId: orgId, memberId, role: "admin" },
        }),
      ),
    ).toBe(`Pat Payer pays for Pro on this workspace. ${cancelHint} changing their role.`);
    expect(
      await message(
        auth.api.removeMember({
          headers: ownerHeaders,
          body: { organizationId: orgId, memberIdOrEmail: memberId },
        }),
      ),
    ).toBe(`Pat Payer pays for Pro on this workspace. ${cancelHint} removing them.`);
    expect(
      await message(
        auth.api.leaveOrganization({ headers: buyerHeaders, body: { organizationId: orgId } }),
      ),
    ).toBe(`You pay for Pro on this workspace. ${cancelHint} leaving.`);

    // Once it can't charge any more, the same actions go through.
    await db
      .update(billingSubscriptions)
      .set({ status: "canceled" })
      .where(eq(billingSubscriptions.providerSubscriptionId, subscriptionId));
    expect(
      await message(
        auth.api.leaveOrganization({ headers: buyerHeaders, body: { organizationId: orgId } }),
      ),
    ).toBe("ok");
    await db
      .delete(billingSubscriptions)
      .where(eq(billingSubscriptions.providerSubscriptionId, subscriptionId));
    await db.delete(user).where(eq(user.id, buyerId));
  });

  it("a revoked session stops working on auth endpoints at once (cookie cache off)", async () => {
    await db.delete(session).where(eq(session.userId, userId));
    const headers = new Headers({ cookie });
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect(await status(auth.api.listOrganizations({ headers }))).toBe(401);
  });
});
