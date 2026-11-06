import { and, count, createDb, eq, member } from "@receipt-ocr/db";
import { authEnv } from "./env";
import { getCurrentPlan } from "./plan-limits";
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
  const [session, { policy }] = await Promise.all([getSession(), getCurrentPlan()]);
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
