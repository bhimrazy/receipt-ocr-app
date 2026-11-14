/**
 * Retention in `maintenance.purge` against real Postgres: expired step-up codes, finished jobs and stray provider
 * tokens.
 * Skipped unless INTEGRATION=1.
 */
import { randomUUID } from "node:crypto";
import { account, eq, inArray, jobs, session, sql, stepUpCodes, user } from "@receipt-ocr/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clearProviderTokens, makeAppLayer, type AppServices } from "../../src/index";
import {
  ContactReplyMailer,
  enqueueJob,
  enqueueWelcomeEmail,
  JOB_REGISTRY,
  MAINTENANCE_PURGE,
  SupportNotifyMailer,
  tick,
  WELCOME_EMAIL,
  WelcomeMailer,
} from "../../src/jobs";
import { STORAGE_ORPHAN_SWEEP } from "../../src/jobs/kinds/storage-orphan-sweep";
import { purgeFinishedJobs } from "../../src/jobs/retention";
import { Db } from "../../src/services";
import { purgeStepUpCodes } from "../../src/step-up/store";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(
  makeAppLayer(
    Layer.mergeAll(
      WelcomeMailer.Disabled,
      ContactReplyMailer.Disabled,
      SupportNotifyMailer.Disabled,
    ),
  ),
);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices | SupportNotifyMailer>) =>
  runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `retention-${Date.now()}`;
const KIND = `test.retention.${tag}`;
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

type JobSeed = {
  state: "queued" | "succeeded" | "dead" | "cancelled";
  finishedDaysAgo?: number;
  kind?: string;
  userId?: string | null;
  idempotencyKey?: string;
};

async function seedJob(over: JobSeed) {
  const [row] = await db((d) =>
    d
      .insert(jobs)
      .values({
        kind: over.kind ?? KIND,
        state: over.state,
        payload: {},
        maxAttempts: 1,
        userId: over.userId ?? null,
        idempotencyKey: over.idempotencyKey ?? null,
        createdAt: daysAgo((over.finishedDaysAgo ?? 0) + 1),
        finishedAt: over.finishedDaysAgo === undefined ? null : daysAgo(over.finishedDaysAgo),
      })
      .returning({ id: jobs.id }),
  );
  return row!.id;
}

const remainingJobs = async (ids: string[]) =>
  (await db((d) => d.select({ id: jobs.id }).from(jobs).where(inArray(jobs.id, ids))))
    .map((r) => r.id)
    .sort();

describe.skipIf(!enabled)("maintenance.purge retention against Postgres", () => {
  const userId = `${tag}-u`;
  const sessionId = `${tag}-s`;

  beforeAll(async () => {
    await db(async (d) => {
      await d
        .insert(user)
        .values({ id: userId, name: "R", email: `${userId}@example.com`, emailVerified: true });
      await d.insert(session).values({
        id: sessionId,
        token: randomUUID(),
        userId,
        expiresAt: new Date(Date.now() + DAY),
      });
    });
  });

  afterAll(async () => {
    await db(async (d) => {
      await d
        .delete(jobs)
        .where(
          sql`${jobs.kind} = ${KIND} or ${jobs.userId} = ${userId} or ${jobs.idempotencyKey} like ${`${tag}%`}`,
        );
      await d.delete(user).where(eq(user.id, userId));
    });
    await runtime.dispose();
  });

  it("deletes step-up codes a day past expiry, in batches, and keeps the rest", async () => {
    const seed = (expiresHoursAgo: number) =>
      db((d) =>
        d
          .insert(stepUpCodes)
          .values({
            sessionId,
            userId,
            codeHash: randomUUID(),
            expiresAt: new Date(Date.now() - expiresHoursAgo * 3_600_000),
            createdAt: new Date(Date.now() - expiresHoursAgo * 3_600_000 - 600_000),
          })
          .returning({ id: stepUpCodes.id }),
      ).then((rows) => rows[0]!.id);
    const old = [await seed(25), await seed(48), await seed(24 * 30)];
    const kept = [await seed(23), await seed(1), await seed(-0.1)];

    expect(await run(purgeStepUpCodes(2))).toBe(2);
    expect(await run(purgeStepUpCodes(2))).toBeGreaterThanOrEqual(1);
    const left = await db((d) =>
      d
        .select({ id: stepUpCodes.id })
        .from(stepUpCodes)
        .where(inArray(stepUpCodes.id, [...old, ...kept])),
    );
    expect(left.map((r) => r.id).sort()).toEqual([...kept].sort());
  });

  it("deletes succeeded jobs after 30 days and dead or cancelled ones after 90, never live ones", async () => {
    const gone = [
      await seedJob({ state: "succeeded", finishedDaysAgo: 31 }),
      await seedJob({ state: "dead", finishedDaysAgo: 91 }),
      await seedJob({ state: "cancelled", finishedDaysAgo: 91 }),
    ];
    const kept = [
      await seedJob({ state: "succeeded", finishedDaysAgo: 29 }),
      await seedJob({ state: "dead", finishedDaysAgo: 60 }),
      await seedJob({ state: "cancelled", finishedDaysAgo: 89 }),
      await seedJob({ state: "queued", idempotencyKey: `${tag}-live` }),
    ];
    await run(purgeFinishedJobs("succeeded", 500));
    await run(purgeFinishedJobs("failed", 500));
    expect(await remainingJobs([...gone, ...kept])).toEqual([...kept].sort());
  });

  it("keeps a welcome job while its user exists, so the user is never welcomed twice", async () => {
    const welcomed = await seedJob({
      state: "succeeded",
      finishedDaysAgo: 400,
      kind: WELCOME_EMAIL,
      userId,
    });
    const deletedAccount = await seedJob({
      state: "succeeded",
      finishedDaysAgo: 400,
      kind: WELCOME_EMAIL,
      userId: null,
    });
    await run(purgeFinishedJobs("succeeded", 500));
    expect(await remainingJobs([welcomed, deletedAccount])).toEqual([welcomed]);
    expect(await run(enqueueWelcomeEmail(userId))).toBe(false);
  });

  it("an old finished job's key is already free, so purging it lets nothing run twice", async () => {
    const key = `${tag}-key`;
    const old = await seedJob({ state: "succeeded", finishedDaysAgo: 31, idempotencyKey: key });
    const live = await db((d) =>
      enqueueJob(d, { kind: KIND, payload: {}, maxAttempts: 1, idempotencyKey: key }),
    );
    expect("id" in live).toBe(true);
    await run(purgeFinishedJobs("succeeded", 500));
    expect(
      await db((d) =>
        enqueueJob(d, { kind: KIND, payload: {}, maxAttempts: 1, idempotencyKey: key }),
      ),
    ).toEqual({ duplicate: true });
    expect(await remainingJobs([old])).toEqual([]);
  });

  it("clears provider tokens an older release wrote, and leaves passwords alone", async () => {
    const expiry = new Date(Date.now() + DAY);
    await db((d) =>
      d.insert(account).values([
        {
          id: `${tag}-google`,
          accountId: `${tag}-g`,
          providerId: "google",
          userId,
          accessToken: "sealed-access",
          refreshToken: "sealed-refresh",
          idToken: "eyJ.id",
          accessTokenExpiresAt: expiry,
          refreshTokenExpiresAt: expiry,
        },
        {
          id: `${tag}-credential`,
          accountId: userId,
          providerId: "credential",
          userId,
          password: "salt:key",
        },
      ]),
    );
    expect(await run(clearProviderTokens(500))).toBeGreaterThanOrEqual(1);
    const rows = await db((d) =>
      d.select().from(account).where(eq(account.userId, userId)).orderBy(account.providerId),
    );
    expect(
      rows.map((r) => [
        r.providerId,
        r.password,
        r.accessToken,
        r.refreshToken,
        r.idToken,
        r.accessTokenExpiresAt,
        r.refreshTokenExpiresAt,
      ]),
    ).toEqual([
      ["credential", "salt:key", null, null, null, null, null],
      ["google", null, null, null, null, null, null],
    ]);
    expect(await run(clearProviderTokens(500))).toBe(0);
  });

  it("runs as part of the daily purge job and reports what each table lost", async () => {
    const expiredJob = await seedJob({ state: "dead", finishedDaysAgo: 120 });
    const queued = await db((d) =>
      enqueueJob(d, { kind: MAINTENANCE_PURGE, payload: {}, maxAttempts: 1 }),
    );
    if (!("id" in queued)) throw new Error("not queued");
    const stats = await run(
      tick({
        worker: `${tag}-worker`,
        registry: JOB_REGISTRY,
        budgetMs: 30_000,
        ids: [queued.id],
        waitForRetries: false,
      }),
    );
    expect(stats.runs.map((r) => r.outcome)).toEqual(["succeeded"]);
    expect(await remainingJobs([expiredJob])).toEqual([]);
    await db((d) => d.delete(jobs).where(eq(jobs.id, queued.id)));
  });

  it("queues the day's first orphan-sweep part once, however often the purge runs", async () => {
    const sweepParts = () =>
      db((d) =>
        d
          .select({ id: jobs.id, payload: jobs.payload })
          .from(jobs)
          .where(sql`${jobs.kind} = ${STORAGE_ORPHAN_SWEEP} and ${jobs.state} = 'queued'`),
      );
    for (let i = 0; i < 2; i++) {
      const queued = await db((d) =>
        enqueueJob(d, { kind: MAINTENANCE_PURGE, payload: {}, maxAttempts: 1 }),
      );
      if (!("id" in queued)) throw new Error("not queued");
      await run(
        tick({
          worker: `${tag}-worker`,
          registry: JOB_REGISTRY,
          budgetMs: 30_000,
          ids: [queued.id],
          waitForRetries: false,
        }),
      );
      await db((d) => d.delete(jobs).where(eq(jobs.id, queued.id)));
    }
    const parts = await sweepParts();
    expect(parts).toHaveLength(1);
    expect(parts[0]!.payload).toMatchObject({ part: 0 });
    await db((d) => d.delete(jobs).where(eq(jobs.id, parts[0]!.id)));
  });
});
