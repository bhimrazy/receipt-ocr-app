import "server-only";
import {
  consumeStepUpCode,
  issueStepUpCode,
  loadTotpSecret,
  markStepUp,
  recordStepUpEvent,
  signInCounts,
  STEP_UP_CODE_TTL_MS,
  stepUpLockedFor,
  totpStepUsed,
  type StepUpAction,
  type StepUpMethod,
} from "@receipt-ocr/core";
import { stepUpCodeEmail } from "@receipt-ocr/email";
import { APIError } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";
import { createHmac, randomInt } from "node:crypto";
import { auth, deliverEmail } from "./auth";
import { authEnv, emailContext } from "./env";
import type { SocialProvider } from "@/components/auth/credentials-form";
import { errorFields, logger } from "./log";
import { runtime } from "./runtime";
import { checkStepUp, STEP_UP_MESSAGES } from "./step-up-check";
import { matchTotpStep } from "./totp";

/**
 * Running a "verify it's you" check: the methods on offer, sending an emailed
 * code, and verifying a TOTP code, backup code or emailed code. Every send and
 * every pass or failure is written to `step_up_events`.
 */

/** How this user can sign in again, which passes the check when they have no factor. */
export interface SignInMethods {
  password: boolean;
  providers: SocialProvider[];
}

export type StepUpOptions =
  | {
      ok: true;
      fresh: boolean;
      methods: StepUpMethod[];
      email: string;
      /** When a new sign-in passes this check instead (see `signInCounts`). */
      signIn?: SignInMethods;
    }
  | { ok: false; error: string; enrol?: boolean };

export type StepUpResult = { ok: true } | { ok: false; error: string; locked?: boolean };

type Caller = {
  session: { id: string };
  user: { id: string; email: string };
  ip: string | null;
  headers: Headers;
};

const wait = (seconds: number) => {
  const minutes = Math.ceil(seconds / 60);
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
};

export async function stepUpOptions(caller: Caller, action: StepUpAction): Promise<StepUpOptions> {
  const check = await checkStepUp(caller.session.id, action);
  if (check.ok) {
    const methods = check.row.twoFactorEnabled ? (["totp", "backup_code"] as const) : [];
    return { ok: true, fresh: true, methods: [...methods], email: caller.user.email };
  }
  if (check.reason !== "required") {
    return { ok: false, error: STEP_UP_MESSAGES[check.reason], enrol: check.reason === "enrol" };
  }
  const signIn = signInCounts(check.methods, action)
    ? await signInMethods(caller.headers)
    : undefined;
  return { ok: true, fresh: false, methods: check.methods, email: caller.user.email, signIn };
}

async function signInMethods(headers: Headers): Promise<SignInMethods> {
  const accounts = await auth.api.listUserAccounts({ headers });
  const linked = new Set(accounts.map((account) => account.providerId));
  return {
    password: linked.has("credential"),
    providers: (["google", "github"] as const).filter(
      (provider) => linked.has(provider) && Boolean(authEnv[provider]),
    ),
  };
}

/** HMAC under the auth secret, bound to the session: a database read alone can't test guesses. */
async function codeHash(sessionId: string, code: string) {
  const { secret } = await auth.$context;
  return createHmac("sha256", secret).update(`step-up:${sessionId}:${code}`).digest("hex");
}

/** Who may run a check now, with which methods; refusals are user-safe messages. */
async function admit(caller: Caller, method: StepUpMethod, action: StepUpAction) {
  const check = await checkStepUp(caller.session.id, action);
  if (!check.ok && check.reason !== "required") {
    return { error: STEP_UP_MESSAGES[check.reason] } as const;
  }
  const methods = check.ok ? null : check.methods;
  if (methods && !methods.includes(method)) {
    return { error: "That way of confirming isn't available for your account." } as const;
  }
  const lockedFor = await runtime.runPromise(stepUpLockedFor(caller.user.id));
  if (lockedFor > 0) return { error: wait(lockedFor), locked: true } as const;
  return { ok: true } as const;
}

export async function sendStepUpCode(caller: Caller, action: StepUpAction): Promise<StepUpResult> {
  const admitted = await admit(caller, "email", action);
  if (!("ok" in admitted)) return { ok: false, ...admitted };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const issued = await runtime.runPromise(
    issueStepUpCode({
      sessionId: caller.session.id,
      userId: caller.user.id,
      codeHash: await codeHash(caller.session.id, code),
    }),
  );
  if (!issued.ok) {
    const minutes = Math.ceil(issued.retryAfterSeconds / 60);
    return {
      ok: false,
      error: `We've sent several codes already. Use the latest one, or try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    };
  }
  try {
    await deliverEmail({
      to: caller.user.email,
      ...stepUpCodeEmail(emailContext, { code, expiresInSeconds: STEP_UP_CODE_TTL_MS / 1000 }),
    });
  } catch (error) {
    logger.error({
      event: "auth.step_up_email_failed",
      unit: "log",
      user_id: caller.user.id,
      action,
      error: errorFields(error),
    });
    return { ok: false, error: "We couldn't send the email. Try again in a minute." };
  }
  await runtime.runPromise(
    recordStepUpEvent({
      userId: caller.user.id,
      sessionId: caller.session.id,
      action,
      method: "email",
      outcome: "sent",
      ip: caller.ip,
    }),
  );
  return { ok: true };
}

type Verified = { ok: true; totpCounter?: number } | { ok: false; error: string };

async function verifyTotp(userId: string, code: string): Promise<Verified> {
  const sealed = await runtime.runPromise(loadTotpSecret(userId));
  if (!sealed) return { ok: false, error: "Two-step sign-in isn't set up on this account." };
  const { secretConfig } = await auth.$context;
  const step = matchTotpStep(await symmetricDecrypt({ key: secretConfig, data: sealed }), code);
  if (step === null)
    return { ok: false, error: "That code isn't right. Check your app and try again." };
  if (await runtime.runPromise(totpStepUsed(userId, step))) {
    return { ok: false, error: "That code was already used. Wait for the next one." };
  }
  return { ok: true, totpCounter: step };
}

async function verifyBackupCode(headers: Headers, code: string): Promise<Verified> {
  try {
    // Session path of the plugin: consumes the code (compare-and-swap), creates no session.
    await auth.api.verifyBackupCode({ body: { code: code.trim(), disableSession: true }, headers });
    return { ok: true };
  } catch (error) {
    if (error instanceof APIError) {
      return { ok: false, error: "That backup code isn't right, or was already used." };
    }
    throw error;
  }
}

async function verifyEmailCode(sessionId: string, code: string): Promise<Verified> {
  const digits = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(digits))
    return { ok: false, error: "Enter the 6-digit code from the email." };
  const result = await runtime.runPromise(
    consumeStepUpCode({ sessionId, codeHash: await codeHash(sessionId, digits) }),
  );
  if (result === "ok") return { ok: true };
  if (result === "invalid")
    return { ok: false, error: "That code isn't right. Check the email and try again." };
  return { ok: false, error: "That code has expired or was used up. Send a new one." };
}

export async function verifyStepUp(
  caller: Caller,
  input: { action: StepUpAction; method: StepUpMethod; code: string },
): Promise<StepUpResult> {
  if (input.method === "passkey") {
    return { ok: false, error: "Passkeys aren't available yet. Use your authenticator app." };
  }
  const admitted = await admit(caller, input.method, input.action);
  if (!("ok" in admitted)) return { ok: false, ...admitted };

  const result =
    input.method === "totp"
      ? await verifyTotp(caller.user.id, input.code)
      : input.method === "backup_code"
        ? await verifyBackupCode(caller.headers, input.code)
        : await verifyEmailCode(caller.session.id, input.code);

  const event = {
    userId: caller.user.id,
    sessionId: caller.session.id,
    action: input.action,
    method: input.method,
    ip: caller.ip,
  };
  logger.info({
    event: "auth.step_up",
    unit: "log",
    user_id: caller.user.id,
    action: input.action,
    kind: input.method,
    outcome: result.ok ? "verified" : "failed",
  });
  if (!result.ok) {
    await runtime.runPromise(recordStepUpEvent({ ...event, outcome: "failed" }));
    return result;
  }
  await runtime.runPromise(
    markStepUp({ ...event, outcome: "verified", totpCounter: result.totpCounter ?? null }),
  );
  return { ok: true };
}
