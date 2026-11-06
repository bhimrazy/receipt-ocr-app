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
import type { WorkspaceRole } from "./admin";
import type { Tx } from "./audit";
import { Conflict, DbError, Forbidden, InvalidInput, NotFound } from "./errors";
import type { ReceiptScope } from "./repository";
import { Db } from "./services";

/**
 * Receipt groups: named collections in a workspace ("Berlin trip"). A receipt
 * can be in several. Any member reads them, creates them and adds or removes
 * receipts; renaming and deleting is for the group's creator and the
 * workspace's owners and admins. Deleting a group never deletes receipts.
 */

export const GROUP_COLORS = [
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
  "red",
  "orange",
  "yellow",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const MAX_GROUPS_PER_WORKSPACE = 100;
export const MAX_GROUPS_PER_RECEIPT = 20;
/** Receipt ids accepted by one bulk add or remove. */
export const MAX_RECEIPTS_PER_CALL = 100;
export const GROUP_NAME_MAX = 60;

// Control and format characters (bidi overrides, zero-width) would let two names look alike.
const HIDDEN_CHARS = /[\p{Cc}\p{Cf}]/u;

export const groupNameSchema = z
  .string({ error: "Enter a group name." })
  .transform((name) => name.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Enter a group name.")
      .max(GROUP_NAME_MAX, `Group names can be up to ${GROUP_NAME_MAX} characters.`)
      .refine((name) => !HIDDEN_CHARS.test(name), "Group names can't contain hidden characters."),
  );

export const groupColorSchema = z.enum(GROUP_COLORS, { error: "Pick a colour from the list." });

export const groupIdSchema = z.uuid({ error: "Group not found" });

export const createGroupSchema = z.strictObject({ name: groupNameSchema, color: groupColorSchema });

export const updateGroupSchema = z
  .strictObject({ name: groupNameSchema.optional(), color: groupColorSchema.optional() })
  .refine((patch) => patch.name !== undefined || patch.color !== undefined, {
    error: "Nothing to change.",
  });

export const receiptIdsSchema = z.strictObject({
  receiptIds: z
    .array(z.uuid({ error: "Receipt ids must be UUIDs." }))
    .min(1, "Choose at least one receipt.")
    .max(MAX_RECEIPTS_PER_CALL, `Up to ${MAX_RECEIPTS_PER_CALL} receipts at a time.`)
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
});

export const receiptGroupBodySchema = z.strictObject({ groupId: groupIdSchema });

export type CreateGroupInput = z.input<typeof createGroupSchema>;
export type UpdateGroupInput = z.input<typeof updateGroupSchema>;

export type ReceiptGroup = {
  id: string;
  name: string;
  color: GroupColor;
  receiptCount: number;
  createdBy: string | null;
  createdAt: Date;
  /** Whether the caller may rename, recolour or delete it. */
  canManage: boolean;
};

/** A group as shown on a receipt: no counts. */
export type ReceiptGroupRef = Pick<ReceiptGroup, "id" | "name" | "color">;

export type MembershipChange = {
  /** Receipts newly added (or removed). */
  changed: number;
  /** Already in the group (add) or not in it (remove). */
  unchanged: number;
  /** Skipped because they are already in MAX_GROUPS_PER_RECEIPT groups. */
  atLimit: number;
  /** Not receipts of this workspace. */
  notFound: number;
};

const MANAGER_ROLES: ReadonlySet<string> = new Set<WorkspaceRole>(["owner", "admin"]);

/** Creator, owner or admin. Fails closed: no role and no creator means no. */
export const canManageGroup = (scope: ReceiptScope, createdBy: string | null) =>
  (createdBy !== null && createdBy === scope.userId) ||
  (scope.role ?? "").split(",").some((role) => MANAGER_ROLES.has(role.trim()));

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

/** First key of the two-key advisory lock; other locks use other namespaces. */
const GROUPS_LOCK_NAMESPACE = 7_302;

/**
 * Serialises a workspace's group writes, so the per-workspace and per-receipt
 * limits and the name check can't be raced past. Group writes are rare.
 */
const lockGroups = (tx: Tx, organizationId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(${GROUPS_LOCK_NAMESPACE}, hashtext(${organizationId}))`,
  );

const isUniqueViolation = (error: unknown): boolean => {
  for (let e = error; e instanceof Error || (e && typeof e === "object");) {
    if ((e as { code?: unknown }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
    if (!e) break;
  }
  return false;
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
            .returning({ receiptId: receiptGroupMembers.receiptId });
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
