import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  SUBSCRIPTION_STATUSES,
  type BillingEvent,
  type PortalLinks,
  type WebhookRejection,
} from "./provider";

/**
 * Paddle Billing adapter: webhook signatures, event parsing and portal links.
 * Plain `node:crypto` and `fetch`: the official SDK would add a dependency for
 * one HMAC and one POST.
 */

export const PADDLE = "paddle";

export type PaddleEnvironment = "sandbox" | "production";

/**
 * How far the signature's timestamp may be from our clock. Paddle's SDKs
 * default to 5 s; a cold start can take longer than that, and a replay inside
 * the window is a no-op anyway (events are stored once by id).
 */
export const SIGNATURE_TOLERANCE_SECONDS = 30;

/** The events the webhook destination subscribes to; anything else is acknowledged and dropped. */
export const PADDLE_EVENT_TYPES = [
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.canceled",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "transaction.completed",
] as const;

/**
 * Checks `Paddle-Signature` (`ts=<unix>;h1=<hex>`): HMAC-SHA256 of
 * `<ts>:<raw body>` with the destination's secret, hex encoded. Any `h1` may
 * match (Paddle sends several while it rotates a secret).
 */
export function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs: number,
): WebhookRejection | "ok" {
  if (!header) return "missing-signature";
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const [key, value] = part.split("=", 2).map((s) => s.trim());
    if (key === "ts") timestamp = value;
    else if (key === "h1" && value) signatures.push(value);
  }
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) {
    return "bad-signature";
  }
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return "stale-signature";
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}:${rawBody}`).digest();
  const matches = signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return matches ? "ok" : "bad-signature";
}

const customData = z
  .record(z.string(), z.unknown())
  .nullish()
  .transform((data) => ({
    workspaceId: typeof data?.workspaceId === "string" ? data.workspaceId : null,
    userId: typeof data?.userId === "string" ? data.userId : null,
  }));

const subscriptionData = z.object({
  id: z.string().min(1),
  status: z.enum(SUBSCRIPTION_STATUSES),
  customer_id: z.string().min(1),
  custom_data: customData,
  items: z
    .array(z.object({ price: z.object({ id: z.string() }).nullish() }))
    .nullish()
    .transform((items) => items?.find((item) => item.price)?.price?.id ?? null),
  billing_cycle: z.object({ interval: z.string() }).nullish(),
  current_billing_period: z.object({ starts_at: z.string(), ends_at: z.string() }).nullish(),
  scheduled_change: z.object({ action: z.string() }).nullish(),
  canceled_at: z.string().nullish(),
  updated_at: z.string(),
});

const envelope = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.string(),
  data: z.unknown(),
});

/**
 * Parses a verified body into a `BillingEvent`. Null for an event type we
 * don't subscribe to, "bad-body" for a shape we can't read (Paddle retries it,
 * and the failure shows in the logs). `transaction.completed` carries no
 * subscription state: its subscription's own events follow.
 */
export function parsePaddleEvent(rawBody: string): BillingEvent | null | "bad-body" {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return "bad-body";
  }
  const head = envelope.safeParse(json);
  if (!head.success) return "bad-body";
  const { event_id, event_type, occurred_at, data } = head.data;
  if (!(PADDLE_EVENT_TYPES as readonly string[]).includes(event_type)) return null;
  const base = {
    provider: PADDLE,
    eventId: event_id,
    type: event_type,
    occurredAt: new Date(occurred_at),
  };
  if (Number.isNaN(base.occurredAt.getTime())) return "bad-body";
  if (!event_type.startsWith("subscription.")) return { ...base, subscription: null };

  const parsed = subscriptionData.safeParse(data);
  if (!parsed.success) return "bad-body";
  const s = parsed.data;
  const interval = s.billing_cycle?.interval;
  const date = (value: string | null | undefined) => (value ? new Date(value) : null);
  const updatedAt = new Date(s.updated_at);
  if (Number.isNaN(updatedAt.getTime())) return "bad-body";
  return {
    ...base,
    subscription: {
      subscriptionId: s.id,
      customerId: s.customer_id,
      status: s.status,
      priceId: s.items,
      interval: interval === "month" || interval === "year" ? interval : null,
      currentPeriodStart: date(s.current_billing_period?.starts_at),
      currentPeriodEnd: date(s.current_billing_period?.ends_at),
      cancelAtPeriodEnd: s.scheduled_change?.action === "cancel",
      canceledAt: date(s.canceled_at),
      updatedAt,
      workspaceId: s.custom_data.workspaceId,
      userId: s.custom_data.userId,
    },
  };
}

export const paddleApiBase = (environment: PaddleEnvironment) =>
  environment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";

const portalResponse = z.object({
  data: z.object({
    urls: z.object({
      general: z.object({ overview: z.url() }),
      subscriptions: z
        .array(
          z.object({
            id: z.string(),
            cancel_subscription: z.url().nullish(),
            update_subscription_payment_method: z.url().nullish(),
          }),
        )
        .default([]),
    }),
  }),
});

/** Paddle's API answered with an error status or a body we can't read. */
export class PaddleApiError extends Error {
  constructor(readonly status: number) {
    super(`Paddle API returned ${status}`);
    this.name = "PaddleApiError";
  }
}

/**
 * Creates a customer portal session (`POST /customers/{id}/portal-sessions`)
 * and returns its links. They carry a temporary token: hand them to the
 * browser once, never store or cache them.
 */
export async function createPaddlePortalSession(
  options: {
    environment: PaddleEnvironment;
    apiKey: string;
    customerId: string;
    subscriptionId: string | null;
    signal?: AbortSignal;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<PortalLinks> {
  const response = await fetchImpl(
    `${paddleApiBase(options.environment)}/customers/${encodeURIComponent(options.customerId)}/portal-sessions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        options.subscriptionId ? { subscription_ids: [options.subscriptionId] } : {},
      ),
      signal: options.signal,
    },
  );
  if (!response.ok) throw new PaddleApiError(response.status);
  const parsed = portalResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new PaddleApiError(response.status);
  const { general, subscriptions } = parsed.data.data.urls;
  const sub = subscriptions.find((s) => s.id === options.subscriptionId);
  return {
    overview: general.overview,
    cancel: sub?.cancel_subscription ?? null,
    updatePaymentMethod: sub?.update_subscription_payment_method ?? null,
  };
}
