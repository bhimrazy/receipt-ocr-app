import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  gt,
  isNull,
  or,
  receipts,
  sql,
  SUPPORT_KINDS,
  supportMessages,
  type SUPPORT_SOURCES,
} from "@receipt-ocr/db";
import { Effect } from "effect";
import type { Tx } from "./audit";
import { isUuid } from "./ids";
import { enqueueJob } from "./jobs/queue";
import { supportNotifyJob } from "./jobs/kinds/support-notify";
import { Db } from "./services";

export type SupportKind = (typeof SUPPORT_KINDS)[number];
export type SupportSource = (typeof SUPPORT_SOURCES)[number];

/** Per signed-in sender, on top of the route's per-IP limit: a shared NAT shares one IP bucket. */
export const SUPPORT_USER_CAP = { windowMs: 24 * 60 * 60_000, max: 10 };

/** First key of the per-sender advisory lock; the other namespaces are in usage.ts and billing. */
const SUPPORT_LOCK_NAMESPACE = 7_304;

export type SupportSubmission = {
  /** Client-generated; a retry with the same id, address and sender stores nothing new. */
  submissionId: string;
  kind: SupportKind;
  name: string;
  /** Stored lowercased. */
  email: string;
  message: string;
  /** The signed-in sender and their active workspace, or null for a visitor. */
  sender: { userId: string; organizationId: string } | null;
  /** Kept only when it is in the sender's active workspace. */
  receiptId?: string | null;
};

export type SupportSubmitResult =
  | { kind: "stored"; id: string; source: SupportSource; receiptId: string | null }
  | { kind: "duplicate" }
  | { kind: "rate-limited" };

/**
 * Stores the message and queues the support-inbox notification in one transaction, so a stored
 * message is always notified and a failed insert queues nothing. Sending happens in the job.
 */
export const submitSupportMessage = (input: SupportSubmission) =>
  Effect.flatMap(Db, ({ use }) => use((db) => db.transaction((tx) => store(tx, input))));

async function store(tx: Tx, input: SupportSubmission): Promise<SupportSubmitResult> {
  const { sender } = input;
  const email = input.email.toLowerCase();
  const sameSender = { email, userId: sender?.userId ?? null };
  // Held to commit, so concurrent sends from one user are counted one after another.
  if (sender) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${SUPPORT_LOCK_NAMESPACE}, hashtext(${sender.userId}))`,
    );
  }

  let submissionId = input.submissionId;
  const earlier = await submittedAs(tx, submissionId);
  if (earlier) {
    if (isSame(earlier, sameSender)) return { kind: "duplicate" };
    submissionId = randomUUID();
  }

  if (sender && (await recentCount(tx, sender.userId)) >= SUPPORT_USER_CAP.max) {
    return { kind: "rate-limited" };
  }

  const receiptId =
    sender && input.receiptId ? await workspaceReceipt(tx, input.receiptId, sender) : null;
  const source: SupportSource = receiptId ? "receipt" : sender ? "help" : "public";
  const values = {
    kind: input.kind,
    source,
    userId: sender?.userId ?? null,
    organizationId: sender?.organizationId ?? null,
    receiptId,
    name: input.name,
    email,
    message: input.message,
  };
  let [row] = await tx
    .insert(supportMessages)
    .values({ ...values, submissionId })
    .onConflictDoNothing({ target: supportMessages.submissionId })
    .returning({ id: supportMessages.id });
  if (!row) {
    // A concurrent request inserted this id after the check above.
    const winner = await submittedAs(tx, submissionId);
    if (winner && isSame(winner, sameSender)) return { kind: "duplicate" };
    [row] = await tx
      .insert(supportMessages)
      .values({ ...values, submissionId: randomUUID() })
      .returning({ id: supportMessages.id });
    if (!row) throw new Error("support message insert returned no row");
  }

  await enqueueJob(tx, supportNotifyJob(row.id));
  return { kind: "stored", id: row.id, source, receiptId };
}

type Origin = { email: string; userId: string | null };

const isSame = (a: Origin, b: Origin) => a.email === b.email && a.userId === b.userId;

async function submittedAs(tx: Tx, submissionId: string): Promise<Origin | null> {
  const [row] = await tx
    .select({ email: supportMessages.email, userId: supportMessages.userId })
    .from(supportMessages)
    .where(eq(supportMessages.submissionId, submissionId))
    .limit(1);
  return row ?? null;
}

async function recentCount(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(supportMessages)
    .where(
      and(
        eq(supportMessages.userId, userId),
        gt(
          supportMessages.createdAt,
          sql`now() - make_interval(secs => ${SUPPORT_USER_CAP.windowMs / 1000})`,
        ),
      ),
    );
  return row?.n ?? 0;
}

async function workspaceReceipt(
  tx: Tx,
  receiptId: string,
  sender: { organizationId: string },
): Promise<string | null> {
  if (!isUuid(receiptId)) return null;
  const [row] = await tx
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.organizationId, sender.organizationId)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * For account deletion: the messages sent signed out from the account's address. Rows another
 * signed-in user sent with this address as their reply address stay with that user.
 */
export const deleteSupportMessagesFrom = (
  tx: Pick<Tx, "delete">,
  account: { userId: string; email: string },
) =>
  tx
    .delete(supportMessages)
    .where(
      and(
        sql`lower(${supportMessages.email}) = lower(${account.email})`,
        or(isNull(supportMessages.userId), eq(supportMessages.userId, account.userId)),
      ),
    );
