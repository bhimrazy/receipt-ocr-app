/**
 * Job queue against real Postgres and S3 (RustFS locally). Skipped unless
 * INTEGRATION=1; run with `bun run --filter @receipt-ocr/core test:int` after
 * `bun run db:migrate`, with DATABASE_URL and S3_* set and OCR_PROVIDER=fixture.
 */
import { FIXTURE_FAIL_MARKER, FIXTURE_RECEIPTS, type OcrFailureKind } from "@receipt-ocr/ai";
import {
  and,
  eq,
  inArray,
  jobControls,
  jobs,
  ocrCalls,
  ocrRounds,
  organization,
  receipts,
  sql,
  user,
} from "@receipt-ocr/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { AppLayer } from "../../src/index";
import { OcrError } from "../../src/errors";
import { Ocr, withoutCooling } from "../../src/ocr";
import {
  claimRetry,
  ingestUpload,
  purgeReceiptFiles,
  runExtraction,
  settleFailure,
} from "../../src/pipeline";
import { checkQuota, quotaGate, usageWindow } from "../../src/quota";
import { EXTRACTION_FAILED_MESSAGE, ReceiptRepo } from "../../src/repository";
import { Db, Storage } from "../../src/services";
import { Settings } from "../../src/settings";
import { DEFAULT_PLANS } from "../../src/plans";

import { ensurePersonalWorkspace } from "../../src/workspace";
import { NonRetryableJobError, type JobDefinition } from "../../src/jobs/definition";
import {
  EXTRACTION_CANCELLED_MESSAGE,
  EXTRACTION_FILE_MISSING_MESSAGE,
  receiptExtract,
} from "../../src/jobs/kinds/receipt-extract";
import {
  enqueueWelcomeEmail,
  welcomeEmail,
  WelcomeMailer,
} from "../../src/jobs/kinds/welcome-email";
import { tickScope } from "../../src/jobs/live";
import { JobQueue } from "../../src/jobs/queue";
import { drainOnce } from "../../src/jobs/drain";
import { cancelJob, resetTickMarks, tick, type JobRunRecord } from "../../src/jobs/runner";

const enabled = process.env.INTEGRATION === "1";
const tag = `jobs-${Date.now()}`;
const limits = { perMinute: 1000, perDay: 1000 };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);

type Step = "ok" | { kind: OcrFailureKind; retryAfterMs?: number };
/** What each successive model call does; past the end, it succeeds. */
let script: Step[] = [];
let calls = 0;
/** When each model call began, on the runner's clock: inside the attempt, so a slow write-up after it can't shift it. */
let callTimes: number[] = [];
const MODEL = "google:gemini-3.8-flash" as const;
const ZERO = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

const ScriptedOcr = Layer.succeed(Ocr, {
  ready: Effect.void,
  extract: (_file, options) =>
    Effect.gen(function* () {
      yield* withoutCooling(
        [{ model: MODEL, enabled: true, timeoutMs: 30_000 }],
        options?.cooling ?? new Map(),
        Date.now(),
      );
      callTimes.push(Date.now());
      const step = script[calls++] ?? "ok";
      if (step === "ok") {
        return {
          extraction: FIXTURE_RECEIPTS[0]!,
          usage: ZERO,
          model: MODEL,
          promptVersion: "v2" as const,
          attempts: [{ model: MODEL, step: 0, kind: "ok" as const, ms: 1, usage: ZERO }],
        };
      }
      return yield* new OcrError({
        message: "Receipt extraction failed",
        kind: step.kind,
        attempts: [
          {
            model: MODEL,
            step: 0,
            kind: step.kind,
            ms: 1,
            usage: null,
            retryAfterMs: step.retryAfterMs,
          },
        ],
      });
    }),
});

const scriptedLayer = Layer.mergeAll(
  ReceiptRepo.Live,
  Storage.Live,
  ScriptedOcr,
  JobQueue.Live,
).pipe(Layer.provideMerge(Settings.Live), Layer.provideMerge(Db.Live));
type Services = Layer.Layer.Success<typeof scriptedLayer>;
const scripted = ManagedRuntime.make(scriptedLayer);
/** The real fixture provider, for reads that always fail (FIXTURE_FAIL). */
const fixture = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, Services>) => scripted.runPromise(effect);

const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));
const queue = <A, E>(f: (q: typeof JobQueue.Service) => Effect.Effect<A, E>) =>
  run(Effect.flatMap(JobQueue, f));

/** receipt.extract with millisecond backoff, so retries run inside one test. */
const fastExtract = { ...receiptExtract, backoff: { baseMs: 100, capMs: 400 } };
const receiptRegistry = { [fastExtract.kind]: fastExtract };
/** receipt.extract with its real (seconds) backoff, for tests that make a retry due by hand. */
const steppedRegistry = { [receiptExtract.kind]: receiptExtract };

const jobsOf = (receiptId: string) =>
  db((d) => d.select().from(jobs).where(eq(jobs.receiptId, receiptId)).orderBy(jobs.createdAt));
const receiptOf = (id: string, scope: Scope) =>
  run(Effect.flatMap(ReceiptRepo, (r) => r.get(id, scope)));
const callsOf = (receiptId: string) =>
  db((d) =>
    d
      .select({ round: ocrCalls.round, jobAttempt: ocrCalls.jobAttempt, status: ocrCalls.status })
      .from(ocrCalls)
      .where(eq(ocrCalls.receiptId, receiptId))
      .orderBy(ocrCalls.round, ocrCalls.jobAttempt, ocrCalls.step),
  );

type Scope = { userId: string; organizationId: string; role: string };

const EXTRACT_TICK = tickScope("receipt.extract");

/** When some process last ran a tick serving receipt.extract, as the orphan rule sees it. */
const setLastTick = (msAgo: number) =>
  db((d) =>
    d
      .insert(jobControls)
      .values({ scope: EXTRACT_TICK, updatedAt: new Date(Date.now() - msAgo) })
      .onConflictDoUpdate({
        target: jobControls.scope,
        set: { updatedAt: new Date(Date.now() - msAgo) },
      }),
  );
const SIX_MINUTES = 6 * 60_000;

/** Ages a receipt, its round and its queued job as if it had waited six minutes. */
const age = async (receiptId: string, jobId: string) => {
  const longAgo = new Date(Date.now() - SIX_MINUTES);
  await db((d) => d.update(receipts).set({ updatedAt: longAgo }).where(eq(receipts.id, receiptId)));
  await db((d) =>
    d.update(ocrRounds).set({ createdAt: longAgo }).where(eq(ocrRounds.receiptId, receiptId)),
  );
  await db((d) => d.update(jobs).set({ runAt: longAgo }).where(eq(jobs.id, jobId)));
};

async function createUser(name: string): Promise<Scope> {
  const id = `${tag}-${name}`;
  await db((d) =>
    d.insert(user).values({ id, name, email: `${id}@example.com`, emailVerified: true }),
  );
  const orgId = await run(ensurePersonalWorkspace({ id, name, email: `${id}@example.com` }));
  if (!orgId) throw new Error("no workspace");
  return { userId: id, organizationId: orgId, role: "owner" };
}

const upload = (scope: Scope, body = JPEG) =>
  run(ingestUpload({ scope, fileName: "r.jpg", body, limits }));

/** Runs the given jobs, waiting out backoff, until nothing is left to run. */
const drain = (ids: readonly string[], worker = `${tag}-w`, budgetMs = 20_000) =>
  run(
    tick({
      worker,
      registry: receiptRegistry,
      budgetMs,
      stopClaimingBeforeMs: 2_000,
      ids,
    }),
  );

/**
 * Runs one job attempt by attempt until it is finished, making it due before
 * each tick instead of waiting out its backoff, so slow runners can't change
 * the outcome. Bounded: a job that never finishes fails the test.
 */
async function runToEnd(jobId: string, on: "scripted" | "fixture" = "scripted") {
  const runs: JobRunRecord[] = [];
  for (let i = 0; i < 10; i++) {
    const [job] = await db((d) =>
      d.select({ state: jobs.state }).from(jobs).where(eq(jobs.id, jobId)),
    );
    if (job?.state !== "queued" && job?.state !== "running") return runs;
    await db((d) =>
      d
        .update(jobs)
        .set({ runAt: new Date(0) })
        .where(and(eq(jobs.id, jobId), eq(jobs.state, "queued"))),
    );
    const step = tick({
      worker: `${tag}-w`,
      registry: receiptRegistry,
      budgetMs: 60_000,
      ids: [jobId],
      waitForRetries: false,
    });
    const stats = await (on === "fixture" ? fixture.runPromise(step) : scripted.runPromise(step));
    runs.push(...stats.runs);
  }
  throw new Error(`job ${jobId} never finished`);
}

const counts = new Map<string, number>();
const COUNT = `test.count.${tag}`;
const countKind: JobDefinition<{ n: number }, never> = {
  kind: COUNT,
  payload: z.object({ n: z.number() }),
  maxAttempts: 3,
  leaseSeconds: 30,
  backoff: { baseMs: 10, capMs: 10 },
  run: (_payload, { job }) =>
    Effect.sync(() => void counts.set(job.id, (counts.get(job.id) ?? 0) + 1)).pipe(
      Effect.zipRight(Effect.sleep("2 millis")),
    ),
};
const SLOW = `test.slow.${tag}`;
let slowInterrupted = 0;
const slowKind: JobDefinition<{ ms: number }, never> = {
  kind: SLOW,
  payload: z.object({ ms: z.number() }),
  maxAttempts: 2,
  // Heartbeats every 333 ms keep this alive however long the run takes.
  leaseSeconds: 1,
  backoff: { baseMs: 10, capMs: 10 },
  run: ({ ms }) =>
    Effect.sleep(`${ms} millis`).pipe(
      Effect.onInterrupt(() => Effect.sync(() => void slowInterrupted++)),
    ),
};
const SCRUB = `test.scrub.${tag}`;
const scrubKind: JobDefinition<{ to: string; fail: boolean }, never> = {
  kind: SCRUB,
  payload: z.object({ to: z.string(), fail: z.boolean() }),
  maxAttempts: 3,
  leaseSeconds: 30,
  backoff: { baseMs: 10, capMs: 10 },
  scrubPayload: true,
  run: ({ fail }) => (fail ? Effect.fail(new NonRetryableJobError({ kind: "boom" })) : Effect.void),
};
const testRegistry = { [COUNT]: countKind, [SLOW]: slowKind, [SCRUB]: scrubKind };

describe.skipIf(!enabled)("job queue against Postgres", () => {
  let a: Scope;
  let b: Scope;

  beforeAll(async () => {
    a = await createUser("a");
    b = await createUser("b");
  });

  afterEach(async () => {
    script = [];
    calls = 0;
    callTimes = [];
    await db((d) => d.delete(jobControls).where(sql`${jobControls.scope} not like 'tick:%'`));
    await setLastTick(0);
  });

  afterAll(async () => {
    for (const owner of [a, b])
      await run(purgeReceiptFiles({ organizationId: owner.organizationId }));
    await db(async (d) => {
      await d
        .delete(jobs)
        .where(sql`${jobs.kind} like ${`test.%.${tag}`} or ${jobs.userId} like ${`${tag}%`}`);
      await d.delete(ocrCalls).where(sql`${ocrCalls.userId} like ${`${tag}%`}`);
      await d.delete(ocrRounds).where(sql`${ocrRounds.userId} like ${`${tag}%`}`);
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await scripted.dispose();
    await fixture.dispose();
  });

  it("enqueues the job with the receipt and its round, in one transaction", async () => {
    const { receipt, jobId } = await upload(a);
    const [job] = await jobsOf(receipt.id);
    expect(job).toMatchObject({
      id: jobId,
      kind: "receipt.extract",
      state: "queued",
      attempts: 0,
      maxAttempts: 4,
      userId: a.userId,
      idempotencyKey: `receipt:${receipt.id}:round:1`,
      payload: {
        receiptId: receipt.id,
        organizationId: a.organizationId,
        userId: a.userId,
        round: 1,
      },
    });
    // Waiting in the queue, the round counts as in flight.
    expect((await run(checkQuota(a, limits))).used).toBeGreaterThanOrEqual(1);
    await drain([jobId]);
    expect((await receiptOf(receipt.id, a))?.status).toBe("completed");
    expect((await jobsOf(receipt.id))[0]).toMatchObject({ state: "succeeded", attempts: 1 });
  });

  it("concurrent workers never run a job twice", async () => {
    const ids = await db(async (d) => {
      const rows = await d
        .insert(jobs)
        .values(
          Array.from({ length: 200 }, (_, n) => ({ kind: COUNT, payload: { n }, maxAttempts: 3 })),
        )
        .returning({ id: jobs.id });
      return rows.map((r) => r.id);
    });
    const ticks = Array.from({ length: 5 }, (_, w) =>
      run(
        tick({
          worker: `${tag}-claimer-${w}`,
          registry: testRegistry,
          budgetMs: 30_000,
          stopClaimingBeforeMs: 1_000,
          concurrency: 3,
          waitForRetries: false,
        }),
      ),
    );
    const stats = await Promise.all(ticks);
    expect(stats.reduce((sum, s) => sum + s.runs.length, 0)).toBe(200);
    expect(ids.every((id) => counts.get(id) === 1)).toBe(true);
    // Every worker got some of the work.
    expect(stats.filter((s) => s.runs.length > 0).length).toBeGreaterThan(1);
    const states = await db((d) =>
      d
        .select({ state: jobs.state, attempts: jobs.attempts, n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(eq(jobs.kind, COUNT))
        .groupBy(jobs.state, jobs.attempts),
    );
    expect(states).toEqual([{ state: "succeeded", attempts: 1, n: 200 }]);
  });

  it("two concurrent drains share the queue, each respects its cap, and no job runs twice", async () => {
    const ids = await db(async (d) => {
      const rows = await d
        .insert(jobs)
        .values(
          Array.from({ length: 12 }, (_, n) => ({ kind: COUNT, payload: { n }, maxAttempts: 3 })),
        )
        .returning({ id: jobs.id });
      return rows.map((r) => r.id);
    });
    const pass = (worker: string) =>
      run(
        drainOnce({
          worker: `${tag}-${worker}`,
          trigger: "drain",
          registry: testRegistry,
          budgetMs: 30_000,
          stopClaimingBeforeMs: 1_000,
          maxJobs: 5,
          concurrency: 2,
        }),
      );
    const [x, y] = await Promise.all([pass("drain-x"), pass("drain-y")]);
    expect(x.claimed).toBeLessThanOrEqual(5);
    expect(y.claimed).toBeLessThanOrEqual(5);
    // Not exactly 10: a drain that finds every due row locked by the other (SKIP LOCKED) stops early.
    expect(x.claimed + y.claimed).toBeGreaterThan(0);
    expect(ids.every((id) => (counts.get(id) ?? 0) <= 1)).toBe(true);
    // Later passes pick up the rest; across all of them each job ran exactly once.
    let left = 12 - x.claimed - y.claimed;
    for (let n = 0; left > 0 && n < 5; n++) left -= (await pass(`drain-z${n}`)).claimed;
    expect(left).toBe(0);
    expect(ids.every((id) => counts.get(id) === 1)).toBe(true);
  });

  it("a drain reclaims a job whose worker died mid-run, without anyone touching the receipt", async () => {
    // Only this test's job may be due, so the counts below are exact.
    await db((d) =>
      d
        .delete(jobs)
        .where(sql`${jobs.kind} in (${COUNT}, ${SLOW}) and ${jobs.state} in ('queued', 'running')`),
    );
    const [stale] = await db((d) =>
      d
        .insert(jobs)
        .values({
          kind: COUNT,
          payload: { n: 0 },
          maxAttempts: 3,
          state: "running",
          attempts: 1,
          lockedBy: `${tag}-dead`,
          lockedUntil: new Date(Date.now() - 5_000),
        })
        .returning({ id: jobs.id }),
    );
    const summary = await run(
      drainOnce({
        worker: `${tag}-drain-r`,
        trigger: "drain",
        registry: testRegistry,
        budgetMs: 30_000,
        stopClaimingBeforeMs: 1_000,
        maxJobs: 10,
      }),
    );
    expect(summary).toMatchObject({ reaped: 1, claimed: 1, succeeded: 1 });
    expect(counts.get(stale!.id)).toBe(1);
    expect(await queue((q) => q.get(stale!.id))).toMatchObject({ state: "succeeded", attempts: 2 });
  });

  it("a paused queue is not drained", async () => {
    await db((d) => d.insert(jobs).values({ kind: COUNT, payload: { n: 1 }, maxAttempts: 3 }));
    await queue((q) => q.pause("queue", { reason: "test" }));
    const summary = await run(
      drainOnce({
        worker: `${tag}-drain-p`,
        trigger: "drain",
        registry: testRegistry,
        budgetMs: 10_000,
        stopClaimingBeforeMs: 1_000,
        maxJobs: 10,
      }),
    );
    expect(summary.claimed).toBe(0);
    await db((d) => d.delete(jobControls).where(sql`${jobControls.scope} not like 'tick:%'`));
    // Leave nothing queued for later tests.
    await run(
      drainOnce({
        worker: `${tag}-drain-p`,
        trigger: "drain",
        registry: testRegistry,
        budgetMs: 10_000,
        stopClaimingBeforeMs: 1_000,
        maxJobs: 10,
      }),
    );
  });

  it("lists a processing receipt as waiting to retry only while its job is queued for later", async () => {
    const { receipt, jobId } = await upload(b);
    const list = async () =>
      (
        await run(Effect.flatMap(ReceiptRepo, (r) => r.list(b, {}, { limit: 50, offset: 0 })))
      ).rows.find((r) => r.id === receipt.id);
    expect((await list())?.retryAt).toBeNull();
    await db((d) =>
      d
        .update(jobs)
        .set({ runAt: new Date(Date.now() + 60_000) })
        .where(eq(jobs.id, jobId)),
    );
    const waiting = await list();
    expect(waiting?.status).toBe("processing");
    expect(waiting?.retryAt).toBeInstanceOf(Date);
    expect(waiting!.retryAt!.getTime()).toBeGreaterThan(Date.now());
    await run(cancelJob(receiptRegistry, jobId));
  });

  it("a crashed worker's job is reaped and resumed; its late writes change nothing", async () => {
    const { receipt, jobId } = await upload(a);
    const lease = [{ kind: "receipt.extract", leaseSeconds: 90 }];
    const [claimed] = await queue((q) =>
      q.claim({ worker: "crashed", kinds: lease, n: 1, ownerCap: 9, ids: [jobId] }),
    );
    expect(claimed).toMatchObject({
      id: jobId,
      state: "running",
      attempts: 1,
      lockedBy: "crashed",
    });
    // The worker dies: nothing renews the lease.
    await db((d) =>
      d
        .update(jobs)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(jobs.id, jobId)),
    );

    const stats = await drain([jobId], "rescuer");
    expect(stats.reaped).toBeGreaterThanOrEqual(1);
    expect(stats.runs).toMatchObject([{ jobId, attempt: 2, outcome: "succeeded" }]);
    const done = await receiptOf(receipt.id, a);
    expect(done?.status).toBe("completed");

    // The crashed worker comes back: its heartbeat, settle and write are fenced off.
    expect(await queue((q) => q.heartbeat(claimed!, "crashed", 90))).toBe(false);
    expect(
      await queue((q) => q.settle(claimed!, "crashed", { type: "dead", errorKind: "timeout" })),
    ).toBe(false);
    const late = { ...FIXTURE_RECEIPTS[1]!, merchant: "Zombie" };
    expect(
      await run(
        Effect.flatMap(ReceiptRepo, (r) => r.complete(receipt.id, a, 1, late, "fixture", [])),
      ),
    ).toBeNull();
    expect(await receiptOf(receipt.id, a)).toMatchObject({
      status: "completed",
      merchant: done?.merchant,
    });
    expect((await jobsOf(receipt.id))[0]).toMatchObject({ state: "succeeded", attempts: 2 });
  });

  it("reaps a running job that started more than 24.8 days ago (no int overflow)", async () => {
    const { receipt, jobId } = await upload(a);
    const lease = [{ kind: "receipt.extract", leaseSeconds: 90 }];
    await queue((q) =>
      q.claim({ worker: "ancient", kinds: lease, n: 1, ownerCap: 9, ids: [jobId] }),
    );
    const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db((d) =>
      d
        .update(jobs)
        .set({ startedAt: longAgo, lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(jobs.id, jobId)),
    );
    const reaped = await queue((q) => q.reap());
    expect(reaped.map((job) => job.id)).toContain(jobId);
    const [job] = await jobsOf(receipt.id);
    const last = (job!.attemptLog as { outcome: string; ms: number }[]).at(-1)!;
    expect(last.ms).toBeGreaterThan(2 ** 31);
  });

  it("a lease that expires on the last attempt kills the job and settles the receipt", async () => {
    const { receipt, jobId } = await upload(a);
    await db((d) => d.update(jobs).set({ attempts: 3 }).where(eq(jobs.id, jobId)));
    await queue((q) =>
      q.claim({
        worker: "crashed",
        kinds: [{ kind: "receipt.extract", leaseSeconds: 90 }],
        n: 1,
        ownerCap: 9,
        ids: [jobId],
      }),
    );
    await db((d) =>
      d
        .update(jobs)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(jobs.id, jobId)),
    );
    await drain([jobId]);
    expect((await jobsOf(receipt.id))[0]).toMatchObject({
      state: "dead",
      lastErrorKind: "lease-expired",
    });
    expect(await receiptOf(receipt.id, a)).toMatchObject({
      status: "failed",
      errorMessage: EXTRACTION_FAILED_MESSAGE,
    });
    // One row closes the attempt that never reported, so the round stops reading as in flight.
    expect(await callsOf(receipt.id)).toEqual([{ round: 1, jobAttempt: 4, status: "timeout" }]);
  });

  it("retries with backoff, records every attempt's calls, and reserves quota once per round", async () => {
    const c = await createUser("retry");
    const before = await run(
      Effect.flatMap(ReceiptRepo, (r) => r.usage(c, usageWindow(new Date(), true))),
    );
    script = [{ kind: "provider-error" }, { kind: "timeout" }];
    const { receipt, jobId } = await upload(c);
    const stats = await run(
      tick({
        worker: `${tag}-w`,
        registry: receiptRegistry,
        budgetMs: 20_000,
        stopClaimingBeforeMs: 2_000,
        ids: [jobId],
      }),
    );

    expect(stats.runs.map((r) => [r.attempt, r.outcome, r.errorKind])).toEqual([
      [1, "retry", "provider-error"],
      [2, "retry", "timeout"],
      [3, "succeeded", undefined],
    ]);
    // Each retry waited out its backoff: at least half of 100 ms, then of 200 ms, between
    // model calls. A call happens before its attempt's result is written, and the next attempt
    // can only be claimed once that write's time plus the backoff has passed, so the gap is at
    // least the backoff however slow the runner is. The queue schedules on the database clock
    // and this measures on the runner's, so allow a few ms of drift between them.
    const drift = 10;
    expect(callTimes).toHaveLength(3);
    expect(callTimes[1]! - callTimes[0]!).toBeGreaterThanOrEqual(50 - drift);
    expect(callTimes[2]! - callTimes[1]!).toBeGreaterThanOrEqual(100 - drift);
    expect((await receiptOf(receipt.id, c))?.status).toBe("completed");
    expect(await callsOf(receipt.id)).toEqual([
      { round: 1, jobAttempt: 1, status: "provider-error" },
      { round: 1, jobAttempt: 2, status: "timeout" },
      { round: 1, jobAttempt: 3, status: "ok" },
    ]);
    const [job] = await jobsOf(receipt.id);
    expect(job).toMatchObject({ state: "succeeded", attempts: 3 });
    expect((job!.attemptLog as { outcome: string }[]).map((e) => e.outcome)).toEqual([
      "retry",
      "retry",
      "succeeded",
    ]);
    // One round, one receipt read: the automatic retries cost the user nothing extra.
    const after = await run(
      Effect.flatMap(ReceiptRepo, (r) => r.usage(c, usageWindow(new Date(), true))),
    );
    expect(after.userMinute - before.userMinute).toBe(1);
    expect(after.day - before.day).toBe(1);
    expect(
      await db((d) => d.select().from(ocrRounds).where(eq(ocrRounds.receiptId, receipt.id))),
    ).toHaveLength(1);
  });

  it("goes dead after its attempts, fails the receipt, and the user's retry is a new round", async () => {
    const c = await createUser("dead");
    const body = new Uint8Array([...JPEG, ...new TextEncoder().encode(FIXTURE_FAIL_MARKER)]);
    const { receipt, jobId } = await fixture.runPromise(
      ingestUpload({ scope: c, fileName: "f.jpg", body, limits }),
    );
    const runs = await runToEnd(jobId, "fixture");
    expect(runs.map((r) => r.outcome)).toEqual(["retry", "retry", "retry", "dead"]);
    expect(await receiptOf(receipt.id, c)).toMatchObject({
      status: "failed",
      errorMessage: EXTRACTION_FAILED_MESSAGE,
    });
    expect((await callsOf(receipt.id)).map((r) => r.jobAttempt)).toEqual([1, 2, 3, 4]);
    expect((await jobsOf(receipt.id))[0]).toMatchObject({
      state: "dead",
      attempts: 4,
      lastErrorKind: "provider-error",
    });

    const retried = await run(claimRetry({ receiptId: receipt.id, scope: c, limits }));
    expect(retried.round).toBe(2);
    const all = await jobsOf(receipt.id);
    expect(all.map((j) => [j.state, (j.payload as { round: number }).round])).toEqual([
      ["dead", 1],
      ["queued", 2],
    ]);
    await drain([retried.jobId]);
    expect((await receiptOf(receipt.id, c))?.status).toBe("completed");
  });

  it("does not retry what another attempt won't fix", async () => {
    script = [{ kind: "bad-image" }];
    const { receipt, jobId } = await upload(a);
    const stats = await drain([jobId]);
    expect(stats.runs.map((r) => [r.outcome, r.errorKind])).toEqual([["dead", "bad-image"]]);
    expect((await receiptOf(receipt.id, a))?.status).toBe("failed");
  });

  it("a stored file missing from the bucket fails the receipt on the first attempt", async () => {
    const { receipt, jobId } = await upload(a);
    await run(Effect.flatMap(Storage, (s) => s.remove([receipt.imageObjectKey!])));
    const stats = await drain([jobId]);
    expect(stats.runs.map((r) => [r.outcome, r.errorKind])).toEqual([
      ["dead", "stored-file-missing"],
    ]);
    expect(await receiptOf(receipt.id, a)).toMatchObject({
      status: "failed",
      errorMessage: EXTRACTION_FILE_MISSING_MESSAGE,
    });
    expect((await jobsOf(receipt.id))[0]).toMatchObject({ state: "dead", attempts: 1 });
    expect(calls).toBe(0);
  });

  it("a 429 cools the provider down: the next attempt waits without spending one", async () => {
    script = [{ kind: "rate-limited", retryAfterMs: 1_500 }];
    const { receipt, jobId } = await upload(a);
    const first = await run(
      tick({
        worker: `${tag}-w`,
        registry: receiptRegistry,
        budgetMs: 10_000,
        ids: [jobId],
        waitForRetries: false,
      }),
    );
    expect(first.runs.map((r) => [r.outcome, r.errorKind])).toEqual([["retry", "rate-limited"]]);
    const cooldowns = await queue((q) => q.cooldowns);
    const until = cooldowns.get("google")!;
    expect(until.getTime()).toBeGreaterThan(Date.now() + 500);
    // Due again before the cooldown ends (e.g. an admin re-ran it): deferred, not spent.
    await db((d) =>
      d
        .update(jobs)
        .set({ runAt: new Date(0) })
        .where(eq(jobs.id, jobId)),
    );
    const second = await run(
      tick({
        worker: `${tag}-w`,
        registry: receiptRegistry,
        budgetMs: 10_000,
        ids: [jobId],
        waitForRetries: false,
      }),
    );
    expect(second.runs.map((r) => [r.outcome, r.errorKind])).toEqual([
      ["deferred", "providers-cooling"],
    ]);
    const [waiting] = await jobsOf(receipt.id);
    expect(waiting).toMatchObject({ state: "queued", attempts: 1 });
    expect(Math.abs(waiting!.runAt.getTime() - until.getTime())).toBeLessThan(5);
    // Once it ends, the job runs on its second attempt.
    await db((d) =>
      d
        .update(jobControls)
        .set({ until: new Date(0) })
        .where(eq(jobControls.scope, "provider:google")),
    );
    const third = await runToEnd(jobId);
    expect(third.map((r) => [r.attempt, r.outcome])).toEqual([[2, "succeeded"]]);
    expect((await receiptOf(receipt.id, a))?.status).toBe("completed");
  });

  it("dedupes on the idempotency key while a job is live, and on one live job per receipt", async () => {
    const key = `${tag}:once`;
    const job = { kind: COUNT, payload: { n: 1 }, maxAttempts: 1, idempotencyKey: key };
    const first = await queue((q) => q.enqueue(job));
    expect(first).toHaveProperty("id");
    expect(await queue((q) => q.enqueue(job))).toEqual({ duplicate: true });
    await run(
      tick({
        worker: `${tag}-w`,
        registry: testRegistry,
        budgetMs: 5_000,
        ids: ["id" in first ? first.id : ""],
        waitForRetries: false,
      }),
    );
    // A finished job frees its key.
    expect(await queue((q) => q.enqueue(job))).toHaveProperty("id");

    const { receipt } = await upload(a);
    const second = await queue((q) =>
      q.enqueue({
        kind: "receipt.extract",
        payload: {},
        maxAttempts: 1,
        receiptId: receipt.id,
        idempotencyKey: `${tag}:other`,
      }),
    );
    expect(second).toEqual({ duplicate: true });
  });

  it("caps each user's running jobs, so one user's batch can't starve another's upload", async () => {
    // Real accounts: jobs.user_id references the user.
    const heavy = (await createUser("heavy")).userId;
    const light = (await createUser("light")).userId;
    await db((d) =>
      d.insert(jobs).values([
        ...Array.from({ length: 10 }, (_, n) => ({
          kind: COUNT,
          payload: { n },
          maxAttempts: 1,
          userId: heavy,
          runAt: new Date(Date.now() - 60_000 + n),
        })),
        { kind: COUNT, payload: { n: 99 }, maxAttempts: 1, userId: light },
      ]),
    );
    const kinds = [{ kind: COUNT, leaseSeconds: 30 }];
    const claimed = await queue((q) =>
      q.claim({ worker: `${tag}-fair`, kinds, n: 5, ownerCap: 2 }),
    );
    expect(claimed.filter((j) => j.userId === heavy)).toHaveLength(2);
    expect(claimed.filter((j) => j.userId === light)).toHaveLength(1);
    // The heavy user stays at the cap until one finishes.
    expect(
      await queue((q) => q.claim({ worker: `${tag}-fair`, kinds, n: 5, ownerCap: 2 })),
    ).toEqual([]);
    await queue((q) => q.settle(claimed[0]!, `${tag}-fair`, { type: "succeeded" }));
    const next = await queue((q) => q.claim({ worker: `${tag}-fair`, kinds, n: 5, ownerCap: 2 }));
    expect(next.map((j) => j.userId)).toEqual([heavy]);
    await db((d) => d.delete(jobs).where(inArray(jobs.userId, [heavy, light])));
  });

  it("a stale or zombie attempt can't overwrite a newer round", async () => {
    script = [{ kind: "bad-image" }];
    const { receipt, jobId } = await upload(a);
    await drain([jobId]);
    const retried = await run(claimRetry({ receiptId: receipt.id, scope: a, limits }));
    // Round 1's handler running late finds a newer round and leaves it alone.
    expect(
      await run(runExtraction({ receiptId: receipt.id, scope: a, round: 1, jobAttempt: 2 })),
    ).toEqual({ kind: "skipped", reason: "superseded" });
    expect(await run(settleFailure({ receiptId: receipt.id, scope: a, round: 1 }))).toBe(false);
    expect((await receiptOf(receipt.id, a))?.status).toBe("processing");
    await drain([retried.jobId]);
    expect((await receiptOf(receipt.id, a))?.status).toBe("completed");
  });

  it("a user retry supersedes a job left live for an older round", async () => {
    const { receipt, jobId } = await upload(a);
    await run(Effect.flatMap(ReceiptRepo, (r) => r.fail(receipt.id, a, 1, "x", [])));
    const retried = await run(claimRetry({ receiptId: receipt.id, scope: a, limits }));
    expect(await queue((q) => q.get(jobId))).toMatchObject({
      state: "cancelled",
      lastErrorKind: "superseded",
    });
    expect(await queue((q) => q.get(retried.jobId))).toMatchObject({ state: "queued" });
  });

  it("heartbeats hold a long job's lease; losing it (a cancel) interrupts the handler", async () => {
    const [{ id: longId }] = await db((d) =>
      d
        .insert(jobs)
        .values({ kind: SLOW, payload: { ms: 2_500 }, maxAttempts: 2 })
        .returning({ id: jobs.id }),
    );
    // A second worker reaps every 200 ms while the job runs for 2.5 lease lengths.
    let reaping = true;
    const reaper = (async () => {
      let reaped = 0;
      while (reaping) {
        reaped += (await queue((q) => q.reap())).filter((j) => j.id === longId).length;
        await new Promise((r) => setTimeout(r, 200));
      }
      return reaped;
    })();
    const stats = await run(
      tick({
        worker: `${tag}-long`,
        registry: testRegistry,
        budgetMs: 10_000,
        ids: [longId!],
        waitForRetries: false,
      }),
    );
    reaping = false;
    expect(await reaper).toBe(0);
    expect(stats.runs).toMatchObject([{ outcome: "succeeded", attempt: 1 }]);

    const [{ id: cancelled }] = await db((d) =>
      d
        .insert(jobs)
        .values({ kind: SLOW, payload: { ms: 10_000 }, maxAttempts: 2 })
        .returning({ id: jobs.id }),
    );
    const running = run(
      tick({
        worker: `${tag}-long`,
        registry: testRegistry,
        budgetMs: 15_000,
        ids: [cancelled!],
        waitForRetries: false,
      }),
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(await run(cancelJob(testRegistry, cancelled!))).toBe(true);
    const lost = await running;
    expect(lost.runs).toMatchObject([{ outcome: "lost" }]);
    expect(lost.runs[0]!.ms).toBeLessThan(2_000);
    expect(slowInterrupted).toBe(1);
    expect(await queue((q) => q.get(cancelled!))).toMatchObject({ state: "cancelled" });
  });

  it("cancelling a receipt's job settles the receipt", async () => {
    const { receipt, jobId } = await upload(a);
    expect(await run(cancelJob(receiptRegistry, jobId))).toBe(true);
    expect(await receiptOf(receipt.id, a)).toMatchObject({
      status: "failed",
      errorMessage: EXTRACTION_CANCELLED_MESSAGE,
    });
    expect(await run(cancelJob(receiptRegistry, jobId))).toBe(false);
  });

  it("a paused kind is not claimed until resumed", async () => {
    const result = await queue((q) =>
      q.enqueue({ kind: COUNT, payload: { n: 7 }, maxAttempts: 1 }),
    );
    const id = "id" in result ? result.id : "";
    const kinds = [{ kind: COUNT, leaseSeconds: 30 }];
    await queue((q) => q.pause(`kind:${COUNT}`, { reason: "test" }));
    expect(
      await queue((q) => q.claim({ worker: `${tag}-p`, kinds, n: 1, ownerCap: 9, ids: [id] })),
    ).toEqual([]);
    await queue((q) => q.resume(`kind:${COUNT}`));
    expect(
      await queue((q) => q.claim({ worker: `${tag}-p`, kinds, n: 1, ownerCap: 9, ids: [id] })),
    ).toHaveLength(1);
  });

  it("a scrubbing kind empties its payload when it succeeds or dies, not while it will retry", async () => {
    const ids: string[] = [];
    for (const fail of [false, true]) {
      const result = await queue((q) =>
        q.enqueue({ kind: SCRUB, payload: { to: "a@example.com", fail }, maxAttempts: 3 }),
      );
      ids.push("id" in result ? result.id : "");
    }
    await run(
      tick({
        worker: `${tag}-w`,
        registry: testRegistry,
        budgetMs: 5_000,
        ids,
        waitForRetries: false,
      }),
    );
    const rows = await db((d) =>
      d
        .select({ state: jobs.state, payload: jobs.payload })
        .from(jobs)
        .where(inArray(jobs.id, ids)),
    );
    expect(rows.map((r) => r.state).sort()).toEqual(["dead", "succeeded"]);
    for (const row of rows) expect(row.payload).toEqual({});

    // A retry keeps the payload: it is still needed.
    const retried = await queue((q) =>
      q.enqueue({ kind: SCRUB, payload: { to: "b@example.com", fail: false }, maxAttempts: 3 }),
    );
    const id = "id" in retried ? retried.id : "";
    const [claimed] = await queue((q) =>
      q.claim({
        worker: `${tag}-r`,
        kinds: [{ kind: SCRUB, leaseSeconds: 30 }],
        n: 1,
        ownerCap: 9,
        ids: [id],
      }),
    );
    await queue((q) =>
      q.settle(
        claimed!,
        `${tag}-r`,
        { type: "retry", delayMs: 1000, errorKind: "x" },
        { scrubPayload: true },
      ),
    );
    expect(await queue((q) => q.get(id))).toMatchObject({
      state: "queued",
      payload: { to: "b@example.com" },
    });
  });

  it("a malformed payload goes straight to dead", async () => {
    const result = await queue((q) =>
      q.enqueue({ kind: COUNT, payload: { n: "x" }, maxAttempts: 3 }),
    );
    const id = "id" in result ? result.id : "";
    const stats = await run(
      tick({
        worker: `${tag}-w`,
        registry: testRegistry,
        budgetMs: 5_000,
        ids: [id],
        waitForRetries: false,
      }),
    );
    expect(stats.runs).toMatchObject([{ outcome: "dead", errorKind: "invalid-payload" }]);
    expect(await queue((q) => q.get(id))).toMatchObject({ state: "dead", attempts: 1 });
  });

  it("a round between automatic retries keeps holding the user's quota", async () => {
    const c = await createUser("between");
    const usage = () =>
      run(Effect.flatMap(ReceiptRepo, (r) => r.usage(c, usageWindow(new Date(), true))));
    const start = (await usage()).day;
    script = Array.from({ length: 4 }, () => ({ kind: "provider-error" as const }));
    const { receipt, jobId } = await upload(c);
    expect((await usage()).day).toBe(start + 1);
    for (let attempt = 1; attempt <= 4; attempt++) {
      await db((d) =>
        d
          .update(jobs)
          .set({ runAt: new Date(0) })
          .where(eq(jobs.id, jobId)),
      );
      // One attempt per tick: with millisecond backoff a slow runner made the retry due again
      // inside the same tick and ran it twice.
      const { runs } = await run(
        tick({
          worker: `${tag}-w`,
          registry: steppedRegistry,
          budgetMs: 10_000,
          ids: [jobId],
          waitForRetries: false,
        }),
      );
      expect(runs.map((r) => r.outcome)).toEqual([attempt < 4 ? "retry" : "dead"]);
      // Its calls failed, but its job is live: still in flight, not a free failure.
      if (attempt < 4) expect((await usage()).day).toBe(start + 1);
    }
    expect((await receiptOf(receipt.id, c))?.status).toBe("failed");
    // Settled: now one failed round, inside the day's free allowance, counted once.
    expect((await usage()).day).toBe(start);
    const failedRounds = await db((d) =>
      d.select().from(ocrRounds).where(eq(ocrRounds.receiptId, receipt.id)),
    );
    expect(failedRounds).toHaveLength(1);
  });

  it("each model-calling retry attempt counts toward the global daily cap", async () => {
    const c = await createUser("global");
    const usage = () =>
      run(Effect.flatMap(ReceiptRepo, (r) => r.usage(c, usageWindow(new Date(), true))));
    const before = (await usage()).globalDay!;
    script = [{ kind: "timeout" }, { kind: "timeout" }];
    const { jobId } = await upload(c);
    expect((await runToEnd(jobId)).map((r) => r.outcome)).toEqual(["retry", "retry", "succeeded"]);
    // One round, three attempts that each called a model.
    expect((await usage()).globalDay! - before).toBe(3);
    // A cap that the retries filled refuses the next upload.
    process.env.OCR_DAILY_CAP = String((await usage()).globalDay);
    try {
      const gate = await run(quotaGate(limits));
      expect(gate.decide(await usage())).toMatchObject({ allowed: false, window: "global" });
    } finally {
      delete process.env.OCR_DAILY_CAP;
    }
  });

  it("a reaped job re-claimed by the same worker id fences off the first claim", async () => {
    const result = await queue((q) =>
      q.enqueue({ kind: COUNT, payload: { n: 3 }, maxAttempts: 3 }),
    );
    const id = "id" in result ? result.id : "";
    const kinds = [{ kind: COUNT, leaseSeconds: 30 }];
    const claim = () =>
      queue((q) => q.claim({ worker: "same", kinds, n: 1, ownerCap: 9, ids: [id] }));
    const [first] = await claim();
    await db((d) =>
      d
        .update(jobs)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(jobs.id, id)),
    );
    await queue((q) => q.reap());
    const [second] = await claim();
    expect(second).toMatchObject({ attempts: 2, lockedBy: "same" });
    expect(await queue((q) => q.heartbeat(first!, "same", 30))).toBe(false);
    expect(await queue((q) => q.settle(first!, "same", { type: "succeeded" }))).toBe(false);
    expect(await queue((q) => q.heartbeat(second!, "same", 30))).toBe(true);
  });

  it("finds a receipt's job that is due but not running, for the poll to kick", async () => {
    const { receipt, jobId } = await upload(a);
    expect(await queue((q) => q.dueReceiptJob(receipt.id))).toBe(jobId);
    await db((d) =>
      d
        .update(jobs)
        .set({ runAt: new Date(Date.now() + 60_000) })
        .where(eq(jobs.id, jobId)),
    );
    expect(await queue((q) => q.dueReceiptJob(receipt.id))).toBeNull();
    // Running under a live lease: someone has it.
    await db((d) =>
      d
        .update(jobs)
        .set({ runAt: new Date(0) })
        .where(eq(jobs.id, jobId)),
    );
    const kinds = [{ kind: "receipt.extract", leaseSeconds: 90 }];
    await queue((q) => q.claim({ worker: `${tag}-k`, kinds, n: 1, ownerCap: 9, ids: [jobId] }));
    expect(await queue((q) => q.dueReceiptJob(receipt.id))).toBeNull();
    // Its worker died.
    await db((d) =>
      d
        .update(jobs)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(eq(jobs.id, jobId)),
    );
    expect(await queue((q) => q.dueReceiptJob(receipt.id))).toBe(jobId);
    await drain([jobId]);
    expect((await receiptOf(receipt.id, a))?.status).toBe("completed");
  });

  it.each(["queued", "running"] as const)(
    "a long-overdue %s job stops holding the receipt and its quota; a retry cancels it",
    async (state) => {
      const c = await createUser(`overdue-${state}`);
      const usage = () =>
        run(Effect.flatMap(ReceiptRepo, (r) => r.usage(c, usageWindow(new Date(), true))));
      const start = (await usage()).day;
      const { receipt, jobId } = await upload(c);
      const longAgo = new Date(Date.now() - 6 * 60_000);
      await db((d) =>
        d.update(receipts).set({ updatedAt: longAgo }).where(eq(receipts.id, receipt.id)),
      );
      await db((d) =>
        d.update(ocrRounds).set({ createdAt: longAgo }).where(eq(ocrRounds.receiptId, receipt.id)),
      );
      await db((d) =>
        d
          .update(jobs)
          .set(
            state === "queued"
              ? { runAt: longAgo }
              : { state: "running", lockedBy: "gone", lockedUntil: longAgo },
          )
          .where(eq(jobs.id, jobId)),
      );
      // And, for a queued job, nothing has drained the queue for as long.
      if (state === "queued") await setLastTick(SIX_MINUTES);
      expect((await receiptOf(receipt.id, c))?.status).toBe("failed");
      expect((await usage()).day).toBe(start);
      const retried = await run(claimRetry({ receiptId: receipt.id, scope: c, limits }));
      expect(await queue((q) => q.get(jobId))).toMatchObject({
        state: "cancelled",
        lastErrorKind: "superseded",
      });
      await drain([retried.jobId]);
      expect((await receiptOf(receipt.id, c))?.status).toBe("completed");
    },
  );

  it("a job waiting behind its owner's cap stays live while ticks run, and ages out once none do", async () => {
    const c = await createUser("capped");
    const usage = () =>
      run(Effect.flatMap(ReceiptRepo, (r) => r.usage(c, usageWindow(new Date(), true))));
    const start = (await usage()).day;
    // Two jobs already running for this user: the running cap.
    await db((d) =>
      d.insert(jobs).values(
        [1, 2].map((n) => ({
          kind: COUNT,
          payload: { n },
          maxAttempts: 1,
          userId: c.userId,
          state: "running" as const,
          lockedBy: `${tag}-busy`,
          lockedUntil: new Date(Date.now() + 60_000),
        })),
      ),
    );
    const { receipt, jobId } = await upload(c);
    await age(receipt.id, jobId);
    expect((await receiptOf(receipt.id, c))?.status).toBe("processing");
    expect((await usage()).day).toBe(start + 1);
    // Not claimable, so a poll doesn't kick it.
    expect(await queue((q) => q.dueReceiptJob(receipt.id))).toBeNull();
    // Running jobs whose lease ran out don't hold the cap: then the poll may kick it.
    await db((d) =>
      d
        .update(jobs)
        .set({ lockedUntil: new Date(Date.now() - 1000) })
        .where(and(eq(jobs.userId, c.userId), eq(jobs.kind, COUNT))),
    );
    expect(await queue((q) => q.dueReceiptJob(receipt.id))).toBe(jobId);
    // Nothing has drained the queue for six minutes: now it is orphaned.
    await setLastTick(SIX_MINUTES);
    expect((await receiptOf(receipt.id, c))?.status).toBe("failed");
    expect((await usage()).day).toBe(start);
    await db((d) => d.delete(jobs).where(eq(jobs.userId, c.userId)));
  });

  it("a pause longer than five minutes keeps receipts processing, and a poll doesn't kick them", async () => {
    await queue((q) => q.pause("queue", { reason: "test" }));
    const { receipt, jobId } = await upload(b);
    await age(receipt.id, jobId);
    // Ticks keep running, and recording, while the queue is paused.
    await setLastTick(SIX_MINUTES);
    resetTickMarks();
    await run(
      tick({
        worker: `${tag}-w`,
        registry: receiptRegistry,
        budgetMs: 5_000,
        waitForRetries: false,
      }),
    );
    expect((await receiptOf(receipt.id, b))?.status).toBe("processing");
    expect(await queue((q) => q.dueReceiptJob(receipt.id))).toBeNull();
    await queue((q) => q.resume("queue"));
    expect(await queue((q) => q.dueReceiptJob(receipt.id))).toBe(jobId);
    await drain([jobId]);
    expect((await receiptOf(receipt.id, b))?.status).toBe("completed");
  });

  it("only an unfiltered tick proves a kind is drained: a request running its own job doesn't", async () => {
    const c = await createUser("orphan");
    const { receipt, jobId } = await upload(c);
    await age(receipt.id, jobId);
    await setLastTick(SIX_MINUTES);
    expect((await receiptOf(receipt.id, c))?.status).toBe("failed");
    // Another upload's first attempt, run in its request (filtered to its id).
    resetTickMarks();
    const other = await upload(c, new Uint8Array([...JPEG, 7]));
    const ran = await run(
      tick({
        worker: `${tag}-w`,
        registry: receiptRegistry,
        budgetMs: 5_000,
        ids: [other.jobId],
        waitForRetries: false,
      }),
    );
    expect(ran.runs).toMatchObject([{ jobId: other.jobId, outcome: "succeeded" }]);
    expect((await receiptOf(receipt.id, c))?.status).toBe("failed");
    // A real drain records the kind, and runs the orphan.
    const drained = await run(
      tick({
        worker: `${tag}-w`,
        registry: receiptRegistry,
        budgetMs: 5_000,
        waitForRetries: false,
      }),
    );
    expect(drained.runs.map((r) => r.jobId)).toContain(jobId);
    const [mark] = await db((d) =>
      d.select().from(jobControls).where(eq(jobControls.scope, EXTRACT_TICK)),
    );
    expect(Date.now() - mark!.updatedAt.getTime()).toBeLessThan(60_000);
    expect((await receiptOf(receipt.id, c))?.status).toBe("completed");
  });

  it("a receipt job of a kind no tick serves ages out while other kinds are drained", async () => {
    const c = await createUser("unserved");
    const { receipt, jobId } = await upload(c);
    await db((d) => d.update(jobs).set({ kind: "receipt.unserved" }).where(eq(jobs.id, jobId)));
    await age(receipt.id, jobId);
    // receipt.extract is being drained right now.
    await setLastTick(0);
    expect((await receiptOf(receipt.id, c))?.status).toBe("failed");
    await db((d) => d.delete(jobs).where(eq(jobs.id, jobId)));
  });

  it("one 429 cools the provider for every job, not just the one that hit it", async () => {
    script = [{ kind: "rate-limited", retryAfterMs: 60_000 }];
    const first = await upload(a);
    const other = await upload(b, new Uint8Array([...JPEG, 9]));
    await run(
      tick({
        worker: `${tag}-w`,
        registry: receiptRegistry,
        budgetMs: 10_000,
        ids: [first.jobId],
        waitForRetries: false,
      }),
    );
    const { runs } = await run(
      tick({
        worker: `${tag}-w`,
        registry: receiptRegistry,
        budgetMs: 10_000,
        ids: [other.jobId],
        waitForRetries: false,
      }),
    );
    // Another user's job never called the provider and spent no attempt.
    expect(runs.map((r) => [r.outcome, r.errorKind])).toEqual([["deferred", "providers-cooling"]]);
    expect(calls).toBe(1);
    expect(await queue((q) => q.get(other.jobId))).toMatchObject({ state: "queued", attempts: 0 });
    for (const { jobId } of [first, other]) await run(cancelJob(receiptRegistry, jobId));
  });

  it("deleting an account unlinks its jobs", async () => {
    const c = await createUser("leaver");
    const { jobId } = await upload(c);
    await run(cancelJob(receiptRegistry, jobId));
    await db((d) => d.delete(user).where(eq(user.id, c.userId)));
    expect(await queue((q) => q.get(jobId))).toMatchObject({ userId: null });
  });

  it("a stuck receipt with a live job keeps reading as processing", async () => {
    const { receipt } = await upload(b);
    await db((d) =>
      d
        .update(receipts)
        .set({ updatedAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(receipts.id, receipt.id)),
    );
    expect((await receiptOf(receipt.id, b))?.status).toBe("processing");
    const listed = await run(
      Effect.flatMap(ReceiptRepo, (r) => r.list(b, { status: "failed" }, { limit: 10, offset: 0 })),
    );
    expect(listed.rows.map((r) => r.id)).not.toContain(receipt.id);
    await db((d) => d.delete(jobs).where(and(eq(jobs.receiptId, receipt.id))));
    expect((await receiptOf(receipt.id, b))?.status).toBe("failed");
  });

  it("welcomes a user once: a second enqueue is a no-op, before and after the mail is sent", async () => {
    const sent: { to: string; plan: string; policy: unknown; idempotencyKey: string }[] = [];
    const mailer = Layer.succeed(WelcomeMailer, {
      send: (input) => Effect.sync(() => (sent.push(input), "delivered" as const)),
    });
    const welcomeJobs = () =>
      db((d) =>
        d
          .select()
          .from(jobs)
          .where(and(eq(jobs.kind, "email.welcome"), eq(jobs.userId, a.userId))),
      );
    expect(await run(enqueueWelcomeEmail(a.userId))).toBe(true);
    expect(await run(enqueueWelcomeEmail(a.userId))).toBe(false);
    await run(
      tick({
        worker: `${tag}-welcome`,
        registry: { [welcomeEmail.kind]: welcomeEmail },
        budgetMs: 30_000,
        waitForRetries: false,
      }).pipe(Effect.provide(mailer)),
    );
    expect(sent).toEqual([
      {
        to: expect.stringContaining("@"),
        plan: "free",
        policy: DEFAULT_PLANS.free,
        idempotencyKey: `job:${(await welcomeJobs())[0]?.id}`,
      },
    ]);
    expect((await welcomeJobs()).map((j) => j.state)).toEqual(["succeeded"]);
    expect(await run(enqueueWelcomeEmail(a.userId))).toBe(false);
    expect(await welcomeJobs()).toHaveLength(1);
  });
});
