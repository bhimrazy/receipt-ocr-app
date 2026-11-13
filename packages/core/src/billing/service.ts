import {
  and,
  billingCheckouts,
  billingEvents,
  billingSubscriptions,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  user,
  type BillingSubscription,
} from "@receipt-ocr/db";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import type { Tx } from "../audit";
import {
  BillingProviderError,
  Conflict,
  Forbidden,
  NotConfigured,
  NotFound,
  type DbError,
} from "../errors";
import { billingApplyJob, refundWaitCheckJob } from "../jobs/billing-apply-job";
import { enqueueJob } from "../jobs/queue";
import { DEFAULT_PLAN, policyFor, type PlanId, type PlanPolicy } from "../plans";
import { Db } from "../services";
import { Settings } from "../settings";
import { annotateEvent } from "../telemetry/current";
import type { Queryable } from "../usage";
import {
  DEPLOY_ENV_KEYS,
  PADDLE_ENV_KEYS,
  PADDLE_LEGACY_PRICES_KEY,
  PADDLE_PUBLIC_KEYS,
  parsePaddleConfig,
  parseProPriceIds,
  parsePublicPaddleConfig,
  sandboxOnProduction,
  type PaddleConfig,
} from "./config";
import {
  adjustmentMayRevoke,
  adjustmentRevokesPro,
  blocksCheckout,
  canStillCharge,
  memberLimitMessage,
  isEntitled,
  PAST_DUE_GRACE_DAYS,
  PAST_DUE_GRACE_MS,
  paysNewerPeriod,
  paysPeriod,
  planForPrice,
  workspaceLimitMessage,
} from "./entitlement";
import {
  cancelPaddleSubscription,
  createPaddleCheckoutTransaction,
  createPaddlePortalSession,
  PADDLE,
  PaddleApiError,
  parsePaddleEvent,
  verifyPaddleSignature,
} from "./paddle";
import {
  billingEventSchema,
  toStoredEvent,
  type BillingEvent,
  type BillingStatus,
  type CheckoutConfig,
  type PortalLinks,
  type SubscriptionSnapshot,
  type WebhookRejection,
} from "./provider";

/**
 * Billing: webhooks in, plan state out. A webhook is verified, stored once by
 * its provider event id and answered at once; the `billing.apply_event` job
 * then applies it to `billing_subscriptions`, where `workspacePlan` reads it.
 */

/** Paddle settings from the environment; none unless every value is set. Secrets stay redacted. */
export const loadPaddleConfig: Effect.Effect<
  Option.Option<
    Omit<PaddleConfig, "apiKey" | "webhookSecret"> & {
      apiKey: Redacted.Redacted<string>;
      webhookSecret: Redacted.Redacted<string>;
    }
  >
> = Config.all(
  Object.fromEntries(
    PADDLE_ENV_KEYS.map((key) => [key, Config.option(Config.string(key))]),
  ) as Record<(typeof PADDLE_ENV_KEYS)[number], Config.Config<Option.Option<string>>>,
).pipe(
  Effect.map((values) =>
    parsePaddleConfig(
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [key, Option.getOrUndefined(value)]),
      ),
    ),
  ),
  Effect.map((config) =>
    config
      ? Option.some({
          ...config,
          apiKey: Redacted.make(config.apiKey),
          webhookSecret: Redacted.make(config.webhookSecret),
        })
      : Option.none(),
  ),
  Effect.orElseSucceed(() => Option.none()),
);

const PRICE_KEYS = [
  "PADDLE_PRICE_PRO_MONTHLY",
  "PADDLE_PRICE_PRO_YEARLY",
  PADDLE_LEGACY_PRICES_KEY,
] as const;

/** The price ids a new subscription must pay to link as Pro (`parseProPriceIds`), from the environment. */
export const loadProPriceIds: Effect.Effect<ReadonlySet<string>> = Config.all(
  PRICE_KEYS.map((key) => Config.option(Config.string(key))),
).pipe(
  Effect.map((values) =>
    parseProPriceIds(
      Object.fromEntries(
        PRICE_KEYS.map((key, i) => [key, Option.getOrUndefined(values[i]!)]),
      ) as Record<(typeof PRICE_KEYS)[number], string | undefined>,
    ),
  ),
  Effect.orElseSucceed(() => new Set<string>()),
);

const TEST_MODE_KEYS = ["PADDLE_ENV", ...DEPLOY_ENV_KEYS] as const;

/** Whether this deploy runs sandbox Paddle keys on the live site (`sandboxOnProduction`). */
export const loadSandboxOnProduction: Effect.Effect<boolean> = Config.all(
  TEST_MODE_KEYS.map((key) => Config.option(Config.string(key))),
).pipe(
  Effect.map((values) => {
    const [environment, VERCEL_ENV, NODE_ENV] = values.map((value) =>
      Option.getOrUndefined(value)?.trim(),
    );
    return environment === "sandbox" && sandboxOnProduction(environment, { VERCEL_ENV, NODE_ENV });
  }),
  Effect.orElseSucceed(() => false),
);

// ---------- Plan resolution ----------

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;

/** `isEntitled` over `billing_subscriptions` aliased `s`. */
export const entitledSql = (now: Date) => sql`(
  s.revoked_at is null and s.plan = 'pro' and (
    (s.status in ('active', 'trialing') and (not s.cancel_at_period_end or s.current_period_end is null or s.current_period_end > ${ts(now)}))
    or (s.status = 'past_due' and s.past_due_since > ${ts(new Date(now.getTime() - PAST_DUE_GRACE_MS))})
    or (s.status = 'canceled' and s.cancel_at_period_end and s.current_period_end > ${ts(now)})
  )
)`;

/** `blocksCheckout` over `billing_subscriptions` aliased `s`. */
export const checkoutBlockingSql = (now: Date) => sql`(
  ${entitledSql(now)}
  or (s.status in ('active', 'trialing') and s.revoked_at is not null)
  or s.status in ('past_due', 'paused')
)`;

/** `canStillCharge` over `billing_subscriptions` aliased `s`. */
const chargingSql = sql`(s.status <> 'canceled' and not (s.status in ('active', 'trialing') and s.cancel_at_period_end))`;

export type PlanResolution = { plan: PlanId; policy: PlanPolicy };

const resolve = (pro: boolean) =>
  Effect.flatMap(Settings, (settings) => settings.plans).pipe(
    Effect.map((plans): PlanResolution => {
      const plan: PlanId = pro ? "pro" : DEFAULT_PLAN;
      return { plan, policy: policyFor(plans, plan) };
    }),
  );

/**
 * The plan a workspace's uploads count against, read fresh from the database
 * (not the session cache) so a webhook or an admin change applies at once.
 * Pro while the workspace has an entitling subscription of its own: one
 * subscription covers exactly one workspace, and Pro never spreads to the
 * owner's other workspaces. The one exception is an admin comp: an owner
 * whose `user.plan` an admin set to `pro` gets Pro on the workspaces they own
 * (recorded on the user, so no webhook can undo it).
 */
export const workspacePlan = (organizationId: string, now = new Date()) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const rows = yield* use((db) =>
      db
        .execute<{ pro: boolean }>(
          sql`select (
        exists (select 1 from billing_subscriptions s
          where s.organization_id = ${organizationId} and ${entitledSql(now)})
        or exists (select 1 from member m join "user" u on u.id = m.user_id
          where m.organization_id = ${organizationId} and m.role = 'owner' and u.plan = 'pro')
      ) as pro`,
        )
        .then((r) => r.rows),
    );
    return yield* resolve(rows[0]?.pro === true);
  });

/**
 * The plan behind a user's account-level limits (how many workspaces they may
 * own): Pro when they own at least one Pro workspace, or an admin comped them.
 * A new workspace still starts on Free; this only lifts the ownership cap.
 */
export const accountPlan = (userId: string, now = new Date()) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const rows = yield* use((db) =>
      db
        .execute<{ pro: boolean }>(
          sql`select (
        exists (select 1 from "user" u where u.id = ${userId} and u.plan = 'pro')
        or exists (select 1 from member m join billing_subscriptions s on s.organization_id = m.organization_id
          where m.user_id = ${userId} and m.role = 'owner' and ${entitledSql(now)})
      ) as pro`,
        )
        .then((r) => r.rows),
    );
    return yield* resolve(rows[0]?.pro === true);
  });

/**
 * Whether the user may create one more workspace, and what to tell them when
 * not. Checked on the server when a workspace is created, not only in the UI.
 */
export const workspaceCreationCheck = (userId: string) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const [{ plan, policy }, rows] = yield* Effect.all(
      [
        accountPlan(userId),
        use((db) =>
          db
            .execute<{ owned: number }>(
              sql`select count(*)::int as owned from member where user_id = ${userId} and role = 'owner'`,
            )
            .then((r) => r.rows),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const owned = rows[0]?.owned ?? 0;
    const allowed = owned < policy.workspaces;
    return {
      allowed,
      owned,
      limit: policy.workspaces,
      plan,
      message: allowed ? null : workspaceLimitMessage(plan, policy.workspaces),
    };
  });

/**
 * Whether a workspace may take one more member, and what to tell them when
 * not: members plus pending, unexpired invitations must stay under the
 * plan's `membersPerWorkspace`. `invite` counts pending invitations (so many
 * invites can't overshoot the cap) except an earlier one to `email`, which a
 * re-invite replaces; `accept` counts members only, since the invitation
 * being accepted was counted when it was sent. No lock is taken (Better Auth
 * inserts after the hook, outside our transaction): invites sent at the same
 * moment can leave extra pending invitations, but the accept check stops
 * those at the limit, so only two accepts in the same instant can overshoot
 * it, by one.
 */
export const memberLimitCheck = (
  organizationId: string,
  when: { kind: "invite"; email: string } | { kind: "accept" },
  now = new Date(),
) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const pending =
      when.kind === "invite"
        ? sql`(select count(*) from invitation i where i.organization_id = ${organizationId}
            and i.status = 'pending' and i.expires_at > ${ts(now)}
            and lower(i.email) <> lower(${when.email}))`
        : sql`0`;
    const [{ plan, policy }, plans, rows] = yield* Effect.all(
      [
        workspacePlan(organizationId, now),
        Effect.flatMap(Settings, (settings) => settings.plans),
        use((db) =>
          db
            .execute<{ members: number; pending: number }>(
              sql`select
            (select count(*) from member m where m.organization_id = ${organizationId})::int as members,
            ${pending}::int as pending`,
            )
            .then((r) => r.rows),
        ),
      ],
      { concurrency: "unbounded" },
    );
    const members = rows[0]?.members ?? 0;
    const used = members + (rows[0]?.pending ?? 0);
    const limit = policy.membersPerWorkspace;
    const allowed = used < limit;
    return {
      allowed,
      used,
      limit,
      plan,
      message: allowed
        ? null
        : memberLimitMessage(plan, limit, plans.pro.membersPerWorkspace, when.kind),
    };
  });

// ---------- Deletion guards ----------

/**
 * Workspaces whose subscription can still charge (`canStillCharge`) and would
 * be orphaned by deleting this user: ones only they belong to (deleted with
 * the account), and ones whose subscription they bought (only the buyer can
 * open its portal). Account deletion is refused while there are any.
 */
export async function chargingWorkspacesOf(
  db: Queryable,
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .execute<{ id: string; name: string }>(
      sql`
    select distinct o.id, o.name from billing_subscriptions s
    join organization o on o.id = s.organization_id
    where ${chargingSql} and (
      s.user_id = ${userId}
      or (
        exists (select 1 from member m where m.organization_id = o.id and m.user_id = ${userId})
        and (select count(*) from member m where m.organization_id = o.id) = 1
      )
    )
    order by o.name`,
    )
    .then((r) => r.rows);
  return [...rows];
}

/** Whether a workspace has a subscription that can still charge: then it can't be deleted. */
export async function hasChargingSubscription(
  db: Queryable,
  organizationId: string,
): Promise<boolean> {
  const rows = await db
    .execute<{ charging: boolean }>(
      sql`
    select exists (select 1 from billing_subscriptions s
      where s.organization_id = ${organizationId} and ${chargingSql}) as charging`,
    )
    .then((r) => r.rows);
  return rows[0]?.charging === true;
}

export const workspaceHasChargingSubscription = (organizationId: string) =>
  Effect.flatMap(Db, ({ use }) => use((db) => hasChargingSubscription(db, organizationId)));

/**
 * Whether the workspace has a subscription that blocks a new checkout
 * (`blocksCheckout`): one that can still charge or still grants Pro. Checkout
 * is refused and no upgrade is offered while it does.
 */
export const workspaceCheckoutBlocked = (organizationId: string, now = new Date()) =>
  Effect.flatMap(Db, ({ use }) => use((db) => checkoutBlocked(db, organizationId, now)));

async function checkoutBlocked(db: Queryable, organizationId: string, now: Date) {
  return (await subscriptionState(db, organizationId, now)).blocked;
}

/** Whether any subscription of the workspace blocks a checkout, and whether any grants Pro. */
async function subscriptionState(db: Queryable, organizationId: string, now: Date) {
  const rows = await db
    .execute<{ blocked: boolean; entitled: boolean }>(
      sql`select
        exists (select 1 from billing_subscriptions s
          where s.organization_id = ${organizationId} and ${checkoutBlockingSql(now)}) as blocked,
        exists (select 1 from billing_subscriptions s
          where s.organization_id = ${organizationId} and ${entitledSql(now)}) as entitled`,
    )
    .then((r) => r.rows);
  return { blocked: rows[0]?.blocked === true, entitled: rows[0]?.entitled === true };
}

/** The checkout refusal while the workspace already has a subscription that can charge. */
export const ALREADY_SUBSCRIBED =
  "This workspace already has a subscription. Manage it on Plan and billing instead of starting another.";

/**
 * Whether `userId` is the buyer (`billing_subscriptions.user_id`) of a
 * subscription on this workspace that can still charge. Only the buyer can
 * cancel in the app, so they can't be removed, demoted or leave meanwhile.
 */
export const userPaysForWorkspace = (organizationId: string, userId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const rows = await db
        .execute<{ pays: boolean }>(
          sql`
        select exists (select 1 from billing_subscriptions s
          where s.organization_id = ${organizationId} and s.user_id = ${userId}
            and ${chargingSql}) as pays`,
        )
        .then((r) => r.rows);
      return rows[0]?.pays === true;
    }),
  );

// ---------- Webhooks ----------

export type WebhookResult =
  | { kind: "rejected"; reason: WebhookRejection }
  /** An event type we don't subscribe to: acknowledged, not stored. */
  | { kind: "ignored" }
  /** Already stored (a redelivery): nothing new is enqueued. */
  | { kind: "duplicate"; event: BillingEvent }
  | { kind: "recorded"; event: BillingEvent; jobId: string };

/**
 * Stores a verified event and enqueues its apply job in one transaction, so
 * there is never an event without its job. A second delivery of the same
 * event id changes nothing.
 */
export const recordBillingEvent = (event: BillingEvent) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db) =>
      db.transaction(async (tx): Promise<WebhookResult> => {
        const [row] = await tx
          .insert(billingEvents)
          .values({
            provider: event.provider,
            providerEventId: event.eventId,
            eventType: event.type,
            occurredAt: event.occurredAt,
            // Set by the apply job once the workspace is checked; custom data is unverified.
            organizationId: null,
            payload: toStoredEvent(event),
          })
          .onConflictDoNothing()
          .returning({ id: billingEvents.id });
        if (!row) return { kind: "duplicate", event };
        const job = await enqueueJob(tx, billingApplyJob({ eventId: row.id }));
        if (!("id" in job)) throw new Error("A new billing event already had a live job");
        return { kind: "recorded", event, jobId: job.id };
      }),
    ),
  );

/** A subscription moved its workspace between plans (activated, lapsed or ended). */
export type PlanChange = { from: "free" | "pro"; to: "free" | "pro" };

export type ApplyOutcome =
  /** The event was applied before (a job retried after its commit). */
  | "already-applied"
  | "applied"
  /** Older than the stored snapshot of its subscription: kept in the log, not applied. */
  | "stale"
  /** Carries nothing to apply: no subscription state, an adjustment that doesn't end Pro, or a transaction that doesn't pay a newer period. */
  | "ignored"
  /** Can't be linked: see `UnmatchedReason`. */
  | "unmatched";

/**
 * Why an event wasn't linked. A new subscription links only when it comes
 * from a checkout transaction the server recorded for the same workspace and
 * buyer (`unknown_transaction`) with the customer it put on it
 * (`customer_mismatch`), the buyer still owns the workspace (`owner`), the
 * price is a Pro price (`price`), and, with sandbox keys on the live site, the
 * buyer is a platform admin (`test_mode`), and no other subscription has
 * linked to that checkout (`transaction_used`). Three are waiting rather than
 * refused: `no_transaction`, a subscription event other than the `created`
 * one that names the transaction; `subscription`, an adjustment for a
 * subscription we don't have yet; and `transaction`, a full refund of a
 * transaction whose `transaction.completed` hasn't arrived yet.
 */
export type UnmatchedReason =
  | "no_transaction"
  | "unknown_transaction"
  | "customer_mismatch"
  | "owner"
  | "price"
  | "test_mode"
  | "transaction_used"
  | "subscription"
  | "transaction";

export type ApplyResult = {
  outcome: ApplyOutcome;
  organizationId: string | null;
  planChange?: PlanChange;
  userId?: string;
  /**
   * Why it wasn't linked. On an `applied` result, `customer_mismatch`: the
   * event named another customer than the stored one, which was kept.
   */
  unmatched?: UnmatchedReason;
  /** The checkout transaction an unmatched subscription named, or the one that charged a revoked subscription. */
  transactionId?: string;
  /** A revoked subscription was charged for a period (`transactionId`): someone must refund it by hand. */
  revokedCharged?: true;
  /** The provider subscription, set with `revokedCharged`. */
  subscriptionId?: string;
  /** Its workspace or buyer was deleted but it can still charge: someone is paying for nothing (it is also cancelled). */
  orphanCharging?: true;
  /**
   * A new subscription linked to a workspace whose other subscription blocks a checkout: the
   * buyer may be paying twice. Linked anyway, so it can be refunded and cancelled.
   */
  duplicate?: true;
  /** The subscription moved to a price this deploy doesn't map to a plan: its plan was kept. */
  unknownPrice?: true;
  /**
   * The provider subscription still needs cancelling: a chargeback or full
   * refund revoked Pro, or its workspace or buyer is gone and it could charge again.
   */
  cancelSubscriptionId?: string;
};

/** A stored payload the schema refuses: a bug, not a transient error. */
export class BillingPayloadError extends Error {
  constructor() {
    super("Stored billing event doesn't match the schema");
    this.name = "BillingPayloadError";
  }
}

/** Second key of the advisory lock namespace that serializes one subscription's writes. */
const SUBSCRIPTION_LOCK_NAMESPACE = 7_303;

const lockSubscription = (tx: Tx, provider: string, subscriptionId: string) =>
  tx
    .execute(
      sql`select pg_advisory_xact_lock(${SUBSCRIPTION_LOCK_NAMESPACE}, hashtext(${`${provider}:${subscriptionId}`}))`,
    )
    .then((r) => r.rows);

const storedSubscription = async (tx: Tx, provider: string, subscriptionId: string) => {
  const [row] = await tx
    .select()
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.provider, provider),
        eq(billingSubscriptions.providerSubscriptionId, subscriptionId),
      ),
    )
    .limit(1);
  return row ?? null;
};

/**
 * Applies one stored event to its subscription row. Out-of-order delivery is
 * handled by the provider's `updated_at`: a snapshot older than the stored one
 * is skipped. The workspace comes from the stored row once there is one; the
 * checkout's custom data only links a new subscription, and only when the
 * workspace exists, the buyer named in it is an owner of it, and the price is
 * a Pro price. An approved chargeback, or a full refund of the transaction
 * paying for the current period, revokes Pro on its subscription and asks the
 * caller to cancel it with the provider; one that arrives before its
 * subscription is linked is kept `unmatched` in the event log and applied
 * when the subscription links. A completed transaction records which one pays
 * for the current period. A subscription whose workspace
 * or buyer was deleted (allowed only once its cancel was scheduled) is
 * cancelled too if an update makes it able to charge again.
 */
export const applyBillingEvent = (eventId: string, now = new Date()) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const prices = yield* loadProPriceIds;
    const testMode = yield* loadSandboxOnProduction;
    return yield* use((db) =>
      db.transaction(async (tx): Promise<ApplyResult> => {
        const [row] = await tx
          .select()
          .from(billingEvents)
          .where(eq(billingEvents.id, eventId))
          .for("update")
          .limit(1);
        if (!row) return { outcome: "ignored", organizationId: null };
        const parsed = billingEventSchema.safeParse(row.payload);
        if (!parsed.success) throw new BillingPayloadError();
        const event = parsed.data;

        if (row.processedAt) {
          // A retry after the commit: the provider cancel may still be owed.
          const owed = await cancelOwed(tx, event);
          return {
            outcome: "already-applied",
            organizationId: row.organizationId,
            ...(owed ? { cancelSubscriptionId: owed } : {}),
          };
        }
        const finish = async (result: ApplyResult): Promise<ApplyResult> => {
          await tx
            .update(billingEvents)
            .set({
              outcome: result.outcome === "already-applied" ? "applied" : result.outcome,
              organizationId: result.organizationId,
              processedAt: new Date(),
            })
            .where(eq(billingEvents.id, eventId));
          return result;
        };

        if (event.transaction) {
          const transaction = event.transaction;
          if (!transaction.subscriptionId)
            return finish({ outcome: "ignored", organizationId: null });
          await lockSubscription(tx, event.provider, transaction.subscriptionId);
          const stored = await storedSubscription(tx, event.provider, transaction.subscriptionId);
          // Before the link there is nothing to record: the link takes the checkout's transaction.
          if (!stored) return finish({ outcome: "ignored", organizationId: null });
          const period = { start: stored.currentPeriodStart, end: stored.currentPeriodEnd };
          const newer = paysNewerPeriod(transaction, stored.paidPeriodStart, period);
          // Charged for a period after Pro was revoked (not the revoked payment itself): refunded by hand.
          const after =
            stored.revokedAt !== null &&
            transaction.transactionId !== stored.paidTransactionId &&
            paysPeriod(transaction, period)
              ? {
                  revokedCharged: true as const,
                  subscriptionId: stored.providerSubscriptionId,
                  transactionId: transaction.transactionId,
                }
              : {};
          // Full refunds of this transaction that arrived before it.
          const waiting = await waitingRefunds(tx, event.provider, transaction.transactionId);
          if (waiting.length > 0) {
            await tx
              .update(billingEvents)
              .set({
                outcome: newer ? "applied" : "ignored",
                organizationId: stored.organizationId,
              })
              .where(inArray(billingEvents.id, waiting));
          }
          if (!newer) {
            return finish({
              outcome: "ignored",
              organizationId: stored.organizationId,
              ...cancelStillOwed(stored),
              ...after,
            });
          }
          await tx
            .update(billingSubscriptions)
            .set({
              paidTransactionId: transaction.transactionId,
              paidPeriodStart: transaction.billingPeriodStart,
              updatedAt: now,
            })
            .where(eq(billingSubscriptions.id, stored.id));
          if (waiting.length === 0) {
            return finish({
              outcome: "applied",
              organizationId: stored.organizationId,
              ...cancelStillOwed(stored),
              ...after,
            });
          }
          return finish({ ...(await revoke(tx, stored, now)), ...after });
        }

        if (event.adjustment) {
          const adjustment = event.adjustment;
          if (!adjustmentMayRevoke(adjustment) || !adjustment.subscriptionId) {
            return finish({ outcome: "ignored", organizationId: null });
          }
          await lockSubscription(tx, event.provider, adjustment.subscriptionId);
          const stored = await storedSubscription(tx, event.provider, adjustment.subscriptionId);
          if (!stored) {
            return finish({
              outcome: "unmatched",
              organizationId: null,
              unmatched: "subscription",
            });
          }
          if (adjustmentRevokesPro(adjustment, stored.paidTransactionId)) {
            return finish(await revoke(tx, stored, now));
          }
          // A refund of a renewal Paddle hasn't reported as completed yet: kept until it is.
          const refunded = adjustment.transactionId;
          if (refunded && !(await transactionKnown(tx, event.provider, refunded))) {
            await enqueueJob(tx, refundWaitCheckJob({ eventId }, adjustment.adjustmentId, now));
            return finish({
              outcome: "unmatched",
              organizationId: stored.organizationId,
              unmatched: "transaction",
              transactionId: refunded,
            });
          }
          return finish({ outcome: "ignored", organizationId: stored.organizationId });
        }

        const snapshot = event.subscription;
        if (!snapshot) return finish({ outcome: "ignored", organizationId: row.organizationId });

        await lockSubscription(tx, event.provider, snapshot.subscriptionId);
        const stored = await storedSubscription(tx, event.provider, snapshot.subscriptionId);

        let organizationId = stored?.organizationId ?? null;
        let buyer = stored?.userId ?? null;
        let pending: string[] = [];
        let current = snapshot;
        let caughtUp: string[] = [];
        let duplicate = false;
        let otherEntitled = false;
        if (!stored) {
          const link = await linkNewSubscription(tx, event.provider, snapshot, prices, testMode);
          if ("unmatched" in link) {
            return finish({
              outcome: "unmatched",
              organizationId: null,
              unmatched: link.unmatched,
              ...(snapshot.transactionId ? { transactionId: snapshot.transactionId } : {}),
            });
          }
          organizationId = link.organizationId;
          buyer = link.userId;
          // Checked before this row exists, so it sees only the workspace's other subscriptions.
          const others = await subscriptionState(tx, link.organizationId, now);
          duplicate = others.blocked;
          otherEntitled = others.entitled;
          pending = await pendingRevocations(
            tx,
            event.provider,
            snapshot.subscriptionId,
            snapshot.transactionId,
          );
          const earlier = await earlierSnapshots(tx, event.provider, snapshot.subscriptionId);
          caughtUp = earlier.ids;
          if (earlier.latest && earlier.latest.updatedAt > snapshot.updatedAt) {
            current = earlier.latest;
          }
        }
        if (stored && stored.providerUpdatedAt > snapshot.updatedAt) {
          return finish({ outcome: "stale", organizationId });
        }

        // The customer is fixed at the link: it is the one the checkout recorded.
        const customerId = stored?.providerCustomerId ?? snapshot.customerId;
        const customerChanged = current.customerId !== customerId;
        // The plan follows the price only for a price this deploy knows; an unknown one keeps it.
        const pricedPlan = planForPrice(current.priceId, prices);
        const plan = pricedPlan ?? stored?.plan ?? "pro";
        const unknownPrice = stored !== null && current.priceId !== null && pricedPlan === null;
        const pastDueSince =
          current.status !== "past_due"
            ? null
            : stored?.status === "past_due" && stored.pastDueSince
              ? stored.pastDueSince
              : current.updatedAt;
        const values = {
          status: current.status,
          providerCustomerId: customerId,
          priceId: current.priceId,
          billingInterval: current.interval,
          currentPeriodStart: current.currentPeriodStart,
          currentPeriodEnd: current.currentPeriodEnd,
          cancelAtPeriodEnd: current.cancelAtPeriodEnd,
          canceledAt: current.canceledAt,
          pastDueSince,
          plan,
          providerUpdatedAt: current.updatedAt,
          updatedAt: new Date(),
        };
        if (stored) {
          await tx
            .update(billingSubscriptions)
            .set(values)
            .where(eq(billingSubscriptions.id, stored.id));
        } else {
          await tx.insert(billingSubscriptions).values({
            ...values,
            organizationId,
            userId: buyer,
            provider: event.provider,
            providerSubscriptionId: snapshot.subscriptionId,
            paidTransactionId: snapshot.transactionId,
            paidPeriodStart: snapshot.currentPeriodStart,
            revokedAt: pending.length > 0 ? now : null,
          });
          const settled = [...pending, ...caughtUp];
          if (settled.length > 0) {
            await tx
              .update(billingEvents)
              .set({ outcome: "applied", organizationId })
              .where(inArray(billingEvents.id, settled));
          }
        }
        // What this subscription grants, before and after: the product event "plan changed".
        const revokedAt = stored?.revokedAt ?? (pending.length > 0 ? now : null);
        const orphan = orphanCanCharge({ organizationId, userId: buyer, ...values });
        // Every later event of a revoked subscription asks again, in case an earlier cancel job died.
        const cancel = (revokedAt !== null && values.status !== "canceled") || orphan;
        const from = stored && isEntitled(entitlementOf(stored), now) ? "pro" : "free";
        const to = isEntitled({ ...values, revokedAt }, now) ? "pro" : "free";
        return finish({
          outcome: "applied",
          organizationId,
          ...(orphan ? { orphanCharging: true as const } : {}),
          ...(duplicate ? { duplicate: true as const } : {}),
          ...(unknownPrice ? { unknownPrice: true as const } : {}),
          ...(customerChanged ? { unmatched: "customer_mismatch" as const } : {}),
          // Beside another subscription that grants Pro, the workspace's plan didn't change.
          ...(from === to || otherEntitled ? {} : { planChange: { from, to } }),
          ...(buyer ? { userId: buyer } : {}),
          ...(cancel ? { cancelSubscriptionId: snapshot.subscriptionId } : {}),
        });
      }),
    );
  });

/**
 * Revokes Pro on a stored subscription (an approved chargeback, or a full
 * refund of the current period's payment) and asks for the provider cancel.
 */
async function revoke(tx: Tx, stored: BillingSubscription, now: Date): Promise<ApplyResult> {
  const wasPro = isEntitled(entitlementOf(stored), now);
  if (!stored.revokedAt) {
    await tx
      .update(billingSubscriptions)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(billingSubscriptions.id, stored.id));
  }
  return {
    outcome: "applied",
    organizationId: stored.organizationId,
    ...(wasPro ? { planChange: { from: "pro", to: "free" } } : {}),
    ...(stored.userId ? { userId: stored.userId } : {}),
    ...(stored.status !== "canceled"
      ? { cancelSubscriptionId: stored.providerSubscriptionId }
      : {}),
  };
}

/** A revoked subscription not yet `canceled` in the provider: every later event asks for the cancel again. */
const cancelStillOwed = (stored: BillingSubscription) =>
  stored.revokedAt !== null && stored.status !== "canceled"
    ? { cancelSubscriptionId: stored.providerSubscriptionId }
    : {};

/**
 * Whether a transaction has been applied (`transaction.completed`) or is one of our checkouts. A report still
 * queued doesn't count: its job reads waiting refunds when it runs.
 */
async function transactionKnown(tx: Tx, provider: string, transactionId: string) {
  const rows = await tx
    .execute<{ known: boolean }>(
      sql`select exists (select 1 from billing_events e where e.provider = ${provider}
          and e.processed_at is not null
          and e.payload->'transaction'->>'transactionId' = ${transactionId})
        or exists (select 1 from billing_checkouts c where c.provider = ${provider}
          and c.provider_transaction_id = ${transactionId}) as known`,
    )
    .then((r) => r.rows);
  return rows[0]?.known === true;
}

/** Full refunds kept `unmatched` until their transaction was reported. Returns their event ids. */
async function waitingRefunds(tx: Tx, provider: string, transactionId: string) {
  const rows = await tx
    .select({ id: billingEvents.id, payload: billingEvents.payload })
    .from(billingEvents)
    .where(
      and(
        eq(billingEvents.provider, provider),
        eq(billingEvents.outcome, "unmatched"),
        sql`${billingEvents.payload}->'adjustment'->>'transactionId' = ${transactionId}`,
      ),
    );
  return rows
    .filter((row) => {
      const adjustment = billingEventSchema.safeParse(row.payload).data?.adjustment;
      return adjustment ? adjustmentRevokesPro(adjustment, transactionId) : false;
    })
    .map((row) => row.id);
}

type ChargeFields = {
  organizationId: string | null;
  userId: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
};

/**
 * A subscription whose workspace or buyer was deleted that could charge again,
 * as when a scheduled cancel is removed in the provider afterwards: nobody is
 * left to bill (or able to open the portal), so it is cancelled.
 */
const orphanCanCharge = (row: ChargeFields) =>
  (row.organizationId === null || row.userId === null) &&
  canStillCharge({ status: row.status as BillingStatus, cancelAtPeriodEnd: row.cancelAtPeriodEnd });

/**
 * Revoking adjustments stored `unmatched` because they arrived before their
 * subscription was linked: an approved chargeback, or a full refund of the
 * checkout transaction (`paidTransactionId`), which pays the first period.
 * The event log is the pending record, so one is never lost however late
 * `subscription.created` comes. Returns their event ids.
 */
async function pendingRevocations(
  tx: Tx,
  provider: string,
  subscriptionId: string,
  paidTransactionId: string | null,
) {
  const rows = await tx
    .select({ id: billingEvents.id, payload: billingEvents.payload })
    .from(billingEvents)
    .where(
      and(
        eq(billingEvents.provider, provider),
        eq(billingEvents.outcome, "unmatched"),
        sql`${billingEvents.payload}->'adjustment'->>'subscriptionId' = ${subscriptionId}`,
      ),
    );
  return rows
    .filter((row) => {
      const adjustment = billingEventSchema.safeParse(row.payload).data?.adjustment;
      return adjustment ? adjustmentRevokesPro(adjustment, paidTransactionId) : false;
    })
    .map((row) => row.id);
}

/**
 * Events of one subscription stored `unmatched` before it linked: only
 * `subscription.created` names the checkout transaction, and the provider may
 * deliver later events of the same subscription first. Returns their ids and
 * the newest snapshot among them, which the link stores when it is newer.
 */
async function earlierSnapshots(tx: Tx, provider: string, subscriptionId: string) {
  const rows = await tx
    .select({ id: billingEvents.id, payload: billingEvents.payload })
    .from(billingEvents)
    .where(
      and(
        eq(billingEvents.provider, provider),
        eq(billingEvents.outcome, "unmatched"),
        sql`${billingEvents.payload}->'subscription'->>'subscriptionId' = ${subscriptionId}`,
      ),
    );
  const ids: string[] = [];
  let latest: SubscriptionSnapshot | null = null;
  for (const row of rows) {
    const snapshot = billingEventSchema.safeParse(row.payload).data?.subscription;
    if (!snapshot) continue;
    ids.push(row.id);
    if (!latest || snapshot.updatedAt > latest.updatedAt) latest = snapshot;
  }
  return { ids, latest };
}

/**
 * Checks a new subscription before linking it (see `UnmatchedReason`). Anyone
 * can open a Paddle checkout with our public client token, any custom data and
 * any customer, so a link needs the transaction the server created for that
 * workspace and buyer, with the same customer on it.
 */
async function linkNewSubscription(
  tx: Tx,
  provider: string,
  snapshot: NonNullable<BillingEvent["subscription"]>,
  prices: ReadonlySet<string>,
  testMode: boolean,
): Promise<{ organizationId: string; userId: string } | { unmatched: UnmatchedReason }> {
  const { transactionId, workspaceId, userId } = snapshot;
  if (!transactionId) return { unmatched: "no_transaction" };
  if (!workspaceId || !userId) return { unmatched: "unknown_transaction" };
  const rows = await tx
    .execute<{ id: string; customer_id: string; owner: boolean; admin: boolean }>(
      sql`select c.id, c.provider_customer_id as customer_id,
    exists (select 1 from member m where m.organization_id = c.organization_id
      and m.user_id = c.user_id and m.role = 'owner') as owner,
    exists (select 1 from "user" u where u.id = c.user_id
      and 'admin' = any(string_to_array(u.role, ','))) as admin
    from billing_checkouts c
    where c.provider = ${provider} and c.provider_transaction_id = ${transactionId}
      and c.organization_id = ${workspaceId} and c.user_id = ${userId}`,
    )
    .then((r) => r.rows);
  const checkout = rows[0];
  if (!checkout) return { unmatched: "unknown_transaction" };
  if (checkout.customer_id !== snapshot.customerId) return { unmatched: "customer_mismatch" };
  if (!checkout.owner) return { unmatched: "owner" };
  if (!snapshot.priceId || !prices.has(snapshot.priceId)) return { unmatched: "price" };
  if (testMode && !checkout.admin) return { unmatched: "test_mode" };
  // Conditional, so of two subscriptions racing for one checkout only the first claims it.
  const claimed = await tx
    .update(billingCheckouts)
    .set({ providerSubscriptionId: snapshot.subscriptionId })
    .where(
      and(eq(billingCheckouts.id, checkout.id), isNull(billingCheckouts.providerSubscriptionId)),
    )
    .returning({ id: billingCheckouts.id });
  if (claimed.length === 0) return { unmatched: "transaction_used" };
  return { organizationId: workspaceId, userId };
}

/**
 * On a retry after the commit, the subscription that may still need cancelling
 * with the provider: revoked but not yet canceled, or orphaned and able to charge.
 */
async function cancelOwed(tx: Tx, event: BillingEvent): Promise<string | null> {
  const adjustment = event.adjustment;
  const subscriptionId = adjustment
    ? adjustmentMayRevoke(adjustment)
      ? adjustment.subscriptionId
      : null
    : (event.subscription?.subscriptionId ?? event.transaction?.subscriptionId ?? null);
  if (!subscriptionId) return null;
  const stored = await storedSubscription(tx, event.provider, subscriptionId);
  if (!stored || stored.status === "canceled") return null;
  if (stored.revokedAt || orphanCanCharge(stored)) return stored.providerSubscriptionId;
  return null;
}

/**
 * A full refund still kept waiting for its transaction (outcome `unmatched`), with what an
 * operator needs to find it in the provider; null once it was applied or dropped.
 */
export const waitingRefund = (eventId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const [row] = await db
        .select({
          outcome: billingEvents.outcome,
          organizationId: billingEvents.organizationId,
          payload: billingEvents.payload,
        })
        .from(billingEvents)
        .where(eq(billingEvents.id, eventId))
        .limit(1);
      const adjustment = row && billingEventSchema.safeParse(row.payload).data?.adjustment;
      if (row?.outcome !== "unmatched" || !adjustment?.transactionId) return null;
      return {
        organizationId: row.organizationId,
        subscriptionId: adjustment.subscriptionId,
        transactionId: adjustment.transactionId,
      };
    }),
  );

/** What the billing page shows about a workspace's subscription. */
export type WorkspaceBilling = {
  status: BillingStatus;
  interval: "month" | "year" | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Set while past_due: when Pro stops unless the payment goes through. */
  graceEndsAt: Date | null;
  entitled: boolean;
  /** When Pro ended, once it has: the cancel, the end of grace, or a refund. */
  endedAt: Date | null;
  /** Ended by a chargeback or full refund. */
  revoked: boolean;
  /** Who subscribed; only they can open the portal. Null once they're gone. */
  buyer: { id: string; email: string } | null;
  /**
   * A subscription of this workspace (this one or another) can still charge or grant Pro
   * (`blocksCheckout`), so no new checkout is offered or accepted.
   */
  checkoutBlocked: boolean;
};

/**
 * The subscription to show and manage: an entitling one, else one that can
 * still charge, else the latest. With `checkoutBlocked` from every row.
 */
const pickRow = (organizationId: string, now: Date) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      // A workspace has one subscription, or a few after a cancel and a re-subscribe.
      const rows = await db
        .select({ row: billingSubscriptions, buyerEmail: user.email })
        .from(billingSubscriptions)
        .leftJoin(user, eq(user.id, billingSubscriptions.userId))
        .where(eq(billingSubscriptions.organizationId, organizationId))
        .orderBy(desc(billingSubscriptions.providerUpdatedAt))
        .limit(20);
      const blocking = rows.filter(({ row }) => blocksCheckout(entitlementOf(row), now));
      const picked =
        rows.find(({ row }) => isEntitled(entitlementOf(row), now)) ?? blocking[0] ?? rows[0];
      return picked ? { ...picked, checkoutBlocked: blocking.length > 0 } : null;
    }),
  );

const entitlementOf = (row: BillingSubscription) => ({
  status: row.status as BillingStatus,
  plan: row.plan,
  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  currentPeriodEnd: row.currentPeriodEnd,
  pastDueSince: row.pastDueSince,
  revokedAt: row.revokedAt,
});

/** The workspace's current subscription (an entitling one, else one that can still charge, else the latest), or null. */
export const workspaceBilling = (organizationId: string, now = new Date()) =>
  Effect.gen(function* () {
    const picked = yield* pickRow(organizationId, now);
    if (!picked) return null;
    const { row, buyerEmail } = picked;
    const fields = entitlementOf(row);
    const status = fields.status;
    const entitled = isEntitled(fields, now);
    const graceEndsAt =
      status === "past_due" && row.pastDueSince
        ? new Date(row.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000)
        : null;
    const endedAt = entitled
      ? null
      : (row.revokedAt ??
        graceEndsAt ??
        (status === "canceled" ? (row.canceledAt ?? row.currentPeriodEnd) : null) ??
        (row.cancelAtPeriodEnd ? row.currentPeriodEnd : null));
    return {
      status,
      interval:
        row.billingInterval === "month" || row.billingInterval === "year"
          ? row.billingInterval
          : null,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      graceEndsAt,
      entitled,
      endedAt,
      revoked: row.revokedAt !== null,
      buyer: row.userId && buyerEmail ? { id: row.userId, email: buyerEmail } : null,
      checkoutBlocked: picked.checkoutBlocked,
    } satisfies WorkspaceBilling;
  });

/**
 * What the browser needs to open a checkout, or null while billing is off.
 * Reads only the non-secret env values (`PADDLE_PUBLIC_KEYS`, no database), so
 * marketing pages can call it at build time, when Sensitive values are empty.
 * The server actions behind the button still need the full config.
 */
export const loadCheckoutConfig: Effect.Effect<CheckoutConfig | null> = Config.all(
  PADDLE_PUBLIC_KEYS.map((key) => Config.option(Config.string(key))),
).pipe(
  Effect.map((values) => {
    const config = parsePublicPaddleConfig(
      Object.fromEntries(
        PADDLE_PUBLIC_KEYS.map((key, i) => [key, Option.getOrUndefined(values[i]!)]),
      ),
    );
    return config
      ? { provider: PADDLE, environment: config.environment, clientToken: config.clientToken }
      : null;
  }),
  Effect.orElseSucceed(() => null),
);

export type CheckoutRequest = {
  organizationId: string;
  userId: string;
  interval: "month" | "year";
};

/** The logged reason for a failed provider call; the status names what to fix (401 key, 403 permission, 400 request). */
export const providerFailureKind = (cause: unknown) =>
  cause instanceof PaddleApiError
    ? cause.reason === "body"
      ? "bad-response"
      : `http-${cause.status}`
    : "network";

/** The provider's error code on a failed billing call, for `billing.provider_error_code`. */
export const providerErrorCode = (error: unknown): string | undefined =>
  error instanceof BillingProviderError ? error.providerCode : undefined;

/** A failed provider call as a typed error, with its loggable kind and the provider's code. */
export const providerFailure = (message: string, cause: unknown) =>
  new BillingProviderError({
    message,
    kind: providerFailureKind(cause),
    ...(cause instanceof PaddleApiError && cause.code ? { providerCode: cause.code } : {}),
    cause,
  });

const providerCall = <A>(message: string, call: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) => providerFailure(message, cause),
  }).pipe(
    Effect.timeoutFail({
      duration: "10 seconds",
      onTimeout: () =>
        new BillingProviderError({ message: `${message}: timed out`, kind: "timeout" }),
    }),
  );

/** The portal refusal once the buyer's account is gone. */
export const BUYER_GONE =
  "The person who subscribed no longer has an account, so this subscription can't be managed here. Use the support button for invoices or changes.";

/** The checkout refusal while the buyer's email address isn't verified. */
export const UNVERIFIED_EMAIL = "Verify your email address before upgrading.";

export class Billing extends Context.Tag("@receipt-ocr/core/Billing")<
  Billing,
  {
    /** Verifies, parses and records a webhook delivery. */
    readonly receiveWebhook: (
      rawBody: string,
      signature: string | null,
    ) => Effect.Effect<WebhookResult, NotConfigured | DbError>;
    /**
     * Short-lived customer portal links for the workspace's subscription.
     * Only for its buyer, and only when its customer is one the server put on
     * a checkout for them: the portal shows that customer's card and
     * invoices. Forbidden once the buyer's account is gone.
     */
    readonly portalLinks: (
      organizationId: string,
      userId: string,
    ) => Effect.Effect<
      PortalLinks,
      NotConfigured | NotFound | Forbidden | BillingProviderError | DbError
    >;
    /**
     * Creates a checkout transaction for one workspace's Pro at the configured
     * price for `interval`, with the workspace and buyer in its custom data,
     * and records it in `billing_checkouts` before returning its id. The
     * customer is the one on the buyer's last checkout, else found or created
     * by their email, which must be verified. The caller has checked the user
     * is an owner; this checks again. Conflict while the workspace is on Pro
     * or has a subscription that can still charge (`blocksCheckout`).
     */
    readonly createCheckout: (
      request: CheckoutRequest,
    ) => Effect.Effect<
      { transactionId: string },
      NotConfigured | Forbidden | Conflict | BillingProviderError | DbError
    >;
    /** Cancels a subscription with the provider at once (after a chargeback or full refund). */
    readonly cancelNow: (
      subscriptionId: string,
    ) => Effect.Effect<void, NotConfigured | BillingProviderError>;
  }
>() {
  static readonly Live = Layer.effect(
    Billing,
    Effect.gen(function* () {
      const db = yield* Db;
      const settings = yield* Settings;
      const config = Option.getOrNull(yield* loadPaddleConfig);
      const off = new NotConfigured({ message: "Billing is not configured" });
      const withDeps = <A, E>(effect: Effect.Effect<A, E, Db | Settings>) =>
        effect.pipe(Effect.provideService(Db, db), Effect.provideService(Settings, settings));
      return {
        receiveWebhook: (rawBody, signature) => {
          if (!config) return Effect.fail(off);
          return Effect.gen(function* () {
            const verdict = verifyPaddleSignature(
              rawBody,
              signature,
              Redacted.value(config.webhookSecret),
              Date.now(),
            );
            if (verdict !== "ok") return { kind: "rejected", reason: verdict } as const;
            const event = parsePaddleEvent(rawBody);
            if (event === "bad-body") return { kind: "rejected", reason: "bad-body" } as const;
            if (event === null) return { kind: "ignored" } as const;
            yield* annotateEvent({
              billing: {
                provider: event.provider,
                event_type: event.type,
                event_id: event.eventId,
                subscription_id:
                  event.subscription?.subscriptionId ?? event.adjustment?.subscriptionId ?? null,
                status: event.subscription?.status ?? event.adjustment?.status ?? null,
                ...(event.adjustment ? { adjustment_action: event.adjustment.action } : {}),
              },
            });
            return yield* recordBillingEvent(event).pipe(Effect.provideService(Db, db));
          });
        },

        portalLinks: (organizationId, userId) => {
          if (!config) return Effect.fail(off);
          return Effect.gen(function* () {
            const picked = yield* pickRow(organizationId, new Date()).pipe(
              Effect.provideService(Db, db),
            );
            const row = picked?.row;
            if (!row || row.provider !== PADDLE) {
              return yield* new NotFound({ message: "This workspace has no subscription yet." });
            }
            if (!row.userId || !picked.buyerEmail) {
              return yield* new Forbidden({ message: BUYER_GONE });
            }
            if (row.userId !== userId) {
              return yield* new Forbidden({
                message: "Only the person who subscribed can manage this subscription.",
              });
            }
            const bound = yield* db.use((d) =>
              d
                .select({ id: billingCheckouts.id })
                .from(billingCheckouts)
                .where(
                  and(
                    eq(billingCheckouts.provider, row.provider),
                    eq(billingCheckouts.userId, userId),
                    eq(billingCheckouts.providerCustomerId, row.providerCustomerId),
                  ),
                )
                .limit(1),
            );
            if (bound.length === 0) {
              return yield* new Forbidden({
                message:
                  "This subscription can't be managed here. Use the support button for help.",
              });
            }
            return yield* providerCall("Paddle portal request failed", (signal) =>
              createPaddlePortalSession({
                environment: config.environment,
                apiKey: Redacted.value(config.apiKey),
                customerId: row.providerCustomerId,
                subscriptionId: row.providerSubscriptionId,
                signal,
              }),
            );
          });
        },

        createCheckout: (request) => {
          if (!config) return Effect.fail(off);
          return Effect.gen(function* () {
            const { use } = db;
            const rows = yield* use((d) =>
              d
                .execute<{ owner: boolean; email: string | null; verified: boolean | null }>(
                  sql`select exists (select 1 from member
                where organization_id = ${request.organizationId} and user_id = ${request.userId}
                and role = 'owner') as owner, u.email, u.email_verified as verified
                from (select 1) one left join "user" u on u.id = ${request.userId}`,
                )
                .then((r) => r.rows),
            );
            const buyer = rows[0];
            if (buyer?.owner !== true || !buyer.email) {
              return yield* new Forbidden({ message: "Only the workspace owner can upgrade it." });
            }
            if (buyer.verified !== true) {
              return yield* new Forbidden({ message: UNVERIFIED_EMAIL });
            }
            const email = buyer.email;
            const [{ plan }, blocked] = yield* Effect.all(
              [
                withDeps(workspacePlan(request.organizationId)),
                withDeps(workspaceCheckoutBlocked(request.organizationId)),
              ],
              { concurrency: "unbounded" },
            );
            if (plan === "pro") {
              return yield* new Conflict({ message: "This workspace is already on Pro." });
            }
            if (blocked) return yield* new Conflict({ message: ALREADY_SUBSCRIBED });
            const [last] = yield* use((d) =>
              d
                .select({ customerId: billingCheckouts.providerCustomerId })
                .from(billingCheckouts)
                .where(
                  and(
                    eq(billingCheckouts.provider, PADDLE),
                    eq(billingCheckouts.userId, request.userId),
                  ),
                )
                .orderBy(desc(billingCheckouts.createdAt))
                .limit(1),
            );
            const priceId = config.prices[request.interval];
            const created = yield* providerCall("Paddle checkout request failed", (signal) =>
              createPaddleCheckoutTransaction({
                environment: config.environment,
                apiKey: Redacted.value(config.apiKey),
                priceId,
                email,
                customerId: last?.customerId ?? null,
                customData: { workspaceId: request.organizationId, userId: request.userId },
                signal,
              }),
            );
            yield* use((d) =>
              d.insert(billingCheckouts).values({
                provider: PADDLE,
                providerTransactionId: created.transactionId,
                organizationId: request.organizationId,
                userId: request.userId,
                providerCustomerId: created.customerId,
                priceId,
              }),
            );
            return { transactionId: created.transactionId };
          });
        },

        cancelNow: (subscriptionId) => {
          if (!config) return Effect.fail(off);
          return providerCall("Paddle cancel request failed", (signal) =>
            cancelPaddleSubscription({
              environment: config.environment,
              apiKey: Redacted.value(config.apiKey),
              subscriptionId,
              signal,
            }),
          );
        },
      };
    }),
  );
}
