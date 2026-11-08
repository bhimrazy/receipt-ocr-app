/**
 * Billing and plan-quota rules against real Postgres and S3 (RustFS locally).
 * Skipped unless INTEGRATION=1; see receipts.int.test.ts for the setup. No
 * network: events are built in the provider-neutral shape the Paddle adapter
 * produces (its parsing and signatures are unit-tested in paddle.test.ts).
 */
import {
  billingEvents,
  billingSubscriptions,
  eq,
  jobs,
  member,
  ocrCalls,
  ocrRounds,
  organization,
  sql,
  user,
} from "@receipt-ocr/db";
import { Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppLayer, type AppServices } from "../index";
import { JOB_REGISTRY, tick } from "../jobs";
import { ingestUpload, purgeReceiptFiles } from "../pipeline";
import { DEFAULT_PLANS } from "../plans";
import { checkQuota, quotaLimits, type QuotaLimits } from "../quota";
import { Db } from "../services";
import { ensurePersonalWorkspace } from "../workspace";
import { deleteWorkspace, prepareUserDeletion, workspacesBlockingDeletion } from "../admin";
import type { AdjustmentSnapshot, BillingEvent, SubscriptionSnapshot } from "./provider";
import {
  accountPlan,
  applyBillingEvent,
  recordBillingEvent,
  userPaysForWorkspace,
  workspaceBilling,
  workspaceCreationCheck,
  workspaceHasChargingSubscription,
  workspacePlan,
} from "./service";

const enabled = process.env.INTEGRATION === "1";
// The Pro prices this suite's subscriptions pay; anything else must not grant Pro.
process.env.PADDLE_PRICE_PRO_MONTHLY = "pri_month";
process.env.PADDLE_PRICE_PRO_YEARLY = "pri_year";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const runExit = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromiseExit(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `bill-${Date.now()}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
let seq = 0;
/** Each workspace's owner: a checkout's custom data names them as the buyer. */
const owners = new Map<string, string>();

async function createUser(name: string) {
  const id = `${tag}-${name}`;
  await db((d) =>
    d.insert(user).values({ id, name, email: `${id}@example.com`, emailVerified: true }),
  );
  const orgId = await run(ensurePersonalWorkspace({ id, name, email: `${id}@example.com` }));
  if (!orgId) throw new Error("no workspace");
  owners.set(orgId, id);
  return { userId: id, organizationId: orgId, role: "owner" };
}

/** A second workspace the user owns, created the way Better Auth would. */
async function createWorkspace(ownerId: string, name: string) {
  const id = crypto.randomUUID();
  await db(async (d) => {
    await d
      .insert(organization)
      .values({ id, name, slug: `${tag}-${name}-${id.slice(0, 6)}`, createdAt: new Date() });
    await d.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: id,
      userId: ownerId,
      role: "owner",
      createdAt: new Date(),
    });
  });
  owners.set(id, ownerId);
  return id;
}

async function addMember(organizationId: string, userId: string) {
  await db((d) =>
    d.insert(member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "member",
      createdAt: new Date(),
    }),
  );
  return { organizationId, userId, role: "member" };
}

/** A snapshot whose custom data names the workspace's owner as the buyer, unless `userId` is given. */
const snapshot = (fields: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => ({
  subscriptionId: `sub_${tag}`,
  customerId: `ctm_${tag}`,
  status: "active",
  priceId: "pri_month",
  interval: "month",
  currentPeriodStart: new Date(Date.now() - 86_400_000),
  currentPeriodEnd: new Date(Date.now() + 29 * 86_400_000),
  cancelAtPeriodEnd: false,
  canceledAt: null,
  updatedAt: new Date(),
  workspaceId: null,
  userId: (fields.workspaceId && owners.get(fields.workspaceId)) || null,
  ...fields,
});

const event = (
  subscription: SubscriptionSnapshot | null,
  type = "subscription.updated",
  adjustment: AdjustmentSnapshot | null = null,
) => {
  seq += 1;
  return {
    provider: "paddle",
    eventId: `evt_${tag}_${seq}`,
    type,
    occurredAt: new Date(),
    subscription,
    adjustment,
  } satisfies BillingEvent;
};

const subscriptionRow = async (providerSubscriptionId: string) =>
  (
    await db((d) =>
      d
        .select()
        .from(billingSubscriptions)
        .where(eq(billingSubscriptions.providerSubscriptionId, providerSubscriptionId)),
    )
  )[0];

const jobOf = async (eventId: string) => {
  const [row] = await db((d) =>
    d
      .select({ id: billingEvents.id })
      .from(billingEvents)
      .where(eq(billingEvents.providerEventId, eventId)),
  );
  const [job] = await db((d) =>
    d
      .select()
      .from(jobs)
      .where(eq(jobs.idempotencyKey, `billing:event:${row!.id}`)),
  );
  return job;
};

/** Records an event and runs its job through the queue, as the webhook route and drain do. */
async function deliver(e: BillingEvent) {
  const result = await run(recordBillingEvent(e));
  if (result.kind !== "recorded") return result;
  await run(
    tick({
      worker: `${tag}-worker`,
      registry: JOB_REGISTRY,
      budgetMs: 30_000,
      ids: [result.jobId],
      waitForRetries: false,
    }),
  );
  return result;
}

const outcomeOf = async (eventId: string) =>
  (
    await db((d) =>
      d
        .select({ outcome: billingEvents.outcome })
        .from(billingEvents)
        .where(eq(billingEvents.providerEventId, eventId)),
    )
  )[0]?.outcome;

/** Applies an already delivered event again, as a job retry after its commit would. */
const reapply = async (eventId: string) => {
  const [row] = await db((d) =>
    d
      .select({ id: billingEvents.id })
      .from(billingEvents)
      .where(eq(billingEvents.providerEventId, eventId)),
  );
  return run(applyBillingEvent(row!.id));
};

const planOf = async (organizationId: string) => (await run(workspacePlan(organizationId))).plan;

describe.skipIf(!enabled)("billing against Postgres", () => {
  let owner: Awaited<ReturnType<typeof createUser>>;
  let other: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    owner = await createUser("owner");
    other = await createUser("other");
  });

  afterAll(async () => {
    for (const u of [owner, other])
      await run(purgeReceiptFiles({ organizationId: u.organizationId }));
    await db(async (d) => {
      await d.delete(ocrCalls).where(sql`${ocrCalls.userId} like ${`${tag}%`}`);
      await d.delete(ocrRounds).where(sql`${ocrRounds.userId} like ${`${tag}%`}`);
      await d
        .delete(jobs)
        .where(sql`${jobs.userId} like ${`${tag}%`} or ${jobs.idempotencyKey} like 'billing:%'`);
      await d
        .delete(billingEvents)
        .where(sql`${billingEvents.providerEventId} like ${`evt_${tag}%`}`);
      await d
        .delete(billingSubscriptions)
        .where(sql`${billingSubscriptions.providerSubscriptionId} like ${`sub_${tag}%`}`);
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await runtime.dispose();
  });

  describe("webhook events", () => {
    it("stores an event once: a redelivery is a no-op and enqueues nothing", async () => {
      const workspaceId = await createWorkspace(other.userId, "dup");
      const e = event(snapshot({ subscriptionId: `sub_${tag}_dup`, workspaceId }));
      const first = await run(recordBillingEvent(e));
      const second = await run(recordBillingEvent(e));
      expect(first.kind).toBe("recorded");
      expect(second.kind).toBe("duplicate");
      const rows = await db((d) =>
        d.select().from(billingEvents).where(eq(billingEvents.providerEventId, e.eventId)),
      );
      expect(rows).toHaveLength(1);
      const queued = await db((d) =>
        d
          .select()
          .from(jobs)
          .where(eq(jobs.idempotencyKey, `billing:event:${rows[0]!.id}`)),
      );
      expect(queued).toHaveLength(1);
      // Applying it twice (a job retried after its commit) changes nothing either.
      expect((await run(applyBillingEvent(rows[0]!.id))).outcome).toBe("applied");
      expect((await run(applyBillingEvent(rows[0]!.id))).outcome).toBe("already-applied");
    });

    it("applies events in provider order: an older snapshot arriving late is stale", async () => {
      const id = `sub_${tag}_order`;
      const workspaceId = await createWorkspace(other.userId, "order");
      const t0 = new Date(Date.now() - 60_000);
      const t1 = new Date(Date.now() - 30_000);
      const canceled = event(
        snapshot({ subscriptionId: id, workspaceId, status: "canceled", updatedAt: t1 }),
        "subscription.canceled",
      );
      const created = event(
        snapshot({ subscriptionId: id, workspaceId, updatedAt: t0 }),
        "subscription.created",
      );
      await deliver(canceled);
      await deliver(created);
      expect(await outcomeOf(canceled.eventId)).toBe("applied");
      expect(await outcomeOf(created.eventId)).toBe("stale");
      const [row] = await db((d) =>
        d
          .select()
          .from(billingSubscriptions)
          .where(eq(billingSubscriptions.providerSubscriptionId, id)),
      );
      expect(row?.status).toBe("canceled");
      expect(await planOf(workspaceId)).toBe("free");
    });

    it("links a subscription only to a workspace that exists, and keeps the first link", async () => {
      const lost = event(
        snapshot({ subscriptionId: `sub_${tag}_lost`, workspaceId: "no-such-workspace" }),
      );
      await deliver(lost);
      expect(await outcomeOf(lost.eventId)).toBe("unmatched");

      const id = `sub_${tag}_link`;
      const workspaceId = await createWorkspace(other.userId, "link");
      await deliver(event(snapshot({ subscriptionId: id, workspaceId })));
      // A later event naming another workspace doesn't move the subscription.
      await deliver(
        event(
          snapshot({
            subscriptionId: id,
            workspaceId: owner.organizationId,
            updatedAt: new Date(Date.now() + 1000),
          }),
        ),
      );
      const [row] = await db((d) =>
        d
          .select()
          .from(billingSubscriptions)
          .where(eq(billingSubscriptions.providerSubscriptionId, id)),
      );
      expect(row?.organizationId).toBe(workspaceId);
    });

    it("ignores a completed transaction: its subscription's own events carry the state", async () => {
      const e = event(null, "transaction.completed");
      await deliver(e);
      expect(await outcomeOf(e.eventId)).toBe("ignored");
    });
  });

  describe("plan per workspace", () => {
    it("is Pro while subscribed, through past_due grace and a cancel at period end, then Free", async () => {
      const workspaceId = await createWorkspace(other.userId, "lifecycle");
      const id = `sub_${tag}_life`;
      const step = (offsetMs: number, fields: Partial<SubscriptionSnapshot>) =>
        deliver(
          event(
            snapshot({
              subscriptionId: id,
              workspaceId,
              updatedAt: new Date(Date.now() + offsetMs),
              ...fields,
            }),
          ),
        );
      expect(await planOf(workspaceId)).toBe("free");
      await step(0, {});
      expect(await planOf(workspaceId)).toBe("pro");
      // Each applied event reports a plan change only when it moves the workspace.
      const applyAgain = async (fields: Partial<SubscriptionSnapshot>, offsetMs: number) => {
        const e = event(
          snapshot({
            subscriptionId: id,
            workspaceId,
            updatedAt: new Date(Date.now() + offsetMs),
            ...fields,
          }),
        );
        const recorded = await run(recordBillingEvent(e));
        if (recorded.kind !== "recorded") throw new Error("not recorded");
        const [row] = await db((d) =>
          d
            .select({ id: billingEvents.id })
            .from(billingEvents)
            .where(eq(billingEvents.providerEventId, e.eventId)),
        );
        return run(applyBillingEvent(row!.id));
      };
      expect(await applyAgain({}, 500)).not.toHaveProperty("planChange");
      await step(1_000, { status: "past_due" });
      expect(await planOf(workspaceId)).toBe("pro");
      expect((await run(workspaceBilling(workspaceId)))?.graceEndsAt).toBeInstanceOf(Date);
      await step(2_000, { status: "active", cancelAtPeriodEnd: true });
      expect(await planOf(workspaceId)).toBe("pro");
      expect(await run(workspaceBilling(workspaceId))).toMatchObject({
        cancelAtPeriodEnd: true,
        entitled: true,
      });
      expect(
        await applyAgain({ status: "canceled", cancelAtPeriodEnd: false }, 3_000),
      ).toMatchObject({
        outcome: "applied",
        planChange: { from: "pro", to: "free" },
      });
      expect(await planOf(workspaceId)).toBe("free");
      expect(await applyAgain({ status: "active" }, 4_000)).toMatchObject({
        planChange: { from: "free", to: "pro" },
      });
    });

    it("covers exactly one workspace: the owner's other and new workspaces stay Free", async () => {
      const paid = await createWorkspace(owner.userId, "paid");
      await deliver(event(snapshot({ subscriptionId: `sub_${tag}_one`, workspaceId: paid })));
      expect(await planOf(paid)).toBe("pro");
      expect(await planOf(owner.organizationId)).toBe("free");
      const later = await createWorkspace(owner.userId, "later");
      expect(await planOf(later)).toBe("free");
      // Owning a Pro workspace lifts only the ownership cap.
      expect((await run(accountPlan(owner.userId))).plan).toBe("pro");
    });

    it("caps owned workspaces at 1 on Free and 2 on Pro", async () => {
      const solo = await createUser("solo");
      expect(await run(workspaceCreationCheck(solo.userId))).toMatchObject({
        allowed: false,
        owned: 1,
        limit: 1,
      });
      await deliver(
        event(snapshot({ subscriptionId: `sub_${tag}_cap`, workspaceId: solo.organizationId })),
      );
      expect(await run(workspaceCreationCheck(solo.userId))).toMatchObject({
        allowed: true,
        owned: 1,
        limit: 2,
      });
      await createWorkspace(solo.userId, "second");
      const full = await run(workspaceCreationCheck(solo.userId));
      expect(full).toMatchObject({ allowed: false, owned: 2, limit: 2 });
      expect(full.message).toContain("2 workspaces");
    });

    it("keeps an admin comp (user.plan = pro) working without any subscription", async () => {
      const comped = await createUser("comped");
      await db((d) => d.update(user).set({ plan: "pro" }).where(eq(user.id, comped.userId)));
      expect(await planOf(comped.organizationId)).toBe("pro");
    });
  });

  describe("linking needs a Pro price and an owner as buyer", () => {
    it("leaves a subscription at another price unmatched, and the workspace Free", async () => {
      const workspaceId = await createWorkspace(other.userId, "cheap");
      const e = event(
        snapshot({ subscriptionId: `sub_${tag}_cheap`, workspaceId, priceId: "pri_other" }),
      );
      await deliver(e);
      expect(await outcomeOf(e.eventId)).toBe("unmatched");
      expect(await subscriptionRow(`sub_${tag}_cheap`)).toBeUndefined();
      expect(await planOf(workspaceId)).toBe("free");
    });

    it("leaves a subscription bought by a member, or naming no buyer, unmatched", async () => {
      const boss = await createUser("link-boss");
      const mate = await createUser("link-mate");
      await addMember(boss.organizationId, mate.userId);
      const byMember = event(
        snapshot({
          subscriptionId: `sub_${tag}_bymember`,
          workspaceId: boss.organizationId,
          userId: mate.userId,
        }),
      );
      const byNobody = event(
        snapshot({
          subscriptionId: `sub_${tag}_bynobody`,
          workspaceId: boss.organizationId,
          userId: null,
        }),
      );
      await deliver(byMember);
      await deliver(byNobody);
      expect(await outcomeOf(byMember.eventId)).toBe("unmatched");
      expect(await outcomeOf(byNobody.eventId)).toBe("unmatched");
      expect(await planOf(boss.organizationId)).toBe("free");
      // The owner's own checkout links as usual.
      await deliver(
        event(snapshot({ subscriptionId: `sub_${tag}_byowner`, workspaceId: boss.organizationId })),
      );
      expect(await planOf(boss.organizationId)).toBe("pro");
      expect((await subscriptionRow(`sub_${tag}_byowner`))?.userId).toBe(boss.userId);
    });

    it("stops granting Pro when a linked subscription moves to a price that isn't Pro", async () => {
      const workspaceId = await createWorkspace(other.userId, "reprice");
      const id = `sub_${tag}_reprice`;
      await deliver(event(snapshot({ subscriptionId: id, workspaceId })));
      expect(await planOf(workspaceId)).toBe("pro");
      await deliver(
        event(
          snapshot({
            subscriptionId: id,
            workspaceId,
            priceId: "pri_other",
            updatedAt: new Date(Date.now() + 1000),
          }),
        ),
      );
      expect(await planOf(workspaceId)).toBe("free");
      expect((await run(workspaceBilling(workspaceId)))?.entitled).toBe(false);
    });
  });

  describe("refunds and chargebacks", () => {
    const adjustment = (fields: Partial<AdjustmentSnapshot>): AdjustmentSnapshot => ({
      adjustmentId: `adj_${tag}_${seq}`,
      action: "chargeback",
      type: "full",
      status: "approved",
      subscriptionId: null,
      transactionId: `txn_${tag}`,
      ...fields,
    });

    it("ends Pro at once on an approved chargeback and asks for the provider cancel", async () => {
      const workspaceId = await createWorkspace(other.userId, "charged-back");
      const id = `sub_${tag}_chargeback`;
      await deliver(event(snapshot({ subscriptionId: id, workspaceId })));
      expect(await planOf(workspaceId)).toBe("pro");

      const warning = event(
        null,
        "adjustment.created",
        adjustment({ action: "chargeback_warning", subscriptionId: id }),
      );
      await deliver(warning);
      expect(await outcomeOf(warning.eventId)).toBe("ignored");
      expect(await planOf(workspaceId)).toBe("pro");

      const chargeback = event(null, "adjustment.created", adjustment({ subscriptionId: id }));
      const recorded = await run(recordBillingEvent(chargeback));
      if (recorded.kind !== "recorded") throw new Error("not recorded");
      const [stored] = await db((d) =>
        d
          .select({ id: billingEvents.id })
          .from(billingEvents)
          .where(eq(billingEvents.providerEventId, chargeback.eventId)),
      );
      expect(await run(applyBillingEvent(stored!.id))).toMatchObject({
        outcome: "applied",
        organizationId: workspaceId,
        planChange: { from: "pro", to: "free" },
        cancelSubscriptionId: id,
      });
      // A retry after the commit still owes the cancel until Paddle reports it canceled.
      expect(await run(applyBillingEvent(stored!.id))).toMatchObject({
        outcome: "already-applied",
        cancelSubscriptionId: id,
      });
      expect(await planOf(workspaceId)).toBe("free");
      expect(await run(workspaceBilling(workspaceId))).toMatchObject({
        entitled: false,
        revoked: true,
      });
      // A later renewal snapshot doesn't bring Pro back.
      await deliver(
        event(
          snapshot({ subscriptionId: id, workspaceId, updatedAt: new Date(Date.now() + 1000) }),
        ),
      );
      expect(await planOf(workspaceId)).toBe("free");
    });

    it("ends Pro on a full refund, not a partial one, and dead-letters the cancel while billing is off", async () => {
      const workspaceId = await createWorkspace(other.userId, "refunded");
      const id = `sub_${tag}_refund`;
      await deliver(event(snapshot({ subscriptionId: id, workspaceId })));
      const partial = event(
        null,
        "adjustment.updated",
        adjustment({ action: "refund", type: "partial", subscriptionId: id }),
      );
      await deliver(partial);
      expect(await outcomeOf(partial.eventId)).toBe("ignored");
      expect(await planOf(workspaceId)).toBe("pro");

      const full = event(
        null,
        "adjustment.updated",
        adjustment({ action: "refund", type: "full", subscriptionId: id }),
      );
      await deliver(full);
      expect(await outcomeOf(full.eventId)).toBe("applied");
      expect(await planOf(workspaceId)).toBe("free");
      // This suite has no PADDLE_API_KEY: the cancel can't be sent, and the job says so.
      expect(await jobOf(full.eventId)).toMatchObject({
        state: "dead",
        lastErrorKind: "billing-off",
      });
    });

    it("keeps a chargeback that arrives before its subscription and applies it on link", async () => {
      const workspaceId = await createWorkspace(other.userId, "early-chargeback");
      const id = `sub_${tag}_early_chargeback`;
      const chargeback = event(null, "adjustment.created", adjustment({ subscriptionId: id }));
      await deliver(chargeback);
      expect(await outcomeOf(chargeback.eventId)).toBe("unmatched");

      const created = event(snapshot({ subscriptionId: id, workspaceId }), "subscription.created");
      await deliver(created);
      expect(await planOf(workspaceId)).toBe("free");
      expect((await subscriptionRow(id))?.revokedAt).toBeInstanceOf(Date);
      expect(await outcomeOf(chargeback.eventId)).toBe("applied");
      // The cancel was asked for: with no PADDLE_API_KEY here, the job says it couldn't send it.
      expect(await jobOf(created.eventId)).toMatchObject({
        state: "dead",
        lastErrorKind: "billing-off",
      });
      expect(await reapply(created.eventId)).toMatchObject({
        outcome: "already-applied",
        cancelSubscriptionId: id,
      });
    });

    it("applies an early chargeback only to its own subscription", async () => {
      const workspaceId = await createWorkspace(other.userId, "other-sub-links");
      const early = event(
        null,
        "adjustment.created",
        adjustment({ subscriptionId: `sub_${tag}_never_linked` }),
      );
      await deliver(early);
      const id = `sub_${tag}_unrelated`;
      const created = event(snapshot({ subscriptionId: id, workspaceId }), "subscription.created");
      await deliver(created);
      expect((await subscriptionRow(id))?.revokedAt).toBeNull();
      expect(await planOf(workspaceId)).toBe("pro");
      expect(await outcomeOf(early.eventId)).toBe("unmatched");
      expect(await jobOf(created.eventId)).toMatchObject({ state: "succeeded" });
    });
  });

  describe("bad payloads", () => {
    it("sends a stored event the schema refuses straight to dead", async () => {
      const e = event(snapshot({ subscriptionId: `sub_${tag}_bad` }));
      const recorded = await run(recordBillingEvent(e));
      if (recorded.kind !== "recorded") throw new Error("not recorded");
      await db((d) =>
        d
          .update(billingEvents)
          .set({ payload: { nonsense: true } })
          .where(eq(billingEvents.providerEventId, e.eventId)),
      );
      await run(
        tick({
          worker: `${tag}-worker`,
          registry: JOB_REGISTRY,
          budgetMs: 30_000,
          ids: [recorded.jobId],
          waitForRetries: false,
        }),
      );
      expect(await jobOf(e.eventId)).toMatchObject({
        state: "dead",
        attempts: 1,
        lastErrorKind: "bad-payload",
      });
    });
  });

  describe("deletion while a subscription can still charge", () => {
    it("refuses the account and the workspace until the subscription is canceled", async () => {
      const buyer = await createUser("del-buyer");
      const id = `sub_${tag}_delete`;
      await deliver(event(snapshot({ subscriptionId: id, workspaceId: buyer.organizationId })));
      const later = (offsetMs: number, fields: Partial<SubscriptionSnapshot>) =>
        deliver(
          event(
            snapshot({
              subscriptionId: id,
              workspaceId: buyer.organizationId,
              updatedAt: new Date(Date.now() + offsetMs),
              ...fields,
            }),
          ),
        );

      expect(await run(workspacesBlockingDeletion(buyer.userId))).toEqual({
        soleOwner: [],
        subscribed: [{ id: buyer.organizationId, name: expect.any(String) }],
      });
      expect(await run(workspaceHasChargingSubscription(buyer.organizationId))).toBe(true);
      const refused = await runExit(prepareUserDeletion(buyer.userId));
      expect(Exit.isFailure(refused) && JSON.stringify(refused.cause)).toContain("Conflict");
      const auditor = { actor: { id: other.userId, email: `${other.userId}@example.com` } };
      expect(Exit.isFailure(await runExit(deleteWorkspace(buyer.organizationId, auditor)))).toBe(
        true,
      );

      // Past due after the grace period and paused still charge (or can resume): still refused.
      await later(1_000, { status: "past_due" });
      await db((d) =>
        d
          .update(billingSubscriptions)
          .set({ pastDueSince: new Date(Date.now() - 30 * 86_400_000) })
          .where(eq(billingSubscriptions.providerSubscriptionId, id)),
      );
      expect(await planOf(buyer.organizationId)).toBe("free");
      expect(await run(workspaceHasChargingSubscription(buyer.organizationId))).toBe(true);
      await later(2_000, { status: "paused" });
      expect(await run(workspaceHasChargingSubscription(buyer.organizationId))).toBe(true);

      // A cancel scheduled for the period end charges nothing more: allowed.
      await later(3_000, { status: "active", cancelAtPeriodEnd: true });
      expect(await run(workspaceHasChargingSubscription(buyer.organizationId))).toBe(false);
      await later(4_000, { status: "canceled", cancelAtPeriodEnd: false });
      expect((await run(workspacesBlockingDeletion(buyer.userId))).subscribed).toEqual([]);
      expect(await run(prepareUserDeletion(buyer.userId))).toMatchObject({ workspacesDeleted: 1 });
      // The subscription row stays as the billing record.
      expect((await subscriptionRow(id))?.organizationId).toBeNull();
    });

    it("never cancels a linked subscription, whatever its state", async () => {
      const workspaceId = await createWorkspace(other.userId, "linked-charging");
      const id = `sub_${tag}_linked_charging`;
      const steps: Partial<SubscriptionSnapshot>[] = [
        {},
        { cancelAtPeriodEnd: true },
        { status: "past_due", cancelAtPeriodEnd: false },
      ];
      for (const [i, fields] of steps.entries()) {
        const e = event(
          snapshot({
            subscriptionId: id,
            workspaceId,
            updatedAt: new Date(Date.now() + i * 1_000),
            ...fields,
          }),
          i === 0 ? "subscription.created" : "subscription.updated",
        );
        await deliver(e);
        expect(await jobOf(e.eventId)).toMatchObject({ state: "succeeded" });
        expect(await reapply(e.eventId)).not.toHaveProperty("cancelSubscriptionId");
      }
    });

    it("cancels a subscription whose workspace is gone if its scheduled cancel is removed", async () => {
      const buyer = await createUser("del-scheduled");
      const id = `sub_${tag}_delete_scheduled`;
      const at = (offsetMs: number, fields: Partial<SubscriptionSnapshot>) =>
        event(
          snapshot({
            subscriptionId: id,
            workspaceId: buyer.organizationId,
            updatedAt: new Date(Date.now() + offsetMs),
            ...fields,
          }),
        );
      await deliver(at(0, {}));
      await deliver(at(1_000, { cancelAtPeriodEnd: true }));
      const auditor = { actor: { id: other.userId, email: `${other.userId}@example.com` } };
      await run(deleteWorkspace(buyer.organizationId, auditor));
      expect((await subscriptionRow(id))?.organizationId).toBeNull();

      const rearmed = at(2_000, { cancelAtPeriodEnd: false });
      await deliver(rearmed);
      expect(await jobOf(rearmed.eventId)).toMatchObject({
        state: "dead",
        lastErrorKind: "billing-off",
      });
      expect(await reapply(rearmed.eventId)).toMatchObject({
        outcome: "already-applied",
        cancelSubscriptionId: id,
      });
      // Once it's canceled nothing more is asked.
      const canceled = at(3_000, { status: "canceled" });
      await deliver(canceled);
      expect(await jobOf(canceled.eventId)).toMatchObject({ state: "succeeded" });
    });

    it("cancels a subscription whose buyer deleted their account if it can charge again", async () => {
      const buyer = await createUser("del-scheduled-buyer");
      const workspaceId = await createWorkspace(buyer.userId, "kept-after-buyer");
      // A second owner keeps the workspace when the buyer's account goes.
      await db((d) =>
        d.insert(member).values({
          id: crypto.randomUUID(),
          organizationId: workspaceId,
          userId: other.userId,
          role: "owner",
          createdAt: new Date(),
        }),
      );
      const id = `sub_${tag}_buyer_gone`;
      const at = (offsetMs: number, fields: Partial<SubscriptionSnapshot>) =>
        event(
          snapshot({
            subscriptionId: id,
            workspaceId,
            userId: buyer.userId,
            updatedAt: new Date(Date.now() + offsetMs),
            ...fields,
          }),
        );
      await deliver(at(0, { cancelAtPeriodEnd: true }));
      await run(prepareUserDeletion(buyer.userId));
      await db((d) => d.delete(user).where(eq(user.id, buyer.userId)));
      expect(await subscriptionRow(id)).toMatchObject({
        organizationId: workspaceId,
        userId: null,
      });

      const rearmed = at(1_000, { cancelAtPeriodEnd: false });
      await deliver(rearmed);
      expect(await jobOf(rearmed.eventId)).toMatchObject({
        state: "dead",
        lastErrorKind: "billing-off",
      });
    });
  });

  describe("the buyer and orphaned subscriptions", () => {
    const applyAt = async (id: string, fields: Partial<SubscriptionSnapshot>, offsetMs: number) => {
      const e = event(
        snapshot({ subscriptionId: id, updatedAt: new Date(Date.now() + offsetMs), ...fields }),
      );
      const recorded = await run(recordBillingEvent(e));
      if (recorded.kind !== "recorded") throw new Error("not recorded");
      const [row] = await db((d) =>
        d
          .select({ id: billingEvents.id })
          .from(billingEvents)
          .where(eq(billingEvents.providerEventId, e.eventId)),
      );
      return run(applyBillingEvent(row!.id));
    };

    it("reports the buyer of a charging subscription only, until it can't charge", async () => {
      const buyer = await createUser("pays-buyer");
      const mate = await createUser("pays-mate");
      await addMember(buyer.organizationId, mate.userId);
      const id = `sub_${tag}_pays`;
      const pays = (who: { userId: string }) =>
        run(userPaysForWorkspace(buyer.organizationId, who.userId));
      expect(await pays(buyer)).toBe(false);

      await applyAt(id, { workspaceId: buyer.organizationId }, 0);
      expect(await pays(buyer)).toBe(true);
      expect(await pays(mate)).toBe(false);
      expect(await run(userPaysForWorkspace("another-workspace", buyer.userId))).toBe(false);

      // A scheduled cancel charges nothing more: the buyer may leave.
      await applyAt(id, { workspaceId: buyer.organizationId, cancelAtPeriodEnd: true }, 1_000);
      expect(await pays(buyer)).toBe(false);
      await applyAt(id, { workspaceId: buyer.organizationId, cancelAtPeriodEnd: false }, 2_000);
      expect(await pays(buyer)).toBe(true);
      await applyAt(id, { workspaceId: buyer.organizationId, status: "canceled" }, 3_000);
      expect(await pays(buyer)).toBe(false);
    });

    it("flags an event that keeps an orphaned subscription charging", async () => {
      const buyer = await createUser("orphan-buyer");
      const id = `sub_${tag}_orphan`;
      expect(await applyAt(id, { workspaceId: buyer.organizationId }, 0)).not.toHaveProperty(
        "orphanCharging",
      );
      await db((d) =>
        d
          .update(billingSubscriptions)
          .set({ organizationId: null })
          .where(eq(billingSubscriptions.providerSubscriptionId, id)),
      );
      // Flagged, and cancelled with the provider by the job.
      expect(await applyAt(id, {}, 1_000)).toMatchObject({
        orphanCharging: true,
        cancelSubscriptionId: id,
      });
      // Once it can't charge any more there is nothing to alert on.
      expect(await applyAt(id, { cancelAtPeriodEnd: true }, 2_000)).not.toHaveProperty(
        "orphanCharging",
      );
    });
  });

  describe("quota rules", () => {
    const upload = (
      scope: { organizationId: string; userId: string; role: string },
      limits: QuotaLimits,
    ) => runExit(ingestUpload({ scope, fileName: "r.jpg", body: JPEG, limits }));
    const verdict = (scope: { organizationId: string; userId: string }, limits: QuotaLimits) =>
      run(checkQuota(scope, limits));

    it("counts Free per user across all workspaces, so an extra free workspace adds nothing", async () => {
      const u = await createUser("free-u");
      const host = await createUser("free-host");
      const elsewhere = await addMember(host.organizationId, u.userId);
      const free: QuotaLimits = { plan: "free", perMinute: 100, perDay: 2 };
      expect(Exit.isSuccess(await upload(u, free))).toBe(true);
      expect(Exit.isSuccess(await upload(elsewhere, free))).toBe(true);
      expect(Exit.isFailure(await upload(u, free))).toBe(true);
      expect(Exit.isFailure(await upload(elsewhere, free))).toBe(true);
      expect(await verdict(elsewhere, free)).toMatchObject({
        allowed: false,
        window: "day",
        used: 2,
      });
    });

    it("refuses the scan past Free's monthly limit, across workspaces, saying when it resets and that Pro has more", async () => {
      const u = await createUser("free-month");
      const host = await createUser("free-month-host");
      const elsewhere = await addMember(host.organizationId, u.userId);
      // The 100-a-month rule with a small limit: the 4th scan this month is the "101st".
      const free = quotaLimits("free", {
        ...DEFAULT_PLANS.free,
        receiptsPerDay: 10,
        receiptsPerMonth: 3,
        poolPerDay: null,
      });
      expect(Exit.isSuccess(await upload(u, free))).toBe(true);
      expect(Exit.isSuccess(await upload(elsewhere, free))).toBe(true);
      expect(Exit.isSuccess(await upload(u, free))).toBe(true);
      const refused = await upload(elsewhere, free);
      expect(Exit.isFailure(refused)).toBe(true);
      const message = Exit.isFailure(refused) ? JSON.stringify(refused.cause) : "";
      expect(message).toContain("QuotaExceeded");
      expect(message).toContain("You've used all 3 scans on the Free plan this month.");
      expect(message).toContain("at 00:00 UTC. Upgrade a workspace to Pro for more scans.");
      expect(await verdict(u, free)).toMatchObject({
        window: "month",
        used: 3,
        limit: 3,
        scope: "user",
      });
    });

    it("pools Pro per workspace for all members, apart from their personal Free day", async () => {
      const boss = await createUser("pro-boss");
      const mate = await createUser("pro-mate");
      await deliver(
        event(snapshot({ subscriptionId: `sub_${tag}_pool`, workspaceId: boss.organizationId })),
      );
      const { plan, policy } = await run(workspacePlan(boss.organizationId));
      expect(plan).toBe("pro");
      const pro: QuotaLimits = { ...quotaLimits(plan, policy), perMonth: 3, perDay: 3 };
      const inPro = await addMember(boss.organizationId, mate.userId);
      const free: QuotaLimits = { plan: "free", perMinute: 100, perDay: 2 };

      expect(Exit.isSuccess(await upload(boss, pro))).toBe(true);
      expect(Exit.isSuccess(await upload(inPro, pro))).toBe(true);
      expect(Exit.isSuccess(await upload(boss, pro))).toBe(true);
      // The member's next scan is refused: the pool of 3 is shared.
      expect(Exit.isFailure(await upload(inPro, pro))).toBe(true);
      expect(await verdict(inPro, pro)).toMatchObject({ window: "month", used: 3, limit: 3 });
      // None of those touched the member's own Free day.
      expect(await verdict(mate, free)).toMatchObject({ allowed: true, used: 0 });
      expect(Exit.isSuccess(await upload(mate, free))).toBe(true);
      expect((await verdict(inPro, pro)).used).toBe(3);
    });

    it("caps a Pro workspace's day below its month", async () => {
      const boss = await createUser("pro-daily");
      await deliver(
        event(snapshot({ subscriptionId: `sub_${tag}_daily`, workspaceId: boss.organizationId })),
      );
      const pro: QuotaLimits = {
        ...quotaLimits("pro", DEFAULT_PLANS.pro),
        perDay: 1,
        perMonth: 10,
      };
      expect(Exit.isSuccess(await upload(boss, pro))).toBe(true);
      expect(Exit.isFailure(await upload(boss, pro))).toBe(true);
      expect(await verdict(boss, pro)).toMatchObject({
        window: "day",
        used: 1,
        limit: 10,
        day: { used: 1, limit: 1 },
      });
    });

    it("closes the Free pool for Free users only: Pro workspaces keep scanning", async () => {
      const freeUser = await createUser("pool-free");
      const proUser = await createUser("pool-pro");
      await deliver(
        event(
          snapshot({ subscriptionId: `sub_${tag}_poolcap`, workspaceId: proUser.organizationId }),
        ),
      );
      // Make the pool exactly what Free has used today, platform-wide: it is full.
      const probe = await verdict(freeUser, {
        plan: "free",
        perMinute: 100,
        perDay: 100,
        planPoolPerDay: 1_000_000,
      });
      expect(probe.allowed).toBe(true);
      const [{ used }] = await db((d) =>
        d.execute<{ used: number }>(
          sql`select count(*)::int as used from ocr_rounds where plan = 'free' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
        ),
      );
      const full: QuotaLimits = {
        plan: "free",
        perMinute: 100,
        perDay: 100,
        planPoolPerDay: Math.max(1, used),
      };
      if (used === 0) expect(Exit.isSuccess(await upload(freeUser, full))).toBe(true);
      expect(Exit.isFailure(await upload(freeUser, full))).toBe(true);
      expect(await verdict(freeUser, full)).toMatchObject({ allowed: false, window: "pool" });
      const pro = quotaLimits("pro", DEFAULT_PLANS.pro);
      expect(Exit.isSuccess(await upload(proUser, pro))).toBe(true);
    });
  });
});
