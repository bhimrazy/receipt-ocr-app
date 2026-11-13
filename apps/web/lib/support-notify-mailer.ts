import "server-only";
import { SupportNotifyMailer } from "@receipt-ocr/core";
import { sendEmail } from "@receipt-ocr/email";
import { Effect, Layer } from "effect";
import { contactEmail } from "./contact-mail";
import { emailContext, isProduction, supportEmail } from "./env";

/**
 * Mails a stored support message to SUPPORT_EMAIL, as `WelcomeMailerLive` does: a template that
 * won't render is "rejected" (no retry), a send error is "failed" (retried). In production a
 * missing SUPPORT_EMAIL is "failed" too, so the job ends dead and visible instead of succeeding.
 */
export const SupportNotifyMailerLive = Layer.succeed(SupportNotifyMailer, {
  send: ({ name, email, kind, message, receiptId }) => {
    if (!supportEmail) return Effect.succeed(isProduction ? "failed" : "not_configured");
    const to = supportEmail;
    return Effect.try(() =>
      contactEmail(emailContext, { to, name, from: email, kind, message, receiptId }),
    ).pipe(
      Effect.flatMap((content) =>
        Effect.tryPromise(async () => {
          const { mailer } = await import("./mailer");
          const result = await sendEmail(mailer, content);
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
