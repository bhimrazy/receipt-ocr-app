import "server-only";
import { NewsletterGateway } from "@receipt-ocr/core";
import {
  newsletterConfirmEmail,
  sendEmail,
  subscribeContact,
  unsubscribeContact,
  type ContactResult,
} from "@receipt-ocr/email";
import { requestNewsletterSubscription } from "@receipt-ocr/core";
import { Effect, Layer } from "effect";
import { emailContext, emailEnv, newsletterEnabled, newsletterEnv, newsletterSecret } from "./env";
import { errorFields, logger } from "./log";
import { mailer } from "./mailer";
import { runtime } from "./runtime";

const contactList = { apiKey: emailEnv.resendApiKey, segmentId: newsletterEnv.segmentId };

const outcome = (result: ContactResult) =>
  result.ok ? ("ok" as const) : (result.reason as "not_configured" | "failed");

/**
 * Wires the newsletter service to Resend: the confirmation mail goes through the shared mailer,
 * contacts through the product-updates segment. Without a signing secret the service is off.
 */
export const NewsletterGatewayLive = Layer.succeed(NewsletterGateway, {
  secret: newsletterSecret() ?? "",
  appUrl: emailContext.appUrl,
  sendConfirmation: ({ to, confirmUrl, unsubscribeUrl, expiresInSeconds }) =>
    Effect.promise(async () => {
      if (!newsletterSecret()) return "not_configured" as const;
      const result = await sendEmail(mailer, {
        to,
        ...newsletterConfirmEmail(emailContext, {
          url: confirmUrl,
          unsubscribeUrl,
          expiresInSeconds,
        }),
      });
      if (result.delivered) return "ok" as const;
      return result.reason;
    }),
  subscribe: (email) =>
    Effect.promise(async () => outcome(await subscribeContact(contactList, email))),
  unsubscribe: (email) =>
    Effect.promise(async () => outcome(await unsubscribeContact(contactList, email))),
});

/** Whether a Better Auth sign-up body carries the ticked "product updates" box. */
export const wantsProductUpdates = (body: unknown) =>
  typeof body === "object" &&
  body !== null &&
  (body as { newsletter?: unknown }).newsletter === true;

/**
 * Starts the double opt-in for an address that ticked the sign-up box. The account's own
 * verification does not count as consent to this list, so the same confirmation mail goes out.
 * Never throws: a failure here must not fail the sign-up.
 */
export async function requestProductUpdates(email: string): Promise<void> {
  if (!newsletterEnabled) return;
  try {
    const result = await runtime.runPromise(
      requestNewsletterSubscription(email).pipe(Effect.provide(NewsletterGatewayLive)),
    );
    logger.info({
      event: "newsletter.sign_up_opt_in",
      unit: "log",
      newsletter: result === "sent" ? "confirm_sent" : result,
    });
  } catch (error) {
    logger.error({
      event: "newsletter.sign_up_opt_in_failed",
      unit: "log",
      error: errorFields(error),
    });
  }
}
