import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { annotateEvent } from "../telemetry/current";
import { WideEventLoggerLive } from "../telemetry/logger";
import { RetryableJobError, type Job, type JobDefinition, type JobFailure } from "./definition";
import { JobQueue } from "./queue";
import { resetTickMarks, tick } from "./runner";

const JOB: Job = {
  id: "00000000-0000-4000-8000-0000000000a1",
  kind: "test.kind",
  state: "running",
  priority: 0,
  payload: { n: 1 },
  idempotencyKey: null,
  receiptId: "00000000-0000-4000-8000-0000000000b1",
  organizationId: "org-1",
  userId: "user-1",
  attempts: 1,
  maxAttempts: 3,
  runAt: new Date(),
  lockedBy: "w",
  lockedUntil: new Date(),
  lastErrorKind: null,
  waitMs: 42,
};

/** A queue holding `jobs` once each; every write succeeds. */
const fakeQueue = (jobs: Job[]) => {
  const pending = [...jobs];
  return Layer.succeed(JobQueue, {
    claim: () => Effect.succeed(pending.splice(0, 1)),
    settle: () => Effect.succeed(true),
    heartbeat: () => Effect.succeed(true),
    reap: () => Effect.succeed([]),
    markTick: () => Effect.void,
    nextRunIn: () => Effect.succeed(null),
  } as unknown as JobQueue["Type"]);
};

const definition = (
  run: () => Effect.Effect<unknown, JobFailure>,
): JobDefinition<unknown, never> => ({
  kind: "test.kind",
  payload: z.unknown(),
  maxAttempts: 3,
  leaseSeconds: 60,
  backoff: { baseMs: 1_000, capMs: 10_000 },
  run,
});

let lines: Record<string, unknown>[] = [];
const capture = (...args: unknown[]) => void lines.push(JSON.parse(String(args[0])));

beforeEach(() => {
  lines = [];
  resetTickMarks();
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const runTick = (run: () => Effect.Effect<unknown, JobFailure>, ids?: string[], jobs = [JOB]) =>
  Effect.runPromise(
    tick({
      worker: "web:1:test",
      registry: { "test.kind": definition(run) },
      budgetMs: 10_000,
      stopClaimingBeforeMs: 0,
      waitForRetries: false,
      ids,
      context: { request_id: "00000000-0000-4000-8000-0000000000c1", trigger: "upload" },
    }).pipe(Effect.provide(Layer.merge(fakeQueue(jobs), WideEventLoggerLive))),
  );

describe("job.attempt events", () => {
  it("writes one event per attempt, from claim to settle, with what the handler annotated", async () => {
    await runTick(
      () =>
        annotateEvent({ round: 1, ocr: { model: "fixture", calls: 1, tokens_in: 10 } }).pipe(
          Effect.as({ ok: true }),
        ),
      ["00000000-0000-4000-8000-0000000000a1"],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      event: "job.attempt",
      unit: "job_attempt",
      request_id: "00000000-0000-4000-8000-0000000000c1",
      trigger: "upload",
      job_id: "00000000-0000-4000-8000-0000000000a1",
      receipt_id: "00000000-0000-4000-8000-0000000000b1",
      user_id: "user-1",
      organization_id: "org-1",
      attempt: 1,
      max_attempts: 3,
      round: 1,
      worker: "web:1:test",
      outcome: "succeeded",
      queue: { kind: "test.kind", priority: 0, wait_ms: 42, outcome: "succeeded" },
      ocr: { model: "fixture", calls: 1, tokens_in: 10 },
    });
    expect(typeof lines[0]!.duration_ms).toBe("number");
    expect(lines[0]).not.toHaveProperty("dropped_fields");
  });

  it("records a retry with its error kind and when it runs next", async () => {
    await runTick(
      () => Effect.fail(new RetryableJobError({ kind: "rate-limited" })),
      ["00000000-0000-4000-8000-0000000000a1"],
    );
    expect(lines[0]).toMatchObject({
      level: "info",
      outcome: "retry",
      error: { kind: "rate-limited" },
      queue: { outcome: "retry", error_kind: "rate-limited" },
    });
    expect(lines[0]!.queue).toHaveProperty("next_run_in_ms");
  });

  it("records a defect by class at error level, never its message", async () => {
    await runTick(
      () =>
        Effect.sync(() => {
          throw new TypeError("TOTAL 9.50 at Jane Doe Pharmacy");
        }),
      ["00000000-0000-4000-8000-0000000000a1"],
    );
    expect(lines[0]).toMatchObject({
      level: "error",
      outcome: "retry",
      error: { type: "Defect", class: "TypeError", kind: "internal" },
    });
    expect(JSON.stringify(lines)).not.toContain("Jane");
  });
});

describe("job.tick events", () => {
  it("summarises an unfiltered tick", async () => {
    await runTick(() => Effect.succeed(null), undefined, [
      JOB,
      { ...JOB, id: "00000000-0000-4000-8000-0000000000a2" },
    ]);
    const summary = lines.find((line) => line.event === "job.tick");
    expect(lines.filter((line) => line.event === "job.attempt")).toHaveLength(2);
    expect(summary).toMatchObject({
      unit: "job_tick",
      request_id: "00000000-0000-4000-8000-0000000000c1",
      outcome: "ran",
      tick: { claimed: 2, succeeded: 2, reaped: 0, idle: false },
    });
  });

  it("samples idle ticks as routine, and writes none for a tick filtered to its own job", async () => {
    vi.stubEnv("LOG_SAMPLE_RATE", "0");
    await runTick(() => Effect.succeed(null), undefined, []);
    expect(lines).toEqual([]);
    vi.stubEnv("LOG_SAMPLE_RATE", "1");
    await runTick(() => Effect.succeed(null), undefined, []);
    expect(lines[0]).toMatchObject({ event: "job.tick", outcome: "idle", tick: { idle: true } });
    lines = [];
    await runTick(() => Effect.succeed(null), ["00000000-0000-4000-8000-0000000000a1"]);
    expect(lines.map((line) => line.event)).toEqual(["job.attempt"]);
  });
});
