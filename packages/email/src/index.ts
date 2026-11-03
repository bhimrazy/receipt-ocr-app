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
  /** Log the full message when no provider is configured. Development only. */
  logUndelivered?: boolean;
}

/**
 * Sends transactional mail through Resend when it is configured. It never
 * throws: callers decide whether an undelivered message should fail.
 *
 * Without a provider only the subject is logged unless `logUndelivered` is
 * set (development, so reset and invite links stay usable locally): those
 * links are credentials, and logs are readable by more people than the
 * recipient.
 */
export async function sendEmail(
  config: MailerConfig,
  input: SendEmailInput,
): Promise<SendEmailResult> {
  if (!config.apiKey || !config.from) {
    const development = config.logUndelivered === true;
    const line = JSON.stringify({
      level: development ? "info" : "error",
      event: "email.not_configured",
      subject: input.subject,
      ...(development ? { to: input.to, text: input.text } : {}),
    });
    if (development) console.info(line);
    else console.error(line);
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
