"use server";

import {
  cancelInvitation,
  deleteWorkspace,
  findUser,
  findWorkspace,
  PLAN_IDS,
  prepareUserDeletion,
  recordAudit,
  removeMember,
  setMemberRole,
  setUserPlan,
  Settings,
  WORKSPACE_ROLES,
  type AppServices,
  type AuditEntryInput,
} from "@receipt-ocr/core";
import { APIError } from "better-auth/api";
import { Cause, Effect, Exit } from "effect";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/http";
import { logger } from "@/lib/log";
import { revalidatePlanCopy } from "@/lib/plan-limits";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";

/**
 * Admin mutations. Each one re-checks the admin role (the client is never
 * trusted), validates its input, then makes the change with its audit row:
 * core changes write both in one transaction, and Better Auth changes write
 * the row first. Errors returned to the browser are user-safe messages only.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

/** A message that is safe to show the admin as-is. */
class ActionError extends Error {}

const GENERIC = "That didn't work. Try again, and check the server logs if it keeps failing.";
const SAFE_TAGS = new Set(["InvalidInput", "Conflict", "NotFound"]);

async function context() {
  const session = await requireAdmin();
  const requestHeaders = await headers();
  return {
    headers: requestHeaders,
    audit: {
      actor: { id: session.user.id, email: session.user.email },
      // Only proxy headers configured as trusted; anything else is client-supplied.
      ip: clientIp({ headers: requestHeaders }),
    },
  };
}

type Context = Awaited<ReturnType<typeof context>>;

/** Runs a core effect; its user-facing failures (bad input, conflicts) become ActionErrors. */
async function core<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  const exit = await runtime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "Some") {
    const error = failure.value as { _tag?: string; message?: string };
    if (error._tag && SAFE_TAGS.has(error._tag) && error.message) {
      throw new ActionError(error.message);
    }
  }
  throw new Error(Cause.pretty(exit.cause));
}

type Entry = Omit<AuditEntryInput, "actor" | "ip">;

function describe(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    type: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause === undefined ? undefined : String(error.cause),
  };
}

/**
 * Runs a Better Auth change after writing its audit row, so the change can't
 * land unrecorded. If the call fails, a `<action>_failed` row says so.
 */
async function audited(ctx: Context, entry: Entry, call: () => Promise<unknown>) {
  await core(recordAudit({ ...ctx.audit, ...entry }));
  try {
    await call();
  } catch (error) {
    await recordFailure(ctx, entry, error);
    throw error;
  }
}

async function recordFailure(ctx: Context, entry: Entry, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await core(
    recordAudit({
      ...ctx.audit,
      ...entry,
      action: `${entry.action}_failed`,
      metadata: { ...entry.metadata, error: message.slice(0, 300) },
    }),
  ).catch((auditError: unknown) =>
    logger.error({
      event: "admin.audit_failed",
      action: `${entry.action}_failed`,
      error: describe(auditError),
    }),
  );
}

async function run(name: string, body: (ctx: Context) => Promise<void>): Promise<ActionResult> {
  const ctx = await context(); // outside try: requireAdmin's notFound() must propagate
  try {
    await body(ctx);
    return { ok: true };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.message };
    if (error instanceof APIError) return { ok: false, error: error.message || GENERIC };
    if (error instanceof z.ZodError) {
      return { ok: false, error: error.issues[0]?.message ?? "Check the values and try again." };
    }
    logger.error({ event: "admin.action_failed", action: name, error: describe(error) });
    return { ok: false, error: GENERIC };
  }
}

const id = z.string().min(1).max(200);
const reason = (min: number, what: string) =>
  z
    .string()
    .trim()
    .min(min, `Write a reason ${what} (at least ${min} characters).`)
    .max(500, "Keep the reason under 500 characters.");

async function loadUser(userId: string) {
  const row = await core(findUser(userId));
  if (!row) throw new ActionError("That user no longer exists.");
  return row;
}

/** Admins can't be banned, deleted or impersonated from the panel; demote them first. */
function notAdmin(target: { role: string | null }, what: string) {
  if (target.role?.split(",").includes("admin")) {
    throw new ActionError(`${what} Remove their admin role first.`);
  }
}

function notSelf(ctx: Context, userId: string, message: string) {
  if (ctx.audit.actor.id === userId) throw new ActionError(message);
}

function touchUser(userId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/users/${userId}`);
}

// ---------- Users ----------

export async function setRoleAction(input: { userId: string; role: "user" | "admin" }) {
  return run("user.role", async (ctx) => {
    const { userId, role } = z.object({ userId: id, role: z.enum(["user", "admin"]) }).parse(input);
    notSelf(ctx, userId, "You can't change your own role. Ask another admin.");
    const target = await loadUser(userId);
    await audited(
      ctx,
      {
        action: "user.role",
        targetType: "user",
        targetId: userId,
        targetLabel: target.email,
        metadata: { from: target.role, to: role },
      },
      () => auth.api.setRole({ body: { userId, role }, headers: ctx.headers }),
    );
    touchUser(userId);
  });
}

export async function setPlanAction(input: { userId: string; plan: string }) {
  return run("user.plan", async (ctx) => {
    const { userId, plan } = z.object({ userId: id, plan: z.enum(PLAN_IDS) }).parse(input);
    const { previous } = await core(setUserPlan(userId, plan, ctx.audit));
    if (previous !== plan) touchUser(userId);
  });
}

export async function banUserAction(input: {
  userId: string;
  reason: string;
  days: number | null;
}) {
  return run("user.ban", async (ctx) => {
    const parsed = z
      .object({
        userId: id,
        reason: reason(3, "for the ban"),
        days: z.union([z.literal(1), z.literal(7), z.literal(30)]).nullable(),
      })
      .parse(input);
    notSelf(ctx, parsed.userId, "You can't ban yourself.");
    const target = await loadUser(parsed.userId);
    notAdmin(target, "Admins can't be banned.");
    await audited(
      ctx,
      {
        action: "user.ban",
        targetType: "user",
        targetId: parsed.userId,
        targetLabel: target.email,
        reason: parsed.reason,
        metadata: { days: parsed.days },
      },
      async () => {
        await auth.api.banUser({
          body: {
            userId: parsed.userId,
            banReason: parsed.reason,
            ...(parsed.days ? { banExpiresIn: parsed.days * 86_400 } : {}),
          },
          headers: ctx.headers,
        });
        // Sign them out everywhere now; server session reads skip the cookie cache, so this applies at once.
        await auth.api.revokeUserSessions({
          body: { userId: parsed.userId },
          headers: ctx.headers,
        });
      },
    );
    touchUser(parsed.userId);
  });
}

export async function unbanUserAction(input: { userId: string }) {
  return run("user.unban", async (ctx) => {
    const { userId } = z.object({ userId: id }).parse(input);
    const target = await loadUser(userId);
    await audited(
      ctx,
      { action: "user.unban", targetType: "user", targetId: userId, targetLabel: target.email },
      () => auth.api.unbanUser({ body: { userId }, headers: ctx.headers }),
    );
    touchUser(userId);
  });
}

export async function revokeUserSessionsAction(input: { userId: string }) {
  return run("user.sessions_revoke", async (ctx) => {
    const { userId } = z.object({ userId: id }).parse(input);
    const target = await loadUser(userId);
    await audited(
      ctx,
      {
        action: "user.sessions_revoke",
        targetType: "user",
        targetId: userId,
        targetLabel: target.email,
      },
      () => auth.api.revokeUserSessions({ body: { userId }, headers: ctx.headers }),
    );
    touchUser(userId);
  });
}

/**
 * Takes the session id, not the token: tokens are bearer credentials and must
 * never reach the browser. The token is looked up here, after the admin check.
 */
export async function revokeUserSessionAction(input: { sessionId: string; userId: string }) {
  return run("user.session_revoke", async (ctx) => {
    const { sessionId, userId } = z.object({ sessionId: id, userId: id }).parse(input);
    const target = await loadUser(userId);
    const result = await auth.api.listUserSessions({ body: { userId }, headers: ctx.headers });
    const sessions = "sessions" in result ? result.sessions : [];
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) throw new ActionError("That session has already ended.");
    await audited(
      ctx,
      {
        action: "user.session_revoke",
        targetType: "user",
        targetId: userId,
        targetLabel: target.email,
        metadata: { sessionId },
      },
      () =>
        auth.api.revokeUserSession({
          body: { sessionToken: session.token },
          headers: ctx.headers,
        }),
    );
    touchUser(userId);
  });
}

export async function resendVerificationAction(input: { userId: string }) {
  return run("user.verification_resend", async (ctx) => {
    const { userId } = z.object({ userId: id }).parse(input);
    const target = await loadUser(userId);
    if (target.emailVerified) throw new ActionError("This email address is already verified.");
    await audited(
      ctx,
      {
        action: "user.verification_resend",
        targetType: "user",
        targetId: userId,
        targetLabel: target.email,
      },
      () => auth.api.sendVerificationEmail({ body: { email: target.email, callbackURL: "/app" } }),
    );
    touchUser(userId);
  });
}

/**
 * Deletes their solo workspaces (with the audit row, in one transaction), then
 * the user through Better Auth, then their stored files. Redirects to the list.
 */
export async function deleteUserAction(input: { userId: string; confirm: string }) {
  const result = await run("user.delete", async (ctx) => {
    const { userId, confirm } = z.object({ userId: id, confirm: z.string() }).parse(input);
    notSelf(ctx, userId, "You can't delete your own account from the admin panel.");
    const target = await loadUser(userId);
    notAdmin(target, "Admins can't be deleted.");
    if (confirm.trim() !== target.email) {
      throw new ActionError("The email you typed doesn't match this user.");
    }
    const removed = await core(prepareUserDeletion(userId, ctx.audit));
    try {
      await auth.api.removeUser({ body: { userId }, headers: ctx.headers });
    } catch (error) {
      const entry: Entry = {
        action: "user.delete",
        targetType: "user",
        targetId: userId,
        targetLabel: target.email,
        metadata: removed,
      };
      await recordFailure(ctx, entry, error);
      throw error;
    }
    revalidatePath("/admin", "layout");
  });
  if (result.ok) redirect("/admin/users");
  return result;
}

/**
 * Starts an impersonation session. The reason is written to the audit log
 * before the session swaps, so even a failed attempt leaves a trace.
 */
export async function impersonateUserAction(input: { userId: string; reason: string }) {
  const result = await run("user.impersonate", async (ctx) => {
    const parsed = z
      .object({ userId: id, reason: reason(10, "for signing in as them") })
      .parse(input);
    notSelf(ctx, parsed.userId, "You can't impersonate yourself.");
    const target = await loadUser(parsed.userId);
    notAdmin(target, "Admins can't be impersonated.");
    await audited(
      ctx,
      {
        action: "user.impersonate_start",
        targetType: "user",
        targetId: parsed.userId,
        targetLabel: target.email,
        reason: parsed.reason,
      },
      () => auth.api.impersonateUser({ body: { userId: parsed.userId }, headers: ctx.headers }),
    );
  });
  if (result.ok) redirect("/app");
  return result;
}

// ---------- Workspaces ----------

function touchWorkspace(organizationId: string, userId?: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/workspaces/${organizationId}`);
  if (userId) revalidatePath(`/admin/users/${userId}`);
}

export async function setMemberRoleAction(input: {
  organizationId: string;
  memberId: string;
  role: string;
}) {
  return run("workspace.member_role", async (ctx) => {
    const parsed = z
      .object({ organizationId: id, memberId: id, role: z.enum(WORKSPACE_ROLES) })
      .parse(input);
    const { previous, userId } = await core(
      setMemberRole(parsed.organizationId, parsed.memberId, parsed.role, ctx.audit),
    );
    if (previous !== parsed.role) touchWorkspace(parsed.organizationId, userId);
  });
}

export async function removeMemberAction(input: { organizationId: string; memberId: string }) {
  return run("workspace.member_remove", async (ctx) => {
    const parsed = z.object({ organizationId: id, memberId: id }).parse(input);
    const { userId } = await core(removeMember(parsed.organizationId, parsed.memberId, ctx.audit));
    touchWorkspace(parsed.organizationId, userId);
  });
}

export async function cancelInvitationAction(input: {
  organizationId: string;
  invitationId: string;
}) {
  return run("workspace.invitation_cancel", async (ctx) => {
    const parsed = z.object({ organizationId: id, invitationId: id }).parse(input);
    await core(cancelInvitation(parsed.organizationId, parsed.invitationId, ctx.audit));
    touchWorkspace(parsed.organizationId);
  });
}

export async function deleteWorkspaceAction(input: { organizationId: string; confirm: string }) {
  const result = await run("workspace.delete", async (ctx) => {
    const parsed = z.object({ organizationId: id, confirm: z.string() }).parse(input);
    const workspace = await core(findWorkspace(parsed.organizationId));
    if (!workspace) throw new ActionError("That workspace no longer exists.");
    if (parsed.confirm.trim() !== workspace.name) {
      throw new ActionError("The name you typed doesn't match this workspace.");
    }
    await core(deleteWorkspace(parsed.organizationId, ctx.audit));
    revalidatePath("/admin", "layout");
  });
  if (result.ok) redirect("/admin/workspaces");
  return result;
}

// ---------- Settings ----------

export async function savePlansAction(value: unknown) {
  return run("settings.plans", async (ctx) => {
    await core(Effect.flatMap(Settings, (settings) => settings.save("plans", value, ctx.audit)));
    revalidatePlanCopy();
    revalidatePath("/admin", "layout");
    revalidatePath("/app", "layout");
  });
}

export async function saveOcrAction(value: unknown) {
  return run("settings.ocr", async (ctx) => {
    await core(Effect.flatMap(Settings, (settings) => settings.save("ocr", value, ctx.audit)));
    revalidatePath("/admin", "layout");
  });
}
