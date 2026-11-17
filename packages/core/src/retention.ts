import {
  adminAuditLog,
  and,
  inArray,
  invitation,
  session,
  sql,
  stepUpEvents,
  type SQL,
} from "@receipt-ocr/db";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { Db } from "./services";

/** A day past expiry, so a session refreshed at the last moment is never deleted under its user. */
const SESSION_RETENTION_DAYS = 1;
/** Far past what the lockout (15 minutes) and the TOTP replay check (the current step) read. */
const STEP_UP_EVENT_RETENTION_DAYS = 90;
/** Counted from expiry, so an answered or lapsed invitation goes about 37 days after it was sent. */
const INVITATION_RETENTION_DAYS = 30;
const ADMIN_AUDIT_RETENTION_YEARS = 2;

/**
 * Deletes up to `limit` rows matching `expired` and returns how many. The delete repeats the
 * predicate on the locked rows, so a row changed between the two reads (a refreshed session) stays.
 */
const purgeWhere = (table: PgTable, id: PgColumn, expired: () => SQL) => (limit: number) =>
  Effect.flatMap(Db, ({ use }) =>
    use(async (db) => {
      const ids = db.select({ id }).from(table).where(expired()).limit(limit);
      const deleted = await db
        .delete(table)
        .where(and(inArray(id, ids), expired()))
        .returning({ id });
      return deleted.length;
    }),
  );

const olderThan = (column: PgColumn, interval: SQL) => sql`${column} < now() - ${interval}`;

export const purgeExpiredSessions = purgeWhere(session, session.id, () =>
  olderThan(session.expiresAt, sql`make_interval(days => ${SESSION_RETENTION_DAYS})`),
);

export const purgeStepUpEvents = purgeWhere(stepUpEvents, stepUpEvents.id, () =>
  olderThan(stepUpEvents.createdAt, sql`make_interval(days => ${STEP_UP_EVENT_RETENTION_DAYS})`),
);

export const purgeInvitations = purgeWhere(invitation, invitation.id, () =>
  olderThan(invitation.expiresAt, sql`make_interval(days => ${INVITATION_RETENTION_DAYS})`),
);

export const purgeAdminAuditLog = purgeWhere(adminAuditLog, adminAuditLog.id, () =>
  olderThan(adminAuditLog.createdAt, sql`make_interval(years => ${ADMIN_AUDIT_RETENTION_YEARS})`),
);
