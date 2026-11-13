import "server-only";
import { WelcomeMailer } from "@receipt-ocr/core";
import { sendEmail, welcomeEmail } from "@receipt-ocr/email";
import { Effect, Layer } from "effect";
import { emailContext } from "./env";
import { welcomePlanLine } from "./plan-copy";

/**
 * Sends the job's welcome email through Resend. A template that won't render is "rejected"
 * (retrying can't fix it); a send error is "failed" (retried).
 */
export const WelcomeMailerLive = Layer.succeed(WelcomeMailer, {
  send: ({ to, plan, policy, earlyAccessUntil }) =>
    Effect.try(() =>
      welcomeEmail(emailContext, { planLine: welcomePlanLine(plan, policy, earlyAccessUntil) }),
    ).pipe(
      Effect.flatMap((content) =>
        Effect.tryPromise(async () => {
          // Loaded on first send: importing the mailer reads email env, which the runtime's importers needn't.
          const { mailer } = await import("./mailer");
          const result = await sendEmail(mailer, { to, ...content });
          if (result.delivered) return "delivered" as const;
          return result.reason === "not_configured"
            ? ("not_configured" as const)
            : ("failed" as const);
        }).pipe(Effect.orElseSucceed(() => "failed" as const)),
      ),
      Effect.orElseSucceed(() => "rejected" as const),
    ),
});
