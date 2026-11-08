import { requestNewsletterSubscription, hitRateLimit, isNewsletterEmail } from "@receipt-ocr/core";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { z } from "zod";
import { newsletterEnabled } from "@/lib/env";
import { clientIp, crossOriginResponse, withRequestEvent } from "@/lib/http";
import { MAX_FORM_JSON_BYTES, readJson } from "@/lib/json-body";
import type { WideEvent } from "@/lib/log";
import { NewsletterGatewayLive } from "@/lib/newsletter";
import { runtime } from "@/lib/runtime";
import { checkTurnstile } from "@/lib/turnstile";

/** Per client IP; without a trusted IP header everyone shares one bucket. */
const RATE_LIMIT = { windowMs: 10 * 60_000, max: 5 };

export const POST = withRequestEvent(
  { event: "newsletter.subscribe", route: "/api/newsletter/subscribe", keepRateLimited: true },
  subscribe,
);

/**
 * Starts a double opt-in. Once the request is well formed and past the bot check the answer is
 * always `{ ok: true }`, whether the address is new, pending, subscribed or over its mail cap, so
 * the form cannot be used to find out who is on the list.
 */
async function subscribe(request: Request, _context: unknown, event: WideEvent) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) {
    event.status_code = 403;
    event.outcome = "cross_origin";
    return forbidden;
  }
  if (!newsletterEnabled) {
    event.status_code = 404;
    event.outcome = "not_enabled";
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const limit = await runtime.runPromise(
    hitRateLimit(
      `newsletter:ip:${clientIp(request) ?? "unknown"}`,
      RATE_LIMIT.windowMs,
      RATE_LIMIT.max,
    ),
  );
  if (!limit.allowed) {
    event.status_code = 429;
    event.outcome = "rate_limited";
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const read = await readJson(request, z.record(z.string(), z.unknown()), MAX_FORM_JSON_BYTES);
  if ("response" in read) {
    event.status_code = read.response.status;
    event.outcome = read.response.status === 413 ? "too_large" : "invalid_body";
    return read.response;
  }
  const data = read.data;

  // Humans never see the honeypot; bots fill it. Pretend success.
  if (typeof data.company === "string" && data.company.trim() !== "") {
    event.status_code = 200;
    event.outcome = "honeypot_dropped";
    return NextResponse.json({ ok: true });
  }

  const email = typeof data.email === "string" ? data.email.trim() : "";
  if (!isNewsletterEmail(email)) {
    event.status_code = 400;
    event.outcome = "invalid_email";
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  const human = await checkTurnstile(request, clientIp(request));
  if (!human.ok) {
    event.outcome = `turnstile_${human.reason}`;
    if (human.reason === "rejected") event.turnstile_errors = human.errorCodes;
    const [status, error] =
      human.reason === "missing"
        ? [400, "Finish the security check, then try again."]
        : human.reason === "rejected"
          ? [403, "The security check failed. Reload the page and try again."]
          : [503, "We couldn't run the security check. Please try again in a moment."];
    event.status_code = status;
    return NextResponse.json({ error }, { status });
  }

  event.newsletter = await runtime.runPromise(
    requestNewsletterSubscription(email).pipe(
      Effect.provide(NewsletterGatewayLive),
      Effect.map((result) => (result === "sent" ? "confirm_sent" : result)),
    ),
  );
  event.status_code = 200;
  event.outcome = "success";
  return NextResponse.json({ ok: true });
}
