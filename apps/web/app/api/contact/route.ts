import { hitRateLimit } from "@receipt-ocr/core";
import { sendEmail, type EmailLogEvent } from "@receipt-ocr/email";
import { NextResponse } from "next/server";
import { z } from "zod";
import { contactEmail, isTopic } from "@/lib/contact-mail";
import { emailContext, emailEnv, isProduction, logUndeliveredMail, supportEmail } from "@/lib/env";
import { clientIp, crossOriginResponse, withRequestEvent } from "@/lib/http";
import { MAX_FORM_JSON_BYTES, readJson } from "@/lib/json-body";
import { logger, type WideEvent } from "@/lib/log";
import { runtime } from "@/lib/runtime";
import { checkTurnstile } from "@/lib/turnstile";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mailer = {
  apiKey: emailEnv.resendApiKey,
  from: emailEnv.from,
  replyTo: emailEnv.replyTo,
  logUndelivered: logUndeliveredMail(),
  log: (event: EmailLogEvent) => logger.emit(event),
};
const MAX_MESSAGE = 2000;
/** Per client IP; without a trusted IP header everyone shares one bucket. */
const RATE_LIMIT = { windowMs: 10 * 60_000, max: 5 };

type ContactPayload = {
  email?: unknown;
  message?: unknown;
  topic?: unknown;
  company?: unknown; // honeypot — humans never see or fill this
};

export const POST = withRequestEvent(
  { event: "contact.submit", route: "/api/contact", keepRateLimited: true },
  submit,
);

async function submit(request: Request, _context: unknown, event: WideEvent) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) {
    event.status_code = 403;
    event.outcome = "cross_origin";
    return forbidden;
  }

  const limit = await runtime.runPromise(
    hitRateLimit(`contact:${clientIp(request) ?? "unknown"}`, RATE_LIMIT.windowMs, RATE_LIMIT.max),
  );
  if (!limit.allowed) {
    event.status_code = 429;
    event.outcome = "rate_limited";
    return NextResponse.json(
      { error: "Too many messages. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const read = await readJson(request, z.record(z.string(), z.unknown()), MAX_FORM_JSON_BYTES);
  if ("response" in read) {
    event.status_code = read.response.status;
    event.outcome = read.response.status === 413 ? "too_large" : "invalid_body";
    return read.response;
  }
  const data = read.data as ContactPayload;

  // Bots tend to fill every field, including hidden ones. Pretend success, drop it.
  if (typeof data.company === "string" && data.company.trim() !== "") {
    event.status_code = 200;
    event.outcome = "honeypot_dropped";
    return NextResponse.json({ ok: true });
  }

  const email = typeof data.email === "string" ? data.email.trim() : "";
  const message = typeof data.message === "string" ? data.message.trim() : "";
  const rawTopic = typeof data.topic === "string" ? data.topic.trim() : "";
  const topic = isTopic(rawTopic) ? rawTopic : "getting-started";
  event.topic = topic;
  event.message_length = message.length;

  if (!EMAIL_RE.test(email)) {
    event.status_code = 400;
    event.outcome = "invalid_email";
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (message.length < 5) {
    event.status_code = 400;
    event.outcome = "message_too_short";
    return NextResponse.json({ error: "Tell us a little more" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    event.status_code = 400;
    event.outcome = "message_too_long";
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  const human = await checkTurnstile(request, clientIp(request));
  if (!human.ok) {
    event.outcome = `turnstile_${human.reason}`;
    if (human.reason === "rejected") event.turnstile_errors = human.errorCodes;
    const [status, error] =
      human.reason === "missing"
        ? [400, "Finish the security check, then send again."]
        : human.reason === "rejected"
          ? [403, "The security check failed. Reload the page and try again."]
          : [503, "We couldn't run the security check. Please try again in a moment."];
    event.status_code = status;
    return NextResponse.json({ error }, { status });
  }

  // Like auth mail: without a mailer, dev and CI simulate (and log) delivery, but production
  // must not tell a visitor their message arrived when it didn't.
  const delivered = supportEmail
    ? (
        await sendEmail(
          mailer,
          contactEmail(emailContext, { to: supportEmail, from: email, topic, message }),
        )
      ).delivered
    : false;
  if (!delivered && isProduction) {
    event.status_code = 503;
    event.outcome = supportEmail ? "delivery_failed" : "support_email_not_configured";
    return NextResponse.json(
      { error: "We couldn't send your message right now. Please try again in a few minutes." },
      { status: 503 },
    );
  }
  event.delivered = delivered;
  event.status_code = 200;
  event.outcome = "success";
  return NextResponse.json({ ok: true });
}
