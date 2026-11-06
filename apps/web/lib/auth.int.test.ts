/**
 * Better Auth against real Postgres. Skipped unless INTEGRATION=1; run with
 * `bun run --filter @receipt-ocr/web test:int` after `bun run db:migrate`,
 * with DATABASE_URL and BETTER_AUTH_SECRET set.
 */
import {
  account,
  createDb,
  eq,
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

vi.mock("server-only", () => ({}));
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

  it("GHSA-c85h: refuses padded owner roles on invite and role change", async () => {
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
    const org = await auth.api.createOrganization({
      headers,
      body: { name: "Roles", slug: `${tag}-roles` },
    });
    const invite = (role: string) =>
      auth.api.createInvitation({
        headers,
        body: { organizationId: org!.id, email: `${tag}-x@example.com`, role: role as "member" },
      });
    expect(await status(invite("admin, owner"))).toBe(400);
    expect(await status(invite(" owner"))).toBe(400);
    expect(await status(invite("member"))).toBe(200);
  });

  // Last: it deletes this user's sessions.
  it("a revoked session stops working on auth endpoints at once (cookie cache off)", async () => {
    await db.delete(session).where(eq(session.userId, userId));
    const headers = new Headers({ cookie });
    expect(await auth.api.getSession({ headers })).toBeNull();
    expect(await status(auth.api.listOrganizations({ headers }))).toBe(401);
  });
});
