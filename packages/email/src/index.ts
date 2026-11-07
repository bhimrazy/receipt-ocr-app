import { Resend } from "resend";

export * from "./templates";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Where replies go, e.g. the sender of a contact-form message. */
  replyTo?: string;
}

export type SendEmailResult =
  | { delivered: true; id?: string }
  | { delivered: false; reason: "not_configured" | "failed"; error?: string };

let client: Resend | null = null;

/**
 * What this package logs: the event name, and for a failure the error's
 * name (`validation_error`, `TypeError`), never its message, the subject,
 * the recipient or their domain. Resend and network messages can quote the
 * address, and subjects can carry a workspace or inviter name.
 */
export type EmailLogEvent = {
  event: "email.sent" | "email.send_failed" | "email.not_configured";
  unit: "log";
  level: "info" | "error";
  error?: { type: string; kind?: string };
};

const CODE = /^[A-Za-z0-9_.-]{1,64}$/;
const code = (value: unknown) =>
  typeof value === "string" && CODE.test(value) ? value : undefined;

function errorOf(cause: unknown): { type: string; kind?: string } {
  if (cause instanceof Error) return { type: code(cause.name) ?? "Error" };
  const name = code((cause as { name?: unknown } | null)?.name);
  return { type: "ResendError", ...(name ? { kind: name } : {}) };
}

/** Without a `log` sink: one JSON line with the same fields, for local runs and tests. */
const consoleLog = (event: EmailLogEvent) => {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event });
  if (event.level === "error") console.error(line);
  else console.info(line);
};

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
  /** Where events go; the web app passes the wide-event logger. Defaults to a JSON line on the console. */
  log?: (event: EmailLogEvent) => void;
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
  const log = config.log ?? consoleLog;
  if (!config.apiKey || !config.from) {
    if (config.logUndelivered === true) {
      // Development only: the link in the mail is the way to finish a local sign-up.
      console.info(
        JSON.stringify({ event: "email.not_configured", to: input.to, text: input.text }),
      );
    } else {
      log({ event: "email.not_configured", unit: "log", level: "error" });
    }
    return { delivered: false, reason: "not_configured" };
  }

  try {
    const { data, error } = await resend(config.apiKey).emails.send({
      from: config.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    if (error) {
      log({ event: "email.send_failed", unit: "log", level: "error", error: errorOf(error) });
      return { delivered: false, reason: "failed", error: error.message };
    }
    log({ event: "email.sent", unit: "log", level: "info" });
    return { delivered: true, id: data?.id };
  } catch (cause) {
    log({ event: "email.send_failed", unit: "log", level: "error", error: errorOf(cause) });
    return {
      delivered: false,
      reason: "failed",
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
