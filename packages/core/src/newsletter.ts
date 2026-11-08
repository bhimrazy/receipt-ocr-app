import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Context, Effect } from "effect";
import { hitRateLimit } from "./workspace";

/**
 * Product-updates signup with double opt-in and no table of our own. A signed, expiring token in
 * the confirmation mail carries the address; nothing is stored until the link is used, and then
 * only in the Resend contact list. Unsubscribe links carry a signed token with no expiry, so old
 * mail keeps working.
 */

export const CONFIRM_TTL_SECONDS = 48 * 60 * 60;
/** Confirmation mails one address may be sent per hour, however many IPs ask. */
export const CONFIRM_MAILS_PER_HOUR = 2;

export type GatewayOutcome = "ok" | "not_configured" | "failed";

/**
 * What the web app provides: the signing secret, the app origin, the confirmation mail and the
 * Resend contact list. `email` is personal data: never log it.
 */
export class NewsletterGateway extends Context.Tag("@receipt-ocr/core/NewsletterGateway")<
  NewsletterGateway,
  {
    readonly secret: string;
    readonly appUrl: string;
    readonly sendConfirmation: (input: {
      to: string;
      confirmUrl: string;
      unsubscribeUrl: string;
      expiresInSeconds: number;
    }) => Effect.Effect<GatewayOutcome>;
    /** Adds the contact to the list, or re-subscribes one who had left. */
    readonly subscribe: (email: string) => Effect.Effect<GatewayOutcome>;
    /** Marks the contact unsubscribed; a contact that does not exist counts as done. */
    readonly unsubscribe: (email: string) => Effect.Effect<GatewayOutcome>;
  }
>() {}

type Purpose = "confirm" | "unsubscribe";

const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

const sign = (secret: string, body: string) =>
  createHmac("sha256", createHmac("sha256", secret).update("newsletter:v1").digest())
    .update(body)
    .digest();

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** `<base64url payload>.<base64url HMAC>`; `ttlSeconds` omitted means the token never expires. */
export function signNewsletterToken(
  secret: string,
  purpose: Purpose,
  email: string,
  options: { now?: number; ttlSeconds?: number } = {},
): string {
  const now = options.now ?? Date.now();
  const payload = {
    p: purpose,
    e: normalizeEmail(email),
    ...(options.ttlSeconds ? { x: Math.floor(now / 1000) + options.ttlSeconds } : {}),
  };
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(sign(secret, body))}`;
}

export type VerifiedToken =
  { ok: true; email: string } | { ok: false; reason: "invalid" | "expired" };

/** Checks signature, purpose and expiry. A token for one purpose never works for the other. */
export function verifyNewsletterToken(
  secret: string,
  purpose: Purpose,
  token: string,
  now = Date.now(),
): VerifiedToken {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined || token.length > 1024) {
    return { ok: false, reason: "invalid" };
  }
  const given = Buffer.from(mac, "base64url");
  const expected = sign(secret, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      p?: unknown;
      e?: unknown;
      x?: unknown;
    };
    if (payload.p !== purpose || typeof payload.e !== "string" || !payload.e) {
      return { ok: false, reason: "invalid" };
    }
    if (typeof payload.x === "number" && payload.x * 1000 < now) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, email: payload.e };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isNewsletterEmail = (email: string) => email.length <= 254 && SHAPE.test(email);

export type RequestOutcome = "sent" | "rate_limited" | "not_configured" | "failed";

/**
 * Mails a confirmation link to the address. Callers answer the visitor identically whatever this
 * returns, so a new, pending or already subscribed address looks the same from outside.
 */
export const requestNewsletterSubscription = (rawEmail: string) =>
  Effect.gen(function* () {
    const gateway = yield* NewsletterGateway;
    const email = normalizeEmail(rawEmail);
    const digest = createHash("sha256").update(email).digest("hex");
    const limit = yield* hitRateLimit(
      `newsletter:to:${digest}`,
      60 * 60_000,
      CONFIRM_MAILS_PER_HOUR,
    );
    if (!limit.allowed) return "rate_limited" as const satisfies RequestOutcome;
    const confirm = signNewsletterToken(gateway.secret, "confirm", email, {
      ttlSeconds: CONFIRM_TTL_SECONDS,
    });
    const leave = signNewsletterToken(gateway.secret, "unsubscribe", email);
    const outcome = yield* gateway.sendConfirmation({
      to: email,
      confirmUrl: `${gateway.appUrl}/newsletter/confirm?t=${confirm}`,
      unsubscribeUrl: `${gateway.appUrl}/newsletter/unsubscribe?t=${leave}`,
      expiresInSeconds: CONFIRM_TTL_SECONDS,
    });
    return (outcome === "ok" ? "sent" : outcome) satisfies RequestOutcome;
  }).pipe(Effect.catchAll(() => Effect.succeed("failed" as const)));

export type TokenOutcome = "done" | "invalid" | "expired" | "unavailable";

/** Adds the contact to the list once the emailed link is used. */
export const confirmNewsletter = (token: string) =>
  Effect.gen(function* () {
    const gateway = yield* NewsletterGateway;
    const verified = verifyNewsletterToken(gateway.secret, "confirm", token);
    if (!verified.ok) return verified.reason satisfies TokenOutcome;
    const outcome = yield* gateway.subscribe(verified.email);
    return (outcome === "ok" ? "done" : "unavailable") satisfies TokenOutcome;
  });

/** Takes the contact off the list. Safe to repeat. */
export const unsubscribeNewsletter = (token: string) =>
  Effect.gen(function* () {
    const gateway = yield* NewsletterGateway;
    const verified = verifyNewsletterToken(gateway.secret, "unsubscribe", token);
    if (!verified.ok) return verified.reason satisfies TokenOutcome;
    const outcome = yield* gateway.unsubscribe(verified.email);
    return (outcome === "ok" ? "done" : "unavailable") satisfies TokenOutcome;
  });
