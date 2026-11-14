/**
 * `hitRateLimit` counters in `app_rate_limits` against real Postgres: a fixed window, and the daily purge of windows
 * that ended long ago. Skipped unless INTEGRATION=1.
 */
import { appRateLimits, eq, sql } from "@receipt-ocr/db";
import { Effect, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "../src/index";
import { Db } from "../src/services";
import { hitRateLimit, purgeRateLimits } from "../src/workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `ratelimits-${Date.now()}`;
const DAY = 86_400_000;

describe.skipIf(!enabled)("app rate limits against Postgres", () => {
  afterAll(async () => {
    await db((d) => d.delete(appRateLimits).where(sql`${appRateLimits.key} like ${`${tag}%`}`));
    await runtime.dispose();
  });

  it("allows `max` hits a window and starts a new window once it has passed", async () => {
    const key = `${tag}-window`;
    expect((await run(hitRateLimit(key, DAY, 1))).allowed).toBe(true);
    const refused = await run(hitRateLimit(key, DAY, 1));
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(DAY / 1000 - 60);
    await db((d) =>
      d
        .update(appRateLimits)
        .set({ windowStart: Date.now() - DAY - 1000 })
        .where(eq(appRateLimits.key, key)),
    );
    expect((await run(hitRateLimit(key, DAY, 1))).allowed).toBe(true);
  });

  it("purges counters two days past their start and keeps a day-old one", async () => {
    const seed = (key: string, ageMs: number) =>
      db((d) => d.insert(appRateLimits).values({ key, count: 1, windowStart: Date.now() - ageMs }));
    await seed(`${tag}-old`, 2 * DAY + 60_000);
    await seed(`${tag}-day`, DAY);
    expect(await run(purgeRateLimits(500))).toBeGreaterThanOrEqual(1);
    const left = await db((d) =>
      d
        .select({ key: appRateLimits.key })
        .from(appRateLimits)
        .where(sql`${appRateLimits.key} in (${`${tag}-old`}, ${`${tag}-day`})`),
    );
    expect(left.map((r) => r.key)).toEqual([`${tag}-day`]);
  });
});
