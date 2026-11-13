import {
  and,
  asc,
  count,
  eq,
  inArray,
  receiptGroupMembers,
  receiptGroups,
  receipts,
  sql,
} from "@receipt-ocr/db";
import { Effect } from "effect";
import { z } from "zod";
import type { Tx } from "./audit";
import { Conflict, DbError, Forbidden, InvalidInput, NotFound } from "./errors";
import {
  canManageGroup,
  MAX_GROUPS_PER_RECEIPT,
  MAX_GROUPS_PER_WORKSPACE,
  type GroupColor,
  type MembershipChange,
  type ReceiptGroup,
  type ReceiptGroupRef,
} from "./group-rules";
import {
  createGroupSchema,
  groupIdSchema,
  receiptIdsSchema,
  updateGroupSchema,
  type CreateGroupInput,
  type UpdateGroupInput,
} from "./group-schemas";
import { LOCK_NAMESPACES } from "./locks";
import type { ReceiptScope } from "./repository";
import { Db } from "./services";

export * from "./group-rules";
export * from "./group-schemas";

/**
 * Receipt groups: named collections in a workspace ("Berlin trip"). A receipt
 * can be in several. Any member reads them, creates them and adds or removes
 * receipts; renaming and deleting is for the group's creator and the
 * workspace's owners and admins. Deleting a group never deletes receipts.
 */

const decode = <A>(
  schema: z.ZodType<A, unknown>,
  input: unknown,
): Effect.Effect<A, InvalidInput> => {
  const result = schema.safeParse(input);
  return result.success
    ? Effect.succeed(result.data)
    : Effect.fail(
        new InvalidInput({ message: result.error.issues[0]?.message ?? "Invalid input" }),
      );
};

type Refusal = Conflict | NotFound | Forbidden;
const isRefusal = (cause: unknown): cause is Refusal =>
  cause instanceof Conflict || cause instanceof NotFound || cause instanceof Forbidden;

/** One transaction; a Conflict, NotFound or Forbidden thrown inside rolls it back and fails with it. */
const transact = <A>(body: (tx: Tx) => Promise<A>) =>
  Effect.flatMap(Db, ({ client }) =>
    Effect.tryPromise({
      try: () => client.transaction(body),
      catch: (cause): Refusal | DbError =>
        isRefusal(cause) ? cause : new DbError({ message: "Database request failed", cause }),
    }),
  );

/**
 * Serialises a workspace's group writes, so the per-workspace and per-receipt
 * limits and the name check can't be raced past. Group writes are rare.
 */
const lockGroups = (tx: Tx, organizationId: string) =>
  tx
    .execute(
      sql`select pg_advisory_xact_lock(${LOCK_NAMESPACES.groups}, hashtext(${organizationId}))`,
    )
    .then((r) => r.rows);

const isUniqueViolation = (error: unknown) => hasCode(error, "23505");

const hasCode = (error: unknown, code: string): boolean => {
  for (let e = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === code) return true;
  }
  return false;
};

/** A receipt or group deleted between the check and the insert: foreign key violation. */
const isForeignKeyViolation = (error: unknown) => hasCode(error, "23503");

export const notFoundOnForeignKey = (error: unknown): never => {
  throw isForeignKeyViolation(error)
    ? new NotFound({ message: "Receipt or group not found" })
    : error;
};

const nameTaken = (name: string) =>
  new Conflict({ message: `A group called “${name}” already exists in this workspace.` });

const groupNotFound = () => new NotFound({ message: "Group not found" });

const inWorkspace = (groupId: string, scope: ReceiptScope) =>
  and(eq(receiptGroups.id, groupId), eq(receiptGroups.organizationId, scope.organizationId));

const sameName = (scope: ReceiptScope, name: string, exceptId?: string) =>
  and(
    eq(receiptGroups.organizationId, scope.organizationId),
    sql`lower(${receiptGroups.name}) = lower(${name})`,
    exceptId ? sql`${receiptGroups.id} <> ${exceptId}` : undefined,
  );

/** Locks the workspace's groups and loads one of them, or fails NotFound. */
async function lockedGroup(tx: Tx, scope: ReceiptScope, groupId: string) {
  await lockGroups(tx, scope.organizationId);
  const [group] = await tx.select().from(receiptGroups).where(inWorkspace(groupId, scope));
  if (!group) throw groupNotFound();
  return group;
}

const toGroup = (
  scope: ReceiptScope,
  row: typeof receiptGroups.$inferSelect & { receiptCount?: number },
): ReceiptGroup => ({
  id: row.id,
  name: row.name,
  color: row.color as GroupColor,
  receiptCount: row.receiptCount ?? 0,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  canManage: canManageGroup(scope, row.createdBy),
});

/** The workspace's groups by name, each with its receipt count. */
export const listGroups = (scope: ReceiptScope) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const rows = await db
        .select({
          id: receiptGroups.id,
          organizationId: receiptGroups.organizationId,
          name: receiptGroups.name,
          color: receiptGroups.color,
          createdBy: receiptGroups.createdBy,
          createdAt: receiptGroups.createdAt,
          updatedAt: receiptGroups.updatedAt,
          receiptCount: sql<number>`(select count(*)::int from receipt_group_members m where m.group_id = ${receiptGroups.id})`,
        })
        .from(receiptGroups)
        .where(eq(receiptGroups.organizationId, scope.organizationId))
        .orderBy(sql`lower(${receiptGroups.name})`, asc(receiptGroups.id));
      return rows.map((row) => toGroup(scope, row));
    }),
  );

/**
 * A member leaves a workspace: its groups stay, but they no longer name the
 * member as creator (in this workspace only). Call inside the removal's
 * transaction where there is one; Better Auth's own removal calls
 * `releaseMemberGroups` from its `afterRemoveMember` hook.
 */
export const clearGroupCreator = (tx: Tx, organizationId: string, userId: string) =>
  tx
    .update(receiptGroups)
    .set({ createdBy: null })
    .where(
      and(eq(receiptGroups.organizationId, organizationId), eq(receiptGroups.createdBy, userId)),
    )
    .returning({ id: receiptGroups.id });

export const releaseMemberGroups = (organizationId: string, userId: string) =>
  transact(async (tx) => (await clearGroupCreator(tx, organizationId, userId)).length);

export const createGroup = (scope: ReceiptScope, input: CreateGroupInput) =>
  Effect.flatMap(decode(createGroupSchema, input), ({ name, color }) =>
    transact(async (tx) => {
      await lockGroups(tx, scope.organizationId);
      const [existing] = await tx
        .select({ value: count() })
        .from(receiptGroups)
        .where(eq(receiptGroups.organizationId, scope.organizationId));
      if ((existing?.value ?? 0) >= MAX_GROUPS_PER_WORKSPACE) {
        throw new Conflict({
          message: `A workspace can have up to ${MAX_GROUPS_PER_WORKSPACE} groups. Delete one to make room.`,
        });
      }
      const [clash] = await tx
        .select({ id: receiptGroups.id })
        .from(receiptGroups)
        .where(sameName(scope, name));
      if (clash) throw nameTaken(name);
      try {
        const [row] = await tx
          .insert(receiptGroups)
          .values({ organizationId: scope.organizationId, name, color, createdBy: scope.userId })
          .returning();
        if (!row) throw new Error("Insert returned no row");
        return toGroup(scope, row);
      } catch (error) {
        throw isUniqueViolation(error) ? nameTaken(name) : error;
      }
    }),
  );

/** Renames and/or recolours. Creator, owner or admin only. */
export const updateGroup = (scope: ReceiptScope, groupId: string, input: UpdateGroupInput) =>
  Effect.all([decode(groupIdSchema, groupId), decode(updateGroupSchema, input)]).pipe(
    Effect.flatMap(([id, patch]) =>
      transact(async (tx) => {
        const group = await lockedGroup(tx, scope, id);
        if (!canManageGroup(scope, group.createdBy)) throw forbidden("rename or recolour");
        if (patch.name !== undefined) {
          const [clash] = await tx
            .select({ id: receiptGroups.id })
            .from(receiptGroups)
            .where(sameName(scope, patch.name, id));
          if (clash) throw nameTaken(patch.name);
        }
        try {
          const [row] = await tx
            .update(receiptGroups)
            .set({ ...patch, updatedAt: new Date() })
            .where(inWorkspace(id, scope))
            .returning();
          if (!row) throw groupNotFound();
          return toGroup(scope, row);
        } catch (error) {
          throw isUniqueViolation(error) ? nameTaken(patch.name ?? group.name) : error;
        }
      }),
    ),
  );

const forbidden = (action: string) =>
  new Forbidden({
    message: `Only the person who created this group, or a workspace owner or admin, can ${action} it.`,
  });

/** Deletes the group and its memberships; the receipts stay. Creator, owner or admin only. */
export const deleteGroup = (scope: ReceiptScope, groupId: string) =>
  Effect.flatMap(decode(groupIdSchema, groupId), (id) =>
    transact(async (tx) => {
      const group = await lockedGroup(tx, scope, id);
      if (!canManageGroup(scope, group.createdBy)) throw forbidden("delete");
      await tx.delete(receiptGroups).where(inWorkspace(id, scope));
      return { id, name: group.name };
    }),
  );

/**
 * Adds up to MAX_RECEIPTS_PER_CALL receipts to a group. Only receipts of the
 * caller's workspace are inserted (the insert selects them through
 * `organization_id`); a receipt already in MAX_GROUPS_PER_RECEIPT groups is
 * skipped and counted, not an error, so one full receipt doesn't fail a bulk add.
 */
export const addReceiptsToGroup = (scope: ReceiptScope, groupId: string, receiptIds: unknown) =>
  Effect.all([decode(groupIdSchema, groupId), decode(receiptIdsSchema, { receiptIds })]).pipe(
    Effect.flatMap(([id, { receiptIds: ids }]) =>
      transact(async (tx): Promise<MembershipChange> => {
        await lockedGroup(tx, scope, id);
        const rows = await tx
          .select({
            id: receipts.id,
            inGroup: sql<boolean>`exists (select 1 from receipt_group_members m where m.receipt_id = ${receipts.id} and m.group_id = ${id})`,
            groups: sql<number>`(select count(*)::int from receipt_group_members m where m.receipt_id = ${receipts.id})`,
          })
          .from(receipts)
          .where(and(eq(receipts.organizationId, scope.organizationId), inArray(receipts.id, ids)));
        const fresh = rows.filter((row) => !row.inGroup);
        const addable = fresh.filter((row) => row.groups < MAX_GROUPS_PER_RECEIPT).map((r) => r.id);
        let changed = 0;
        if (addable.length > 0) {
          const inserted = await tx
            .insert(receiptGroupMembers)
            .select(
              tx
                .select({
                  groupId: receiptGroups.id,
                  receiptId: receipts.id,
                  addedBy: sql<string>`${scope.userId}`.as("added_by"),
                  addedAt: sql<Date>`now()`.as("added_at"),
                })
                .from(receipts)
                .innerJoin(receiptGroups, eq(receiptGroups.organizationId, receipts.organizationId))
                .where(
                  and(
                    eq(receiptGroups.id, id),
                    eq(receipts.organizationId, scope.organizationId),
                    inArray(receipts.id, addable),
                  ),
                ),
            )
            .onConflictDoNothing()
            .returning({ receiptId: receiptGroupMembers.receiptId })
            .catch(notFoundOnForeignKey);
          changed = inserted.length;
        }
        return {
          changed,
          unchanged: rows.length - fresh.length,
          atLimit: fresh.length - addable.length,
          notFound: ids.length - rows.length,
        };
      }),
    ),
  );

/** Removes up to MAX_RECEIPTS_PER_CALL receipts from a group. Any member may. */
export const removeReceiptsFromGroup = (
  scope: ReceiptScope,
  groupId: string,
  receiptIds: unknown,
) =>
  Effect.all([decode(groupIdSchema, groupId), decode(receiptIdsSchema, { receiptIds })]).pipe(
    Effect.flatMap(([id, { receiptIds: ids }]) =>
      transact(async (tx): Promise<MembershipChange> => {
        await lockedGroup(tx, scope, id);
        const [found] = await tx
          .select({ value: count() })
          .from(receipts)
          .where(and(eq(receipts.organizationId, scope.organizationId), inArray(receipts.id, ids)));
        const removed = await tx
          .delete(receiptGroupMembers)
          .where(
            and(
              eq(receiptGroupMembers.groupId, id),
              inArray(receiptGroupMembers.receiptId, ids),
              sql`exists (select 1 from receipts r where r.id = ${receiptGroupMembers.receiptId} and r.organization_id = ${scope.organizationId})`,
            ),
          )
          .returning({ receiptId: receiptGroupMembers.receiptId });
        const inWorkspaceCount = found?.value ?? 0;
        return {
          changed: removed.length,
          unchanged: inWorkspaceCount - removed.length,
          atLimit: 0,
          notFound: ids.length - inWorkspaceCount,
        };
      }),
    ),
  );

/**
 * Adds or removes one receipt in one group and returns the receipt's groups,
 * all in one transaction. NotFound when the receipt or group isn't this
 * workspace's (or was deleted mid-way); Conflict when the receipt is already in
 * MAX_GROUPS_PER_RECEIPT groups.
 */
export const setReceiptGroup = (
  scope: ReceiptScope,
  receiptId: string,
  groupId: string,
  action: "add" | "remove",
) =>
  Effect.all([
    decode(z.uuid({ error: "Receipt not found" }), receiptId).pipe(
      Effect.mapError(() => new NotFound({ message: "Receipt not found" })),
    ),
    decode(groupIdSchema, groupId),
  ]).pipe(
    Effect.flatMap(([rid, gid]) =>
      transact(async (tx): Promise<ReceiptGroupRef[]> => {
        await lockedGroup(tx, scope, gid);
        const [receipt] = await tx
          .select({ id: receipts.id })
          .from(receipts)
          .where(and(eq(receipts.id, rid), eq(receipts.organizationId, scope.organizationId)));
        if (!receipt) throw new NotFound({ message: "Receipt not found" });
        if (action === "add") {
          const [current] = await tx
            .select({ value: count() })
            .from(receiptGroupMembers)
            .where(eq(receiptGroupMembers.receiptId, rid));
          const [already] = await tx
            .select({ groupId: receiptGroupMembers.groupId })
            .from(receiptGroupMembers)
            .where(
              and(eq(receiptGroupMembers.receiptId, rid), eq(receiptGroupMembers.groupId, gid)),
            );
          if (!already && (current?.value ?? 0) >= MAX_GROUPS_PER_RECEIPT) {
            throw new Conflict({
              message: `A receipt can be in up to ${MAX_GROUPS_PER_RECEIPT} groups. Take it out of one first.`,
            });
          }
          await tx
            .insert(receiptGroupMembers)
            .values({ groupId: gid, receiptId: rid, addedBy: scope.userId })
            .onConflictDoNothing()
            .catch(notFoundOnForeignKey);
        } else {
          await tx
            .delete(receiptGroupMembers)
            .where(
              and(eq(receiptGroupMembers.groupId, gid), eq(receiptGroupMembers.receiptId, rid)),
            );
        }
        const rows = await tx
          .select({ id: receiptGroups.id, name: receiptGroups.name, color: receiptGroups.color })
          .from(receiptGroupMembers)
          .innerJoin(receiptGroups, eq(receiptGroups.id, receiptGroupMembers.groupId))
          .where(
            and(
              eq(receiptGroupMembers.receiptId, rid),
              eq(receiptGroups.organizationId, scope.organizationId),
            ),
          )
          .orderBy(sql`lower(${receiptGroups.name})`);
        return rows.map((row) => ({ ...row, color: row.color as GroupColor }));
      }),
    ),
  );

/** The groups a receipt is in, by name; NotFound when it isn't this workspace's receipt. */
export const groupsOfReceipt = (scope: ReceiptScope, receiptId: string) =>
  decode(z.uuid({ error: "Receipt not found" }), receiptId).pipe(
    Effect.mapError(() => new NotFound({ message: "Receipt not found" })),
    Effect.flatMap((id) =>
      Effect.flatMap(Db, ({ use }) =>
        use(async (db): Promise<ReceiptGroupRef[] | null> => {
          const [receipt] = await db
            .select({ id: receipts.id })
            .from(receipts)
            .where(and(eq(receipts.id, id), eq(receipts.organizationId, scope.organizationId)));
          if (!receipt) return null;
          const rows = await db
            .select({ id: receiptGroups.id, name: receiptGroups.name, color: receiptGroups.color })
            .from(receiptGroupMembers)
            .innerJoin(receiptGroups, eq(receiptGroups.id, receiptGroupMembers.groupId))
            .where(
              and(
                eq(receiptGroupMembers.receiptId, id),
                eq(receiptGroups.organizationId, scope.organizationId),
              ),
            )
            .orderBy(sql`lower(${receiptGroups.name})`);
          return rows.map((row) => ({ ...row, color: row.color as GroupColor }));
        }),
      ),
    ),
    Effect.flatMap((groups) =>
      groups ? Effect.succeed(groups) : Effect.fail(new NotFound({ message: "Receipt not found" })),
    ),
  );
