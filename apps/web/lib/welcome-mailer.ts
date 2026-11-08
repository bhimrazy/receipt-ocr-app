import "server-only";
import { WelcomeMailer } from "@receipt-ocr/core";
import { sendEmail, welcomeEmail } from "@receipt-ocr/email";
import { Effect, Layer } from "effect";
import { emailContext } from "./env";
import { mailer } from "./mailer";

/** Sends the job's welcome email through Resend; never throws, the job decides about retries. */
export const WelcomeMailerLive = Layer.succeed(WelcomeMailer, {
  send: ({ to, receiptsPerDay }) =>
    Effect.promise(async () => {
      const result = await sendEmail(mailer, {
        to,
        ...welcomeEmail(emailContext, { receiptsPerDay }),
      });
      if (result.delivered) return "delivered" as const;
      return result.reason === "not_configured" ? ("not_configured" as const) : ("failed" as const);
    }),
});
