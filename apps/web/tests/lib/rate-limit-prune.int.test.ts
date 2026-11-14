/**
 * The app's day-long caps against Better Auth's rate-limit pruning, on real Postgres. Whenever one of Better Auth's
 * own windows resets, it deletes every `rate_limit` row older than its longest window (an hour); counters kept in that
 * table lost a 24-hour cap after an hour. Skipped unless INTEGRATION=1.
 */
import { createHash } from "node:crypto";
import { appRateLimits, createDb, eq, rateLimit, sql } from "@receipt-ocr/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.INTEGRATION === "1";
vi.mock("server-only", () => ({}));

const tag = `int-ratelimit-${Date.now()}`;
const HOUR = 3_600_000;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

describe.skipIf(!enabled)("app rate limits next to Better Auth's pruning", () => {
  const db = createDb(process.env.DATABASE_URL ?? "");
  let auth: typeof import("@/lib/auth").auth;
  let limits: typeof import("@/lib/email-limits");
  const probe = `${tag}-probe`;

  beforeAll(async () => {
    ({ auth } = await import("@/lib/auth"));
    limits = await import("@/lib/email-limits");
  }, 60_000);

  afterAll(async () => {
    await db.delete(appRateLimits).where(sql`${appRateLimits.key} like 'contact-reply:%'`);
    await db.delete(rateLimit).where(eq(rateLimit.key, probe));
  });

  /** Makes Better Auth reset one of its own windows, which is when it prunes; resolves once it has. */
  async function betterAuthPrunes() {
    await db.insert(rateLimit).values({
      id: probe,
      key: probe,
      count: 1,
      lastRequest: Date.now() - 2 * HOUR,
    });
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const request = () =>
      auth.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin, "x-forwarded-for": ip },
          body: JSON.stringify({ email: `${tag}@example.com`, password: "not-the-password" }),
        }),
      );
    await request();
    await db
      .update(rateLimit)
      .set({ lastRequest: Date.now() - 2 * HOUR })
      .where(eq(rateLimit.key, `${ip}|/sign-in/email`));
    await request();
    // The prune may finish after the response.
    for (let i = 0; i < 50; i++) {
      const [left] = await db.select().from(rateLimit).where(eq(rateLimit.key, probe));
      if (!left) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Better Auth did not prune");
  }

  it("keeps one contact auto-reply per address a day after Better Auth prunes", async () => {
    const address = `${tag}-reply@example.com`;
    expect(await limits.allowContactReply(address, null)).toBe(true);
    expect(await limits.allowContactReply(address, null)).toBe(false);
    const key = `contact-reply:to:${createHash("sha256").update(limits.replyAddressKey(address)).digest("hex")}`;
    // Two hours into the 24-hour window.
    const moved = await db
      .update(appRateLimits)
      .set({ windowStart: Date.now() - 2 * HOUR })
      .where(eq(appRateLimits.key, key))
      .returning({ key: appRateLimits.key });
    expect(moved).toHaveLength(1);
    await betterAuthPrunes();
    expect(await limits.allowContactReply(address, null)).toBe(false);
  });
});
