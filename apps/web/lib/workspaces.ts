import { and, asc, count, createDb, eq, member, organization } from "@receipt-ocr/db";
import { authEnv } from "./env";
import { getAccountPlan } from "./plan-limits";
import { getSession } from "./session";

export interface WorkspaceAllowance {
  owned: number;
  limit: number;
  canCreate: boolean;
}

/**
 * Counts workspaces the caller owns. Memberships in someone else's workspace
 * do not count against the cap — that mismatch was why the switcher used to
 * lock "Create workspace" after being invited to a second workspace.
 */
export async function getWorkspaceAllowance(): Promise<WorkspaceAllowance> {
  const [session, { policy }] = await Promise.all([getSession(), getAccountPlan()]);
  const limit = policy.workspaces;
  if (!session || !authEnv.databaseUrl) {
    return { owned: 0, limit, canCreate: false };
  }

  const db = createDb(authEnv.databaseUrl);
  const [row] = await db
    .select({ value: count() })
    .from(member)
    .where(and(eq(member.userId, session.user.id), eq(member.role, "owner")));

  const owned = Number(row?.value ?? 0);
  return { owned, limit, canCreate: owned < limit };
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

/** Every workspace the signed-in user belongs to, for the switcher. */
export async function listWorkspaces(): Promise<WorkspaceOption[]> {
  const session = await getSession();
  if (!session || !authEnv.databaseUrl) return [];
  return createDb(authEnv.databaseUrl)
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, session.user.id))
    .orderBy(asc(member.createdAt));
}

/** Whether a workspace has anyone besides one member (the security nudge targets those). */
export async function isSharedWorkspace(organizationId: string): Promise<boolean> {
  if (!authEnv.databaseUrl) return false;
  const rows = await createDb(authEnv.databaseUrl)
    .select({ id: member.id })
    .from(member)
    .where(eq(member.organizationId, organizationId))
    .limit(2);
  return rows.length > 1;
}
