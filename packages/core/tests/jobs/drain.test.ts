import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { WideEventLoggerLive } from "../../src/telemetry/logger";
import type { Job, JobDefinition } from "../../src/jobs/definition";
import { drainOnce, runWorkerLoop } from "../../src/jobs/drain";
import { JobQueue } from "../../src/jobs/queue";
import { resetTickMarks } from "../../src/jobs/runner";

const job = (n: number): Job => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  kind: "test.kind",
  state: "running",
  priority: 0,
  payload: {},
  idempotencyKey: null,
  receiptId: null,
  organizationId: null,
  userId: null,
  attempts: 1,
  maxAttempts: 3,
  runAt: new Date(),
  lockedBy: "w",
  lockedUntil: new Date(),
  lastErrorKind: null,
  waitMs: 0,
});

/** A queue with `n` due jobs; `reapedOnce` expired leases come back on the first reap. */
const fakeQueue = (n: number, reapedOnce = 0) => {
  const pending = Array.from({ length: n }, (_, i) => job(i + 1));
  let reaps = 0;
  const calls = { claim: 0, nextRunIn: 0 };
  const layer = Layer.succeed(JobQueue, {
    claim: () => {
      calls.claim += 1;
      return Effect.succeed(pending.splice(0, 1));
    },
    settle: () => Effect.succeed(true),
    heartbeat: () => Effect.succeed(true),
    reap: () =>
      Effect.succeed(
        reaps++ === 0
          ? Array.from({ length: reapedOnce }, (_, i) => ({
              ...job(900 + i),
              state: "queued" as const,
            }))
          : [],
      ),
    markTick: () => Effect.void,
    nextRunIn: () => {
      calls.nextRunIn += 1;
      return Effect.succeed(5_000);
    },
  } as unknown as JobQueue["Type"]);
  return { layer, calls, pending };
};

const ran: string[] = [];
const kind: JobDefinition<unknown, never> = {
  kind: "test.kind",
  payload: z.unknown(),
  maxAttempts: 3,
  leaseSeconds: 60,
  backoff: { baseMs: 1_000, capMs: 10_000 },
  run: () => Effect.sync(() => void ran.push("x")),
};
const registry = { "test.kind": kind };

const base = {
  registry,
  worker: "web:1:test",
  budgetMs: 10_000,
  stopClaimingBeforeMs: 0,
} as const;

beforeEach(() => {
  ran.length = 0;
  resetTickMarks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const run = <A>(effect: Effect.Effect<A, never, JobQueue>, queue: Layer.Layer<JobQueue>) =>
  Effect.runPromise(effect.pipe(Effect.provide(Layer.merge(queue, WideEventLoggerLive))));

describe("drainOnce", () => {
  it("stops at maxJobs, even with more due, and says it was capped", async () => {
    const q = fakeQueue(10);
    const summary = await run(drainOnce({ ...base, trigger: "drain", maxJobs: 3 }), q.layer);
    expect(summary).toMatchObject({ claimed: 3, succeeded: 3, capped: true });
    expect(q.pending).toHaveLength(7);
    expect(ran).toHaveLength(3);
  });

  it("holds the cap across concurrent slots", async () => {
    const q = fakeQueue(10);
    const summary = await run(
      drainOnce({ ...base, trigger: "drain", maxJobs: 4, concurrency: 3 }),
      q.layer,
    );
    expect(summary.claimed).toBe(4);
    expect(ran).toHaveLength(4);
  });

  it("drains everything under the cap without sleeping for backoff", async () => {
    const q = fakeQueue(2);
    const started = Date.now();
    const summary = await run(drainOnce({ ...base, trigger: "drain", maxJobs: 10 }), q.layer);
    expect(summary).toMatchObject({ claimed: 2, capped: false });
    // nextRunIn says 5 s away; the drain must return without waiting for it.
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(q.calls.nextRunIn).toBe(0);
  });

  it("claims nothing once the claim window has closed", async () => {
    const q = fakeQueue(5);
    const summary = await run(
      drainOnce({
        ...base,
        trigger: "drain",
        maxJobs: 10,
        budgetMs: 100,
        stopClaimingBeforeMs: 100,
      }),
      q.layer,
    );
    expect(summary.claimed).toBe(0);
    expect(q.calls.claim).toBe(0);
  });

  it("counts reaped leases and tags the events with the trigger", async () => {
    const lines: Record<string, unknown>[] = [];
    vi.spyOn(console, "info").mockImplementation(
      (...args) => void lines.push(JSON.parse(String(args[0]))),
    );
    const q = fakeQueue(0, 2);
    const summary = await run(drainOnce({ ...base, trigger: "drain", maxJobs: 10 }), q.layer);
    expect(summary.reaped).toBe(2);
    expect(lines.find((l) => l.event === "job.tick")).toMatchObject({
      trigger: "drain",
      tick: { reaped: 2 },
    });
  });
});

describe("runWorkerLoop", () => {
  it("runs back to back while there is work, sleeps when idle, and stops on abort", async () => {
    const q = fakeQueue(3);
    const controller = new AbortController();
    const passes: number[] = [];
    const loop = run(
      runWorkerLoop({
        ...base,
        maxJobs: 2,
        idleMs: 60_000,
        signal: controller.signal,
        onPass: (s) => void passes.push(s.claimed),
      }),
      q.layer,
    );
    // Two busy passes (2 then 1), then it idles; the 60 s sleep must end on abort.
    await vi.waitFor(() => expect(passes).toEqual([2, 1]));
    controller.abort();
    await loop;
    expect(ran).toHaveLength(3);
  });

  it("returns at once for a signal that is already aborted", async () => {
    const q = fakeQueue(3);
    const controller = new AbortController();
    controller.abort();
    await run(
      runWorkerLoop({ ...base, maxJobs: 2, idleMs: 10, signal: controller.signal }),
      q.layer,
    );
    expect(ran).toHaveLength(0);
  });

  it("lets the pass in progress finish before stopping", async () => {
    const q = fakeQueue(2);
    const controller = new AbortController();
    const slow: JobDefinition<unknown, never> = {
      ...kind,
      run: () =>
        Effect.sleep("30 millis").pipe(
          Effect.tap(() => Effect.sync(() => void ran.push("done"))),
          Effect.tap(() => Effect.sync(() => controller.abort())),
        ),
    };
    await run(
      runWorkerLoop({
        ...base,
        registry: { "test.kind": slow },
        maxJobs: 5,
        idleMs: 10,
        signal: controller.signal,
      }),
      q.layer,
    );
    // Aborted during the first job; the pass still ran the second, then stopped.
    expect(ran).toEqual(["done", "done"]);
  });
});
