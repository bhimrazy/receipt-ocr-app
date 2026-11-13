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
  // Refunds and chargebacks: an approved chargeback or full refund ends Pro.
  "adjustment.created",
  "adjustment.updated",
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
  transaction_id: z.string().min(1).nullish(),
});

const adjustmentData = z.object({
  id: z.string().min(1),
  action: z.string().min(1),
  type: z.string().nullish(),
  status: z.string().min(1),
  subscription_id: z.string().nullish(),
  transaction_id: z.string().nullish(),
});

const transactionData = z.object({
  id: z.string().min(1),
  subscription_id: z.string().nullish(),
  origin: z.string().nullish(),
  billing_period: z.object({ starts_at: z.string(), ends_at: z.string().nullish() }).nullish(),
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
 * subscription state (its subscription's own events follow), only its id,
 * subscription, origin and billing period. An adjustment (refund,
 * chargeback) keeps only its ids, action, type and status.
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
  if (event_type.startsWith("adjustment.")) {
    const adjustment = adjustmentData.safeParse(data);
    if (!adjustment.success) return "bad-body";
    const a = adjustment.data;
    return {
      ...base,
      subscription: null,
      transaction: null,
      adjustment: {
        adjustmentId: a.id,
        action: a.action,
        type: a.type ?? null,
        status: a.status,
        subscriptionId: a.subscription_id ?? null,
        transactionId: a.transaction_id ?? null,
      },
    };
  }
  if (!event_type.startsWith("subscription.")) {
    return { ...base, subscription: null, adjustment: null, transaction: transactionOf(data) };
  }

  const parsed = subscriptionData.safeParse(data);
  if (!parsed.success) return "bad-body";
  const s = parsed.data;
  const interval = s.billing_cycle?.interval;
  const date = (value: string | null | undefined) => (value ? new Date(value) : null);
  const updatedAt = new Date(s.updated_at);
  if (Number.isNaN(updatedAt.getTime())) return "bad-body";
  return {
    ...base,
    adjustment: null,
    transaction: null,
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
      transactionId: s.transaction_id ?? null,
    },
  };
}

/** A transaction we can't read is kept without its details rather than refused: it never grants anything. */
function transactionOf(data: unknown): BillingEvent["transaction"] {
  const parsed = transactionData.safeParse(data);
  if (!parsed.success) return null;
  const t = parsed.data;
  const date = (value: string | null | undefined) => {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  };
  return {
    transactionId: t.id,
    subscriptionId: t.subscription_id ?? null,
    origin: t.origin ?? null,
    billingPeriodStart: date(t.billing_period?.starts_at),
    billingPeriodEnd: date(t.billing_period?.ends_at),
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

/**
 * The Paddle error codes we log by name (https://developer.paddle.com/errors): the ones our
 * calls (customers, transactions, portal sessions, cancel) can hit and that name what to fix.
 */
export const PADDLE_ERROR_CODES = [
  // The account can't sell yet; platform admins see the fix.
  "transaction_default_checkout_url_not_set",
  "checkout_url_domain_not_approved",
  "transaction_checkout_url_domain_is_not_approved",
  // The API key.
  "authentication_missing",
  "authentication_malformed",
  "invalid_token",
  "forbidden",
  // Our request.
  "bad_request",
  "invalid_field",
  "not_found",
  "entity_archived",
  "transaction_price_not_found",
  // Finding or creating the customer.
  "customer_email_invalid",
  "customer_email_domain_not_allowed",
  "customer_already_exists",
  // Cancelling after a refund or chargeback.
  "subscription_is_canceled_action_invalid",
  "subscription_locked_pending_changes",
  "subscription_locked_processing",
  "subscription_locked_renewal",
  // Paddle's side.
  "too_many_requests",
  "internal_error",
] as const;

/** A code from `PADDLE_ERROR_CODES`, or `other` for any code Paddle sent that isn't listed. */
export type PaddleErrorCode = (typeof PADDLE_ERROR_CODES)[number] | "other";

const KNOWN_CODES: ReadonlySet<string> = new Set(PADDLE_ERROR_CODES);

/**
 * Paddle's `error.code` from an error body, as a closed set: a listed code, `other` for any other
 * value, or null when the body has no code. Nothing Paddle wrote (not even an unlisted code, nor
 * `error.detail`, which can name ids) reaches the logs.
 */
export function paddleErrorCode(body: unknown): PaddleErrorCode | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const error = body.error;
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = error.code;
  if (code === undefined || code === null) return null;
  return typeof code === "string" && KNOWN_CODES.has(code) ? (code as PaddleErrorCode) : "other";
}

/** Paddle's API answered with an error status or a body we can't read. */
export class PaddleApiError extends Error {
  /**
   * `status`: Paddle answered with an error status; `body`: a 2xx whose body didn't parse.
   * `code`: Paddle's error code, when the error body had one (see `paddleErrorCode`).
   */
  constructor(
    readonly status: number,
    readonly reason: "status" | "body" = "status",
    readonly code: PaddleErrorCode | null = null,
  ) {
    super(`Paddle API returned ${status}`);
    this.name = "PaddleApiError";
  }
}

export type PaddleApiOptions = {
  environment: PaddleEnvironment;
  apiKey: string;
  signal?: AbortSignal;
};

/** One Paddle API call: JSON in and out, the body read through `schema`. */
async function paddleRequest<T>(
  options: PaddleApiOptions,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(`${paddleApiBase(options.environment)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: options.signal,
  });
  if (!response.ok) {
    const code = paddleErrorCode(await response.json().catch(() => null));
    throw new PaddleApiError(response.status, "status", code);
  }
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new PaddleApiError(response.status, "body");
  return parsed.data;
}

/**
 * Creates a customer portal session (`POST /customers/{id}/portal-sessions`)
 * and returns its links. They carry a temporary token: hand them to the
 * browser once, never store or cache them.
 */
export async function createPaddlePortalSession(
  options: PaddleApiOptions & { customerId: string; subscriptionId: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<PortalLinks> {
  const parsed = await paddleRequest(
    options,
    "POST",
    `/customers/${encodeURIComponent(options.customerId)}/portal-sessions`,
    options.subscriptionId ? { subscription_ids: [options.subscriptionId] } : {},
    portalResponse,
    fetchImpl,
  );
  const { general, subscriptions } = parsed.data.urls;
  const sub = subscriptions.find((s) => s.id === options.subscriptionId);
  return {
    overview: general.overview,
    cancel: sub?.cancel_subscription ?? null,
    updatePaymentMethod: sub?.update_subscription_payment_method ?? null,
  };
}

const customerList = z.object({ data: z.array(z.object({ id: z.string().min(1) })) });
const created = z.object({ data: z.object({ id: z.string().min(1) }) });

/**
 * Creates the checkout's transaction on the server (`POST /transactions`), so
 * the price, the customer and the custom data are ours, not the browser's.
 * The customer is `customerId` when the buyer already has one on record, else
 * found by email (`GET /customers?email=`) or created (`POST /customers`), so
 * the checkout opens with the address filled in. Paddle.js opens the returned
 * `txn_…` id; the subscription it creates copies `custom_data` and the customer.
 */
export async function createPaddleCheckoutTransaction(
  options: PaddleApiOptions & {
    priceId: string;
    email: string;
    customerId: string | null;
    customData: { workspaceId: string; userId: string };
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ transactionId: string; customerId: string }> {
  const customerId =
    options.customerId ??
    (
      await paddleRequest(
        options,
        "GET",
        `/customers?email=${encodeURIComponent(options.email)}`,
        undefined,
        customerList,
        fetchImpl,
      )
    ).data[0]?.id ??
    (
      await paddleRequest(
        options,
        "POST",
        "/customers",
        { email: options.email },
        created,
        fetchImpl,
      )
    ).data.id;
  const transaction = await paddleRequest(
    options,
    "POST",
    "/transactions",
    {
      items: [{ price_id: options.priceId, quantity: 1 }],
      customer_id: customerId,
      custom_data: options.customData,
    },
    created,
    fetchImpl,
  );
  return { transactionId: transaction.data.id, customerId };
}

/**
 * Cancels a subscription at once (`POST /subscriptions/{id}/cancel`,
 * `effective_from: immediately`): no further charges, and Paddle sends
 * `subscription.canceled`. Used after a chargeback or a full refund.
 */
export async function cancelPaddleSubscription(
  options: PaddleApiOptions & { subscriptionId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await paddleRequest(
    options,
    "POST",
    `/subscriptions/${encodeURIComponent(options.subscriptionId)}/cancel`,
    { effective_from: "immediately" },
    z.unknown(),
    fetchImpl,
  );
}
