import { NextResponse } from "next/server";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE = 2000;

type ContactPayload = {
  email?: unknown;
  message?: unknown;
  topic?: unknown;
  company?: unknown; // honeypot — humans never see or fill this
};

export async function POST(request: Request) {
  let data: ContactPayload;
  try {
    data = (await request.json()) as ContactPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Bots tend to fill every field, including hidden ones. Pretend success, drop it.
  if (typeof data.company === "string" && data.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const email = typeof data.email === "string" ? data.email.trim() : "";
  const message = typeof data.message === "string" ? data.message.trim() : "";
  const topic = typeof data.topic === "string" ? data.topic.trim() : "general";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (message.length < 5) {
    return NextResponse.json({ error: "Tell us a little more" }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: "Message is too long" }, { status: 400 });
  }

  // TODO(resend): send this as a transactional email once RESEND_API_KEY is set.
  // Until then we log server-side so early-access submissions aren't silently lost.
  console.info("[contact] new message", { topic, email, message });

  return NextResponse.json({ ok: true });
}
