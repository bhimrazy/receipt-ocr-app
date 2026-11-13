import "server-only";
import { SupportNotifyMailer } from "@receipt-ocr/core";
import { sendEmail } from "@receipt-ocr/email";
import { Effect, Layer } from "effect";
import { contactEmail } from "./contact-mail";
import { emailContext, isProduction, supportEmail } from "./env";

/**
 * Tells SUPPORT_EMAIL a support message was stored, with a link to it. As in `WelcomeMailerLive`,
 * a template that won't render is "rejected" (no retry) and a send error is "failed" (retried). In
 * production a missing SUPPORT_EMAIL is "failed" too, so the job ends dead and visible.
 */
export const SupportNotifyMailerLive = Layer.succeed(SupportNotifyMailer, {
  send: ({ name, email, kind, messageId, jobId }) => {
    if (!supportEmail) return Effect.succeed(isProduction ? "failed" : "not_configured");
    const to = supportEmail;
    return Effect.try(() =>
      contactEmail(emailContext, { to, name, from: email, kind, messageId }),
    ).pipe(
      Effect.flatMap((content) =>
        Effect.tryPromise(async () => {
          const { mailer } = await import("./mailer");
          const result = await sendEmail(mailer, { ...content, idempotencyKey: `job:${jobId}` });
          if (result.delivered) return "delivered" as const;
          return result.reason === "not_configured"
            ? ("not_configured" as const)
            : ("failed" as const);
        }).pipe(Effect.orElseSucceed(() => "failed" as const)),
      ),
      Effect.orElseSucceed(() => "rejected" as const),
    );
  },
});
