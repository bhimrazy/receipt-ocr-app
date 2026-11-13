import { jobs, user } from "@receipt-ocr/db";
import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import type { DbError } from "../../errors";
import { accountPlan } from "../../billing/service";
import { type PlanId, type PlanPolicy } from "../../plans";
import { Db } from "../../services";
import type { Settings } from "../../settings";
import { annotateEvent } from "../../telemetry/current";
import { logger } from "../../telemetry/logger";
import { errorFields } from "../../telemetry/redact";
import { enqueueJob } from "../queue";
import {
  NonRetryableJobError,
  RetryableJobError,
  type JobDefinition,
  type NewJob,
} from "../definition";

export const WELCOME_EMAIL = "email.welcome";
export const WELCOME_EMAIL_MAX_ATTEMPTS = 5;

export const welcomeEmailPayload = z.object({ userId: z.string().min(1) });
export type WelcomeEmailPayload = z.infer<typeof welcomeEmailPayload>;

/**
 * How the welcome mail leaves the building. The web app provides the real one (it owns the Resend
 * config and the app origin); the default delivers nothing. `to` is the user's address: never log it.
 */
export class WelcomeMailer extends Context.Tag("@receipt-ocr/core/WelcomeMailer")<
  WelcomeMailer,
  {
    readonly send: (input: {
      to: string;
      /** The account's plan when sending; the mail states its limits. */
      plan: PlanId;
      policy: PlanPolicy;
      /** Stable across a job's attempts, so a retry after an accepted send doesn't mail twice. */
      idempotencyKey: string;
    }) => Effect.Effect<"delivered" | "not_configured" | "failed" | "rejected">;
  }
>() {
  static readonly Disabled = Layer.succeed(WelcomeMailer, {
    send: () => Effect.succeed("not_configured" as const),
  });
}

const welcomeJob = (userId: string): NewJob => ({
  kind: WELCOME_EMAIL,
  payload: { userId } satisfies WelcomeEmailPayload,
  maxAttempts: WELCOME_EMAIL_MAX_ATTEMPTS,
  // Lets the welcome wait behind receipts in the queue.
  priority: 10,
  idempotencyKey: `welcome:${userId}`,
  userId,
});

/**
 * Queues the user's welcome email unless one was ever queued for them. The key only dedupes live
 * jobs, so the check covers finished and dead ones too: a user is welcomed once, however many
 * times verification or sign-in hooks fire. Two racing calls are caught by the key.
 */
export const enqueueWelcomeEmail = (userId: string): Effect.Effect<boolean, DbError, Db> =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const existing = yield* use((db) =>
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.kind, WELCOME_EMAIL), eq(jobs.userId, userId)))
        .limit(1),
    );
    if (existing.length > 0) return false;
    const result = yield* use((db) => enqueueJob(db, welcomeJob(userId)));
    return "id" in result;
  });

export type WelcomeEmailResult =
  { kind: "skipped"; reason: "user-gone" } | { kind: "sent"; delivered: boolean };

export const welcomeEmail: JobDefinition<WelcomeEmailPayload, Db | Settings | WelcomeMailer> = {
  kind: WELCOME_EMAIL,
  payload: welcomeEmailPayload,
  maxAttempts: WELCOME_EMAIL_MAX_ATTEMPTS,
  leaseSeconds: 60,
  backoff: { baseMs: 30_000, capMs: 30 * 60_000 },

  run: (payload, { job }) =>
    Effect.gen(function* () {
      const { use } = yield* Db;
      const mailer = yield* WelcomeMailer;
      const rows = yield* use((db) =>
        db.select({ email: user.email }).from(user).where(eq(user.id, payload.userId)).limit(1),
      );
      const row = rows[0];
      if (!row) return { kind: "skipped", reason: "user-gone" } satisfies WelcomeEmailResult;
      // Read now, not at enqueue: the plan may have changed since.
      const { plan, policy } = yield* accountPlan(payload.userId);
      const outcome = yield* mailer.send({
        to: row.email,
        plan,
        policy,
        idempotencyKey: `job:${job.id}`,
      });
      yield* annotateEvent({ kind: "welcome", plan, delivered: outcome === "delivered" });
      if (outcome === "rejected")
        return yield* new NonRetryableJobError({ kind: "email-render-failed" });
      if (outcome === "failed") return yield* new RetryableJobError({ kind: "email-send-failed" });
      logger.info({
        event: "email.welcome_sent",
        unit: "log",
        user_id: payload.userId,
        kind: "welcome",
        plan,
        delivered: outcome === "delivered",
      });
      return { kind: "sent", delivered: outcome === "delivered" } satisfies WelcomeEmailResult;
    }).pipe(
      // A database or settings failure is worth another attempt; the typed job failures pass through.
      Effect.catchAll((error) =>
        error instanceof RetryableJobError || error instanceof NonRetryableJobError
          ? Effect.fail(error)
          : Effect.zipRight(
              annotateEvent({ error: errorFields(error) }),
              Effect.fail(new RetryableJobError({ kind: "welcome-error" })),
            ),
      ),
    ),
};
