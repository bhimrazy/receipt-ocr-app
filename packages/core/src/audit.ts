import { adminAuditLog, type DbClient } from "@receipt-ocr/db";
import { Effect } from "effect";
import { Conflict, DbError, InvalidInput, NotFound } from "./errors";
import { Db } from "./services";

export type AuditTarget = "user" | "workspace" | "settings";

/** Who made an admin change, and from where. */
export type AuditActor = {
  actor: { id: string; email: string };
  ip?: string | null;
};

export type AuditEntryInput = AuditActor & {
  action: string;
  targetType: AuditTarget;
  targetId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/** Writes an audit row with `db`, which may be a transaction so the row commits with the change. */
export const insertAudit = (db: Pick<Tx, "insert">, entry: AuditEntryInput) =>
  db.insert(adminAuditLog).values({
    actorId: entry.actor.id,
    actorEmail: entry.actor.email,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    targetLabel: entry.targetLabel ?? null,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? null,
    ip: entry.ip ?? null,
  });

/** A standalone audit row, for changes made outside our transactions (Better Auth calls). */
export const recordAudit = (entry: AuditEntryInput) =>
  Effect.flatMap(Db, ({ use }) => use((db) => insertAudit(db, entry)));

type Refusal = Conflict | NotFound | InvalidInput;
const isRefusal = (cause: unknown): cause is Refusal =>
  cause instanceof Conflict || cause instanceof NotFound || cause instanceof InvalidInput;

/**
 * Runs `body` in one transaction. Throwing a Conflict, NotFound or
 * InvalidInput inside rolls it back and fails with that error; anything else
 * becomes a DbError.
 */
export const transact = <A>(body: (tx: Tx) => Promise<A>) =>
  Effect.flatMap(Db, ({ client }) =>
    Effect.tryPromise({
      try: () => client.transaction(body),
      catch: (cause): Refusal | DbError =>
        isRefusal(cause) ? cause : new DbError({ message: "Database request failed", cause }),
    }),
  );
