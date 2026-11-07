/**
 * "Verify it's you" (step-up) policy. Pure, so the matrix is unit-tested and
 * the web app, the Better Auth hooks and the admin guard all decide alike.
 */

/** A passed check stays fresh this long, per session. */
export const STEP_UP_TTL_MS = 10 * 60 * 1000;

/** Emailed codes: lifetime, wrong guesses per code, and sends per user per window. */
export const STEP_UP_CODE_TTL_MS = 10 * 60 * 1000;
export const STEP_UP_CODE_MAX_ATTEMPTS = 5;
export const STEP_UP_CODES_PER_WINDOW = 3;
export const STEP_UP_CODE_WINDOW_MS = 10 * 60 * 1000;

/** Consecutive failed checks per user before verification locks for the window. */
export const STEP_UP_MAX_FAILURES = 5;
export const STEP_UP_LOCKOUT_MS = 15 * 60 * 1000;

/** Account and workspace actions that need a fresh check. Admin actions are `admin.<action>`. */
export const STEP_UP_ACTIONS = [
  "account.delete",
  "account.change_email",
  "account.change_password",
  "two_factor.enable",
  "two_factor.disable",
  "two_factor.regenerate_backup_codes",
  "passkey.add",
  "passkey.remove",
  "receipts.export",
  "receipts.delete_all",
  "workspace.delete",
  "workspace.transfer_ownership",
  "api_token.create",
] as const;

export type StepUpAction = (typeof STEP_UP_ACTIONS)[number] | `admin.${string}`;

export const SECOND_FACTORS = ["passkey", "totp", "backup_code"] as const;
export type SecondFactor = (typeof SECOND_FACTORS)[number];
export type StepUpMethod = SecondFactor | "email";

const isSecondFactor = (method: string | null | undefined): method is SecondFactor =>
  (SECOND_FACTORS as readonly string[]).includes(method ?? "");

/** Session `auth_method` values that already proved a second factor at sign-in. */
const STRONG_SIGN_INS = new Set(["mfa", "passkey"]);

export interface StepUpSubject {
  isAdmin: boolean;
  twoFactorEnabled: boolean;
  passkeys: number;
}

/**
 * How this user can verify. Anyone with a factor must use it (an emailed code
 * would be a downgrade); others get an emailed code, except admins, who must
 * enrol a factor first. Enrolling is itself checked, or a stolen session could
 * add the thief's authenticator and then pass every check with it; with no
 * factor yet, the emailed code is the only way, admins included.
 */
export function stepUpMethods(subject: StepUpSubject, action?: string): StepUpMethod[] {
  const methods: StepUpMethod[] = [];
  if (subject.passkeys > 0) methods.push("passkey");
  if (subject.twoFactorEnabled) methods.push("totp", "backup_code");
  if (methods.length > 0) return methods;
  return subject.isAdmin && !ENROLMENT.has(action ?? "") ? [] : ["email"];
}

/** Adding a factor, where an admin without one may still use the emailed code. */
const ENROLMENT = new Set(["two_factor.enable", "passkey.add"]);

export interface StepUpState {
  stepUpAt: Date | null;
  stepUpMethod: string | null;
  /** When the session was created: a sign-in. */
  createdAt: Date;
}

/**
 * Actions a recent sign-in may confirm for a user with no factor, because each
 * is confirmed again on its own: deletion by an emailed link, an email change
 * by the current address, a password change by the current password. Adding a
 * factor is not one of them: a stolen fresh session could otherwise enrol the
 * thief's authenticator and lock the owner out.
 */
const SIGN_IN_CONFIRMS = new Set<string>([
  "account.delete",
  "account.change_email",
  "account.change_password",
]);

/** Whether "sign in again" passes this check: the user's method is the emailed code. */
export const signInCounts = (allowed: readonly StepUpMethod[], action?: string) =>
  allowed.includes("email") && SIGN_IN_CONFIRMS.has(action ?? "");

/**
 * True when the session passed a check within the TTL with a method this user
 * may still use, or (see `signInCounts`) was signed in within the TTL.
 */
export function stepUpFresh(
  state: StepUpState,
  allowed: readonly StepUpMethod[],
  now: Date,
  action?: string,
) {
  const within = (at: Date) => {
    const age = now.getTime() - at.getTime();
    return age >= 0 && age < STEP_UP_TTL_MS;
  };
  if (signInCounts(allowed, action) && within(state.createdAt)) return true;
  if (!state.stepUpAt || !state.stepUpMethod) return false;
  return within(state.stepUpAt) && (allowed as readonly string[]).includes(state.stepUpMethod);
}

export type AdminAccess = "ok" | "enrol" | "verify";

/**
 * Platform admins need a second factor, and their session must have proved it
 * once: at sign-in (TOTP or passkey) or in a step-up. Google/GitHub sign-in
 * skips the TOTP prompt, so enrolment alone isn't enough.
 */
export function adminAccess(input: {
  enforce: boolean;
  subject: StepUpSubject;
  authMethod: string | null;
  stepUpMethod: string | null;
}): AdminAccess {
  if (!input.enforce) return "ok";
  if (!input.subject.twoFactorEnabled && input.subject.passkeys === 0) return "enrol";
  if (STRONG_SIGN_INS.has(input.authMethod ?? "") || isSecondFactor(input.stepUpMethod)) {
    return "ok";
  }
  return "verify";
}
