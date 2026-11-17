/**
 * A contact-form reply's payload (the visitor's address and name) is emptied on every way a job can end, not only
 * when it succeeds or dies in a run: a lease that expires on the last attempt, a cancel, and an admin cancel. A
 * scrubbed job can't be re-run. Skipped unless INTEGRATION=1.
 */
import { eq, inArray, jobs, user } from "@receipt-ocr/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeAppLayer, type AppServices } from "../../src/index";
import {
  cancelJob,
  cancelQueuedJob,
  CONTACT_REPLY,
  ContactReplyMailer,
  JOB_REGISTRY,
  rerunJob,
  SupportNotifyMailer,
  WelcomeMailer,
} from "../../src/jobs";
import { JobQueue } from "../../src/jobs/queue";
import { Db } from "../../src/services";

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

const tag = `scrub-${Date.now()}`;
const payload = { to: "visitor@example.com", name: "Visitor", topic: "general" };
const OTHER = `test.scrub.${tag}`;

async function seed(over: { kind?: string; state: "queued" | "running"; attempts?: number }) {
  const [row] = await db((d) =>
    d
      .insert(jobs)
      .values({
        kind: over.kind ?? CONTACT_REPLY,
        state: over.state,
        payload,
        attempts: over.attempts ?? 0,
        maxAttempts: 3,
        ...(over.state === "running"
          ? { lockedBy: `${tag}-gone`, lockedUntil: new Date(Date.now() - 1000) }
          : {}),
      })
      .returning({ id: jobs.id }),
  );
  return row!.id;
}

const stored = async (id: string) =>
  (await db((d) => d.select().from(jobs).where(eq(jobs.id, id))))[0]!;

describe.skipIf(!enabled)("payload scrubbing on every terminal path", () => {
  const adminId = `${tag}-admin`;
  const audit = { actor: { id: adminId, email: `${adminId}@example.com` }, ip: null };
  const ids: string[] = [];

  beforeAll(async () => {
    await db((d) =>
      d.insert(user).values({ id: adminId, name: "A", email: `${adminId}@example.com` }),
    );
  });

  afterAll(async () => {
    await db(async (d) => {
      await d.delete(jobs).where(inArray(jobs.id, ids));
      await d.delete(user).where(eq(user.id, adminId));
    });
    await runtime.dispose();
  });

  it("empties a reply reaped dead, keeps one reaped back to queued, and returns the payload it had", async () => {
    const last = await seed({ state: "running", attempts: 3 });
    const retry = await seed({ state: "running", attempts: 1 });
    const other = await seed({ kind: OTHER, state: "running", attempts: 3 });
    ids.push(last, retry, other);
    const reaped = await run(
      Effect.flatMap(JobQueue, (q) => q.reap({ scrubKinds: [CONTACT_REPLY] })),
    );
    expect(reaped.find((j) => j.id === last)).toMatchObject({ state: "dead", payload });
    expect(await stored(last)).toMatchObject({ state: "dead", payload: {} });
    expect(await stored(retry)).toMatchObject({ state: "queued", payload });
    expect(await stored(other)).toMatchObject({ state: "dead", payload });
  });

  it("empties a reply when it is cancelled", async () => {
    const id = await seed({ state: "queued" });
    ids.push(id);
    expect(await run(cancelJob(JOB_REGISTRY, id))).toBe(true);
    expect(await stored(id)).toMatchObject({ state: "cancelled", payload: {} });
  });

  it("empties a reply an admin cancels, and refuses to re-run it", async () => {
    const id = await seed({ state: "queued" });
    ids.push(id);
    await run(cancelQueuedJob(JOB_REGISTRY, id, audit, "test"));
    expect(await stored(id)).toMatchObject({ state: "cancelled", payload: {} });
    await expect(run(rerunJob(JOB_REGISTRY, id, audit))).rejects.toThrow(
      "This job's details were deleted when it ended",
    );
    expect(await stored(id)).toMatchObject({ state: "cancelled" });
  });
});
