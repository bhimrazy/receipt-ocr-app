import {
  and,
  eq,
  gt,
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

export const isSupportKind = (value: string): value is SupportKind =>
  (SUPPORT_KINDS as readonly string[]).includes(value);

/** Per signed-in sender, on top of the route's per-IP limit: a shared NAT shares one IP bucket. */
export const SUPPORT_USER_CAP = { windowMs: 24 * 60 * 60_000, max: 10 };

export type SupportSubmission = {
  /** Client-generated; a retry with the same id stores nothing new. */
  submissionId: string;
  kind: SupportKind;
  name: string;
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

const OVER_CAP = Symbol("support-over-cap");

/**
 * Stores the message and queues the support-inbox notification in one transaction, so a stored
 * message is always notified and a failed insert queues nothing. Sending happens in the job.
 */
export const submitSupportMessage = (input: SupportSubmission) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<SupportSubmitResult> => {
      try {
        return await db.transaction((tx) => store(tx, input));
      } catch (error) {
        if (error === OVER_CAP) return { kind: "rate-limited" };
        throw error;
      }
    }),
  );

async function store(tx: Tx, input: SupportSubmission): Promise<SupportSubmitResult> {
  const { sender } = input;
  const receiptId =
    sender && input.receiptId ? await workspaceReceipt(tx, input.receiptId, sender) : null;
  const source: SupportSource = receiptId ? "receipt" : sender ? "help" : "public";
  const [row] = await tx
    .insert(supportMessages)
    .values({
      submissionId: input.submissionId,
      kind: input.kind,
      source,
      userId: sender?.userId ?? null,
      organizationId: sender?.organizationId ?? null,
      receiptId,
      name: input.name,
      email: input.email,
      message: input.message,
    })
    .onConflictDoNothing({ target: supportMessages.submissionId })
    .returning({ id: supportMessages.id });
  if (!row) return { kind: "duplicate" };

  if (sender) {
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(supportMessages)
      .where(
        and(
          eq(supportMessages.userId, sender.userId),
          gt(
            supportMessages.createdAt,
            sql`now() - make_interval(secs => ${SUPPORT_USER_CAP.windowMs / 1000})`,
          ),
        ),
      );
    if ((recent?.n ?? 0) > SUPPORT_USER_CAP.max) throw OVER_CAP;
  }

  await enqueueJob(tx, supportNotifyJob(row.id));
  return { kind: "stored", id: row.id, source, receiptId };
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

/** For account deletion: the signed-out messages sent from the account's address. */
export const deleteSupportMessagesFrom = (tx: Pick<Tx, "delete">, email: string) =>
  tx.delete(supportMessages).where(sql`lower(${supportMessages.email}) = lower(${email})`);
