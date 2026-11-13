/**
 * Billing and plan-quota rules against real Postgres and S3 (RustFS locally).
 * Skipped unless INTEGRATION=1; see receipts.int.test.ts for the setup. No
 * network: events are built in the provider-neutral shape the Paddle adapter
 * produces (its parsing and signatures are unit-tested in paddle.test.ts).
 */
import {
  billingCheckouts,
  billingEvents,
  billingSubscriptions,
  eq,
  invitation,
  jobs,
  member,
  ocrCalls,
  ocrRounds,
  organization,
  sql,
  user,
} from "@receipt-ocr/db";
import { Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayer, type AppServices } from "../index";
import { JOB_REGISTRY, tick } from "../jobs";
import { ingestUpload, purgeReceiptFiles } from "../pipeline";
import { DEFAULT_PLANS } from "../plans";
import { checkQuota, quotaLimits, type QuotaLimits } from "../quota";
import { Db } from "../services";
import { ensurePersonalWorkspace } from "../workspace";
import { deleteWorkspace, prepareUserDeletion, workspacesBlockingDeletion } from "../admin";
import { blocksCheckout, PAST_DUE_GRACE_DAYS } from "./entitlement";
import type {
  AdjustmentSnapshot,
  BillingEvent,
  BillingStatus,
  SubscriptionSnapshot,
  TransactionSnapshot,
} from "./provider";
import {
  accountPlan,
  applyBillingEvent,
  Billing,
  BUYER_GONE,
  UNVERIFIED_EMAIL,
  ALREADY_SUBSCRIBED,
  memberLimitCheck,
  recordBillingEvent,
  userPaysForWorkspace,
  workspaceBilling,
  workspaceCheckoutBlocked,
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

/**
 * A snapshot whose custom data names the workspace's owner as the buyer, unless `userId` is given,
 * and whose checkout transaction is `txn_<subscription id>` unless `transactionId` is given.
 */
const snapshot = (fields: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => {
  const subscriptionId = fields.subscriptionId ?? `sub_${tag}`;
  return {
    subscriptionId,
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
    transactionId: `txn_${subscriptionId}`,
    ...fields,
  };
};

/**
 * Records the checkout the server would have created for this snapshot: its transaction, workspace,
 * buyer and customer. Skipped when the workspace or buyer doesn't exist (no checkout could be made).
 */
async function recordCheckout(
  s: SubscriptionSnapshot,
  fields: { customerId?: string; organizationId?: string; userId?: string } = {},
) {
  const organizationId = fields.organizationId ?? s.workspaceId;
  const userId = fields.userId ?? s.userId;
  if (!s.transactionId || !organizationId || !userId) return;
  await db((d) =>
    d.execute(sql`insert into billing_checkouts
      (provider, provider_transaction_id, organization_id, user_id, provider_customer_id, price_id)
      select 'paddle', ${s.transactionId}, ${organizationId}, ${userId},
        ${fields.customerId ?? s.customerId}, 'pri_month'
      where exists (select 1 from organization where id = ${organizationId})
        and exists (select 1 from "user" where id = ${userId})
      on conflict do nothing`),
  );
}

const event = (
  subscription: SubscriptionSnapshot | null,
  type = "subscription.updated",
  adjustment: AdjustmentSnapshot | null = null,
  transaction: TransactionSnapshot | null = null,
) => {
  seq += 1;
  return {
    provider: "paddle",
    eventId: `evt_${tag}_${seq}`,
    type,
    occurredAt: new Date(),
    subscription,
    adjustment,
    transaction,
  } satisfies BillingEvent;
};

/** A completed transaction of `subscriptionId` paying for the period starting `start`. */
const paid = (
  subscriptionId: string,
  transactionId: string,
  start: Date | null,
  origin = "subscription_recurring",
) =>
  event(null, "transaction.completed", null, {
    transactionId,
    subscriptionId,
    origin,
    billingPeriodStart: start,
  });

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

/**
 * Records an event and runs its job through the queue, as the webhook route and drain do. Its
 * checkout is recorded first unless `checkout` is false.
 */
async function deliver(e: BillingEvent, { checkout = true } = {}) {
  if (checkout && e.subscription) await recordCheckout(e.subscription);
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

/** Records an event and applies it directly, returning the apply result (with any unmatched reason). */
const applyOnce = async (e: BillingEvent) => {
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
      await d
        .delete(billingCheckouts)
        .where(sql`${billingCheckouts.providerTransactionId} like ${`txn_%${tag}%`}`);
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await runtime.dispose();
  });

  describe("webhook events", () => {
    it("stores an event once: a redelivery is a no-op and enqueues nothing", async () => {
      const workspaceId = await createWorkspace(other.userId, "dup");
      const e = event(snapshot({ subscriptionId: `sub_${tag}_dup`, workspaceId }));
      await recordCheckout(e.subscription!);
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
        snapshot({
          subscriptionId: id,
          workspaceId,
          status: "canceled",
          updatedAt: t1,
          transactionId: null,
        }),
        "subscription.canceled",
      );
      const created = event(
        snapshot({ subscriptionId: id, workspaceId, updatedAt: t0 }),
        "subscription.created",
      );
      // Only `created` names the transaction: the earlier event waits, and the link catches up to it.
      await deliver(canceled);
      expect(await outcomeOf(canceled.eventId)).toBe("unmatched");
      await deliver(created);
      expect(await outcomeOf(canceled.eventId)).toBe("applied");
      expect(await outcomeOf(created.eventId)).toBe("applied");
      const late = event(
        snapshot({ subscriptionId: id, workspaceId, updatedAt: t0, transactionId: null }),
      );
      await deliver(late);
      expect(await outcomeOf(late.eventId)).toBe("stale");
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
    it("counts the grace from the first failure: a later past_due update doesn't restart it", async () => {
      const workspaceId = await createWorkspace(other.userId, "dunning");
      const id = `sub_${tag}_dunning`;
      const t1 = new Date(Date.now() - 10 * 86_400_000);
      const t2 = new Date(Date.now() - 86_400_000);
      await deliver(
        event(snapshot({ subscriptionId: id, workspaceId, updatedAt: t1, status: "past_due" })),
      );
      expect((await subscriptionRow(id))?.pastDueSince?.getTime()).toBe(t1.getTime());
      // Paddle's next retry fails: subscription.updated, still past_due.
      await deliver(
        event(snapshot({ subscriptionId: id, workspaceId, updatedAt: t2, status: "past_due" })),
      );
      const row = await subscriptionRow(id);
      expect(row?.providerUpdatedAt.getTime()).toBe(t2.getTime());
      expect(row?.pastDueSince?.getTime()).toBe(t1.getTime());
    });

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

  describe("members per workspace", () => {
    async function invite(organizationId: string, inviterId: string, email: string, ageDays = 0) {
      await db((d) =>
        d.insert(invitation).values({
          id: crypto.randomUUID(),
          organizationId,
          email,
          role: "member",
          status: "pending",
          inviterId,
          expiresAt: new Date(Date.now() + (7 - ageDays) * 86_400_000),
        }),
      );
    }
    const check = (organizationId: string, email = `${tag}-next@example.com`) =>
      run(memberLimitCheck(organizationId, { kind: "invite", email }));

    it("refuses a 4th on Free, counting pending invitations, and names the Pro limit", async () => {
      const boss = await createUser("seats-free");
      const mate = await createUser("seats-mate");
      await addMember(boss.organizationId, mate.userId);
      expect(await check(boss.organizationId)).toMatchObject({ allowed: true, used: 2, limit: 3 });

      await invite(boss.organizationId, boss.userId, `${tag}-third@example.com`);
      const full = await check(boss.organizationId);
      expect(full).toMatchObject({ allowed: false, used: 3, limit: 3, plan: "free" });
      expect(full.message).toContain("Free workspaces have up to 3 members");
      expect(full.message).toContain(
        `Pro workspaces up to ${DEFAULT_PLANS.pro.membersPerWorkspace}`,
      );

      // Re-inviting the same address replaces its invitation, so it isn't refused.
      expect(await check(boss.organizationId, `${tag}-THIRD@example.com`)).toMatchObject({
        allowed: true,
      });
      // Accepting counts members only: the invitation was counted when it was sent.
      expect(await run(memberLimitCheck(boss.organizationId, { kind: "accept" }))).toMatchObject({
        allowed: true,
        used: 2,
      });
    });

    it("doesn't count expired or answered invitations", async () => {
      const boss = await createUser("seats-expired");
      await invite(boss.organizationId, boss.userId, `${tag}-old@example.com`, 8);
      await invite(boss.organizationId, boss.userId, `${tag}-no@example.com`);
      await db((d) =>
        d
          .update(invitation)
          .set({ status: "rejected" })
          .where(eq(invitation.email, `${tag}-no@example.com`)),
      );
      expect(await check(boss.organizationId)).toMatchObject({ allowed: true, used: 1 });
    });

    it("allows 10 on Pro and keeps members over the limit after a move to Free", async () => {
      const boss = await createUser("seats-pro");
      await deliver(
        event(snapshot({ subscriptionId: `sub_${tag}_seats`, workspaceId: boss.organizationId })),
      );
      for (let i = 0; i < 8; i++) {
        const mate = await createUser(`seats-pro-${i}`);
        await addMember(boss.organizationId, mate.userId);
      }
      await invite(boss.organizationId, boss.userId, `${tag}-ninth@example.com`);
      const full = await check(boss.organizationId);
      expect(full).toMatchObject({ allowed: false, used: 10, limit: 10, plan: "pro" });
      expect(full.message).toContain("Pro workspaces have up to 10 members");

      // Pro revoked (as a chargeback would): the 9 members stay, and no one else can join.
      await db((d) =>
        d
          .update(billingSubscriptions)
          .set({ revokedAt: new Date() })
          .where(eq(billingSubscriptions.providerSubscriptionId, `sub_${tag}_seats`)),
      );
      const free = await run(memberLimitCheck(boss.organizationId, { kind: "accept" }));
      expect(free).toMatchObject({ allowed: false, used: 9, limit: 3, plan: "free" });
      expect(free.message).toContain("Ask its owner to make room.");
      const members = await db((d) =>
        d.select().from(member).where(eq(member.organizationId, boss.organizationId)),
      );
      expect(members).toHaveLength(9);
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

    it("keeps Pro through a change of the configured prices: the plan is fixed at the link", async () => {
      const workspaceId = await createWorkspace(other.userId, "reprice");
      const id = `sub_${tag}_reprice`;
      await deliver(event(snapshot({ subscriptionId: id, workspaceId })));
      expect((await subscriptionRow(id))?.plan).toBe("pro");
      expect(await planOf(workspaceId)).toBe("pro");
      // The monthly price is replaced without listing the old one as legacy.
      vi.stubEnv("PADDLE_PRICE_PRO_MONTHLY", "pri_month_v2");
      try {
        expect(await planOf(workspaceId)).toBe("pro");
        expect((await run(workspaceBilling(workspaceId)))?.entitled).toBe(true);
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
        expect(await planOf(workspaceId)).toBe("pro");
        expect((await run(accountPlan(other.userId))).plan).toBe("pro");
      } finally {
        vi.unstubAllEnvs();
      }
    });
    it("keeps the plan and warns when a subscription moves to a price this deploy doesn't know", async () => {
      const workspaceId = await createWorkspace(other.userId, "unknown-price");
      const id = `sub_${tag}_unknown_price`;
      await deliver(event(snapshot({ subscriptionId: id, workspaceId })));
      const move = (priceId: string, offsetMs: number) =>
        applyOnce(
          event(
            snapshot({
              subscriptionId: id,
              workspaceId,
              priceId,
              transactionId: null,
              updatedAt: new Date(Date.now() + offsetMs),
            }),
          ),
        );
      expect(await move("pri_unlisted", 1000)).toMatchObject({
        outcome: "applied",
        unknownPrice: true,
      });
      expect((await subscriptionRow(id))?.plan).toBe("pro");
      expect(await planOf(workspaceId)).toBe("pro");
      // Monthly to yearly: a known price, no warning.
      expect(await move("pri_year", 2000)).not.toHaveProperty("unknownPrice");
      expect((await subscriptionRow(id))?.plan).toBe("pro");
    });
  });

  describe("linking needs the checkout the server created", () => {
    it("leaves a subscription from a transaction we didn't create unmatched", async () => {
      const workspaceId = await createWorkspace(other.userId, "foreign-txn");
      const s = snapshot({ subscriptionId: `sub_${tag}_foreign`, workspaceId });
      expect(await applyOnce(event(s, "subscription.created"))).toMatchObject({
        outcome: "unmatched",
        unmatched: "unknown_transaction",
        transactionId: s.transactionId,
      });
      // A transaction we created for another workspace doesn't count either.
      await recordCheckout(s, { organizationId: await createWorkspace(other.userId, "foreign-2") });
      expect(await applyOnce(event(s, "subscription.created"))).toMatchObject({
        unmatched: "unknown_transaction",
      });
      expect(await subscriptionRow(s.subscriptionId)).toBeUndefined();
      expect(await planOf(workspaceId)).toBe("free");
    });

    it("leaves a subscription whose customer isn't the one on our checkout unmatched", async () => {
      const workspaceId = await createWorkspace(other.userId, "other-customer");
      const s = snapshot({
        subscriptionId: `sub_${tag}_customer`,
        workspaceId,
        customerId: `ctm_${tag}_theirs`,
      });
      await recordCheckout(s, { customerId: `ctm_${tag}_ours` });
      expect(await applyOnce(event(s, "subscription.created"))).toMatchObject({
        outcome: "unmatched",
        unmatched: "customer_mismatch",
      });
      expect(await subscriptionRow(s.subscriptionId)).toBeUndefined();
      expect(await planOf(workspaceId)).toBe("free");
    });

    it("links a subscription from our checkout, with our customer, to its workspace and buyer", async () => {
      const workspaceId = await createWorkspace(other.userId, "our-checkout");
      const s = snapshot({ subscriptionId: `sub_${tag}_ours`, workspaceId });
      await recordCheckout(s);
      expect(await applyOnce(event(s, "subscription.created"))).toMatchObject({
        outcome: "applied",
        organizationId: workspaceId,
        userId: other.userId,
      });
      expect(await subscriptionRow(s.subscriptionId)).toMatchObject({
        organizationId: workspaceId,
        userId: other.userId,
        providerCustomerId: s.customerId,
      });
      expect(await planOf(workspaceId)).toBe("pro");
    });

    it("links one subscription per checkout: a second one on the same transaction stays unmatched", async () => {
      const workspaceId = await createWorkspace(other.userId, "used-txn");
      const first = snapshot({ subscriptionId: `sub_${tag}_used_1`, workspaceId });
      await recordCheckout(first);
      expect(await applyOnce(event(first, "subscription.created"))).toMatchObject({
        outcome: "applied",
      });
      const second = snapshot({
        subscriptionId: `sub_${tag}_used_2`,
        workspaceId,
        transactionId: first.transactionId,
      });
      expect(await applyOnce(event(second, "subscription.created"))).toMatchObject({
        outcome: "unmatched",
        unmatched: "transaction_used",
      });
      expect(await subscriptionRow(second.subscriptionId)).toBeUndefined();
      const [checkout] = await db((d) =>
        d
          .select()
          .from(billingCheckouts)
          .where(eq(billingCheckouts.providerTransactionId, first.transactionId!)),
      );
      expect(checkout?.providerSubscriptionId).toBe(first.subscriptionId);
    });

    it("keeps the checkout's customer when a waiting snapshot names another, and flags it", async () => {
      const workspaceId = await createWorkspace(other.userId, "waiting-customer");
      const id = `sub_${tag}_waiting_customer`;
      const early = event(
        snapshot({
          subscriptionId: id,
          workspaceId,
          customerId: `ctm_${tag}_other`,
          cancelAtPeriodEnd: true,
          updatedAt: new Date(Date.now() + 1_000),
          transactionId: null,
        }),
      );
      expect(await applyOnce(early)).toMatchObject({ unmatched: "no_transaction" });
      const created = snapshot({ subscriptionId: id, workspaceId });
      await recordCheckout(created);
      expect(await applyOnce(event(created, "subscription.created"))).toMatchObject({
        outcome: "applied",
        unmatched: "customer_mismatch",
      });
      // The newer state is applied, the customer is not.
      expect(await subscriptionRow(id)).toMatchObject({
        providerCustomerId: created.customerId,
        cancelAtPeriodEnd: true,
      });
    });

    it("ends on the newest snapshot whatever order created, activated and updated apply in", async () => {
      const workspaceId = await createWorkspace(other.userId, "concurrent");
      const orders = [
        ["created", "activated", "updated"],
        ["updated", "activated", "created"],
        ["activated", "updated", "created"],
        ["updated", "created", "activated"],
      ] as const;
      for (const [n, order] of orders.entries()) {
        const id = `sub_${tag}_concurrent_${n}`;
        const base = Date.now();
        const events = {
          created: event(
            snapshot({ subscriptionId: id, workspaceId, updatedAt: new Date(base) }),
            "subscription.created",
          ),
          activated: event(
            snapshot({
              subscriptionId: id,
              workspaceId,
              updatedAt: new Date(base + 1_000),
              transactionId: null,
            }),
            "subscription.activated",
          ),
          updated: event(
            snapshot({
              subscriptionId: id,
              workspaceId,
              cancelAtPeriodEnd: true,
              updatedAt: new Date(base + 2_000),
              transactionId: null,
            }),
            "subscription.updated",
          ),
        };
        await recordCheckout(events.created.subscription!);
        const rows: string[] = [];
        for (const name of order) {
          await run(recordBillingEvent(events[name]));
          const [row] = await db((d) =>
            d
              .select({ id: billingEvents.id })
              .from(billingEvents)
              .where(eq(billingEvents.providerEventId, events[name].eventId)),
          );
          rows.push(row!.id);
        }
        await Promise.all(rows.map((rowId) => run(applyBillingEvent(rowId))));

        expect(await subscriptionRow(id)).toMatchObject({
          organizationId: workspaceId,
          cancelAtPeriodEnd: true,
          providerUpdatedAt: new Date(base + 2_000),
        });
        const outcomes = await Promise.all(order.map((name) => outcomeOf(events[name].eventId)));
        expect(outcomes, order.join(", ")).not.toContain("unmatched");
      }
    });

    it("with sandbox keys on the live site, links only a platform admin's checkout", async () => {
      vi.stubEnv("PADDLE_ENV", "sandbox");
      vi.stubEnv("VERCEL_ENV", "production");
      try {
        const buyer = await createUser("sandbox-buyer");
        const s = snapshot({
          subscriptionId: `sub_${tag}_sandbox`,
          workspaceId: buyer.organizationId,
        });
        await recordCheckout(s);
        expect(await applyOnce(event(s, "subscription.created"))).toMatchObject({
          outcome: "unmatched",
          unmatched: "test_mode",
        });
        expect(await planOf(buyer.organizationId)).toBe("free");

        const admin = await createUser("sandbox-admin");
        await db((d) => d.update(user).set({ role: "admin" }).where(eq(user.id, admin.userId)));
        const t = snapshot({
          subscriptionId: `sub_${tag}_sandbox_admin`,
          workspaceId: admin.organizationId,
        });
        await recordCheckout(t);
        expect(await applyOnce(event(t, "subscription.created"))).toMatchObject({
          outcome: "applied",
        });
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  describe("checkout and portal with Paddle configured", () => {
    let calls: { method: string; url: string; body: unknown }[] = [];
    const created = (id: string) => Response.json({ data: { id } }, { status: 201 });

    beforeEach(() => {
      vi.stubEnv("PADDLE_ENV", "sandbox");
      vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_apikey_test");
      vi.stubEnv("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN", "test_token");
      vi.stubEnv("PADDLE_WEBHOOK_SECRET", "pdl_ntfset_test");
      calls = [];
      // Paddle's API, scripted: no network.
      vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, url: input, body: init?.body ? JSON.parse(String(init.body)) : null });
        const path = new URL(input).pathname;
        if (path.endsWith("/portal-sessions")) {
          return Response.json({
            data: { urls: { general: { overview: "https://portal.example.com/o" } } },
          });
        }
        if (path === "/customers") {
          return method === "GET" ? Response.json({ data: [] }) : created(`ctm_${tag}_new`);
        }
        if (path === "/transactions") return created(`txn_${tag}_checkout_${++seq}`);
        return new Response("{}", { status: 404 });
      });
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    const withBilling = <A, E>(f: (billing: typeof Billing.Service) => Effect.Effect<A, E>) =>
      runExit(Effect.flatMap(Billing, f).pipe(Effect.provide(Billing.Live)));
    const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
      Exit.isFailure(exit) ? exit.cause.toJSON() : null;

    it("refuses the checkout while the buyer's email isn't verified", async () => {
      const buyer = await createUser("unverified");
      await db((d) =>
        d.update(user).set({ emailVerified: false }).where(eq(user.id, buyer.userId)),
      );
      const exit = await withBilling((b) =>
        b.createCheckout({
          organizationId: buyer.organizationId,
          userId: buyer.userId,
          interval: "month",
        }),
      );
      expect(failureOf(exit)).toMatchObject({
        error: { _tag: "Forbidden", message: UNVERIFIED_EMAIL },
      });
      expect(calls).toEqual([]);
    });

    it("records each checkout it creates and reuses the buyer's customer next time", async () => {
      const buyer = await createUser("records");
      const checkout = (interval: "month" | "year") =>
        withBilling((b) =>
          b.createCheckout({
            organizationId: buyer.organizationId,
            userId: buyer.userId,
            interval,
          }),
        );
      const first = await checkout("month");
      if (!Exit.isSuccess(first)) throw new Error("checkout failed");
      expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "POST"]);
      const rows = await db((d) =>
        d.select().from(billingCheckouts).where(eq(billingCheckouts.userId, buyer.userId)),
      );
      expect(rows).toMatchObject([
        {
          provider: "paddle",
          providerTransactionId: first.value.transactionId,
          organizationId: buyer.organizationId,
          providerCustomerId: `ctm_${tag}_new`,
          priceId: "pri_month",
        },
      ]);

      calls = [];
      expect(Exit.isSuccess(await checkout("year"))).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        url: expect.stringMatching(/\/transactions$/),
        body: { customer_id: `ctm_${tag}_new`, items: [{ price_id: "pri_year" }] },
      });
    });

    it("refuses a checkout while a subscription can still charge, and allows it once none can", async () => {
      const buyer = await createUser("blocked");
      const id = `sub_${tag}_blocked`;
      // Past due for longer than the grace: Free, while Paddle may still recover the payment.
      await deliver(
        event(
          snapshot({
            subscriptionId: id,
            workspaceId: buyer.organizationId,
            status: "past_due",
            updatedAt: new Date(Date.now() - (PAST_DUE_GRACE_DAYS + 5) * 86_400_000),
          }),
          "subscription.created",
        ),
      );
      expect(await planOf(buyer.organizationId)).toBe("free");
      // Another owner, who didn't subscribe, is refused the same way.
      const coOwner = await createUser("blocked-co-owner");
      await db((d) =>
        d.insert(member).values({
          id: crypto.randomUUID(),
          organizationId: buyer.organizationId,
          userId: coOwner.userId,
          role: "owner",
          createdAt: new Date(),
        }),
      );
      const checkout = (userId = buyer.userId) =>
        withBilling((b) =>
          b.createCheckout({ organizationId: buyer.organizationId, userId, interval: "month" }),
        );
      const setRow = (fields: Partial<typeof billingSubscriptions.$inferInsert>) =>
        db((d) =>
          d
            .update(billingSubscriptions)
            .set(fields)
            .where(eq(billingSubscriptions.providerSubscriptionId, id)),
        );
      const ahead = new Date(Date.now() + 5 * 86_400_000);
      const behind = new Date(Date.now() - 86_400_000);
      for (const fields of [
        {},
        { status: "paused" },
        { status: "active", revokedAt: new Date() },
      ] satisfies Partial<typeof billingSubscriptions.$inferInsert>[]) {
        await setRow({ cancelAtPeriodEnd: false, revokedAt: null, ...fields });
        for (const userId of [buyer.userId, coOwner.userId]) {
          expect(failureOf(await checkout(userId))).toMatchObject({
            error: { _tag: "Conflict", message: ALREADY_SUBSCRIBED },
          });
        }
        expect(await run(workspaceBilling(buyer.organizationId))).toMatchObject({
          checkoutBlocked: true,
        });
      }
      expect(calls).toEqual([]);

      // The SQL and `blocksCheckout` agree on every state, blocked or not.
      for (const fields of [
        { status: "active", currentPeriodEnd: null },
        { status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: behind },
        { status: "canceled", currentPeriodEnd: behind },
        { status: "canceled", currentPeriodEnd: ahead },
        { status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: ahead },
        {
          status: "canceled",
          cancelAtPeriodEnd: true,
          currentPeriodEnd: ahead,
          revokedAt: new Date(),
        },
        { status: "canceled", currentPeriodEnd: null },
        { status: "trialing", currentPeriodEnd: ahead },
        { status: "trialing", revokedAt: new Date() },
        { status: "past_due", currentPeriodEnd: behind },
        { status: "past_due", pastDueSince: new Date() },
        { status: "paused" },
      ] satisfies Partial<typeof billingSubscriptions.$inferInsert>[]) {
        await setRow({ cancelAtPeriodEnd: false, revokedAt: null, ...fields });
        const row = await subscriptionRow(id);
        const expected = blocksCheckout(
          { ...row!, status: row!.status as BillingStatus },
          new Date(),
        );
        expect(await run(workspaceCheckoutBlocked(buyer.organizationId))).toBe(expected);
      }

      await setRow({ status: "canceled", cancelAtPeriodEnd: false, currentPeriodEnd: ahead });
      expect(Exit.isSuccess(await checkout())).toBe(true);
      expect(await run(workspaceBilling(buyer.organizationId))).toMatchObject({
        checkoutBlocked: false,
      });
    });

    it("retries a cancel Paddle refuses as locked for over an hour, then the next event asks again", async () => {
      vi.stubGlobal("fetch", async (input: string) => {
        if (new URL(input).pathname.endsWith("/cancel")) {
          return Response.json({ error: { code: "subscription_locked_renewal" } }, { status: 409 });
        }
        return new Response("{}", { status: 404 });
      });
      // A runtime built with Paddle configured, so the job's cancel reaches the stubbed API.
      const configured = ManagedRuntime.make(AppLayer);
      try {
        const workspaceId = await createWorkspace(other.userId, "locked");
        const id = `sub_${tag}_locked`;
        await deliver(event(snapshot({ subscriptionId: id, workspaceId })));
        const chargeback = event(null, "adjustment.created", {
          adjustmentId: `adj_${tag}_locked`,
          action: "chargeback",
          type: "full",
          status: "approved",
          subscriptionId: id,
          transactionId: `txn_${id}`,
        });
        const recorded = await run(recordBillingEvent(chargeback));
        if (recorded.kind !== "recorded") throw new Error("not recorded");
        const runJob = () =>
          configured.runPromise(
            tick({
              worker: `${tag}-worker`,
              registry: JOB_REGISTRY,
              budgetMs: 30_000,
              ids: [recorded.jobId],
              waitForRetries: false,
            }),
          );
        const job = () => jobOf(chargeback.eventId);
        await runJob();
        const first = await job();
        expect(first).toMatchObject({ state: "queued", lastErrorKind: "provider-locked" });
        expect(first!.runAt.getTime() - Date.now()).toBeGreaterThanOrEqual(14 * 60_000);
        for (let attempt = 2; attempt <= 8; attempt += 1) {
          await db((d) =>
            d.update(jobs).set({ runAt: new Date() }).where(eq(jobs.id, recorded.jobId)),
          );
          await runJob();
        }
        expect(await job()).toMatchObject({
          state: "dead",
          attempts: 8,
          lastErrorKind: "provider-locked",
        });
        // The dead job isn't the last chance: the next event of the subscription asks again.
        const renewal = event(
          snapshot({
            subscriptionId: id,
            workspaceId,
            transactionId: null,
            updatedAt: new Date(Date.now() + 1000),
          }),
        );
        expect(await applyOnce(renewal)).toMatchObject({ cancelSubscriptionId: id });
      } finally {
        await configured.dispose();
      }
    });

    it("opens the portal only for the buyer's own customer, and never once the buyer is gone", async () => {
      const buyer = await createUser("portal-buyer");
      const coOwner = await createUser("portal-co-owner");
      await db((d) =>
        d.insert(member).values({
          id: crypto.randomUUID(),
          organizationId: buyer.organizationId,
          userId: coOwner.userId,
          role: "owner",
          createdAt: new Date(),
        }),
      );
      const id = `sub_${tag}_portal`;
      await deliver(event(snapshot({ subscriptionId: id, workspaceId: buyer.organizationId })));
      const portal = (userId: string) =>
        withBilling((b) => b.portalLinks(buyer.organizationId, userId));

      expect(Exit.isSuccess(await portal(buyer.userId))).toBe(true);
      expect(failureOf(await portal(coOwner.userId))).toMatchObject({
        error: { _tag: "Forbidden" },
      });

      // A customer the server never put on a checkout for this buyer.
      const setRow = (fields: Partial<typeof billingSubscriptions.$inferInsert>) =>
        db((d) =>
          d
            .update(billingSubscriptions)
            .set(fields)
            .where(eq(billingSubscriptions.providerSubscriptionId, id)),
        );
      await setRow({ providerCustomerId: `ctm_${tag}_elsewhere` });
      calls = [];
      expect(failureOf(await portal(buyer.userId))).toMatchObject({
        error: { _tag: "Forbidden" },
      });

      // Orphaned: no portal for any remaining owner.
      await setRow({ userId: null, providerCustomerId: `ctm_${tag}` });
      expect(failureOf(await portal(coOwner.userId))).toMatchObject({
        error: { _tag: "Forbidden", message: BUYER_GONE },
      });
      expect(calls).toEqual([]);
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
        adjustment({
          action: "refund",
          type: "full",
          subscriptionId: id,
          transactionId: `txn_${id}`,
        }),
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

    it("keeps Pro on a full refund of an earlier period or a duplicate charge, and ends it on the current period's", async () => {
      const workspaceId = await createWorkspace(other.userId, "renewed");
      const id = `sub_${tag}_renewed`;
      const firstStart = new Date(Date.now() - 31 * 86_400_000);
      const renewalStart = new Date(Date.now() - 86_400_000);
      await deliver(
        event(
          snapshot({ subscriptionId: id, workspaceId, currentPeriodStart: firstStart }),
          "subscription.created",
        ),
      );
      expect(await subscriptionRow(id)).toMatchObject({
        paidTransactionId: `txn_${id}`,
        paidPeriodStart: firstStart,
      });
      // The checkout's own transaction arrives after the link: nothing changes.
      const first = paid(id, `txn_${id}`, firstStart, "api");
      await deliver(first);
      expect(await outcomeOf(first.eventId)).toBe("ignored");

      const renewal = paid(id, `txn_${tag}_renewal`, renewalStart);
      await deliver(renewal);
      expect(await outcomeOf(renewal.eventId)).toBe("applied");
      // Paddle charged the same period twice, and a one-off charge.
      const duplicate = paid(id, `txn_${tag}_duplicate`, renewalStart);
      const oneOff = paid(id, `txn_${tag}_one_off`, null, "subscription_charge");
      await deliver(duplicate);
      await deliver(oneOff);
      expect(await outcomeOf(duplicate.eventId)).toBe("ignored");
      expect((await subscriptionRow(id))?.paidTransactionId).toBe(`txn_${tag}_renewal`);

      const refund = (transactionId: string) =>
        event(
          null,
          "adjustment.updated",
          adjustment({ action: "refund", type: "full", subscriptionId: id, transactionId }),
        );
      for (const transactionId of [`txn_${id}`, `txn_${tag}_duplicate`, `txn_${tag}_one_off`]) {
        const e = refund(transactionId);
        await deliver(e);
        expect(await outcomeOf(e.eventId)).toBe("ignored");
        expect(await jobOf(e.eventId)).toMatchObject({ state: "succeeded" });
      }
      expect(await planOf(workspaceId)).toBe("pro");
      expect((await subscriptionRow(id))?.revokedAt).toBeNull();

      const current = refund(`txn_${tag}_renewal`);
      await deliver(current);
      expect(await outcomeOf(current.eventId)).toBe("applied");
      expect(await planOf(workspaceId)).toBe("free");
    });

    it("asks for the cancel again on every later event of a revoked subscription", async () => {
      const workspaceId = await createWorkspace(other.userId, "revoked-renews");
      const id = `sub_${tag}_revoked_renews`;
      await deliver(event(snapshot({ subscriptionId: id, workspaceId })));
      // The cancel job dies here (no API key); the subscription stays active in Paddle.
      await deliver(event(null, "adjustment.created", adjustment({ subscriptionId: id })));
      expect((await subscriptionRow(id))?.revokedAt).toBeInstanceOf(Date);
      const renewal = event(
        snapshot({
          subscriptionId: id,
          workspaceId,
          transactionId: null,
          updatedAt: new Date(Date.now() + 1000),
        }),
      );
      expect(await applyOnce(renewal)).toMatchObject({
        outcome: "applied",
        cancelSubscriptionId: id,
      });
      expect(await planOf(workspaceId)).toBe("free");
      const canceled = event(
        snapshot({
          subscriptionId: id,
          workspaceId,
          status: "canceled",
          transactionId: null,
          updatedAt: new Date(Date.now() + 2000),
        }),
      );
      expect(await applyOnce(canceled)).not.toHaveProperty("cancelSubscriptionId");
    });

    it("keeps a full refund of a renewal not yet reported, and applies it when the renewal arrives", async () => {
      const workspaceId = await createWorkspace(other.userId, "refund-first");
      const id = `sub_${tag}_refund_first`;
      const firstStart = new Date(Date.now() - 31 * 86_400_000);
      await deliver(
        event(
          snapshot({ subscriptionId: id, workspaceId, currentPeriodStart: firstStart }),
          "subscription.created",
        ),
      );
      const refund = (transactionId: string) =>
        event(
          null,
          "adjustment.updated",
          adjustment({ action: "refund", type: "full", subscriptionId: id, transactionId }),
        );
      const early = refund(`txn_${tag}_renewal_late`);
      expect(await applyOnce(early)).toMatchObject({
        outcome: "unmatched",
        unmatched: "transaction",
        transactionId: `txn_${tag}_renewal_late`,
      });
      expect(await planOf(workspaceId)).toBe("pro");

      const renewal = paid(id, `txn_${tag}_renewal_late`, new Date(Date.now() - 86_400_000));
      expect(await applyOnce(renewal)).toMatchObject({
        outcome: "applied",
        planChange: { from: "pro", to: "free" },
        cancelSubscriptionId: id,
      });
      expect(await outcomeOf(early.eventId)).toBe("applied");
      expect(await planOf(workspaceId)).toBe("free");
    });

    it("keeps a refund waiting while its renewal's report is stored but not yet applied", async () => {
      const workspaceId = await createWorkspace(other.userId, "refund-queued");
      const id = `sub_${tag}_refund_queued`;
      const firstStart = new Date(Date.now() - 31 * 86_400_000);
      await deliver(
        event(
          snapshot({ subscriptionId: id, workspaceId, currentPeriodStart: firstStart }),
          "subscription.created",
        ),
      );
      const renewal = paid(id, `txn_${tag}_renewal_queued`, new Date(Date.now() - 86_400_000));
      // The renewal's webhook is stored, but its job hasn't run yet.
      expect((await run(recordBillingEvent(renewal))).kind).toBe("recorded");
      const refund = event(
        null,
        "adjustment.updated",
        adjustment({
          action: "refund",
          type: "full",
          subscriptionId: id,
          transactionId: `txn_${tag}_renewal_queued`,
        }),
      );
      expect(await applyOnce(refund)).toMatchObject({
        outcome: "unmatched",
        unmatched: "transaction",
      });
      const [row] = await db((d) =>
        d
          .select({ id: billingEvents.id })
          .from(billingEvents)
          .where(eq(billingEvents.providerEventId, renewal.eventId)),
      );
      expect(await run(applyBillingEvent(row!.id))).toMatchObject({
        outcome: "applied",
        planChange: { from: "pro", to: "free" },
      });
      expect(await outcomeOf(refund.eventId)).toBe("applied");
      expect(await planOf(workspaceId)).toBe("free");
    });

    it("drops a waiting refund when its transaction turns out to be a duplicate", async () => {
      const workspaceId = await createWorkspace(other.userId, "refund-duplicate");
      const id = `sub_${tag}_refund_duplicate`;
      const start = new Date(Date.now() - 86_400_000);
      await deliver(
        event(
          snapshot({ subscriptionId: id, workspaceId, currentPeriodStart: start }),
          "subscription.created",
        ),
      );
      const early = event(
        null,
        "adjustment.updated",
        adjustment({
          action: "refund",
          type: "full",
          subscriptionId: id,
          transactionId: `txn_${tag}_same_period`,
        }),
      );
      await deliver(early);
      expect(await outcomeOf(early.eventId)).toBe("unmatched");
      // A second charge for the period the checkout already paid.
      await deliver(paid(id, `txn_${tag}_same_period`, start));
      expect(await outcomeOf(early.eventId)).toBe("ignored");
      expect(await planOf(workspaceId)).toBe("pro");
    });

    it("applies an early full refund on link only when it refunds the checkout's payment", async () => {
      const refundBeforeLink = async (name: string, refunded: (id: string) => string) => {
        const workspaceId = await createWorkspace(other.userId, name);
        const id = `sub_${tag}_${name}`;
        const early = event(
          null,
          "adjustment.created",
          adjustment({
            action: "refund",
            type: "full",
            subscriptionId: id,
            transactionId: refunded(id),
          }),
        );
        await deliver(early);
        expect(await outcomeOf(early.eventId)).toBe("unmatched");
        await deliver(event(snapshot({ subscriptionId: id, workspaceId }), "subscription.created"));
        return { workspaceId, id };
      };
      const ours = await refundBeforeLink("early-refund", (id) => `txn_${id}`);
      expect(await planOf(ours.workspaceId)).toBe("free");
      expect((await subscriptionRow(ours.id))?.revokedAt).toBeInstanceOf(Date);

      const another = await refundBeforeLink("early-other-refund", () => `txn_${tag}_elsewhere`);
      expect(await planOf(another.workspaceId)).toBe("pro");
      expect((await subscriptionRow(another.id))?.revokedAt).toBeNull();
    });
  });

  describe("a second subscription for one workspace", () => {
    it("reports Free to Pro for a duplicate beside a paused subscription, and flags it", async () => {
      const workspaceId = await createWorkspace(other.userId, "beside-paused");
      await deliver(
        event(
          snapshot({ subscriptionId: `sub_${tag}_paused_1`, workspaceId, status: "paused" }),
          "subscription.created",
        ),
      );
      expect(await planOf(workspaceId)).toBe("free");
      const next = event(
        snapshot({ subscriptionId: `sub_${tag}_paused_2`, workspaceId }),
        "subscription.created",
      );
      await recordCheckout(next.subscription!);
      expect(await applyOnce(next)).toMatchObject({
        outcome: "applied",
        duplicate: true,
        planChange: { from: "free", to: "pro" },
      });
      expect(await planOf(workspaceId)).toBe("pro");
    });
    it("links it but flags it, with no plan change to report", async () => {
      const workspaceId = await createWorkspace(other.userId, "twice");
      const first = event(
        snapshot({ subscriptionId: `sub_${tag}_twice_1`, workspaceId }),
        "subscription.created",
      );
      await recordCheckout(first.subscription!);
      expect(await applyOnce(first)).toMatchObject({
        outcome: "applied",
        planChange: { from: "free", to: "pro" },
      });
      const second = event(
        snapshot({ subscriptionId: `sub_${tag}_twice_2`, workspaceId }),
        "subscription.created",
      );
      await recordCheckout(second.subscription!);
      const result = await applyOnce(second);
      expect(result).toMatchObject({ outcome: "applied", duplicate: true });
      expect(result).not.toHaveProperty("planChange");
      expect((await subscriptionRow(`sub_${tag}_twice_2`))?.organizationId).toBe(workspaceId);
      expect(await planOf(workspaceId)).toBe("pro");
    });

    it("doesn't flag a new subscription after the old one ended", async () => {
      const workspaceId = await createWorkspace(other.userId, "again");
      await deliver(
        event(
          snapshot({
            subscriptionId: `sub_${tag}_again_1`,
            workspaceId,
            status: "canceled",
            currentPeriodEnd: new Date(Date.now() - 86_400_000),
          }),
          "subscription.created",
        ),
      );
      const next = event(
        snapshot({ subscriptionId: `sub_${tag}_again_2`, workspaceId }),
        "subscription.created",
      );
      await recordCheckout(next.subscription!);
      const result = await applyOnce(next);
      expect(result).toMatchObject({ outcome: "applied", planChange: { from: "free", to: "pro" } });
      expect(result).not.toHaveProperty("duplicate");
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
          .set({ pastDueSince: new Date(Date.now() - (PAST_DUE_GRACE_DAYS + 1) * 86_400_000) })
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
      expect(await reapply(rearmed.eventId)).toMatchObject({ cancelSubscriptionId: id });
      // A fresh event with the buyer gone is flagged as well as cancelled.
      const again = event(
        snapshot({
          subscriptionId: id,
          workspaceId,
          userId: null,
          updatedAt: new Date(Date.now() + 2_000),
        }),
      );
      await run(recordBillingEvent(again));
      expect(await reapply(again.eventId)).toMatchObject({
        orphanCharging: true,
        cancelSubscriptionId: id,
      });
    });
  });

  describe("the buyer and orphaned subscriptions", () => {
    const applyAt = async (id: string, fields: Partial<SubscriptionSnapshot>, offsetMs: number) => {
      const e = event(
        snapshot({ subscriptionId: id, updatedAt: new Date(Date.now() + offsetMs), ...fields }),
      );
      await recordCheckout(e.subscription!);
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
      expect(message).toContain("They reset on");
      expect(message).not.toMatch(/upgrade/i);
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
        d
          .execute<{ used: number }>(
            sql`select count(*)::int as used from ocr_rounds where plan = 'free' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`,
          )
          .then((r) => r.rows),
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
