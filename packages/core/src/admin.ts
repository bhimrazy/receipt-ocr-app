import {
  adminAuditLog,
  and,
  count,
  eq,
  inArray,
  invitation,
  member,
  ne,
  organization,
  sql,
  user,
} from "@receipt-ocr/db";
import { Effect } from "effect";
import { Conflict, NotFound } from "./errors";
import { purgeReceiptFiles } from "./pipeline";
import type { PlanId } from "./plans";
import { Db } from "./services";

/**
 * Admin writes that need more than one table, plus the audit log. Reads for
 * the admin pages live in `admin-queries.ts`.
 */

export type AuditTarget = "user" | "workspace" | "settings";

export type AuditEntryInput = {
  actor: { id: string; email: string };
  action: string;
  targetType: AuditTarget;
  targetId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

export const recordAudit = (entry: AuditEntryInput) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db) =>
      db.insert(adminAuditLog).values({
        actorId: entry.actor.id,
        actorEmail: entry.actor.email,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        targetLabel: entry.targetLabel ?? null,
        reason: entry.reason ?? null,
        metadata: entry.metadata ?? null,
        ip: entry.ip ?? null,
      }),
    ),
  );

/** Deletes a workspace: its stored files first, then the row (members, invitations and receipts cascade). */
export const deleteWorkspace = (organizationId: string) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const files = yield* purgeReceiptFiles({ organizationId });
    const removed = yield* use((db) =>
      db
        .delete(organization)
        .where(eq(organization.id, organizationId))
        .returning({ id: organization.id }),
    );
    if (removed.length === 0) return yield* new NotFound({ message: "Workspace not found" });
    return { files };
  });

/**
 * Clears the way for deleting a user. Workspaces where they are the only
 * member go with them (files purged first). A workspace they own that has
 * other members blocks the deletion: those members would lose their owner.
 * Receipts they uploaded to other workspaces stay (`user_id` is set to null).
 */
export const prepareUserDeletion = (userId: string) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const memberships = yield* use((db) =>
      db
        .select({
          organizationId: member.organizationId,
          role: member.role,
          name: organization.name,
          others: sql<number>`(select count(*)::int from ${member} m2 where m2.organization_id = ${member.organizationId} and m2.user_id <> ${userId})`,
        })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.userId, userId)),
    );
    const blocking = memberships.filter((m) => m.role === "owner" && m.others > 0);
    if (blocking.length > 0) {
      // Another owner in the same workspace keeps it owned, so it doesn't block.
      const stillBlocked: string[] = [];
      for (const m of blocking) {
        const [row] = yield* use((db) =>
          db
            .select({ value: count() })
            .from(member)
            .where(
              and(
                eq(member.organizationId, m.organizationId),
                eq(member.role, "owner"),
                ne(member.userId, userId),
              ),
            ),
        );
        if (Number(row?.value ?? 0) === 0) stillBlocked.push(m.name);
      }
      if (stillBlocked.length > 0) {
        return yield* new Conflict({
          message: `This user owns ${stillBlocked.join(", ")}, which has other members. Make one of them an owner first.`,
        });
      }
    }
    const solo = memberships.filter((m) => m.others === 0).map((m) => m.organizationId);
    let files = 0;
    for (const organizationId of solo) {
      files += yield* purgeReceiptFiles({ organizationId });
    }
    if (solo.length > 0) {
      yield* use((db) => db.delete(organization).where(inArray(organization.id, solo)));
    }
    return { workspacesDeleted: solo.length, files };
  });

export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const loadMember = (organizationId: string, memberId: string) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const [row] = yield* use((db) =>
      db
        .select({ id: member.id, role: member.role, userId: member.userId })
        .from(member)
        .where(and(eq(member.id, memberId), eq(member.organizationId, organizationId)))
        .limit(1),
    );
    if (!row)
      return yield* new NotFound({ message: "That member is no longer in this workspace." });
    return row;
  });

const otherOwners = (organizationId: string, memberId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const [row] = await db
        .select({ value: count() })
        .from(member)
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(member.role, "owner"),
            ne(member.id, memberId),
          ),
        );
      return Number(row?.value ?? 0);
    }),
  );

/** A workspace always keeps at least one owner. */
export const setMemberRole = (organizationId: string, memberId: string, role: WorkspaceRole) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const current = yield* loadMember(organizationId, memberId);
    if (current.role === role) return { previous: current.role, userId: current.userId };
    if (current.role === "owner" && (yield* otherOwners(organizationId, memberId)) === 0) {
      return yield* new Conflict({
        message: "This is the only owner. Make another member an owner first.",
      });
    }
    yield* use((db) => db.update(member).set({ role }).where(eq(member.id, memberId)));
    return { previous: current.role, userId: current.userId };
  });

/** Their receipts stay in the workspace. Sessions pointing at it fall back on the next request. */
export const removeMember = (organizationId: string, memberId: string) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const current = yield* loadMember(organizationId, memberId);
    if (current.role === "owner" && (yield* otherOwners(organizationId, memberId)) === 0) {
      return yield* new Conflict({
        message:
          "This is the only owner. Make another member an owner first, or delete the workspace.",
      });
    }
    yield* use((db) => db.delete(member).where(eq(member.id, memberId)));
    return { role: current.role, userId: current.userId };
  });

export const cancelInvitation = (organizationId: string, invitationId: string) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const rows = yield* use((db) =>
      db
        .update(invitation)
        .set({ status: "canceled" })
        .where(
          and(
            eq(invitation.id, invitationId),
            eq(invitation.organizationId, organizationId),
            eq(invitation.status, "pending"),
          ),
        )
        .returning({ email: invitation.email }),
    );
    if (rows.length === 0)
      return yield* new NotFound({ message: "That invitation is no longer pending." });
    return rows[0]!;
  });

export const setUserPlan = (userId: string, plan: PlanId) =>
  Effect.gen(function* () {
    const { use } = yield* Db;
    const [before] = yield* use((db) =>
      db.select({ plan: user.plan }).from(user).where(eq(user.id, userId)).limit(1),
    );
    if (!before) return yield* new NotFound({ message: "User not found" });
    yield* use((db) =>
      db.update(user).set({ plan, updatedAt: new Date() }).where(eq(user.id, userId)),
    );
    return { previous: before.plan };
  });
