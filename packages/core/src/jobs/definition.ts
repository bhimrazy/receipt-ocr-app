import { Data, type Effect } from "effect";
import type { z } from "zod";
import type { BackoffPolicy } from "./backoff";

/**
 * Error kinds are short codes (`rate-limited`, `lease-expired`), stored in
 * `jobs.last_error_kind`, which only accepts `[a-z0-9.-]`. Never a message:
 * provider errors can embed receipt contents.
 */
export type JobErrorKind = string;

/** A failure worth another attempt, after backoff. */
export class RetryableJobError extends Data.TaggedError("RetryableJobError")<{
  readonly kind: JobErrorKind;
  /** The provider's Retry-After: the next attempt waits at least this long. */
  readonly retryAfterMs?: number;
}> {}

/** A failure another attempt won't fix (bad payload, unreadable image): the job goes dead now. */
export class NonRetryableJobError extends Data.TaggedError("NonRetryableJobError")<{
  readonly kind: JobErrorKind;
}> {}

/** Nothing can run the job until `until` (e.g. every provider is cooling down). Spends no attempt. */
export class JobDeferred extends Data.TaggedError("JobDeferred")<{
  readonly kind: JobErrorKind;
  readonly until: Date;
}> {}

export type JobFailure = RetryableJobError | NonRetryableJobError | JobDeferred;

export type JobState = "queued" | "running" | "succeeded" | "dead" | "cancelled";

/** A job row as the runner sees it. */
export type Job = {
  id: string;
  kind: string;
  state: JobState;
  priority: number;
  payload: unknown;
  idempotencyKey: string | null;
  receiptId: string | null;
  organizationId: string | null;
  userId: string | null;
  /** Including the current one: a claim increments it. */
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedBy: string | null;
  lockedUntil: Date | null;
  lastErrorKind: string | null;
  /** Set by a claim: how long the job had been runnable, by the database clock. */
  waitMs?: number;
};

export type JobContext = {
  job: Job;
  /** 1-based attempt number of this run. */
  attempt: number;
  worker: string;
};

/**
 * One job kind: its payload schema, retry policy and handler. A payload that
 * fails the schema sends the job straight to dead.
 */
export type JobDefinition<P, R> = {
  readonly kind: string;
  readonly payload: z.ZodType<P>;
  readonly maxAttempts: number;
  /** How long a claim holds the job without a heartbeat; a crashed worker loses it after this. */
  readonly leaseSeconds: number;
  readonly backoff: BackoffPolicy;
  /** Its result is reported to the caller of `tick` (wide events); it is not stored. */
  readonly run: (payload: P, context: JobContext) => Effect.Effect<unknown, JobFailure, R>;
  /** Replaces the payload with `{}` once the job succeeds or dies, for payloads holding personal data. */
  readonly scrubPayload?: boolean;
  /**
   * Runs once the job is dead (retries exhausted, not retryable, lease expired
   * on the last attempt) or cancelled: settles the domain row, e.g. marks the
   * receipt failed. Must not fail; log instead.
   */
  readonly onFinalFailure?: (
    payload: P,
    context: { job: Job; errorKind: JobErrorKind },
  ) => Effect.Effect<void, never, R>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the registry mixes payload types
export type AnyJobDefinition<R> = JobDefinition<any, R>;

export type JobRegistry<R> = Readonly<Record<string, AnyJobDefinition<R>>>;

/** A new job. `idempotencyKey` dedupes against live (queued or running) jobs. */
export type NewJob = {
  kind: string;
  payload: unknown;
  maxAttempts: number;
  priority?: number;
  idempotencyKey?: string | null;
  receiptId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  runAt?: Date;
};
