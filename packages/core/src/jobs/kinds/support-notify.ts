import { eq, supportMessages, type SUPPORT_KINDS } from "@receipt-ocr/db";
import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import { Db } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { logger } from "../../telemetry/logger";
import { errorFields } from "../../telemetry/redact";
import {
  NonRetryableJobError,
  RetryableJobError,
  type JobDefinition,
  type NewJob,
} from "../definition";

export const SUPPORT_NOTIFY = "email.support-notify";
const SUPPORT_NOTIFY_MAX_ATTEMPTS = 10;

/** Only the row id: the message text stays in `support_messages`, never in `jobs`. */
const supportNotifyPayload = z.object({ messageId: z.uuid() });
type SupportNotifyPayload = z.infer<typeof supportNotifyPayload>;

export type SupportNotice = {
  name: string;
  /** The sender's reply address. */
  email: string;
  kind: (typeof SUPPORT_KINDS)[number];
  message: string;
  receiptId: string | null;
  /** Stable across retries of one job, for the provider's idempotency key. */
  jobId: string;
};

/**
 * Mails a stored support message to the support inbox. The web app provides the real one (it owns
 * Resend and the templates); the default delivers nothing. Never log the notice's fields.
 */
export class SupportNotifyMailer extends Context.Tag("@receipt-ocr/core/SupportNotifyMailer")<
  SupportNotifyMailer,
  {
    readonly send: (
      notice: SupportNotice,
    ) => Effect.Effect<"delivered" | "not_configured" | "failed" | "rejected">;
  }
>() {
  static readonly Disabled = Layer.succeed(SupportNotifyMailer, {
    send: () => Effect.succeed("not_configured" as const),
  });
}

/** Enqueued in the transaction that stores the message, so every stored message is notified. */
export const supportNotifyJob = (messageId: string): NewJob => ({
  kind: SUPPORT_NOTIFY,
  payload: { messageId } satisfies SupportNotifyPayload,
  maxAttempts: SUPPORT_NOTIFY_MAX_ATTEMPTS,
  // Behind receipts, like the other mail.
  priority: 10,
});

export const supportNotify: JobDefinition<SupportNotifyPayload, Db | SupportNotifyMailer> = {
  kind: SUPPORT_NOTIFY,
  payload: supportNotifyPayload,
  maxAttempts: SUPPORT_NOTIFY_MAX_ATTEMPTS,
  leaseSeconds: 60,
  // About four hours of retries: a provider outage delays the notice, the message is already kept.
  backoff: { baseMs: 60_000, capMs: 60 * 60_000 },

  run: (payload, { job }) =>
    Effect.gen(function* () {
      const { use } = yield* Db;
      const mailer = yield* SupportNotifyMailer;
      const [row] = yield* use((db) =>
        db
          .select({
            name: supportMessages.name,
            email: supportMessages.email,
            kind: supportMessages.kind,
            message: supportMessages.message,
            receiptId: supportMessages.receiptId,
          })
          .from(supportMessages)
          .where(eq(supportMessages.id, payload.messageId))
          .limit(1),
      );
      // Deleted with the sender's account before the notice went out.
      if (!row) return { kind: "skipped" as const };
      const outcome = yield* mailer.send({ ...row, jobId: job.id });
      yield* annotateEvent({ kind: row.kind, delivered: outcome === "delivered" });
      if (outcome === "rejected")
        return yield* new NonRetryableJobError({ kind: "email-render-failed" });
      if (outcome === "failed") return yield* new RetryableJobError({ kind: "email-send-failed" });
      logger.info({
        event: "email.support_notify_sent",
        unit: "log",
        kind: row.kind,
        delivered: outcome === "delivered",
      });
      return { kind: "sent" as const, delivered: outcome === "delivered" };
    }).pipe(
      Effect.catchTag("DbError", (error) =>
        Effect.zipRight(
          annotateEvent({ error: errorFields(error) }),
          Effect.fail(new RetryableJobError({ kind: "support-notify-error" })),
        ),
      ),
    ),
};
