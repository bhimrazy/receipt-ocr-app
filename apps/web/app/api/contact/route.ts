import { NextResponse } from "next/server";
import { logger, type WideEvent } from "@/lib/log";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE = 2000;

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

    // TODO(resend): send this as a transactional email once RESEND_API_KEY is set.
    // Until then the wide event below preserves early-access submissions in logs.
    event.email = email;
    event.message = message;
    event.status_code = 200;
    event.outcome = "success";
    return NextResponse.json({ ok: true });
  } finally {
    event.duration_ms = Date.now() - startedAt;
    logger.info(event);
  }
}
