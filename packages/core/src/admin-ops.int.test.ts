/**
 * Operations metrics and job admin actions against real Postgres (and S3 for
 * the re-run path). Skipped unless INTEGRATION=1; see receipts.int.test.ts
 * for the setup. Ledger rows are seeded in March 2031 and the metrics are
 * read with `now` set there, so other suites' rows never fall in the window.
 */
import { FIXTURE_FAIL_MARKER } from "@receipt-ocr/ai";
import {
  adminAuditLog,
  and,
  eq,
  inArray,
  jobs,
  ocrRounds,
  receipts,
  sql,
  user,
} from "@receipt-ocr/db";
import { Effect, Exit, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  costQuery,
  failuresQuery,
  jobDetail,
  latencyQuery,
  listJobs,
  monthQuery,
  operationsOverview,
  opsWindow,
  peopleQuery,
  queueQuery,
  storageQuery,
  topWorkspacesQuery,
  volumeQuery,
} from "./admin-ops";
import { AppLayer, type AppServices } from "./index";
import { cancelQueuedJob, JOB_REGISTRY, rerunJob, setQueueControl, tick } from "./jobs";
import { claimRetry, ingestUpload } from "./pipeline";
import { Db } from "./services";
import { ensurePersonalWorkspace } from "./workspace";

const enabled = process.env.INTEGRATION === "1";
const runtime = ManagedRuntime.make(AppLayer);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromise(effect);
const runExit = <A, E>(effect: Effect.Effect<A, E, AppServices>) => runtime.runPromiseExit(effect);
type Client = Parameters<Parameters<typeof Db.Service.use>[0]>[0];
const db = <A>(f: (d: Client) => Promise<A>) => run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `ops-${Date.now()}`;
const NOW = new Date("2031-03-15T12:30:00Z");
const at = (iso: string) => new Date(iso);
const limits = { perMinute: 1000, perDay: 1000 };
const FAILING_JPEG = new Uint8Array([
  0xff,
  0xd8,
  0xff,
  0xe0,
  ...new TextEncoder().encode(tag + FIXTURE_FAIL_MARKER),
]);

async function createUser(name: string, createdAt?: Date) {
  const id = `${tag}-${name}`;
  const email = `${id}@example.com`;
  await db((d) =>
    d
      .insert(user)
      .values({ id, name, email, emailVerified: true, ...(createdAt ? { createdAt } : {}) }),
  );
  const organizationId = await run(ensurePersonalWorkspace({ id, name, email }));
  if (!organizationId) throw new Error("no workspace");
  return { userId: id, organizationId, role: "owner", email };
}

type Call = {
  model?: string | null;
  status?: string;
  latencyMs?: number;
  cost?: number | null;
  input?: number;
  output?: number;
  step?: number;
  jobAttempt?: number;
};

/** One round at `createdAt` with its calls, straight into the ledger. */
async function seedRound(
  owner: { userId: string; organizationId: string },
  createdAt: Date,
  calls: Call[],
) {
  const receiptId = crypto.randomUUID();
  await db((d) =>
    d
      .execute(
        sql`insert into ocr_rounds (receipt_id, organization_id, user_id, round, created_at)
      values (${receiptId}, ${owner.organizationId}, ${owner.userId}, 1, ${createdAt.toISOString()}::timestamptz)`,
      )
      .then((r) => r.rows),
  );
  for (const [i, c] of calls.entries()) {
    await db((d) =>
      d
        .execute(
          sql`insert into ocr_calls (receipt_id, organization_id, user_id, round, job_attempt,
          step, model, provider, status, latency_ms, input_tokens, output_tokens, cost_micro_usd, created_at)
        values (${receiptId}, ${owner.organizationId}, ${owner.userId}, 1, ${c.jobAttempt ?? 1},
          ${c.step ?? i}, ${c.model === undefined ? "google:model-a" : c.model}, 'google',
          ${c.status ?? "ok"}, ${c.latencyMs ?? 1000}, ${c.input ?? 100}, ${c.output ?? 10},
          ${c.cost === undefined ? 50 : c.cost}, ${createdAt.toISOString()}::timestamptz)`,
        )
        .then((r) => r.rows),
    );
  }
  return receiptId;
}

/** Runs a receipt's live job until it settles, skipping backoff waits. */
async function settle(receiptId: string) {
  for (let i = 0; i < 12; i++) {
    const [live] = await db((d) =>
      d
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.receiptId, receiptId), inArray(jobs.state, ["queued", "running"]))),
    );
    if (!live) return;
    await db((d) =>
      d
        .update(jobs)
        .set({ runAt: new Date(0) })
        .where(eq(jobs.id, live.id)),
    );
    await run(
      tick({
        worker: `${tag}-w`,
        registry: JOB_REGISTRY,
        budgetMs: 60_000,
        ids: [live.id],
        waitForRetries: false,
      }),
    );
  }
  throw new Error("job never settled");
}

const jobOf = async (receiptId: string) => {
  const [row] = await db((d) =>
    d
      .select()
      .from(jobs)
      .where(eq(jobs.receiptId, receiptId))
      .orderBy(sql`created_at desc`)
      .limit(1),
  );
  return row!;
};
const receiptOf = async (receiptId: string) => {
  const [row] = await db((d) => d.select().from(receipts).where(eq(receipts.id, receiptId)));
  return row!;
};
const auditFor = (targetId: string) =>
  db((d) => d.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, targetId)));

let a: Awaited<ReturnType<typeof createUser>>;
let b: Awaited<ReturnType<typeof createUser>>;
let auditor: { actor: { id: string; email: string }; ip: string };

beforeAll(async () => {
  if (!enabled) return;
  a = await createUser("a", at("2031-03-15T03:10:00Z"));
  b = await createUser("b", at("2031-03-14T23:00:00Z"));
  const admin = await createUser("admin");
  auditor = { actor: { id: admin.userId, email: admin.email }, ip: "203.0.113.7" };

  // Hour 10: model A makes ten calls (100..1000 ms). Round 1: five timeouts, then a read.
  // Round 2: a read of four calls. B's round fails with one unpriced rate-limited call.
  const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
  await seedRound(a, at("2031-03-15T10:05:00Z"), [
    ...latencies.slice(0, 5).map((ms) => ({ latencyMs: ms, status: "timeout", cost: 0 })),
    { latencyMs: latencies[5]!, cost: 0 },
  ]);
  await seedRound(
    a,
    at("2031-03-15T10:40:00Z"),
    latencies.slice(6).map((ms) => ({ latencyMs: ms, cost: 100 })),
  );
  await seedRound(b, at("2031-03-15T10:50:00Z"), [
    { model: "google:model-b", status: "rate-limited", latencyMs: 5000, cost: null },
  ]);
  // Hour 12 (the current one): workspace B is read by model B.
  await seedRound(b, at("2031-03-15T12:01:00Z"), [
    { model: "google:model-b", latencyMs: 2000, cost: 1000 },
  ]);
  // Outside the 24 h window, inside 7 d.
  await seedRound(a, at("2031-03-10T09:00:00Z"), [{ latencyMs: 400, cost: 7 }]);
  // Sessions: A signs in in hour 11; an impersonated session for B never counts.
  await db((d) =>
    d
      .execute(
        sql`insert into session (id, expires_at, token, user_id, impersonated_by, created_at, updated_at) values
      (${`${tag}-s1`}, now() + interval '1 day', ${`${tag}-t1`}, ${a.userId}, null,
        '2031-03-15T11:00:00Z', '2031-03-15T11:30:00Z'),
      (${`${tag}-s2`}, now() + interval '1 day', ${`${tag}-t2`}, ${b.userId}, ${a.userId},
        '2031-03-13T08:00:00Z', '2031-03-13T08:00:00Z')`,
      )
      .then((r) => r.rows),
  );
});

afterAll(async () => {
  if (!enabled) return;
  await db((d) =>
    d
      .execute(
        sql`delete from ocr_calls where user_id like ${`${tag}-%`};
      delete from ocr_rounds where user_id like ${`${tag}-%`};
      delete from jobs where user_id like ${`${tag}-%`}`,
      )
      .then((r) => r.rows),
  ).catch(() => undefined);
  await db((d) =>
    d
      .execute(sql`delete from job_controls where scope = 'kind:receipt.extract'`)
      .then((r) => r.rows),
  );
  await runtime.dispose();
});

describe.skipIf(!enabled)("operations metrics", () => {
  const w = opsWindow("24h", NOW);

  it("buckets rounds by hour, zero-filled, with a success rate over settled rounds", async () => {
    const volume = await db((d) => volumeQuery(d, w));
    expect(volume.points).toHaveLength(24);
    expect(volume.points.at(-1)!.t).toBe("2031-03-15T12");
    const hour = (h: string) => volume.points.find((p) => p.t === `2031-03-15T${h}`)!;
    expect(hour("10")).toEqual({ t: "2031-03-15T10", ok: 2, failed: 1, inFlight: 0 });
    expect(hour("12")).toMatchObject({ ok: 1, failed: 0 });
    expect(hour("11")).toMatchObject({ ok: 0, failed: 0, inFlight: 0 });
    expect(volume.totals).toEqual({ ok: 3, failed: 1, inFlight: 0 });
    expect(volume.successRate).toBeCloseTo(0.75);

    const week = await db((d) => volumeQuery(d, opsWindow("7d", NOW)));
    expect(week.points).toHaveLength(7);
    expect(week.points.find((p) => p.t === "2031-03-10")).toMatchObject({ ok: 1 });
  });

  it("computes p50 and p95 per model with percentile_cont, nulls where a model made no calls", async () => {
    const latency = await db((d) => latencyQuery(d, w));
    expect(latency.models).toEqual(["google:model-a", "google:model-b"]);
    // Ten calls 100..1000 ms, linear interpolation.
    expect(latency.byModel["google:model-a"]).toEqual({ p50: 550, p95: 955, calls: 10 });
    expect(latency.byModel["google:model-b"]).toMatchObject({ calls: 2, p50: 3500 });
    const ten = latency.points.find((p) => p.t === "2031-03-15T10")!;
    expect(ten.byModel["google:model-a"]).toEqual({ p50: 550, p95: 955, calls: 10 });
    const eleven = latency.points.find((p) => p.t === "2031-03-15T11")!;
    expect(eleven.byModel["google:model-a"]).toBeNull();
    expect(latency.overall?.calls).toBe(12);
  });

  it("sums tokens and cost per model and bucket, and counts unpriced calls", async () => {
    const cost = await db((d) => costQuery(d, w));
    expect(cost.byModel["google:model-a"]).toMatchObject({
      calls: 10,
      costMicroUsd: 400,
      inputTokens: 1000,
    });
    expect(cost.byModel["google:model-b"]).toMatchObject({ costMicroUsd: 1000, unpriced: 1 });
    expect(cost.models[0]).toBe("google:model-b");
    expect(cost.total.costMicroUsd).toBe(1400);
    const twelve = cost.points.find((p) => p.t === "2031-03-15T12")!;
    expect(twelve.byModel["google:model-a"]!.calls).toBe(0);
  });

  it("ranks workspaces by cost and folds the rest into Other", async () => {
    const top = await db((d) => topWorkspacesQuery(d, w));
    expect(top.map((r) => r.organizationId)).toEqual([b.organizationId, a.organizationId]);
    expect(top[0]).toMatchObject({ costMicroUsd: 1000, reads: 1, other: false });
    const folded = await db((d) => topWorkspacesQuery(d, w, 1));
    expect(folded).toHaveLength(2);
    expect(folded[1]).toMatchObject({ other: true, workspaces: 1, costMicroUsd: 400, reads: 2 });
  });

  it("breaks failures down by call status", async () => {
    const failures = await db((d) => failuresQuery(d, w));
    expect(failures.calls).toEqual([
      { kind: "timeout", count: 5 },
      { kind: "rate-limited", count: 1 },
    ]);
  });

  it("counts sign-ups and distinct active users, leaving impersonation out", async () => {
    const people = await db((d) => peopleQuery(d, opsWindow("7d", NOW)));
    expect(people.signups).toBe(2);
    // A and B uploaded; B's only session is an impersonation.
    expect(people.active).toBe(2);
    const day13 = people.points.find((p) => p.t === "2031-03-13")!;
    expect(day13.active).toBe(0);
    const day15 = people.points.find((p) => p.t === "2031-03-15")!;
    expect(day15).toMatchObject({ signups: 1, active: 2 });
  });

  it("projects the month from the last 7 days", async () => {
    const month = await db((d) => monthQuery(d, NOW));
    expect(month.month).toBe("2031-03");
    expect(month.monthToDateMicroUsd).toBe(1407);
    expect(month.dailyRunRateMicroUsd).toBe(Math.round(1407 / 7));
    expect(month.projectedMicroUsd).toBeGreaterThan(1407);
    expect(month.unpriced).toBe(1);
  });

  it("reads the database size without extra privileges", async () => {
    const storage = await db((d) => storageQuery(d));
    expect(storage.databaseBytes).toBeGreaterThan(0);
    expect(storage.tables.map((t) => t.name)).toContain("ocr_calls");
  });

  it("returns the previous period when comparing", async () => {
    const overview = await run(operationsOverview("24h", { now: NOW, compare: true }));
    expect(overview.previous?.window.end.toISOString()).toBe(w.start.toISOString());
    expect(overview.previous?.cost).toHaveLength(24);
    expect(overview.volume.totals.ok).toBe(3);
  });
});

describe.skipIf(!enabled)("queue snapshot and job list", () => {
  it("counts queued, due, retrying and dead jobs and shows pauses in force", async () => {
    const before = await db((d) => queueQuery(d));
    await db((d) =>
      d
        .execute(
          sql`insert into jobs (kind, payload, max_attempts, user_id, organization_id, attempts, run_at, state, finished_at, last_error_kind) values
        ('test.ops', '{}', 3, ${a.userId}, ${a.organizationId}, 0, now() - interval '1 minute', 'queued', null, null),
        ('test.ops', '{}', 3, ${a.userId}, ${a.organizationId}, 1, now() + interval '1 hour', 'queued', null, 'timeout'),
        ('test.ops', '{}', 3, ${b.userId}, ${b.organizationId}, 3, now(), 'dead', now(), 'timeout')`,
        )
        .then((r) => r.rows),
    );
    await run(
      setQueueControl(
        JOB_REGISTRY,
        { scope: "kind:receipt.extract", paused: true, reason: "test" },
        auditor,
      ),
    );
    const after = await db((d) => queueQuery(d));
    expect(after.queued - before.queued).toBe(2);
    expect(after.due - before.due).toBe(1);
    expect(after.retrying - before.retrying).toBe(1);
    expect(after.dead24h - before.dead24h).toBe(1);
    expect(after.oldestDueSeconds).toBeGreaterThanOrEqual(59);
    expect(after.byKind.find((k) => k.kind === "test.ops")?.queued).toBeGreaterThanOrEqual(2);
    expect(after.controls.find((c) => c.scope === "kind:receipt.extract")).toMatchObject({
      paused: true,
      reason: "test",
      updatedBy: auditor.actor.email,
    });

    await run(
      setQueueControl(JOB_REGISTRY, { scope: "kind:receipt.extract", paused: false }, auditor),
    );
    const resumed = await db((d) => queueQuery(d));
    expect(resumed.controls.find((c) => c.scope === "kind:receipt.extract")).toBeUndefined();
    const audit = await auditFor("kind:receipt.extract");
    expect(audit.map((r) => r.action).sort()).toEqual(["job.pause", "job.resume"]);
  });

  it("refuses unknown scopes", async () => {
    const exit = await runExit(
      setQueueControl(JOB_REGISTRY, { scope: "kind:nope", paused: true }, auditor),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const inherited = await runExit(
      setQueueControl(JOB_REGISTRY, { scope: "kind:constructor", paused: true }, auditor),
    );
    expect(Exit.isFailure(inherited)).toBe(true);
    const bad = await runExit(
      setQueueControl(JOB_REGISTRY, { scope: "drop table", paused: true }, auditor),
    );
    expect(Exit.isFailure(bad)).toBe(true);
  });

  it("filters by state, kind, error kind and workspace", async () => {
    const mine = await run(
      listJobs({ q: a.organizationId, kind: "test.ops" }, { page: 1, pageSize: 25 }),
    );
    expect(mine.total).toBe(2);
    expect(mine.rows.every((r) => r.organizationId === a.organizationId)).toBe(true);
    const dead = await run(
      listJobs({ q: b.email, state: "dead", errorKind: "timeout" }, { page: 1, pageSize: 25 }),
    );
    expect(dead.rows).toHaveLength(1);
    expect(dead.rows[0]).toMatchObject({ userEmail: b.email, workspaceName: expect.any(String) });
    const none = await run(
      listJobs({ q: a.organizationId, state: "running" }, { page: 1, pageSize: 25 }),
    );
    expect(none).toEqual({ rows: [], total: 0, capped: false });
    const pastEnd = await run(listJobs({ q: a.organizationId }, { page: 9, pageSize: 25 }));
    expect(pastEnd.total).toBe(2);
  });
});

describe.skipIf(!enabled)("job admin actions", () => {
  const deadUpload = async (owner: typeof a) => {
    const { receipt } = await run(
      ingestUpload({ scope: owner, fileName: "f.jpg", body: FAILING_JPEG, limits }),
    );
    await settle(receipt.id);
    return receipt.id;
  };

  it("re-runs a dead job under the same round, without a new quota round, and audits it", async () => {
    const receiptId = await deadUpload(a);
    const job = await jobOf(receiptId);
    expect(job.state).toBe("dead");
    expect((await receiptOf(receiptId)).status).toBe("failed");
    const rounds = () =>
      db((d) => d.select().from(ocrRounds).where(eq(ocrRounds.receiptId, receiptId)));
    expect(await rounds()).toHaveLength(1);

    await run(rerunJob(JOB_REGISTRY, job.id, auditor, { reason: "provider outage" }));
    const requeued = await jobOf(receiptId);
    expect(requeued).toMatchObject({ id: job.id, state: "queued", attempts: job.attempts });
    expect(requeued.maxAttempts).toBe(job.attempts + 4);
    expect((requeued.attemptLog as { outcome: string }[]).at(-1)?.outcome).toBe("admin-rerun");
    expect((await receiptOf(receiptId)).status).toBe("processing");
    expect(await rounds()).toHaveLength(1);

    const [entry] = await auditFor(job.id);
    expect(entry).toMatchObject({
      action: "job.rerun",
      targetType: "job",
      actorEmail: auditor.actor.email,
      reason: "provider outage",
    });
    expect(entry!.metadata).toMatchObject({ from: "dead", round: 1, quota: "not-charged" });

    // It runs again with new attempt numbers, so its calls are billed, not dropped.
    await settle(receiptId);
    const calls = await db((d) =>
      d
        .execute<{ n: number }>(
          sql`select count(distinct job_attempt)::int as n from ocr_calls where receipt_id = ${receiptId}`,
        )
        .then((r) => r.rows),
    );
    expect(calls[0]!.n).toBeGreaterThan(job.attempts);
    const detail = await run(jobDetail(job.id));
    expect(detail?.calls.length).toBeGreaterThan(job.attempts);
    expect(detail?.receipt).toEqual({ status: "failed", attempts: 1 });
  });

  it("refuses a re-run once the user retried, and for jobs that aren't dead", async () => {
    const receiptId = await deadUpload(b);
    const old = await jobOf(receiptId);
    await run(claimRetry({ receiptId, scope: b, limits }));
    const current = await jobOf(receiptId);
    expect(current.id).not.toBe(old.id);

    const superseded = await runExit(rerunJob(JOB_REGISTRY, old.id, auditor));
    expect(Exit.isFailure(superseded)).toBe(true);
    const live = await runExit(rerunJob(JOB_REGISTRY, current.id, auditor));
    expect(Exit.isFailure(live)).toBe(true);
    expect(await auditFor(old.id)).toHaveLength(0);
  });

  it("respects the service-wide daily cap", async () => {
    const receiptId = await deadUpload(a);
    const job = await jobOf(receiptId);
    const exit = await runExit(rerunJob(JOB_REGISTRY, job.id, auditor, { dailyCap: 1 }));
    expect(Exit.isFailure(exit)).toBe(true);
    expect((await jobOf(receiptId)).state).toBe("dead");
  });

  it("cancels a queued job, fails its receipt, and audits it", async () => {
    await run(
      setQueueControl(JOB_REGISTRY, { scope: "queue", paused: true, reason: "hold" }, auditor),
    );
    try {
      const { receipt } = await run(
        ingestUpload({ scope: a, fileName: "q.jpg", body: FAILING_JPEG, limits }),
      );
      const job = await jobOf(receipt.id);
      expect(job.state).toBe("queued");
      await run(cancelQueuedJob(JOB_REGISTRY, job.id, auditor, "stuck"));
      expect((await jobOf(receipt.id)).state).toBe("cancelled");
      expect((await receiptOf(receipt.id)).status).toBe("failed");
      const [entry] = await auditFor(job.id);
      expect(entry).toMatchObject({ action: "job.cancel", reason: "stuck" });
      const again = await runExit(cancelQueuedJob(JOB_REGISTRY, job.id, auditor));
      expect(Exit.isFailure(again)).toBe(true);
    } finally {
      await run(setQueueControl(JOB_REGISTRY, { scope: "queue", paused: false }, auditor));
    }
  });
});
