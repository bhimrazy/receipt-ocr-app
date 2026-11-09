import {
  and,
  desc,
  eq,
  gt,
  gte,
  isNull,
  passkey,
  session,
  sql,
  stepUpCodes,
  stepUpEvents,
  twoFactor,
  user,
  verification,
} from "@receipt-ocr/db";
import { timingSafeEqual } from "node:crypto";
import { Effect } from "effect";
import { insertAudit, transact, type AuditActor } from "../audit";
import { Db } from "../services";
import {
  STEP_UP_CODE_MAX_ATTEMPTS,
  STEP_UP_CODE_TTL_MS,
  STEP_UP_CODE_WINDOW_MS,
  STEP_UP_CODES_PER_WINDOW,
  STEP_UP_LOCKOUT_MS,
  STEP_UP_MAX_FAILURES,
  type StepUpMethod,
} from "./policy";

export interface StepUpSessionRow {
  sessionId: string;
  userId: string;
  role: string;
  twoFactorEnabled: boolean;
  passkeys: number;
  authMethod: string | null;
  stepUpAt: Date | null;
  stepUpMethod: string | null;
  impersonatedBy: string | null;
}

/** The session's step-up state and its user's factors, read fresh (never from a cookie). */
export const loadStepUpSession = (sessionId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db): Promise<StepUpSessionRow | null> => {
      const [row] = await db
        .select({
          sessionId: session.id,
          userId: session.userId,
          role: user.role,
          twoFactorEnabled: user.twoFactorEnabled,
          authMethod: session.authMethod,
          stepUpAt: session.stepUpAt,
          stepUpMethod: session.stepUpMethod,
          impersonatedBy: session.impersonatedBy,
          passkeys: sql<number>`(select count(*)::int from ${passkey} p where p.user_id = ${session.userId})`,
        })
        .from(session)
        .innerJoin(user, eq(user.id, session.userId))
        .where(eq(session.id, sessionId))
        .limit(1);
      return row ?? null;
    }),
  );

export interface StepUpEventInput {
  userId: string;
  sessionId: string | null;
  action: string;
  method: StepUpMethod;
  outcome: "sent" | "verified" | "failed";
  totpCounter?: number | null;
  ip?: string | null;
}

/** A passed check: marks the session fresh and writes the audit row, together. */
export const markStepUp = (input: StepUpEventInput & { sessionId: string }) =>
  transact(async (tx) => {
    await tx
      .update(session)
      .set({ stepUpAt: new Date(), stepUpMethod: input.method })
      .where(and(eq(session.id, input.sessionId), eq(session.userId, input.userId)));
    await tx.insert(stepUpEvents).values({ ...input, outcome: "verified" });
  });

export const recordStepUpEvent = (input: StepUpEventInput) =>
  Effect.flatMap(Db, ({ use }) => use((db) => db.insert(stepUpEvents).values(input)));

/**
 * Seconds until this user may try again, or 0. Counts failures since their last
 * pass, within the lockout window, across sessions and methods.
 */
export const stepUpLockedFor = (userId: string, now = new Date()) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const windowStart = new Date(now.getTime() - STEP_UP_LOCKOUT_MS);
      const [pass] = await db
        .select({ at: stepUpEvents.createdAt })
        .from(stepUpEvents)
        .where(and(eq(stepUpEvents.userId, userId), eq(stepUpEvents.outcome, "verified")))
        .orderBy(desc(stepUpEvents.createdAt))
        .limit(1);
      // A pass clears earlier failures: only consecutive ones count.
      const since = pass && pass.at > windowStart ? pass.at : windowStart;
      const failures = await db
        .select({ at: stepUpEvents.createdAt })
        .from(stepUpEvents)
        .where(
          and(
            eq(stepUpEvents.userId, userId),
            eq(stepUpEvents.outcome, "failed"),
            gt(stepUpEvents.createdAt, since),
          ),
        )
        .orderBy(desc(stepUpEvents.createdAt))
        .limit(STEP_UP_MAX_FAILURES);
      if (failures.length < STEP_UP_MAX_FAILURES) return 0;
      // Locked until the oldest of the last N failures leaves the window.
      const oldest = failures.at(-1)!.at.getTime();
      return Math.max(1, Math.ceil((oldest + STEP_UP_LOCKOUT_MS - now.getTime()) / 1000));
    }),
  );

/** True when a verified TOTP step-up already used this time step or a later one (replay). */
export const totpStepUsed = (userId: string, counter: number) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const [row] = await db
        .select({ id: stepUpEvents.id })
        .from(stepUpEvents)
        .where(
          and(
            eq(stepUpEvents.userId, userId),
            eq(stepUpEvents.method, "totp"),
            eq(stepUpEvents.outcome, "verified"),
            gte(stepUpEvents.totpCounter, counter),
          ),
        )
        .limit(1);
      return Boolean(row);
    }),
  );

/** The sealed TOTP secret of a verified authenticator, or null. Decrypted by the caller. */
export const loadTotpSecret = (userId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const [row] = await db
        .select({ secret: twoFactor.secret })
        .from(twoFactor)
        .where(and(eq(twoFactor.userId, userId), eq(twoFactor.verified, true)))
        .limit(1);
      return row?.secret ?? null;
    }),
  );

export type IssueCodeResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Stores a new emailed code for the session (only its hash), replacing any
 * earlier one, unless the user has had too many codes in the window.
 */
export const issueStepUpCode = (input: {
  sessionId: string;
  userId: string;
  codeHash: string;
  now?: Date;
}) =>
  transact(async (tx): Promise<IssueCodeResult> => {
    const now = input.now ?? new Date();
    const since = new Date(now.getTime() - STEP_UP_CODE_WINDOW_MS);
    // Serialises concurrent sends for one user, so the window count holds.
    await tx
      .execute(sql`select pg_advisory_xact_lock(hashtext(${`step-up:${input.userId}`}))`)
      .then((r) => r.rows);
    const recent = await tx
      .select({ createdAt: stepUpCodes.createdAt })
      .from(stepUpCodes)
      .where(and(eq(stepUpCodes.userId, input.userId), gte(stepUpCodes.createdAt, since)))
      .orderBy(stepUpCodes.createdAt);
    if (recent.length >= STEP_UP_CODES_PER_WINDOW) {
      const oldest = recent[0]!.createdAt.getTime();
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + STEP_UP_CODE_WINDOW_MS - now.getTime()) / 1000),
        ),
      };
    }
    await tx
      .update(stepUpCodes)
      .set({ consumedAt: now })
      .where(and(eq(stepUpCodes.sessionId, input.sessionId), isNull(stepUpCodes.consumedAt)));
    await tx.insert(stepUpCodes).values({
      sessionId: input.sessionId,
      userId: input.userId,
      codeHash: input.codeHash,
      expiresAt: new Date(now.getTime() + STEP_UP_CODE_TTL_MS),
      createdAt: now,
    });
    return { ok: true };
  });

export type ConsumeCodeResult = "ok" | "invalid" | "expired" | "too_many";

const sameHash = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Checks a code against the session's latest unused one; single use, limited guesses. */
export const consumeStepUpCode = (input: { sessionId: string; codeHash: string; now?: Date }) =>
  transact(async (tx): Promise<ConsumeCodeResult> => {
    const now = input.now ?? new Date();
    const [row] = await tx
      .select()
      .from(stepUpCodes)
      .where(and(eq(stepUpCodes.sessionId, input.sessionId), isNull(stepUpCodes.consumedAt)))
      .orderBy(desc(stepUpCodes.createdAt))
      .limit(1)
      .for("update");
    if (!row || row.expiresAt.getTime() <= now.getTime()) return "expired";
    if (row.attempts >= STEP_UP_CODE_MAX_ATTEMPTS) return "too_many";
    if (!sameHash(row.codeHash, input.codeHash)) {
      const attempts = row.attempts + 1;
      await tx
        .update(stepUpCodes)
        .set({
          attempts,
          ...(attempts >= STEP_UP_CODE_MAX_ATTEMPTS ? { consumedAt: now } : {}),
        })
        .where(eq(stepUpCodes.id, row.id));
      return attempts >= STEP_UP_CODE_MAX_ATTEMPTS ? "too_many" : "invalid";
    }
    await tx.update(stepUpCodes).set({ consumedAt: now }).where(eq(stepUpCodes.id, row.id));
    return "ok";
  });

/**
 * Stored identifiers of trusted-device rows start with this. Every other
 * verification identifier is a bare SHA-256 (base64url, never a colon), so
 * this prefix tells trust rows apart without unhashing anything. Set by
 * `trustDeviceIdentifier` in the web app's Better Auth config.
 */
export const TRUST_DEVICE_STORED_PREFIX = "trust-device:";

/**
 * Forgets every trusted device of the user (Better Auth's own disable forgets
 * only the current one). Only trust rows: the user's pending password-reset
 * or account-deletion links, keyed by user id too, stay valid.
 */
export const forgetTrustedDevices = (userId: string) =>
  Effect.flatMap(Db, ({ use }) =>
    use((db) =>
      db
        .delete(verification)
        .where(
          and(
            eq(verification.value, userId),
            sql`${verification.identifier} like ${`${TRUST_DEVICE_STORED_PREFIX}%`}`,
          ),
        ),
    ),
  );

/**
 * After a sign-in from a browser that was already signed in as the same user:
 * the new session keeps the old one's workspace and the old one is deleted, so
 * re-signing in leaves no second live session for a thief who had copied the
 * old cookie.
 */
export const replacePreviousSession = (input: {
  previousToken: string;
  sessionId: string;
  userId: string;
}) =>
  transact(async (tx) => {
    const [previous] = await tx
      .select({ id: session.id, activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(and(eq(session.token, input.previousToken), eq(session.userId, input.userId)))
      .limit(1);
    if (!previous || previous.id === input.sessionId) return { replaced: false };
    await tx
      .update(session)
      .set({ activeOrganizationId: previous.activeOrganizationId })
      .where(and(eq(session.id, input.sessionId), eq(session.userId, input.userId)));
    await tx.delete(session).where(eq(session.id, previous.id));
    return { replaced: true };
  });

/**
 * A passkey check signs in afresh (the plugin creates a new session). The new
 * session counts as verified, keeps the workspace the old one had, and replaces
 * it, so a step-up doesn't leave a stray session behind.
 */
export const adoptPasskeySession = (input: {
  previousToken: string | null;
  sessionId: string;
  userId: string;
  ip?: string | null;
}) =>
  transact(async (tx) => {
    const [previous] = input.previousToken
      ? await tx
          .select({ id: session.id, activeOrganizationId: session.activeOrganizationId })
          .from(session)
          .where(and(eq(session.token, input.previousToken), eq(session.userId, input.userId)))
          .limit(1)
      : [];
    await tx
      .update(session)
      .set({
        stepUpAt: new Date(),
        stepUpMethod: "passkey",
        ...(previous ? { activeOrganizationId: previous.activeOrganizationId } : {}),
      })
      .where(and(eq(session.id, input.sessionId), eq(session.userId, input.userId)));
    if (previous && previous.id !== input.sessionId) {
      await tx.delete(session).where(eq(session.id, previous.id));
    }
    await tx.insert(stepUpEvents).values({
      userId: input.userId,
      sessionId: input.sessionId,
      action: previous ? "passkey.step_up" : "passkey.sign_in",
      method: "passkey",
      outcome: "verified",
      ip: input.ip ?? null,
    });
    return { replaced: Boolean(previous) };
  });

/**
 * Admin reset of a user's sign-in factors: clears the authenticator, passkeys,
 * trusted devices and every session, with the audit row in the same transaction.
 * It drops every verification row keyed by the user, pending password-reset and
 * deletion links included, on purpose: the account may be in someone else's
 * hands, and the user signs in afresh with their password anyway.
 */
export const resetSecondFactor = (
  target: { id: string; email: string },
  audit: AuditActor & { reason: string },
) =>
  transact(async (tx) => {
    const removed = await tx
      .delete(twoFactor)
      .where(eq(twoFactor.userId, target.id))
      .returning({ id: twoFactor.id });
    const passkeys = await tx
      .delete(passkey)
      .where(eq(passkey.userId, target.id))
      .returning({ id: passkey.id });
    await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, target.id));
    await tx.delete(verification).where(eq(verification.value, target.id));
    const sessions = await tx
      .delete(session)
      .where(eq(session.userId, target.id))
      .returning({ id: session.id });
    await insertAudit(tx, {
      ...audit,
      action: "user.two_factor_reset",
      targetType: "user",
      targetId: target.id,
      targetLabel: target.email,
      reason: audit.reason,
      metadata: {
        authenticator: removed.length > 0,
        passkeys: passkeys.length,
        sessions: sessions.length,
      },
    });
    return {
      authenticator: removed.length > 0,
      passkeys: passkeys.length,
      sessions: sessions.length,
    };
  });
