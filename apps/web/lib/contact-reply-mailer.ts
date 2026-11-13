import "server-only";
import { ContactReplyMailer } from "@receipt-ocr/core";
import { contactReplyEmail, sendEmail } from "@receipt-ocr/email";
import { Effect, Layer } from "effect";
import { topicPhrase } from "./contact-mail";
import { emailContext } from "./env";

/**
 * Sends the job's contact-form auto-reply through Resend, as `WelcomeMailerLive` does: a template
 * that won't render is "rejected" (no retry), a send error is "failed" (retried).
 */
export const ContactReplyMailerLive = Layer.succeed(ContactReplyMailer, {
  send: ({ to, name, topic, idempotencyKey }) =>
    Effect.try(() =>
      contactReplyEmail(emailContext, { name, topicPhrase: topicPhrase(topic) }),
    ).pipe(
      Effect.flatMap((content) =>
        Effect.tryPromise(async () => {
          const { mailer } = await import("./mailer");
          const result = await sendEmail(mailer, { to, idempotencyKey, ...content });
          if (result.delivered) return "delivered" as const;
          if (result.errorName === "invalid_idempotent_request") return "conflict" as const;
          return result.reason === "not_configured"
            ? ("not_configured" as const)
            : ("failed" as const);
        }).pipe(Effect.orElseSucceed(() => "failed" as const)),
      ),
      Effect.orElseSucceed(() => "rejected" as const),
    ),
});
