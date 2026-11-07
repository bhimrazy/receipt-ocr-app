import {
  and,
  eq,
  inArray,
  invitation,
  isNotNull,
  member,
  organization,
  receipts,
  user,
} from "@receipt-ocr/db";
import { Effect } from "effect";
import { insertAudit, transact, type AuditActor, type Tx } from "./audit";
import { Conflict, NotFound } from "./errors";
import { clearGroupCreator } from "./groups";
import type { PlanId } from "./plans";
import { Storage } from "./services";
import { errorFields } from "./telemetry/redact";

/**
 * Admin writes. Each one makes its change and writes its audit row in the
 * same transaction, so a change is never committed without its audit entry.
 * Reads for the admin pages live in `admin-queries.ts`.
 */

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * Locks every member row of these workspaces until commit, so an owner check
 * and the change that relies on it can't interleave with another admin's.
 */
const lockMembers = (tx: Tx, organizationIds: string[]) =>
  tx
    .select({
      id: member.id,
      organizationId: member.organizationId,
      userId: member.userId,
      role: member.role,
    })
    .from(member)
    .where(inArray(member.organizationId, organizationIds))
    .orderBy(member.id)
    .for("update");

const objectKeysOf = async (tx: Tx, organizationIds: string[]) => {
  const rows = await tx
    .select({ key: receipts.imageObjectKey })
    .from(receipts)
    .where(
      and(inArray(receipts.organizationId, organizationIds), isNotNull(receipts.imageObjectKey)),
    );
  return rows.flatMap((row) => (row.key ? [row.key] : []));
};

/** The workspace name and member email an audit row is labelled with. */
const labels = async (tx: Tx, organizationId: string, userId: string) => {
  const [row] = await tx
    .select({ workspace: organization.name, email: user.email })
    .from(organization)
    .leftJoin(user, eq(user.id, userId))
    .where(eq(organization.id, organizationId))
    .limit(1);
  return { workspace: row?.workspace ?? organizationId, email: row?.email ?? userId };
};

/**
 * Deletes stored files once their rows are gone. A failure leaves orphaned
 * objects, which only cost storage, so it is logged rather than surfaced.
 */
const purgeObjects = (keys: string[], context: Record<string, string>) =>
  Effect.flatMap(Storage, (storage) => storage.remove(keys)).pipe(
    Effect.catchAll((error) =>
      Effect.logError("admin.purge_failed", {
        ...context,
        count: keys.length,
        error: errorFields(error),
      }),
    ),
  );

/** Deletes a workspace (members, invitations and receipts cascade), then its stored files. */
export const deleteWorkspace = (organizationId: string, audit: AuditActor) =>
  Effect.gen(function* () {
    const keys = yield* transact(async (tx) => {
      // The row lock also holds back new receipts (their foreign key check waits), so `keys` is complete.
      const [org] = await tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .for("update");
      if (!org) throw new NotFound({ message: "That workspace no longer exists." });
      const keys = await objectKeysOf(tx, [organizationId]);
      await tx.delete(organization).where(eq(organization.id, organizationId));
      await insertAudit(tx, {
        ...audit,
        action: "workspace.delete",
        targetType: "workspace",
        targetId: organizationId,
        targetLabel: org.name,
        metadata: { files: keys.length },
      });
      return keys;
    });
    yield* purgeObjects(keys, { organization_id: organizationId });
    return { files: keys.length };
  });

/**
 * Clears the way for deleting a user. Workspaces where they are the only
 * member go with them. A workspace they own that has other members and no
 * other owner blocks the deletion: those members would lose their owner.
 * Receipts they uploaded to other workspaces stay (`user_id` is set to null).
 * With `audit`, the `user.delete` row commits with the workspace deletions.
 */
export const prepareUserDeletion = (userId: string, audit?: AuditActor) =>
  Effect.gen(function* () {
    const { keys, workspacesDeleted } = yield* transact(async (tx) => {
      const mine = await tx
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, userId));
      const organizationIds = [...new Set(mine.map((m) => m.organizationId))];
      const rows = organizationIds.length > 0 ? await lockMembers(tx, organizationIds) : [];

      const solo: string[] = [];
      const blocked: string[] = [];
      for (const organizationId of organizationIds) {
        const inOrg = rows.filter((r) => r.organizationId === organizationId);
        const others = inOrg.filter((r) => r.userId !== userId);
        const owner = inOrg.some((r) => r.userId === userId && r.role === "owner");
        if (others.length === 0) solo.push(organizationId);
        else if (owner && !others.some((r) => r.role === "owner")) blocked.push(organizationId);
      }
      if (blocked.length > 0) {
        const names = await tx
          .select({ name: organization.name })
          .from(organization)
          .where(inArray(organization.id, blocked));
        throw new Conflict({
          message: `This user owns ${names.map((n) => n.name).join(", ")}, which has other members. Make one of them an owner first.`,
        });
      }

      const keys = solo.length > 0 ? await objectKeysOf(tx, solo) : [];
      if (solo.length > 0) await tx.delete(organization).where(inArray(organization.id, solo));
      if (audit) {
        const [target] = await tx
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1);
        await insertAudit(tx, {
          ...audit,
          action: "user.delete",
          targetType: "user",
          targetId: userId,
          targetLabel: target?.email ?? userId,
          metadata: { workspacesDeleted: solo.length, files: keys.length },
        });
      }
      return { keys, workspacesDeleted: solo.length };
    });
    yield* purgeObjects(keys, { user_id: userId });
    return { workspacesDeleted, files: keys.length };
  });

/** A workspace always keeps at least one owner. */
export const setMemberRole = (
  organizationId: string,
  memberId: string,
  role: WorkspaceRole,
  audit: AuditActor,
) =>
  transact(async (tx) => {
    const rows = await lockMembers(tx, [organizationId]);
    const current = rows.find((r) => r.id === memberId);
    if (!current) throw new NotFound({ message: "That member is no longer in this workspace." });
    const result = { previous: current.role, userId: current.userId };
    if (current.role === role) return result;
    if (current.role === "owner" && !rows.some((r) => r.id !== memberId && r.role === "owner")) {
      throw new Conflict({
        message: "This is the only owner. Make another member an owner first.",
      });
    }
    await tx.update(member).set({ role }).where(eq(member.id, memberId));
    const names = await labels(tx, organizationId, current.userId);
    await insertAudit(tx, {
      ...audit,
      action: "workspace.member_role",
      targetType: "workspace",
      targetId: organizationId,
      targetLabel: names.workspace,
      metadata: { member: names.email, from: current.role, to: role },
    });
    return result;
  });

/** Their receipts stay in the workspace. Sessions pointing at it fall back on the next request. */
export const removeMember = (organizationId: string, memberId: string, audit: AuditActor) =>
  transact(async (tx) => {
    const rows = await lockMembers(tx, [organizationId]);
    const current = rows.find((r) => r.id === memberId);
    if (!current) throw new NotFound({ message: "That member is no longer in this workspace." });
    if (current.role === "owner" && !rows.some((r) => r.id !== memberId && r.role === "owner")) {
      throw new Conflict({
        message:
          "This is the only owner. Make another member an owner first, or delete the workspace.",
      });
    }
    await tx.delete(member).where(eq(member.id, memberId));
    // Their groups stay for the workspace; only the creator link goes.
    await clearGroupCreator(tx, organizationId, current.userId);
    const names = await labels(tx, organizationId, current.userId);
    await insertAudit(tx, {
      ...audit,
      action: "workspace.member_remove",
      targetType: "workspace",
      targetId: organizationId,
      targetLabel: names.workspace,
      metadata: { member: names.email, role: current.role },
    });
    return { role: current.role, userId: current.userId };
  });

export const cancelInvitation = (organizationId: string, invitationId: string, audit: AuditActor) =>
  transact(async (tx) => {
    const [row] = await tx
      .update(invitation)
      .set({ status: "canceled" })
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, "pending"),
        ),
      )
      .returning({ email: invitation.email });
    if (!row) throw new NotFound({ message: "That invitation is no longer pending." });
    const [org] = await tx
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);
    await insertAudit(tx, {
      ...audit,
      action: "workspace.invitation_cancel",
      targetType: "workspace",
      targetId: organizationId,
      targetLabel: org?.name ?? organizationId,
      metadata: { email: row.email },
    });
    return row;
  });

export const setUserPlan = (userId: string, plan: PlanId, audit: AuditActor) =>
  transact(async (tx) => {
    const [before] = await tx
      .select({ plan: user.plan, email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (!before) throw new NotFound({ message: "That user no longer exists." });
    if (before.plan === plan) return { previous: before.plan };
    await tx.update(user).set({ plan, updatedAt: new Date() }).where(eq(user.id, userId));
    await insertAudit(tx, {
      ...audit,
      action: "user.plan",
      targetType: "user",
      targetId: userId,
      targetLabel: before.email,
      metadata: { from: before.plan, to: plan },
    });
    return { previous: before.plan };
  });
