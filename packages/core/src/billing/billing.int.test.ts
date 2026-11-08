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
import type { BillingEvent, SubscriptionSnapshot } from "./provider";
import {
  accountPlan,
  applyBillingEvent,
  recordBillingEvent,
  workspaceBilling,
  workspaceCreationCheck,
  workspacePlan,
} from "./service";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const runExit = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromiseExit(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `bill-${Date.now()}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode(tag)]);
let seq = 0;

async function createUser(name: string) {
  const id = `${tag}-${name}`;
  await db((d) =>
    d.insert(user).values({ id, name, email: `${id}@example.com`, emailVerified: true }),
  );
  const orgId = await run(ensurePersonalWorkspace({ id, name, email: `${id}@example.com` }));
  if (!orgId) throw new Error("no workspace");
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
  userId: null,
  ...fields,
});

const event = (subscription: SubscriptionSnapshot | null, type = "subscription.updated") => {
  seq += 1;
  return {
    provider: "paddle",
    eventId: `evt_${tag}_${seq}`,
    type,
    occurredAt: new Date(),
    subscription,
  } satisfies BillingEvent;
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
      await step(1_000, { status: "past_due" });
      expect(await planOf(workspaceId)).toBe("pro");
      expect((await run(workspaceBilling(workspaceId)))?.graceEndsAt).toBeInstanceOf(Date);
      await step(2_000, { status: "active", cancelAtPeriodEnd: true });
      expect(await planOf(workspaceId)).toBe("pro");
      expect(await run(workspaceBilling(workspaceId))).toMatchObject({
        cancelAtPeriodEnd: true,
        entitled: true,
      });
      await step(3_000, { status: "canceled", cancelAtPeriodEnd: false });
      expect(await planOf(workspaceId)).toBe("free");
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
