import "server-only";
import { WelcomeMailer } from "@receipt-ocr/core";
import { sendEmail, welcomeEmail } from "@receipt-ocr/email";
import { Effect, Layer } from "effect";
import { emailContext } from "./env";

/** Sends the job's welcome email through Resend; a template or send error is "failed"; the job decides about retries. */
export const WelcomeMailerLive = Layer.succeed(WelcomeMailer, {
  send: ({ to, receiptsPerDay }) =>
    Effect.tryPromise(async () => {
      // Loaded on first send: importing the mailer reads email env, which the runtime's importers needn't.
      const { mailer } = await import("./mailer");
      const result = await sendEmail(mailer, {
        to,
        ...welcomeEmail(emailContext, { receiptsPerDay }),
      });
      if (result.delivered) return "delivered" as const;
      return result.reason === "not_configured" ? ("not_configured" as const) : ("failed" as const);
    }).pipe(Effect.orElseSucceed(() => "failed" as const)),
});
