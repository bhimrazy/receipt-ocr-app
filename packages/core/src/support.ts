import { randomUUID } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  organization,
  receipts,
  sql,
  SUPPORT_KINDS,
  supportMessages,
  type SQL,
  type SUPPORT_SOURCES,
  type SUPPORT_STATUSES,
} from "@receipt-ocr/db";
import { Effect } from "effect";
import { insertAudit, transact, type AuditActor, type Tx } from "./audit";
import { NotFound } from "./errors";
import { isUuid } from "./ids";
import { enqueueJob } from "./jobs/queue";
import { supportNotifyJob } from "./jobs/kinds/support-notify";
import { LOCK_NAMESPACES } from "./locks";
import { Db } from "./services";

export type SupportKind = (typeof SUPPORT_KINDS)[number];
export type SupportSource = (typeof SUPPORT_SOURCES)[number];

/** Per signed-in sender, on top of the route's per-IP limit: a shared NAT shares one IP bucket. */
export const SUPPORT_USER_CAP = { windowMs: 24 * 60 * 60_000, max: 10 };

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
      sql`select pg_advisory_xact_lock(${LOCK_NAMESPACES.support}, hashtext(${sender.userId}))`,
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

export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** `active` is new and open together: everything still waiting on a reply. */
export type SupportStatusFilter = SupportStatus | "active";

export type SupportFilters = {
  status?: SupportStatusFilter;
  /** Matches the sender's name or reply address. */
  q?: string;
};

export type AdminSupportRow = {
  id: string;
  kind: SupportKind;
  source: SupportSource;
  status: SupportStatus;
  name: string;
  email: string;
  message: string;
  userId: string | null;
  organizationId: string | null;
  workspaceName: string | null;
  receiptId: string | null;
  createdAt: Date;
  closedAt: Date | null;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Newest first, offset-paged with a total. For platform admins only. */
export const listSupportMessages = (
  filters: SupportFilters,
  page: { page: number; pageSize: number },
) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const conditions: (SQL | undefined)[] = [];
      if (filters.status === "active") {
        conditions.push(inArray(supportMessages.status, ["new", "open"]));
      } else if (filters.status) {
        conditions.push(eq(supportMessages.status, filters.status));
      }
      const q = filters.q?.trim();
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        conditions.push(
          or(ilike(supportMessages.name, pattern), ilike(supportMessages.email, pattern)),
        );
      }
      const where = and(...conditions);
      const rows: AdminSupportRow[] = await db
        .select({
          id: supportMessages.id,
          kind: supportMessages.kind,
          source: supportMessages.source,
          status: supportMessages.status,
          name: supportMessages.name,
          email: supportMessages.email,
          message: supportMessages.message,
          userId: supportMessages.userId,
          organizationId: supportMessages.organizationId,
          workspaceName: organization.name,
          receiptId: supportMessages.receiptId,
          createdAt: supportMessages.createdAt,
          closedAt: supportMessages.closedAt,
        })
        .from(supportMessages)
        .leftJoin(organization, eq(organization.id, supportMessages.organizationId))
        .where(where)
        .orderBy(desc(supportMessages.createdAt), desc(supportMessages.id))
        .limit(page.pageSize)
        .offset((Math.max(1, page.page) - 1) * page.pageSize);
      const [total] = await db.select({ value: count() }).from(supportMessages).where(where);
      return { rows, total: Number(total?.value ?? 0) };
    }),
  );

/**
 * Moves a message to `status` with its audit row in one transaction. Closing stamps `closed_at`,
 * which starts the retention period; anything else clears it. The audit row names the message by
 * id and kind only, so the sender's address doesn't outlive the message in the audit log.
 */
export const setSupportStatus = (id: string, status: SupportStatus, audit: AuditActor) =>
  transact(async (tx) => {
    const notFound = new NotFound({ message: "That message no longer exists." });
    if (!isUuid(id)) throw notFound;
    const [before] = await tx
      .select({ status: supportMessages.status, kind: supportMessages.kind })
      .from(supportMessages)
      .where(eq(supportMessages.id, id))
      .for("update");
    if (!before) throw notFound;
    if (before.status === status) return { previous: before.status };
    await tx
      .update(supportMessages)
      .set({
        status,
        closedAt: status === "closed" ? sql`now()` : null,
        updatedAt: sql`now()`,
      })
      .where(eq(supportMessages.id, id));
    await insertAudit(tx, {
      ...audit,
      action: "support.status",
      targetType: "support",
      targetId: id,
      targetLabel: `${before.kind} message ${id.slice(0, 8)}`,
      metadata: { from: before.status, to: status },
    });
    return { previous: before.status };
  });

/** How long a message is kept: after it is closed, or after it was sent if it never is. */
export const SUPPORT_RETENTION_MONTHS = 12;

/**
 * Deletes up to `limit` messages past the retention period and returns how many. A message's
 * `closed_at` is never before its `created_at`, so a closed one past its period passes both checks.
 */
export const purgeSupportMessages = (limit: number) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const cutoff = sql`now() - make_interval(months => ${SUPPORT_RETENTION_MONTHS})`;
      const expired = db
        .select({ id: supportMessages.id })
        .from(supportMessages)
        .where(
          and(
            lt(supportMessages.createdAt, cutoff),
            or(isNull(supportMessages.closedAt), lt(supportMessages.closedAt, cutoff)),
          ),
        )
        .limit(limit);
      const deleted = await db
        .delete(supportMessages)
        .where(inArray(supportMessages.id, expired))
        .returning({ id: supportMessages.id });
      return deleted.length;
    }),
  );
