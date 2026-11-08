import {
  and,
  billingEvents,
  billingSubscriptions,
  desc,
  eq,
  organization,
  sql,
  type BillingSubscription,
} from "@receipt-ocr/db";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import type { Tx } from "../audit";
import { BillingProviderError, NotConfigured, NotFound, type DbError } from "../errors";
import { billingApplyJob } from "../jobs/billing-apply-job";
import { enqueueJob } from "../jobs/queue";
import { DEFAULT_PLAN, policyFor, type PlanId, type PlanPolicy } from "../plans";
import { Db } from "../services";
import { Settings } from "../settings";
import { annotateEvent } from "../telemetry/current";
import { PADDLE_ENV_KEYS, parsePaddleConfig, type PaddleConfig } from "./config";
import {
  isEntitled,
  PAST_DUE_GRACE_DAYS,
  PAST_DUE_GRACE_MS,
  workspaceLimitMessage,
} from "./entitlement";
import {
  createPaddlePortalSession,
  PADDLE,
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

// ---------- Plan resolution ----------

const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;

/** `isEntitled` over `billing_subscriptions` aliased `s`. */
export const entitledSql = (now: Date) => sql`(
  (s.status in ('active', 'trialing') and (not s.cancel_at_period_end or s.current_period_end is null or s.current_period_end > ${ts(now)}))
  or (s.status = 'past_due' and s.past_due_since > ${ts(new Date(now.getTime() - PAST_DUE_GRACE_MS))})
  or (s.status = 'canceled' and s.cancel_at_period_end and s.current_period_end > ${ts(now)})
)`;

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
      db.execute<{ pro: boolean }>(sql`select (
        exists (select 1 from billing_subscriptions s
          where s.organization_id = ${organizationId} and ${entitledSql(now)})
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
    const rows = yield* use((db) =>
      db.execute<{ pro: boolean }>(sql`select (
        exists (select 1 from "user" u where u.id = ${userId} and u.plan = 'pro')
        or exists (select 1 from member m join billing_subscriptions s on s.organization_id = m.organization_id
          where m.user_id = ${userId} and m.role = 'owner' and ${entitledSql(now)})
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

export type ApplyOutcome =
  /** The event was applied before (a job retried after its commit). */
  | "already-applied"
  | "applied"
  /** Older than the stored snapshot of its subscription: kept in the log, not applied. */
  | "stale"
  /** Carries no subscription state. */
  | "ignored"
  /** Names no workspace we know, and no stored subscription links one. */
  | "unmatched";

/** Second key of the advisory lock namespace that serializes one subscription's writes. */
const SUBSCRIPTION_LOCK_NAMESPACE = 7_303;

/**
 * Applies one stored event to its subscription row. Out-of-order delivery is
 * handled by the provider's `updated_at`: a snapshot older than the stored one
 * is skipped. The workspace comes from the stored row once there is one; the
 * checkout's custom data only links a new subscription, and only to a
 * workspace that exists.
 */
export const applyBillingEvent = (eventId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(billingEvents)
          .where(eq(billingEvents.id, eventId))
          .for("update")
          .limit(1);
        if (!row) return { outcome: "ignored" as ApplyOutcome, organizationId: null };
        if (row.processedAt) {
          return { outcome: "already-applied" as ApplyOutcome, organizationId: row.organizationId };
        }
        const finish = async (outcome: ApplyOutcome, organizationId: string | null) => {
          await tx
            .update(billingEvents)
            .set({
              outcome: outcome === "already-applied" ? "applied" : outcome,
              organizationId,
              processedAt: new Date(),
            })
            .where(eq(billingEvents.id, eventId));
          return { outcome, organizationId };
        };
        const event = billingEventSchema.parse(row.payload);
        const snapshot = event.subscription;
        if (!snapshot) return finish("ignored", row.organizationId);

        await tx.execute(
          sql`select pg_advisory_xact_lock(${SUBSCRIPTION_LOCK_NAMESPACE}, hashtext(${`${event.provider}:${snapshot.subscriptionId}`}))`,
        );
        const [stored] = await tx
          .select()
          .from(billingSubscriptions)
          .where(
            and(
              eq(billingSubscriptions.provider, event.provider),
              eq(billingSubscriptions.providerSubscriptionId, snapshot.subscriptionId),
            ),
          )
          .limit(1);

        let organizationId = stored?.organizationId ?? null;
        if (!stored && snapshot.workspaceId) {
          const [org] = await tx
            .select({ id: organization.id })
            .from(organization)
            .where(eq(organization.id, snapshot.workspaceId))
            .limit(1);
          organizationId = org?.id ?? null;
        }
        if (!stored && !organizationId) return finish("unmatched", null);
        if (stored && stored.providerUpdatedAt > snapshot.updatedAt) {
          return finish("stale", organizationId);
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
            userId: snapshot.userId ? await existingUser(tx, snapshot.userId) : null,
            provider: event.provider,
            providerSubscriptionId: snapshot.subscriptionId,
          });
        }
        return finish("applied", organizationId);
      }),
    ),
  );

/** The buyer's id from custom data, if that user still exists (the FK would refuse it otherwise). */
async function existingUser(tx: Tx, userId: string): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(
    sql`select id from "user" where id = ${userId} limit 1`,
  );
  return rows[0]?.id ?? null;
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
};

const pickRow = (organizationId: string, now: Date) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<BillingSubscription | null> => {
      // A workspace has one subscription, or a few after a cancel and a re-subscribe.
      const rows = await db
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.organizationId, organizationId))
        .orderBy(desc(billingSubscriptions.providerUpdatedAt))
        .limit(20);
      return rows.find((row) => isEntitled(entitlementOf(row), now)) ?? rows[0] ?? null;
    }),
  );

const entitlementOf = (row: BillingSubscription) => ({
  status: row.status as BillingStatus,
  cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  currentPeriodEnd: row.currentPeriodEnd,
  pastDueSince: row.pastDueSince,
});

/** The workspace's current subscription (an entitling one first, else the latest), or null. */
export const workspaceBilling = (organizationId: string, now = new Date()) =>
  Effect.map(pickRow(organizationId, now), (row): WorkspaceBilling | null => {
    if (!row) return null;
    const fields = entitlementOf(row);
    const status = fields.status;
    return {
      status,
      interval:
        row.billingInterval === "month" || row.billingInterval === "year"
          ? row.billingInterval
          : null,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      graceEndsAt:
        status === "past_due" && row.pastDueSince
          ? new Date(row.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000)
          : null,
      entitled: isEntitled(fields, now),
    };
  });

/**
 * What the browser needs to open a checkout, or null while billing is off.
 * Reads env only (no database), so marketing pages can call it at build time.
 */
export const loadCheckoutConfig: Effect.Effect<CheckoutConfig | null> = Effect.map(
  loadPaddleConfig,
  Option.match({
    onNone: () => null,
    onSome: (config) => ({
      provider: PADDLE,
      environment: config.environment,
      clientToken: config.clientToken,
      prices: config.prices,
    }),
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
    /** Short-lived customer portal links for the workspace's subscription. */
    readonly portalLinks: (
      organizationId: string,
    ) => Effect.Effect<PortalLinks, NotConfigured | NotFound | BillingProviderError | DbError>;
  }
>() {
  static readonly Live = Layer.effect(
    Billing,
    Effect.gen(function* () {
      const db = yield* Db;
      const config = Option.getOrNull(yield* loadPaddleConfig);
      const off = new NotConfigured({ message: "Billing is not configured" });
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
                subscription_id: event.subscription?.subscriptionId ?? null,
                status: event.subscription?.status ?? null,
              },
            });
            return yield* recordBillingEvent(event).pipe(Effect.provideService(Db, db));
          });
        },

        portalLinks: (organizationId) => {
          if (!config) return Effect.fail(off);
          return Effect.gen(function* () {
            const row = yield* pickRow(organizationId, new Date()).pipe(
              Effect.provideService(Db, db),
            );
            if (!row || row.provider !== PADDLE) {
              return yield* new NotFound({ message: "This workspace has no subscription yet." });
            }
            return yield* Effect.tryPromise({
              try: (signal) =>
                createPaddlePortalSession({
                  environment: config.environment,
                  apiKey: Redacted.value(config.apiKey),
                  customerId: row.providerCustomerId,
                  subscriptionId: row.providerSubscriptionId,
                  signal,
                }),
              catch: (cause) =>
                new BillingProviderError({ message: "Paddle portal request failed", cause }),
            }).pipe(
              Effect.timeoutFail({
                duration: "10 seconds",
                onTimeout: () => new BillingProviderError({ message: "Paddle portal timed out" }),
              }),
            );
          });
        },
      };
    }),
  );
}
