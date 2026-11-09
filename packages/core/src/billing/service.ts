import {
  and,
  billingEvents,
  billingSubscriptions,
  desc,
  eq,
  inArray,
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
import { billingApplyJob } from "../jobs/billing-apply-job";
import { enqueueJob } from "../jobs/queue";
import { DEFAULT_PLAN, policyFor, type PlanId, type PlanPolicy } from "../plans";
import { Db } from "../services";
import { Settings } from "../settings";
import { annotateEvent } from "../telemetry/current";
import type { Queryable } from "../usage";
import {
  PADDLE_ENV_KEYS,
  PADDLE_LEGACY_PRICES_KEY,
  PADDLE_PUBLIC_KEYS,
  parsePaddleConfig,
  parseProPriceIds,
  parsePublicPaddleConfig,
  type PaddleConfig,
} from "./config";
import {
  adjustmentRevokesPro,
  canStillCharge,
  memberLimitMessage,
  isEntitled,
  PAST_DUE_GRACE_DAYS,
  PAST_DUE_GRACE_MS,
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

/** The price ids that grant Pro (`parseProPriceIds`), from the environment. */
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

// ---------- Plan resolution ----------

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;

const priceIn = (prices: ReadonlySet<string>) =>
  prices.size === 0
    ? sql`false`
    : sql`s.price_id in (${sql.join(
        [...prices].map((id) => sql`${id}`),
        sql`, `,
      )})`;

/** `isEntitled` over `billing_subscriptions` aliased `s`. */
export const entitledSql = (now: Date, prices: ReadonlySet<string>) => sql`(
  s.revoked_at is null and ${priceIn(prices)} and (
    (s.status in ('active', 'trialing') and (not s.cancel_at_period_end or s.current_period_end is null or s.current_period_end > ${ts(now)}))
    or (s.status = 'past_due' and s.past_due_since > ${ts(new Date(now.getTime() - PAST_DUE_GRACE_MS))})
    or (s.status = 'canceled' and s.cancel_at_period_end and s.current_period_end > ${ts(now)})
  )
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
    const prices = yield* loadProPriceIds;
    const rows = yield* use((db) =>
      db.execute<{ pro: boolean }>(sql`select (
        exists (select 1 from billing_subscriptions s
          where s.organization_id = ${organizationId} and ${entitledSql(now, prices)})
        or exists (select 1 from member m join "user" u on u.id = m.user_id
          where m.organization_id = ${organizationId} and m.role = 'owner' and u.plan = 'pro')
      ) as pro`),
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
    const prices = yield* loadProPriceIds;
    const rows = yield* use((db) =>
      db.execute<{ pro: boolean }>(sql`select (
        exists (select 1 from "user" u where u.id = ${userId} and u.plan = 'pro')
        or exists (select 1 from member m join billing_subscriptions s on s.organization_id = m.organization_id
          where m.user_id = ${userId} and m.role = 'owner' and ${entitledSql(now, prices)})
      ) as pro`),
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
          db.execute<{ owned: number }>(
            sql`select count(*)::int as owned from member where user_id = ${userId} and role = 'owner'`,
          ),
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
          db.execute<{ members: number; pending: number }>(sql`select
            (select count(*) from member m where m.organization_id = ${organizationId})::int as members,
            ${pending}::int as pending`),
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
  const rows = await db.execute<{ id: string; name: string }>(sql`
    select distinct o.id, o.name from billing_subscriptions s
    join organization o on o.id = s.organization_id
    where ${chargingSql} and (
      s.user_id = ${userId}
      or (
        exists (select 1 from member m where m.organization_id = o.id and m.user_id = ${userId})
        and (select count(*) from member m where m.organization_id = o.id) = 1
      )
    )
    order by o.name`);
  return [...rows];
}

/** Whether a workspace has a subscription that can still charge: then it can't be deleted. */
export async function hasChargingSubscription(
  db: Queryable,
  organizationId: string,
): Promise<boolean> {
  const rows = await db.execute<{ charging: boolean }>(sql`
    select exists (select 1 from billing_subscriptions s
      where s.organization_id = ${organizationId} and ${chargingSql}) as charging`);
  return rows[0]?.charging === true;
}

export const workspaceHasChargingSubscription = (organizationId: string) =>
  Effect.flatMap(Db, ({ use }) => use((db) => hasChargingSubscription(db, organizationId)));

/**
 * Whether `userId` is the buyer (`billing_subscriptions.user_id`) of a
 * subscription on this workspace that can still charge. Only the buyer can
 * cancel in the app, so they can't be removed, demoted or leave meanwhile.
 */
export const userPaysForWorkspace = (organizationId: string, userId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const rows = await db.execute<{ pays: boolean }>(sql`
        select exists (select 1 from billing_subscriptions s
          where s.organization_id = ${organizationId} and s.user_id = ${userId}
            and ${chargingSql}) as pays`);
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
  /** Carries no subscription state, or an adjustment that doesn't end Pro. */
  | "ignored"
  /** Can't be linked: see `UnmatchedReason`. */
  | "unmatched";

/**
 * Why a new subscription wasn't linked. Custom data comes from the checkout,
 * so a link needs all three: a workspace that exists, a buyer who owns it,
 * and a Pro price.
 */
export type UnmatchedReason = "workspace" | "owner" | "price" | "subscription";

export type ApplyResult = {
  outcome: ApplyOutcome;
  organizationId: string | null;
  planChange?: PlanChange;
  userId?: string;
  unmatched?: UnmatchedReason;
  /** Its workspace or buyer was deleted but it can still charge: someone is paying for nothing (it is also cancelled). */
  orphanCharging?: true;
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
  tx.execute(
    sql`select pg_advisory_xact_lock(${SUBSCRIPTION_LOCK_NAMESPACE}, hashtext(${`${provider}:${subscriptionId}`}))`,
  );

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
 * a Pro price. An approved chargeback or full refund revokes Pro on its
 * subscription and asks the caller to cancel it with the provider; one that
 * arrives before its subscription is linked is kept `unmatched` in the event
 * log and applied when the subscription links. A subscription whose workspace
 * or buyer was deleted (allowed only once its cancel was scheduled) is
 * cancelled too if an update makes it able to charge again.
 */
export const applyBillingEvent = (eventId: string, now = new Date()) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const prices = yield* loadProPriceIds;
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

        if (event.adjustment) {
          const adjustment = event.adjustment;
          if (!adjustmentRevokesPro(adjustment) || !adjustment.subscriptionId) {
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
          const wasPro = isEntitled(entitlementOf(stored), now, prices);
          if (!stored.revokedAt) {
            await tx
              .update(billingSubscriptions)
              .set({ revokedAt: now, updatedAt: now })
              .where(eq(billingSubscriptions.id, stored.id));
          }
          return finish({
            outcome: "applied",
            organizationId: stored.organizationId,
            ...(wasPro ? { planChange: { from: "pro", to: "free" } } : {}),
            ...(stored.userId ? { userId: stored.userId } : {}),
            ...(stored.status !== "canceled"
              ? { cancelSubscriptionId: stored.providerSubscriptionId }
              : {}),
          });
        }

        const snapshot = event.subscription;
        if (!snapshot) return finish({ outcome: "ignored", organizationId: row.organizationId });

        await lockSubscription(tx, event.provider, snapshot.subscriptionId);
        const stored = await storedSubscription(tx, event.provider, snapshot.subscriptionId);

        let organizationId = stored?.organizationId ?? null;
        let buyer = stored?.userId ?? null;
        let pending: string[] = [];
        if (!stored) {
          const link = await linkNewSubscription(tx, snapshot, prices);
          if ("unmatched" in link) {
            return finish({
              outcome: "unmatched",
              organizationId: null,
              unmatched: link.unmatched,
            });
          }
          organizationId = link.organizationId;
          buyer = link.userId;
          pending = await pendingRevocations(tx, event.provider, snapshot.subscriptionId);
        }
        if (stored && stored.providerUpdatedAt > snapshot.updatedAt) {
          return finish({ outcome: "stale", organizationId });
        }

        const pastDueSince =
          snapshot.status !== "past_due"
            ? null
            : stored?.status === "past_due" && stored.pastDueSince
              ? stored.pastDueSince
              : snapshot.updatedAt;
        const values = {
          status: snapshot.status,
          providerCustomerId: snapshot.customerId,
          priceId: snapshot.priceId,
          billingInterval: snapshot.interval,
          currentPeriodStart: snapshot.currentPeriodStart,
          currentPeriodEnd: snapshot.currentPeriodEnd,
          cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
          canceledAt: snapshot.canceledAt,
          pastDueSince,
          providerUpdatedAt: snapshot.updatedAt,
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
            revokedAt: pending.length > 0 ? now : null,
          });
          if (pending.length > 0) {
            await tx
              .update(billingEvents)
              .set({ outcome: "applied", organizationId })
              .where(inArray(billingEvents.id, pending));
          }
        }
        // What this subscription grants, before and after: the product event "plan changed".
        const revokedAt = stored?.revokedAt ?? (pending.length > 0 ? now : null);
        const orphan = orphanCanCharge({ organizationId, userId: buyer, ...values });
        const cancel = (pending.length > 0 && values.status !== "canceled") || orphan;
        const from = stored && isEntitled(entitlementOf(stored), now, prices) ? "pro" : "free";
        const to = isEntitled({ ...values, revokedAt }, now, prices) ? "pro" : "free";
        return finish({
          outcome: "applied",
          organizationId,
          ...(orphan ? { orphanCharging: true as const } : {}),
          ...(from === to ? {} : { planChange: { from, to } }),
          ...(buyer ? { userId: buyer } : {}),
          ...(cancel ? { cancelSubscriptionId: snapshot.subscriptionId } : {}),
        });
      }),
    );
  });

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
 * Revoking adjustments (approved chargeback or full refund) stored `unmatched`
 * because they arrived before their subscription was linked: the event log is
 * the pending record, so one is never lost however late `subscription.created`
 * comes. Returns their event ids.
 */
async function pendingRevocations(tx: Tx, provider: string, subscriptionId: string) {
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
      return adjustment ? adjustmentRevokesPro(adjustment) : false;
    })
    .map((row) => row.id);
}

/**
 * Checks a new subscription's custom data before linking it: the workspace
 * exists, the buyer is one of its owners now, and the price is a Pro price.
 * Anyone can open a Paddle checkout with our public client token and any
 * custom data, so none of it is trusted on its own.
 */
async function linkNewSubscription(
  tx: Tx,
  snapshot: NonNullable<BillingEvent["subscription"]>,
  prices: ReadonlySet<string>,
): Promise<{ organizationId: string; userId: string } | { unmatched: UnmatchedReason }> {
  if (!snapshot.workspaceId) return { unmatched: "workspace" };
  const rows = await tx.execute<{ workspace: boolean; owner: boolean }>(sql`select
    exists (select 1 from organization where id = ${snapshot.workspaceId}) as workspace,
    exists (select 1 from member where organization_id = ${snapshot.workspaceId}
      and user_id = ${snapshot.userId ?? ""} and role = 'owner') as owner`);
  if (rows[0]?.workspace !== true) return { unmatched: "workspace" };
  if (rows[0]?.owner !== true || !snapshot.userId) return { unmatched: "owner" };
  if (!snapshot.priceId || !prices.has(snapshot.priceId)) return { unmatched: "price" };
  return { organizationId: snapshot.workspaceId, userId: snapshot.userId };
}

/**
 * On a retry after the commit, the subscription that may still need cancelling
 * with the provider: revoked but not yet canceled, or orphaned and able to charge.
 */
async function cancelOwed(tx: Tx, event: BillingEvent): Promise<string | null> {
  const adjustment = event.adjustment;
  const subscriptionId = adjustment
    ? adjustmentRevokesPro(adjustment)
      ? adjustment.subscriptionId
      : null
    : (event.subscription?.subscriptionId ?? null);
  if (!subscriptionId) return null;
  const stored = await storedSubscription(tx, event.provider, subscriptionId);
  if (!stored || stored.status === "canceled") return null;
  if (stored.revokedAt || orphanCanCharge(stored)) return stored.providerSubscriptionId;
  return null;
}

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
};

const pickRow = (organizationId: string, now: Date, prices: ReadonlySet<string>) =>
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
      return rows.find(({ row }) => isEntitled(entitlementOf(row), now, prices)) ?? rows[0] ?? null;
    }),
  );

const entitlementOf = (row: BillingSubscription) => ({
  status: row.status as BillingStatus,
  priceId: row.priceId,
  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  currentPeriodEnd: row.currentPeriodEnd,
  pastDueSince: row.pastDueSince,
  revokedAt: row.revokedAt,
});

/** The workspace's current subscription (an entitling one first, else the latest), or null. */
export const workspaceBilling = (organizationId: string, now = new Date()) =>
  Effect.gen(function* () {
    const prices = yield* loadProPriceIds;
    const picked = yield* pickRow(organizationId, now, prices);
    if (!picked) return null;
    const { row, buyerEmail } = picked;
    const fields = entitlementOf(row);
    const status = fields.status;
    const entitled = isEntitled(fields, now, prices);
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
  email: string;
  interval: "month" | "year";
};

/** The logged reason for a failed provider call; the status names what to fix (401 key, 403 permission, 400 request). */
export const providerFailureKind = (cause: unknown) =>
  cause instanceof PaddleApiError
    ? cause.reason === "body"
      ? "bad-response"
      : `http-${cause.status}`
    : "network";

const providerCall = <A>(message: string, call: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      new BillingProviderError({ message, kind: providerFailureKind(cause), cause }),
  }).pipe(
    Effect.timeoutFail({
      duration: "10 seconds",
      onTimeout: () =>
        new BillingProviderError({ message: `${message}: timed out`, kind: "timeout" }),
    }),
  );

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
     * Only for its buyer (or any owner once the buyer is gone): the portal
     * shows their card and invoices.
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
     * price for `interval`, with the workspace and buyer in its custom data.
     * The caller has checked the user is an owner; this checks again.
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
            const prices = yield* loadProPriceIds;
            const picked = yield* pickRow(organizationId, new Date(), prices).pipe(
              Effect.provideService(Db, db),
            );
            const row = picked?.row;
            if (!row || row.provider !== PADDLE) {
              return yield* new NotFound({ message: "This workspace has no subscription yet." });
            }
            if (picked.buyerEmail && row.userId !== userId) {
              return yield* new Forbidden({
                message: "Only the person who subscribed can manage this subscription.",
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
            const owner = yield* use((d) =>
              d.execute<{ owner: boolean }>(sql`select exists (select 1 from member
                where organization_id = ${request.organizationId} and user_id = ${request.userId}
                and role = 'owner') as owner`),
            );
            if (owner[0]?.owner !== true) {
              return yield* new Forbidden({ message: "Only the workspace owner can upgrade it." });
            }
            const { plan } = yield* withDeps(workspacePlan(request.organizationId));
            if (plan === "pro") {
              return yield* new Conflict({ message: "This workspace is already on Pro." });
            }
            return yield* providerCall("Paddle checkout request failed", (signal) =>
              createPaddleCheckoutTransaction({
                environment: config.environment,
                apiKey: Redacted.value(config.apiKey),
                priceId: config.prices[request.interval],
                email: request.email,
                customData: { workspaceId: request.organizationId, userId: request.userId },
                signal,
              }),
            );
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
