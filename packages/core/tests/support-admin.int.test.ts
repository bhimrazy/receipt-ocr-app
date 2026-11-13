/**
 * The support admin and retention against real Postgres: status changes with their audit rows,
 * the admin list, the batched purge and the daily purge schedule. Skipped unless INTEGRATION=1.
 */
import { randomUUID } from "node:crypto";
import {
  adminAuditLog,
  eq,
  inArray,
  jobs,
  organization,
  sql,
  supportMessages,
  user,
} from "@receipt-ocr/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeAppLayer, type AppServices } from "../src/index";
import {
  ContactReplyMailer,
  enqueueJob,
  JOB_REGISTRY,
  MAINTENANCE_PURGE,
  scheduleMaintenance,
  SupportNotifyMailer,
  tick,
  WelcomeMailer,
} from "../src/jobs";
import { maintenancePurgeJob } from "../src/jobs/kinds/maintenance-purge";
import { Db } from "../src/services";
import {
  listSupportMessages,
  purgeSupportMessages,
  setSupportStatus,
  type SupportStatus,
} from "../src/support";
import { ensurePersonalWorkspace } from "../src/workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(
  makeAppLayer(
    Layer.mergeAll(
      WelcomeMailer.Disabled,
      ContactReplyMailer.Disabled,
      SupportNotifyMailer.Disabled,
    ),
  ),
);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices | SupportNotifyMailer>) =>
  runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `supadm-${Date.now()}`;
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

type Seed = {
  status?: SupportStatus;
  createdAt?: Date;
  updatedAt?: Date;
  closedAt?: Date | null;
  name?: string;
  organizationId?: string | null;
};

async function seed(over: Seed = {}) {
  const status = over.status ?? (over.closedAt ? "closed" : "new");
  const [row] = await db((d) =>
    d
      .insert(supportMessages)
      .values({
        submissionId: randomUUID(),
        kind: "question",
        source: "public",
        status,
        name: over.name ?? "Test Sender",
        email: `${tag}-${randomUUID().slice(0, 8)}@example.com`,
        message: "A test question",
        organizationId: over.organizationId ?? null,
        createdAt: over.createdAt ?? new Date(),
        updatedAt: over.updatedAt ?? over.closedAt ?? over.createdAt ?? new Date(),
        closedAt: over.closedAt ?? null,
      })
      .returning({ id: supportMessages.id }),
  );
  return row!.id;
}

const statusOf = (id: string) =>
  db((d) =>
    d
      .select({ status: supportMessages.status, closedAt: supportMessages.closedAt })
      .from(supportMessages)
      .where(eq(supportMessages.id, id)),
  ).then((rows) => rows[0]);

const auditFor = (id: string) =>
  db((d) => d.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, id)));

const remaining = (ids: string[]) =>
  db((d) =>
    d
      .select({ id: supportMessages.id })
      .from(supportMessages)
      .where(inArray(supportMessages.id, ids)),
  ).then((rows) => rows.map((r) => r.id).sort());

describe.skipIf(!enabled)("support admin and retention against Postgres", () => {
  const adminId = `${tag}-admin`;
  const audit = { actor: { id: adminId, email: `${adminId}@example.com` }, ip: null };
  let organizationId: string;

  beforeAll(async () => {
    await db((d) =>
      d
        .insert(user)
        .values({ id: adminId, name: "Admin", email: audit.actor.email, emailVerified: true }),
    );
    const workspace = await run(
      ensurePersonalWorkspace({ id: adminId, name: "Admin", email: audit.actor.email }),
    );
    if (!workspace) throw new Error("no workspace");
    organizationId = workspace;
  });

  afterAll(async () => {
    await db(async (d) => {
      await d.delete(supportMessages).where(sql`${supportMessages.email} like ${`${tag}%`}`);
      await d.delete(adminAuditLog).where(eq(adminAuditLog.actorId, adminId));
      await d.delete(jobs).where(eq(jobs.kind, MAINTENANCE_PURGE));
      await d.delete(organization).where(eq(organization.id, organizationId));
      await d.delete(user).where(eq(user.id, adminId));
    });
    await runtime.dispose();
  });

  it("closes and reopens a message with one audit row per change, without the sender's address", async () => {
    const id = await seed();

    await run(setSupportStatus(id, "closed", audit));
    const closed = await statusOf(id);
    expect(closed?.status).toBe("closed");
    expect(closed?.closedAt).toBeInstanceOf(Date);

    // Already closed: nothing changes and nothing is audited.
    await run(setSupportStatus(id, "closed", audit));

    await run(setSupportStatus(id, "open", audit));
    expect(await statusOf(id)).toEqual({ status: "open", closedAt: null });

    const rows = await auditFor(id);
    expect(rows.map((r) => r.metadata)).toEqual(
      expect.arrayContaining([
        { from: "new", to: "closed" },
        { from: "closed", to: "open" },
      ]),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        action: "support.status",
        targetType: "support",
        actorId: adminId,
      });
      expect(row.targetLabel).not.toContain("@");
    }
  });

  it("refuses an unknown or malformed id", async () => {
    for (const id of [randomUUID(), "not-a-uuid"]) {
      const exit = await runtime.runPromiseExit(setSupportStatus(id, "open", audit));
      expect(exit._tag).toBe("Failure");
      expect(JSON.stringify(exit)).toContain("NotFound");
    }
  });

  it("lists newest first, filters by status and searches by sender, with the workspace name", async () => {
    const name = `${tag}-lister`;
    const older = await seed({ name, createdAt: daysAgo(2), organizationId });
    const newer = await seed({ name, status: "open", createdAt: daysAgo(1) });
    const closed = await seed({ name, closedAt: new Date() });
    const page = { page: 1, pageSize: 50 };

    const active = await run(listSupportMessages({ status: "active", q: name }, page));
    expect(active.rows.map((r) => r.id)).toEqual([newer, older]);
    expect(active.total).toBe(2);
    expect(active.rows[1]).toMatchObject({ organizationId, workspaceName: expect.any(String) });

    const onlyClosed = await run(listSupportMessages({ status: "closed", q: name }, page));
    expect(onlyClosed.rows.map((r) => r.id)).toEqual([closed]);

    const everything = await run(listSupportMessages({ q: name }, page));
    expect(everything.total).toBe(3);

    // `%` and `_` in a search are literal.
    expect((await run(listSupportMessages({ q: "%" }, page))).rows).toEqual([]);
  });

  it("purges messages 12 months after closing, or after their last change while not closed", async () => {
    const closedLongAgo = await seed({ createdAt: daysAgo(500), closedAt: daysAgo(380) });
    const closedRecently = await seed({ createdAt: daysAgo(500), closedAt: daysAgo(300) });
    const unansweredOld = await seed({ createdAt: daysAgo(380) });
    const openOld = await seed({ status: "open", createdAt: daysAgo(380) });
    const unansweredRecent = await seed({ createdAt: daysAgo(300) });
    const openedRecently = await seed({
      status: "open",
      createdAt: daysAgo(380),
      updatedAt: daysAgo(5),
    });
    const all = [
      closedLongAgo,
      closedRecently,
      unansweredOld,
      openOld,
      unansweredRecent,
      openedRecently,
    ];

    // In batches: the first takes two of the three expired messages, the next the last one.
    expect(await run(purgeSupportMessages(2))).toBe(2);
    expect(await run(purgeSupportMessages(2))).toBe(1);
    expect(await run(purgeSupportMessages(2))).toBe(0);
    expect(await remaining(all)).toEqual([closedRecently, unansweredRecent, openedRecently].sort());
  });

  it("keeps an old message that was closed recently and then reopened", async () => {
    const id = await seed({ createdAt: daysAgo(400), closedAt: daysAgo(10) });
    await run(setSupportStatus(id, "open", audit));
    await run(purgeSupportMessages(500));
    expect(await remaining([id])).toEqual([id]);
  });

  it("runs the purge as a job", async () => {
    const expired = await seed({ createdAt: daysAgo(400) });
    const kept = await seed({ createdAt: daysAgo(10) });
    const queued = await db((d) =>
      enqueueJob(d, { kind: MAINTENANCE_PURGE, payload: {}, maxAttempts: 1 }),
    );
    if (!("id" in queued)) throw new Error("not queued");
    const stats = await run(
      tick({
        worker: `${tag}-worker`,
        registry: JOB_REGISTRY,
        budgetMs: 30_000,
        ids: [queued.id],
        waitForRetries: false,
      }),
    );
    expect(stats.runs.map((r) => r.outcome)).toEqual(["succeeded"]);
    expect(await remaining([expired, kept])).toEqual([kept]);
  });

  it("queues one purge for the next UTC day by the database clock, however many drains ask", async () => {
    expect(maintenancePurgeJob("2026-04-01")).toMatchObject({
      idempotencyKey: `${MAINTENANCE_PURGE}:2026-04-01`,
      runAt: new Date("2026-04-01T00:00:00Z"),
    });
    await run(scheduleMaintenance());
    await run(scheduleMaintenance());
    const [clock] = await db((d) =>
      d
        .execute<{ day: string }>(
          sql`select to_char((now() at time zone 'UTC')::date + 1, 'YYYY-MM-DD') as day`,
        )
        .then((r) => r.rows),
    );
    const rows = await db((d) =>
      d
        .select({ key: jobs.idempotencyKey, runAt: jobs.runAt, state: jobs.state })
        .from(jobs)
        .where(sql`${jobs.idempotencyKey} like ${`${MAINTENANCE_PURGE}:%`}`),
    );
    expect(rows).toEqual([
      {
        key: `${MAINTENANCE_PURGE}:${clock!.day}`,
        runAt: new Date(`${clock!.day}T00:00:00Z`),
        state: "queued",
      },
    ]);
  });
});
