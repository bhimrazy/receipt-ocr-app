import { hitRateLimit } from "@receipt-ocr/core";
import { NextResponse } from "next/server";
import { clientIp, crossOriginResponse } from "@/lib/http";
import { logger, type WideEvent } from "@/lib/log";
import { runtime } from "@/lib/runtime";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE = 2000;
/** Per client IP; without a trusted IP header everyone shares one bucket. */
const RATE_LIMIT = { windowMs: 10 * 60_000, max: 5 };

type ContactPayload = {
  email?: unknown;
  message?: unknown;
  topic?: unknown;
  company?: unknown; // honeypot — humans never see or fill this
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  const event: WideEvent = {
    event: "contact.submit",
    method: "POST",
    path: "/api/contact",
    request_id: crypto.randomUUID(),
  };

  try {
    const forbidden = crossOriginResponse(request);
    if (forbidden) {
      event.status_code = 403;
      event.outcome = "cross_origin";
      return forbidden;
    }

    const limit = await runtime.runPromise(
      hitRateLimit(
        `contact:${clientIp(request) ?? "unknown"}`,
        RATE_LIMIT.windowMs,
        RATE_LIMIT.max,
      ),
    );
    if (!limit.allowed) {
      event.status_code = 429;
      event.outcome = "rate_limited";
      return NextResponse.json(
        { error: "Too many messages. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    let data: ContactPayload;
    try {
      data = (await request.json()) as ContactPayload;
    } catch {
      event.status_code = 400;
      event.outcome = "invalid_body";
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Bots tend to fill every field, including hidden ones. Pretend success, drop it.
    if (typeof data.company === "string" && data.company.trim() !== "") {
      event.status_code = 200;
      event.outcome = "honeypot_dropped";
      return NextResponse.json({ ok: true });
    }

    const email = typeof data.email === "string" ? data.email.trim() : "";
    const message = typeof data.message === "string" ? data.message.trim() : "";
    const topic = typeof data.topic === "string" ? data.topic.trim() : "general";
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

    // TODO(resend): deliver this to the support inbox. The address and
    // message are personal data, so the log line carries only their shape.
    event.email_domain = email.split("@")[1]?.toLowerCase();
    event.status_code = 200;
    event.outcome = "success";
    return NextResponse.json({ ok: true });
  } finally {
    event.duration_ms = Date.now() - startedAt;
    logger.info(event);
  }
}
