import { isEmailAddress } from "@receipt-ocr/email";
import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import type { DbError } from "../../errors";
import { Db } from "../../services";
import { annotateEvent } from "../../telemetry/current";
import { logger } from "../../telemetry/logger";
import { enqueueJob } from "../queue";
import {
  NonRetryableJobError,
  RetryableJobError,
  type JobDefinition,
  type NewJob,
} from "../definition";

export const CONTACT_REPLY = "email.contact-reply";
export const CONTACT_REPLY_MAX_ATTEMPTS = 3;

/**
 * `to` is the address the visitor typed and `name` the first name the web app already cleaned;
 * `topic` is one of the app's fixed topic ids. Never the message itself.
 */
export const contactReplyPayload = z.object({
  // Same shape the contact route accepts.
  to: z
    .string()
    .max(320)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    .refine(isEmailAddress),
  name: z.string().max(80),
  topic: z.string().min(1).max(40),
});
export type ContactReplyPayload = z.infer<typeof contactReplyPayload>;

/**
 * Sends the contact-form auto-reply. The web app provides the real one (it owns Resend, the
 * templates and the topic copy); the default delivers nothing. Never log `to` or `name`.
 */
export class ContactReplyMailer extends Context.Tag("@receipt-ocr/core/ContactReplyMailer")<
  ContactReplyMailer,
  {
    readonly send: (
      input: ContactReplyPayload,
    ) => Effect.Effect<"delivered" | "not_configured" | "failed" | "rejected">;
  }
>() {
  static readonly Disabled = Layer.succeed(ContactReplyMailer, {
    send: () => Effect.succeed("not_configured" as const),
  });
}

/**
 * Queues one auto-reply. The caller has already passed Turnstile and the per-address and per-IP
 * caps; this only records the job.
 */
export const enqueueContactReply = (
  payload: ContactReplyPayload,
): Effect.Effect<boolean, DbError, Db> =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const job: NewJob = {
      kind: CONTACT_REPLY,
      payload: contactReplyPayload.parse(payload),
      maxAttempts: CONTACT_REPLY_MAX_ATTEMPTS,
      // Behind receipts, like the welcome email.
      priority: 10,
    };
    const result = yield* use((db) => enqueueJob(db, job));
    return "id" in result;
  });

export const contactReply: JobDefinition<ContactReplyPayload, ContactReplyMailer> = {
  kind: CONTACT_REPLY,
  payload: contactReplyPayload,
  maxAttempts: CONTACT_REPLY_MAX_ATTEMPTS,
  leaseSeconds: 60,
  // The address and name are deleted once the reply is sent (or given up on).
  scrubPayload: true,
  backoff: { baseMs: 30_000, capMs: 10 * 60_000 },

  run: (payload) =>
    Effect.gen(function* () {
      const mailer = yield* ContactReplyMailer;
      const outcome = yield* mailer.send(payload);
      yield* annotateEvent({
        kind: "contact_reply",
        topic: payload.topic,
        delivered: outcome === "delivered",
      });
      if (outcome === "rejected")
        return yield* new NonRetryableJobError({ kind: "email-render-failed" });
      if (outcome === "failed") return yield* new RetryableJobError({ kind: "email-send-failed" });
      logger.info({
        event: "email.contact_reply_sent",
        unit: "log",
        kind: "contact_reply",
        topic: payload.topic,
        delivered: outcome === "delivered",
      });
      return { delivered: outcome === "delivered" };
    }),
};
