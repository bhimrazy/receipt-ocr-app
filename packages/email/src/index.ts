import { Resend } from "resend";

export * from "./templates";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendEmailResult =
  | { delivered: true; id?: string }
  | { delivered: false; reason: "not_configured" | "failed"; error?: string };

let client: Resend | null = null;

function resend(apiKey: string): Resend {
  if (!client) client = new Resend(apiKey);
  return client;
}

export interface MailerConfig {
  apiKey?: string;
  /** e.g. `receiptOCR <noreply@yourdomain.com>` */
  from?: string;
}

/**
 * Sends transactional mail through Resend when it is configured, and logs the
 * message otherwise.
 *
 * The logging fallback is deliberate: local development and previews have no
 * mail provider, and password-reset and invitation links printed to the server
 * log are still usable. It never throws — a failed notification must not fail
 * the sign-up, invite, or reset that triggered it.
 */
export async function sendEmail(
  config: MailerConfig,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!config.apiKey || !config.from) {
    console.info(
      JSON.stringify({
        level: "info",
        event: "email.not_configured",
        to: input.to,
        subject: input.subject,
        // The body carries the actionable link in every template we send.
        text: input.text,
      }),
    );
    return { delivered: false, reason: "not_configured" };
  }

  try {
    const { data, error } = await resend(config.apiKey).emails.send({
      from: config.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "email.send_failed",
          to: input.to,
          subject: input.subject,
          error: error.message,
        }),
      );
      return { delivered: false, reason: "failed", error: error.message };
    }
    console.info(
      JSON.stringify({
        level: "info",
        event: "email.sent",
        to: input.to,
        subject: input.subject,
        id: data?.id,
      }),
    );
    return { delivered: true, id: data?.id };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(
      JSON.stringify({
        level: "error",
        event: "email.send_failed",
        to: input.to,
        subject: input.subject,
        error: message,
      }),
    );
    return { delivered: false, reason: "failed", error: message };
  }
}
