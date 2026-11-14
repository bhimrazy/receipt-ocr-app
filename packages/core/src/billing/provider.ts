import { z } from "zod";

/**
 * The provider-neutral shapes the billing service works in. A provider adapter
 * (Paddle today) verifies and parses its webhooks into a `BillingEvent`, which
 * is what `billing_events.payload` stores and the apply job reads back, so a
 * switch of merchant of record is one new adapter.
 */

/** Subscription states we store; `BILLING_STATUSES` in packages/db must match (a core test checks). */
export const SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "paused",
  "canceled",
] as const;

export type BillingStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/** A subscription as one event saw it. */
export const subscriptionSnapshotSchema = z.object({
  subscriptionId: z.string().min(1).max(100),
  customerId: z.string().min(1).max(100),
  status: z.enum(SUBSCRIPTION_STATUSES),
  priceId: z.string().max(100).nullable(),
  interval: z.enum(["month", "year"]).nullable(),
  currentPeriodStart: isoDate.nullable(),
  currentPeriodEnd: isoDate.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: isoDate.nullable(),
  /** The provider's `updated_at`: orders snapshots of one subscription. */
  updatedAt: isoDate,
  /** From the checkout's custom data; trusted only to link a new subscription. */
  workspaceId: z.string().max(100).nullable(),
  userId: z.string().max(100).nullable(),
  /** The checkout transaction that created it, on `subscription.created` only. Absent from older stored payloads. */
  transactionId: z.string().max(100).nullable().default(null),
});

export type SubscriptionSnapshot = z.output<typeof subscriptionSnapshotSchema>;

/** A refund, credit or chargeback as one event saw it. */
export const adjustmentSnapshotSchema = z.object({
  adjustmentId: z.string().min(1).max(100),
  /** `refund`, `chargeback`, `credit`, and their reversals and warnings. */
  action: z.string().min(1).max(40),
  /** `full` or `partial`. */
  type: z.string().max(20).nullable(),
  /** `pending_approval`, `approved`, `rejected` or `reversed`. */
  status: z.string().min(1).max(40),
  subscriptionId: z.string().max(100).nullable(),
  transactionId: z.string().max(100).nullable(),
});

export type AdjustmentSnapshot = z.output<typeof adjustmentSnapshotSchema>;

/** One item a transaction charged. A negative quantity credits an item it replaced. */
const transactionLineSchema = z.object({
  quantity: z.number().int(),
  /** Charged for part of a period (the provider's proration marker), not at full price. */
  prorated: z.boolean(),
});

export type TransactionLine = z.output<typeof transactionLineSchema>;

/** A completed transaction, kept to know which one pays for a subscription's current period. */
export const transactionSnapshotSchema = z.object({
  transactionId: z.string().min(1).max(100),
  subscriptionId: z.string().max(100).nullable(),
  /** The provider's origin: `web`, `api`, `subscription_recurring`, `subscription_charge`, … */
  origin: z.string().max(60).nullable(),
  /** The start of the billing period it pays for; null for a one-off charge. */
  billingPeriodStart: isoDate.nullable(),
  /** Its end. Absent on events stored before it was kept. */
  billingPeriodEnd: isoDate.nullish().transform((value) => value ?? null),
  /** The items it charged; null when unknown, as on events stored before they were kept. */
  lines: z
    .array(transactionLineSchema)
    .max(100)
    .nullish()
    .transform((value) => value ?? null),
});

export type TransactionSnapshot = z.output<typeof transactionSnapshotSchema>;

export const billingEventSchema = z.object({
  provider: z.string().min(1).max(20),
  eventId: z.string().min(1).max(100),
  type: z.string().min(1).max(60),
  occurredAt: isoDate,
  /** Null for events that carry no subscription state (a transaction, an adjustment). */
  subscription: subscriptionSnapshotSchema.nullable(),
  /** Set on refund and chargeback events. */
  adjustment: adjustmentSnapshotSchema.nullable().default(null),
  /** Set on `transaction.completed`. Absent from older stored payloads. */
  transaction: transactionSnapshotSchema.nullable().default(null),
});

export type BillingEvent = z.output<typeof billingEventSchema>;

/** The JSON stored in `billing_events.payload`: dates as ISO strings, read back with `billingEventSchema`. */
export const toStoredEvent = (event: BillingEvent) => JSON.parse(JSON.stringify(event)) as unknown;

/** Why a webhook was refused. Each is a 400 or 401 to the provider, which retries. */
export type WebhookRejection =
  "missing-signature" | "bad-signature" | "stale-signature" | "bad-body";

/** Links into the provider's customer portal; short-lived, never stored. */
export type PortalLinks = {
  overview: string;
  cancel: string | null;
  updatePaymentMethod: string | null;
};

/**
 * What the browser needs to open a checkout. Public values only: the price and
 * the workspace are chosen on the server when it creates the transaction.
 */
export type CheckoutConfig = {
  provider: string;
  environment: "sandbox" | "production";
  clientToken: string;
};
