/**
 * Support messages against real Postgres: submission dedupe, receipt scoping, the per-user cap,
 * the notify job, and account deletion. Skipped unless INTEGRATION=1.
 */
import { randomUUID } from "node:crypto";
import {
  eq,
  inArray,
  jobs,
  organization,
  receipts,
  sql,
  supportMessages,
  user,
} from "@receipt-ocr/db";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prepareUserDeletion } from "../src/admin";
import { makeAppLayer, type AppServices } from "../src/index";
import {
  ContactReplyMailer,
  JOB_REGISTRY,
  SUPPORT_NOTIFY,
  SupportNotifyMailer,
  tick,
  WelcomeMailer,
  type SupportNotice,
} from "../src/jobs";
import { Db } from "../src/services";
import { SUPPORT_USER_CAP, submitSupportMessage, type SupportSubmission } from "../src/support";
import { ensurePersonalWorkspace } from "../src/workspace";

const enabled = process.env.INTEGRATION === "1";
const notices: SupportNotice[] = [];
const runtime = ManagedRuntime.make(
  makeAppLayer(
    Layer.mergeAll(
      WelcomeMailer.Disabled,
      ContactReplyMailer.Disabled,
      Layer.succeed(SupportNotifyMailer, {
        send: (notice) => Effect.sync(() => (notices.push(notice), "delivered" as const)),
      }),
    ),
  ),
);
const run = <A, E>(effect: Effect.Effect<A, E, AppServices | SupportNotifyMailer>) =>
  runtime.runPromise(effect);
const db = <A>(f: (d: Parameters<Parameters<typeof Db.Service.use>[0]>[0]) => Promise<A>) =>
  run(Effect.flatMap(Db, ({ use }) => use(f)));

const tag = `sup-${Date.now()}`;

async function createUser(name: string) {
  const id = `${tag}-${name}`;
  const email = `${id}@example.com`;
  await db((d) => d.insert(user).values({ id, name, email, emailVerified: true }));
  const organizationId = await run(ensurePersonalWorkspace({ id, name, email }));
  if (!organizationId) throw new Error("no workspace");
  return { userId: id, organizationId, email };
}

const message = (over: Partial<SupportSubmission> = {}): SupportSubmission => ({
  submissionId: randomUUID(),
  kind: "question",
  name: "Test Sender",
  email: `${tag}-visitor@example.com`,
  message: "Hello, a question about receipts",
  sender: null,
  ...over,
});

const rowsWhere = (where: ReturnType<typeof eq>) =>
  db((d) => d.select().from(supportMessages).where(where));

const notifyJobs = (messageId: string) =>
  db((d) =>
    d
      .select({ id: jobs.id, payload: jobs.payload })
      .from(jobs)
      .where(
        sql`${jobs.kind} = ${SUPPORT_NOTIFY} and ${jobs.payload}->>'messageId' = ${messageId}`,
      ),
  );

describe.skipIf(!enabled)("support messages against Postgres", () => {
  let alice: Awaited<ReturnType<typeof createUser>>;
  let bob: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
  });

  afterAll(async () => {
    await db(async (d) => {
      await d.delete(supportMessages).where(sql`${supportMessages.email} like ${`${tag}%`}`);
      await d.delete(jobs).where(eq(jobs.kind, SUPPORT_NOTIFY));
      await d.delete(organization).where(sql`${organization.slug} like ${`${tag}%`}`);
      await d.delete(user).where(sql`${user.id} like ${`${tag}%`}`);
    });
    await runtime.dispose();
  });

  it("stores a retried submission once, with one notify job", async () => {
    const input = message();
    const first = await run(submitSupportMessage(input));
    const again = await run(submitSupportMessage({ ...input, message: "A different text" }));
    expect(first).toMatchObject({ kind: "stored", source: "public", receiptId: null });
    expect(again).toEqual({ kind: "duplicate" });
    const rows = await rowsWhere(eq(supportMessages.submissionId, input.submissionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "new", message: input.message, userId: null });
    if (first.kind !== "stored") throw new Error("not stored");
    expect(await notifyJobs(first.id)).toHaveLength(1);
  });

  it("links a receipt only when it is in the sender's active workspace", async () => {
    const [mine] = await db((d) =>
      d
        .insert(receipts)
        .values({ organizationId: alice.organizationId, userId: alice.userId })
        .returning({ id: receipts.id }),
    );
    const [theirs] = await db((d) =>
      d
        .insert(receipts)
        .values({ organizationId: bob.organizationId, userId: bob.userId })
        .returning({ id: receipts.id }),
    );
    const sender = { userId: alice.userId, organizationId: alice.organizationId };

    const linked = await run(
      submitSupportMessage(message({ kind: "problem", sender, receiptId: mine!.id })),
    );
    expect(linked).toMatchObject({ kind: "stored", source: "receipt", receiptId: mine!.id });

    const foreign = await run(
      submitSupportMessage(message({ kind: "problem", sender, receiptId: theirs!.id })),
    );
    expect(foreign).toMatchObject({ kind: "stored", source: "help", receiptId: null });

    const visitor = await run(submitSupportMessage(message({ receiptId: mine!.id })));
    expect(visitor).toMatchObject({ kind: "stored", source: "public", receiptId: null });

    const junk = await run(submitSupportMessage(message({ sender, receiptId: "not-a-uuid" })));
    expect(junk).toMatchObject({ kind: "stored", receiptId: null });

    if (linked.kind !== "stored") throw new Error("not stored");
    const [row] = await rowsWhere(eq(supportMessages.id, linked.id));
    expect(row).toMatchObject({
      userId: alice.userId,
      organizationId: alice.organizationId,
      receiptId: mine!.id,
    });
  });

  it("refuses a signed-in sender over the cap and keeps nothing of the refused message", async () => {
    const carol = await createUser("carol");
    const sender = { userId: carol.userId, organizationId: carol.organizationId };
    for (let i = 0; i < SUPPORT_USER_CAP.max; i++) {
      expect(await run(submitSupportMessage(message({ sender })))).toMatchObject({
        kind: "stored",
      });
    }
    const over = message({ sender });
    expect(await run(submitSupportMessage(over))).toEqual({ kind: "rate-limited" });
    expect(await rowsWhere(eq(supportMessages.userId, carol.userId))).toHaveLength(
      SUPPORT_USER_CAP.max,
    );
    expect(await rowsWhere(eq(supportMessages.submissionId, over.submissionId))).toEqual([]);
  });

  it("mails a stored message from the job, and skips one deleted before it ran", async () => {
    const kept = await run(submitSupportMessage(message({ message: "Please call me back" })));
    const gone = await run(submitSupportMessage(message()));
    if (kept.kind !== "stored" || gone.kind !== "stored") throw new Error("not stored");
    await db((d) => d.delete(supportMessages).where(eq(supportMessages.id, gone.id)));
    const [keptJob] = await notifyJobs(kept.id);
    const [goneJob] = await notifyJobs(gone.id);

    notices.length = 0;
    const stats = await run(
      tick({
        worker: `${tag}-worker`,
        registry: JOB_REGISTRY,
        budgetMs: 30_000,
        ids: [keptJob!.id, goneJob!.id],
        waitForRetries: false,
      }),
    );
    expect(stats.runs.map((r) => r.outcome).sort()).toEqual(["succeeded", "succeeded"]);
    expect(notices).toEqual([
      expect.objectContaining({ message: "Please call me back", jobId: keptJob!.id }),
    ]);
  });

  it("deletes the account's messages by user id and by address, and nobody else's", async () => {
    const dana = await createUser("dana");
    const signedIn = message({
      sender: { userId: dana.userId, organizationId: dana.organizationId },
      email: `${tag}-other-address@example.com`,
    });
    const signedOut = message({ email: dana.email.toUpperCase() });
    const stranger = message();
    for (const m of [signedIn, signedOut, stranger]) await run(submitSupportMessage(m));

    await run(prepareUserDeletion(dana.userId));
    // Better Auth deletes the user row after prepareUserDeletion.
    await db((d) => d.delete(user).where(eq(user.id, dana.userId)));

    const left = await db((d) =>
      d
        .select({ submissionId: supportMessages.submissionId })
        .from(supportMessages)
        .where(
          inArray(supportMessages.submissionId, [
            signedIn.submissionId,
            signedOut.submissionId,
            stranger.submissionId,
          ]),
        ),
    );
    expect(left.map((r) => r.submissionId)).toEqual([stranger.submissionId]);
  });

  it("keeps a message when its workspace or receipt is deleted, without the link", async () => {
    const erin = await createUser("erin");
    const [receipt] = await db((d) =>
      d
        .insert(receipts)
        .values({ organizationId: erin.organizationId, userId: erin.userId })
        .returning({ id: receipts.id }),
    );
    const stored = await run(
      submitSupportMessage(
        message({
          kind: "problem",
          sender: { userId: erin.userId, organizationId: erin.organizationId },
          receiptId: receipt!.id,
        }),
      ),
    );
    if (stored.kind !== "stored") throw new Error("not stored");
    await db((d) => d.delete(organization).where(eq(organization.id, erin.organizationId)));
    const [row] = await rowsWhere(eq(supportMessages.id, stored.id));
    expect(row).toMatchObject({ userId: erin.userId, organizationId: null, receiptId: null });
  });
});
