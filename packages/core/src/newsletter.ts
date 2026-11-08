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
    /** Signing secrets, current first: new tokens use the first, any one verifies (rotation). */
    readonly secrets: readonly string[];
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

/**
 * `<base64url payload>.<base64url HMAC>`; `ttlSeconds` omitted means the token never expires.
 * Throws on an empty secret: an unconfigured deployment must not mint forgeable tokens.
 */
export function signNewsletterToken(
  secret: string,
  purpose: Purpose,
  email: string,
  options: { now?: number; ttlSeconds?: number } = {},
): string {
  if (!secret) throw new Error("A newsletter token needs a signing secret");
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
  secrets: string | readonly string[],
  purpose: Purpose,
  token: string,
  now = Date.now(),
): VerifiedToken {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined || token.length > 1024) {
    return { ok: false, reason: "invalid" };
  }
  const given = Buffer.from(mac, "base64url");
  const signed = [secrets].flat().some((secret) => {
    if (!secret) return false;
    const expected = sign(secret, body);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!signed) return { ok: false, reason: "invalid" };
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      p?: unknown;
      e?: unknown;
      x?: unknown;
    };
    if (payload.p !== purpose || typeof payload.e !== "string" || !payload.e) {
      return { ok: false, reason: "invalid" };
    }
    // A confirm token always expires; one without an expiry was not minted by us.
    if (purpose === "confirm" && typeof payload.x !== "number") {
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

// Plain addr-spec only: ASCII, no display-name syntax (`x<a@b.co>`), no quotes, comments or
// zero-width and other invisible characters, so one mailbox has one string and one cap.
const ADDR_SPEC =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
export const isNewsletterEmail = (email: string) => email.length <= 254 && ADDR_SPEC.test(email);

export type RequestOutcome = "sent" | "rate_limited" | "not_configured" | "failed" | "invalid";

/**
 * Mails a confirmation link to the address. Callers answer the visitor identically whatever this
 * returns, so a new, pending or already subscribed address looks the same from outside.
 */
export const requestNewsletterSubscription = (rawEmail: string) =>
  Effect.gen(function* () {
    const gateway = yield* NewsletterGateway;
    const email = normalizeEmail(rawEmail);
    if (!isNewsletterEmail(email)) return "invalid" as const satisfies RequestOutcome;
    const current = gateway.secrets[0];
    if (!current) return "not_configured" as const satisfies RequestOutcome;
    const digest = createHash("sha256").update(email).digest("hex");
    const limit = yield* hitRateLimit(
      `newsletter:to:${digest}`,
      60 * 60_000,
      CONFIRM_MAILS_PER_HOUR,
    );
    if (!limit.allowed) return "rate_limited" as const satisfies RequestOutcome;
    const confirm = signNewsletterToken(current, "confirm", email, {
      ttlSeconds: CONFIRM_TTL_SECONDS,
    });
    const leave = signNewsletterToken(current, "unsubscribe", email);
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
    const verified = verifyNewsletterToken(gateway.secrets, "confirm", token);
    if (!verified.ok) return verified.reason satisfies TokenOutcome;
    const outcome = yield* gateway.subscribe(verified.email);
    return (outcome === "ok" ? "done" : "unavailable") satisfies TokenOutcome;
  });

/** Takes the contact off the list. Safe to repeat. */
export const unsubscribeNewsletter = (token: string) =>
  Effect.gen(function* () {
    const gateway = yield* NewsletterGateway;
    const verified = verifyNewsletterToken(gateway.secrets, "unsubscribe", token);
    if (!verified.ok) return verified.reason satisfies TokenOutcome;
    const outcome = yield* gateway.unsubscribe(verified.email);
    return (outcome === "ok" ? "done" : "unavailable") satisfies TokenOutcome;
  });
