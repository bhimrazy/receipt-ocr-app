import "server-only";
import {
  loadStepUpSession,
  stepUpFresh,
  stepUpMethods,
  type StepUpAction,
  type StepUpMethod,
  type StepUpSessionRow,
} from "@receipt-ocr/core";
import { logger } from "./log";
import { runtime } from "./runtime";

/** The error code a refused request carries, from server actions and Better Auth alike. */
export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

export type StepUpRefusal = "required" | "enrol" | "impersonating" | "no_session";

export type StepUpCheck =
  | { ok: true; row: StepUpSessionRow }
  | { ok: false; reason: StepUpRefusal; methods: StepUpMethod[] };

export const STEP_UP_MESSAGES: Record<StepUpRefusal, string> = {
  required: "Confirm it's you to continue.",
  enrol: "Set up two-step sign-in in Settings → Security before you do this.",
  impersonating: "You can't do this while signed in as another user.",
  no_session: "Sign in again to continue.",
};

export const subjectOf = (row: StepUpSessionRow) => ({
  isAdmin: row.role.split(",").includes("admin"),
  twoFactorEnabled: row.twoFactorEnabled,
  passkeys: row.passkeys,
});

/** Whether this session passed a "verify it's you" check recently enough, read from the database. */
export async function checkStepUp(
  sessionId: string,
  action?: string,
  now = new Date(),
): Promise<StepUpCheck> {
  const row = await runtime.runPromise(loadStepUpSession(sessionId));
  if (!row) return { ok: false, reason: "no_session", methods: [] };
  if (row.impersonatedBy) return { ok: false, reason: "impersonating", methods: [] };
  const methods = stepUpMethods(subjectOf(row), action);
  if (methods.length === 0) return { ok: false, reason: "enrol", methods };
  if (stepUpFresh(row, methods, now)) return { ok: true, row };
  return { ok: false, reason: "required", methods };
}

/** Thrown by `requireStepUp`; server actions turn it into `{ ok: false, code: STEP_UP_REQUIRED }`. */
export class StepUpRequiredError extends Error {
  readonly code = STEP_UP_REQUIRED;
  constructor(
    readonly action: StepUpAction,
    readonly reason: StepUpRefusal,
  ) {
    super(STEP_UP_MESSAGES[reason]);
  }
}

/**
 * The one server-side gate for important actions: passes when the session
 * verified within 10 minutes, otherwise throws StepUpRequiredError. Call it
 * after the role check and before any change.
 */
export async function requireStepUp(
  session: { session: { id: string }; user: { id: string } },
  action: StepUpAction,
): Promise<void> {
  const check = await checkStepUp(session.session.id, action);
  if (check.ok) return;
  logger.info({
    event: "auth.step_up_required",
    unit: "log",
    user_id: session.user.id,
    action,
    outcome: check.reason,
  });
  throw new StepUpRequiredError(action, check.reason);
}
