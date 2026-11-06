"use server";

import { findUser, recordAudit } from "@receipt-ocr/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { logger } from "./log";
import { runtime } from "./runtime";
import { getSession } from "./session";

/**
 * Ends an impersonation and records it against the admin who started it.
 * Better Auth deletes the impersonation session, so this row is the only
 * lasting trace of when it ended.
 */
export async function stopImpersonatingAction(): Promise<{ ok: false; error: string } | void> {
  const session = await getSession();
  const adminId = session?.session.impersonatedBy;
  if (!session || !adminId) {
    return { ok: false, error: "You aren't signed in as another user." };
  }
  const admin = await runtime.runPromise(findUser(adminId));
  await auth.api.stopImpersonating({ headers: await headers() });
  await runtime
    .runPromise(
      recordAudit({
        actor: { id: adminId, email: admin?.email ?? adminId },
        action: "user.impersonate_stop",
        targetType: "user",
        targetId: session.user.id,
        targetLabel: session.user.email,
      }),
    )
    .catch((error: unknown) =>
      logger.error({
        event: "admin.audit_failed",
        action: "user.impersonate_stop",
        message: String(error),
      }),
    );
  redirect(`/admin/users/${session.user.id}`);
}
