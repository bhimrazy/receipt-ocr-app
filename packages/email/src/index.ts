import { Resend } from "resend";

import type { TemplateName } from "./templates";

export * from "./templates";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Where replies go, e.g. the sender of a contact-form message. */
  replyTo?: string;
  /** The template that made the message; logged as `email_kind`. */
  kind?: TemplateName;
  /**
   * Resend's `Idempotency-Key`: a repeat of the same key and payload within 24 hours returns
   * the first send instead of mailing again; the same key with a different payload fails (409).
   * Set it from a retried job (`job:{id}`), whose earlier attempt may have been accepted
   * before the response was lost.
   */
  idempotencyKey?: string;
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
  event: "email.sent" | "email.send_failed" | "email.not_configured" | "email.contact_failed";
  unit: "log";
  level: "info" | "error";
  email_kind?: TemplateName;
  /** Resend's id for an accepted message, to find it in the provider's logs. */
  provider_message_id?: string;
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

const kindOf = (input: SendEmailInput) => (input.kind ? { email_kind: input.kind } : {});

function resend(apiKey: string): Resend {
  if (!client) client = new Resend(apiKey);
  return client;
}

export interface MailerConfig {
  apiKey?: string;
  /** e.g. `ReceiptOCR <noreply@yourdomain.com>` */
  from?: string;
  /** Reply-To for messages that set none (e.g. the support inbox, since `from` is noreply). */
  replyTo?: string;
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
      log({ event: "email.not_configured", unit: "log", level: "error", ...kindOf(input) });
    }
    return { delivered: false, reason: "not_configured" };
  }

  const replyTo = input.replyTo ?? config.replyTo;
  try {
    const { data, error } = await resend(config.apiKey).emails.send(
      {
        from: config.from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
        ...(replyTo ? { replyTo } : {}),
      },
      input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
    );
    if (error) {
      log({
        event: "email.send_failed",
        unit: "log",
        level: "error",
        ...kindOf(input),
        error: errorOf(error),
      });
      return { delivered: false, reason: "failed", error: error.message };
    }
    log({
      event: "email.sent",
      unit: "log",
      level: "info",
      ...kindOf(input),
      ...(data?.id ? { provider_message_id: data.id } : {}),
    });
    return { delivered: true, id: data?.id };
  } catch (cause) {
    log({
      event: "email.send_failed",
      unit: "log",
      level: "error",
      ...kindOf(input),
      error: errorOf(cause),
    });
    return {
      delivered: false,
      reason: "failed",
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export type ContactResult = { ok: true } | { ok: false; reason: "not_configured" | "failed" };

export interface ContactListConfig {
  /** A full-access key: a sending-only key cannot manage contacts. */
  apiKey?: string;
  /** The Resend segment (formerly audience) the product-updates contacts belong to. */
  segmentId?: string;
  log?: (event: EmailLogEvent) => void;
}

/**
 * Adds an address to the product-updates segment as subscribed. An existing contact (including
 * one who unsubscribed before) is re-subscribed and added to the segment. Never throws, and logs
 * only the event name and the error's name, never the address.
 */
export async function subscribeContact(
  config: ContactListConfig,
  email: string,
): Promise<ContactResult> {
  const { apiKey, segmentId } = config;
  if (!apiKey || !segmentId) return { ok: false, reason: "not_configured" };
  const log = config.log ?? consoleLog;
  try {
    const api = resend(apiKey);
    const created = await api.contacts.create({
      email,
      unsubscribed: false,
      segments: [{ id: segmentId }],
    });
    if (created.error) {
      // Most likely the contact exists already: re-subscribe it and make sure it is in the segment.
      const updated = await api.contacts.update({ email, unsubscribed: false });
      if (updated.error) throw updated.error;
      const added = await api.contacts.segments.add({ email, segmentId });
      // Already in the segment is fine; anything else surfaces on the next attempt.
      if (added.error && added.error.statusCode !== 409 && added.error.statusCode !== 422) {
        throw added.error;
      }
    }
    return { ok: true };
  } catch (cause) {
    log({ event: "email.contact_failed", unit: "log", level: "error", error: errorOf(cause) });
    return { ok: false, reason: "failed" };
  }
}

/** Marks the contact unsubscribed from all Broadcasts. A contact that is not there counts as done. */
export async function unsubscribeContact(
  config: ContactListConfig,
  email: string,
): Promise<ContactResult> {
  if (!config.apiKey || !config.segmentId) return { ok: false, reason: "not_configured" };
  const log = config.log ?? consoleLog;
  try {
    const { error } = await resend(config.apiKey).contacts.update({ email, unsubscribed: true });
    if (error && error.statusCode !== 404) throw error;
    return { ok: true };
  } catch (cause) {
    log({ event: "email.contact_failed", unit: "log", level: "error", error: errorOf(cause) });
    return { ok: false, reason: "failed" };
  }
}
