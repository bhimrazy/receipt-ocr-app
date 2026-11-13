import { asc, createDb, eq, member, organization } from "@receipt-ocr/db";
import { cache } from "react";
import { authEnv } from "./env";
import { workspaceCapNote } from "./plan-copy";
import { getAccountPlan, getPlanTable } from "./plan-limits";
import { getSession } from "./session";

export interface WorkspaceAllowance {
  owned: number;
  limit: number;
  canCreate: boolean;
  /** Why "Create workspace" is missing, for the account's plan. */
  planNote: string;
  /** Free: the cap note links the plans. */
  comparePlans: boolean;
}

/**
 * Counts workspaces the caller owns. Memberships in someone else's workspace
 * do not count against the cap.
 */
export async function getWorkspaceAllowance(): Promise<WorkspaceAllowance> {
  const [session, { plan, policy }, plans] = await Promise.all([
    getSession(),
    getAccountPlan(),
    getPlanTable(),
  ]);
  const limit = policy.workspaces;
  const planNote = workspaceCapNote(plan, limit, plans.pro.workspaces);
  const comparePlans = plan === "free";
  if (!session || !authEnv.databaseUrl) {
    return { owned: 0, limit, canCreate: false, planNote, comparePlans };
  }

  // From the switcher's list (per-request cached), not a query of its own.
  const owned = (await listWorkspaces()).filter((w) => w.role === "owner").length;
  return { owned, limit, canCreate: owned < limit, planNote, comparePlans };
}

export interface WorkspaceOption {
  id: string;
  name: string;
  /** The signed-in user's role in it. */
  role: string;
}

/** Every workspace the signed-in user belongs to, for the switcher. Deduplicated per request. */
export const listWorkspaces = cache(async (): Promise<WorkspaceOption[]> => {
  const session = await getSession();
  if (!session || !authEnv.databaseUrl) return [];
  return createDb(authEnv.databaseUrl)
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, session.user.id))
    .orderBy(asc(member.createdAt));
});

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
