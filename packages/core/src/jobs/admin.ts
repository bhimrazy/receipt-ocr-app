import { receipts, sql } from "@receipt-ocr/db";
import { Effect } from "effect";
import { insertAudit, transact, type AuditActor } from "../audit";
import { Conflict, InvalidInput, NotFound } from "../errors";
import { utcDayStart } from "../quota";
import { roundsSince } from "../usage";
import type { Job, JobRegistry } from "./definition";
import { liveReceiptJob } from "./live";

/**
 * Admin actions on the queue. Each one changes the job (and its receipt) and
 * writes its `admin_audit_log` row in one transaction. Audit metadata holds
 * ids, states and error kinds only, never payload or receipt contents.
 */

/** `queue`, `kind:<registered kind>` or `provider:<id>` (clearing a cooldown). */
const SCOPE = /^(queue|kind:[a-z0-9.-]{1,40}|provider:[a-z0-9-]{1,40})$/;

type LockedJob = {
  id: string;
  kind: string;
  state: string;
  attempts: number;
  max_attempts: number;
  receipt_id: string | null;
  organization_id: string | null;
  user_id: string | null;
  last_error_kind: string | null;
  payload: unknown;
};

const roundOf = (payload: unknown) => {
  const round = (payload as { round?: unknown } | null)?.round;
  return typeof round === "number" && Number.isInteger(round) && round >= 1 ? round : null;
};

/**
 * Re-queues a dead or cancelled job under the same round, so the user is not
 * charged a new round for a failure on our side: this is the audited admin
 * override of the per-user quota (`quota: "not-charged"` in the audit row).
 * The service-wide daily cap still applies.
 *
 * - The job keeps its attempt count and gets a fresh budget of the kind's
 *   attempts on top, so each new attempt's calls get their own `job_attempt`
 *   in the ledger and are billed, never dropped as duplicates.
 * - A receipt job only re-runs while its round is still the receipt's
 *   current one: after the user retried, the newer round owns the receipt.
 *   The receipt goes back to `processing`; it must still exist.
 * - A job a user retry superseded can't be re-run.
 */
export const rerunJob = <R>(
  registry: JobRegistry<R>,
  id: string,
  audit: AuditActor,
  options: { reason?: string | null; dailyCap?: number; now?: Date } = {},
) =>
  transact(async (tx) => {
    const [job] = await tx
      .execute<LockedJob>(
        sql`select id, kind, state, attempts, max_attempts,
        receipt_id, organization_id, user_id, last_error_kind, payload
      from jobs where id = ${id}::uuid for update`,
      )
      .then((r) => r.rows);
    if (!job) throw new NotFound({ message: "That job no longer exists." });
    const definition = Object.hasOwn(registry, job.kind) ? registry[job.kind] : undefined;
    if (!definition) throw new Conflict({ message: `No handler runs ${job.kind} jobs any more.` });
    if (job.state !== "dead" && job.state !== "cancelled") {
      throw new Conflict({ message: "Only dead or cancelled jobs can be re-run." });
    }
    if (job.last_error_kind === "superseded") {
      throw new Conflict({ message: "A newer try of this receipt replaced this job." });
    }

    if (options.dailyCap !== undefined) {
      const [row] = await tx
        .execute<{ used: number }>(
          sql`select ${roundsSince(utcDayStart(options.now ?? new Date()))} as used`,
        )
        .then((r) => r.rows);
      if ((row?.used ?? 0) >= options.dailyCap) {
        throw new Conflict({
          message: "The service-wide daily cap is reached. Re-run after 00:00 UTC.",
        });
      }
    }

    const round = roundOf(job.payload);
    let receiptLabel: string | null = null;
    if (job.receipt_id && job.kind.startsWith("receipt.")) {
      if (round === null) throw new Conflict({ message: "This job has no round to re-run." });
      const [receipt] = await tx
        .execute<{ status: string; attempts: number }>(
          sql`select status, attempts from receipts where id = ${job.receipt_id}::uuid for update`,
        )
        .then((r) => r.rows);
      if (!receipt) throw new Conflict({ message: "Its receipt was deleted." });
      if (receipt.attempts !== round) {
        throw new Conflict({
          message: `The receipt is on try ${receipt.attempts} now; this job was for try ${round}.`,
        });
      }
      if (receipt.status === "completed") {
        throw new Conflict({ message: "Its receipt has been read since." });
      }
      const [live] = await tx
        .execute<{ id: string }>(
          sql`select j.id from jobs j
        where j.receipt_id = ${job.receipt_id}::uuid and j.id <> ${id}::uuid and ${liveReceiptJob("j")}
        limit 1`,
        )
        .then((r) => r.rows);
      if (live) throw new Conflict({ message: "Another job for this receipt is still running." });
      await tx
        .update(receipts)
        .set({ status: "processing", errorMessage: null, updatedAt: new Date() })
        .where(sql`${receipts.id} = ${job.receipt_id}::uuid and ${receipts.attempts} = ${round}`);
      receiptLabel = job.receipt_id;
    }

    // Older live leftovers for the receipt still hold the unique index; the check above
    // found none live, so any that remain are orphans, cancelled like a user retry does.
    if (job.receipt_id) {
      await tx.execute(sql`update jobs set state = 'cancelled', last_error_kind = 'superseded',
          last_error_at = now(), finished_at = now(), locked_by = null, locked_until = null,
          updated_at = now()
        where receipt_id = ${job.receipt_id}::uuid and id <> ${id}::uuid
          and kind like 'receipt.%' and state in ('queued', 'running')`);
    }
    const [updated] = await tx
      .execute<{ max_attempts: number }>(
        sql`update jobs j set
        state = 'queued', run_at = now(), finished_at = null, locked_by = null, locked_until = null,
        max_attempts = j.attempts + ${definition.maxAttempts}, updated_at = now(),
        attempt_log = (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from (
          select e, i from jsonb_array_elements(j.attempt_log || jsonb_build_object(
            'n', j.attempts, 'at', now(), 'outcome', 'admin-rerun', 'kind', null, 'worker', null, 'ms', null))
            with ordinality as t(e, i) order by i desc limit 5) s)
      where j.id = ${id}::uuid
      returning j.max_attempts`,
      )
      .then((r) => r.rows);

    await insertAudit(tx, {
      ...audit,
      action: "job.rerun",
      targetType: "job",
      targetId: id,
      targetLabel: `${job.kind} ${id.slice(0, 8)}`,
      reason: options.reason ?? null,
      metadata: {
        kind: job.kind,
        from: job.state,
        errorKind: job.last_error_kind,
        attempts: job.attempts,
        maxAttempts: updated?.max_attempts ?? null,
        round,
        receiptId: receiptLabel,
        quota: "not-charged",
      },
    });
    return { id, round };
  });

/**
 * Cancels a queued job (running ones finish or fail on their own), then
 * settles what it was for: a receipt becomes failed with "cancelled", and the
 * user can try again.
 */
export const cancelQueuedJob = <R>(
  registry: JobRegistry<R>,
  id: string,
  audit: AuditActor,
  reason?: string | null,
) =>
  Effect.gen(function* () {
    const job = yield* transact(async (tx) => {
      const [row] = await tx
        .execute<LockedJob & { run_at: string | Date; priority: number }>(
          sql`update jobs set state = 'cancelled', finished_at = now(), last_error_kind = 'cancelled',
            last_error_at = now(), locked_by = null, locked_until = null, updated_at = now()
          where id = ${id}::uuid and state = 'queued'
          returning id, kind, state, attempts, max_attempts, receipt_id, organization_id, user_id,
            last_error_kind, payload, run_at, priority`,
        )
        .then((r) => r.rows);
      if (!row) {
        const [exists] = await tx
          .execute<{ state: string }>(sql`select state from jobs where id = ${id}::uuid`)
          .then((r) => r.rows);
        throw exists
          ? new Conflict({
              message: `Only queued jobs can be cancelled; this one is ${exists.state}.`,
            })
          : new NotFound({ message: "That job no longer exists." });
      }
      await insertAudit(tx, {
        ...audit,
        action: "job.cancel",
        targetType: "job",
        targetId: id,
        targetLabel: `${row.kind} ${id.slice(0, 8)}`,
        reason: reason ?? null,
        metadata: { kind: row.kind, attempts: row.attempts, round: roundOf(row.payload) },
      });
      return {
        id: row.id,
        kind: row.kind,
        state: "cancelled",
        priority: row.priority,
        payload: row.payload,
        idempotencyKey: null,
        receiptId: row.receipt_id,
        organizationId: row.organization_id,
        userId: row.user_id,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
        runAt: new Date(row.run_at),
        lockedBy: null,
        lockedUntil: null,
        lastErrorKind: "cancelled",
      } satisfies Job;
    });
    const definition = Object.hasOwn(registry, job.kind) ? registry[job.kind] : undefined;
    const parsed = definition?.payload.safeParse(job.payload);
    if (definition?.onFinalFailure && parsed?.success) {
      yield* definition.onFinalFailure(parsed.data, { job, errorKind: "cancelled" });
    }
    return { id };
  });

/**
 * Pauses or resumes the whole queue (`queue`) or one kind (`kind:<kind>`);
 * resuming `provider:<id>` clears its cooldown. A pause holds until resumed.
 */
export const setQueueControl = <R>(
  registry: JobRegistry<R>,
  input: { scope: string; paused: boolean; reason?: string | null },
  audit: AuditActor,
) =>
  transact(async (tx) => {
    const { scope, paused } = input;
    if (!SCOPE.test(scope)) throw new InvalidInput({ message: "Unknown queue scope." });
    if (scope.startsWith("kind:") && !Object.hasOwn(registry, scope.slice(5))) {
      throw new InvalidInput({ message: "No handler runs that kind." });
    }
    if (paused && scope.startsWith("provider:")) {
      throw new InvalidInput({
        message: "Providers cool down on their own; pause a kind instead.",
      });
    }
    const [before] = await tx
      .execute<{ paused: boolean; until: string | null }>(
        sql`select paused, until from job_controls where scope = ${scope} for update`,
      )
      .then((r) => r.rows);
    if (paused) {
      await tx.execute(sql`insert into job_controls (scope, paused, until, reason, updated_by)
        values (${scope}, true, null, ${input.reason ?? null}, ${audit.actor.email})
        on conflict (scope) do update set paused = true, until = null,
          reason = excluded.reason, updated_by = excluded.updated_by, updated_at = now()`);
    } else {
      await tx.execute(sql`update job_controls set paused = false, until = null,
          reason = ${input.reason ?? null}, updated_by = ${audit.actor.email}, updated_at = now()
        where scope = ${scope}`);
    }
    const action = paused
      ? "job.pause"
      : scope.startsWith("provider:")
        ? "job.cooldown_clear"
        : "job.resume";
    await insertAudit(tx, {
      ...audit,
      action,
      targetType: "job",
      targetId: scope,
      targetLabel: scope,
      reason: input.reason ?? null,
      metadata: { scope, wasPaused: before?.paused ?? false, wasUntil: before?.until ?? null },
    });
    return { scope, paused };
  });
