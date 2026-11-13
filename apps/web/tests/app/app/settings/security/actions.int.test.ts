/**
 * The signed-in "Resend link" action against real Postgres and Better Auth. Skipped unless
 * INTEGRATION=1 (see lib/auth.int.test.ts for the setup).
 */
import { createHash } from "node:crypto";
import { createDb, sql, user } from "@receipt-ocr/db";
import type { SendEmailInput } from "@receipt-ocr/email";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.INTEGRATION === "1";
const sent: SendEmailInput[] = [];
const request = { headers: new Headers() };

vi.mock("@receipt-ocr/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/email")>()),
  sendEmail: async (_config: unknown, input: SendEmailInput) => {
    sent.push(input);
    return { delivered: true };
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => request.headers,
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const tag = `int-resend-${Date.now()}`;
const email = `${tag}@example.com`;

describe.skipIf(!enabled)("sendVerificationAction against Postgres", () => {
  const db = createDb(process.env.DATABASE_URL ?? "");

  beforeAll(async () => {
    const { auth } = await import("@/lib/auth");
    const signUp = await auth.api.signUpEmail({
      body: { email, password: "int-password-123", name: "Resend" },
      returnHeaders: true,
    });
    const cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0]!)
      .filter((c) => c.includes("session_token=") && !c.endsWith("="))
      .join("; ");
    request.headers = new Headers({ cookie });
    // Sign-up may have sent the first link; start the hourly count from zero.
    const { runtime } = await import("@/lib/runtime");
    const { clearRateLimit } = await import("@receipt-ocr/core");
    const digest = createHash("sha256").update(email).digest("hex");
    await runtime.runPromise(clearRateLimit(`email:verification:${digest}`));
  });

  afterAll(async () => {
    await db.execute(
      sql`delete from organization where id in (select m.organization_id from member m join "user" u on u.id = m.user_id where u.email = ${email})`,
    );
    await db.delete(user).where(sql`${user.email} = ${email}`);
  });

  // Pins that Better Auth awaits sendVerificationEmail: otherwise the capped send would set its
  // flag after the action returned, and the 4th resend would claim a link went out.
  it("sends three links an hour, then says it sent one recently", async () => {
    const { sendVerificationAction } = await import("@/app/app/settings/security/actions");
    sent.length = 0;
    for (let i = 0; i < 3; i++) expect(await sendVerificationAction()).toEqual({ ok: true });
    expect(sent.filter((mail) => mail.to === email)).toHaveLength(3);
    expect(await sendVerificationAction()).toEqual({
      ok: false,
      error: "We sent a link recently. Try again later.",
    });
    expect(sent.filter((mail) => mail.to === email)).toHaveLength(3);
  });
});
