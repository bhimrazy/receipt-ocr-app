# Background jobs

How a receipt gets read after it is accepted: a durable `receipt.extract` job in Postgres, claimed by whatever runs
the queue, retried with backoff, and only then allowed to fail the receipt. The code is in
[`packages/core/src/jobs`](../../../packages/core/src/jobs); the decision and the alternatives are in the
[jobs plan](../../plans/2026-11-06-jobs-queue.md).

## Contents

- [Two state machines](#two-state-machines)
- [Who runs the queue](#who-runs-the-queue)
- [Claim, lease and fencing](#claim-lease-and-fencing)
- [Retries, dead jobs and cooldowns](#retries-dead-jobs-and-cooldowns)
- [Quota and cost](#quota-and-cost)
- [Orphaned jobs](#orphaned-jobs)
- [Other job kinds](#other-job-kinds)
- [Tables](#tables)

## Two state machines

The receipt row stays what the user sees (`processing`, `completed`, `failed`). The job row is how the work runs.

```mermaid
stateDiagram-v2
  [*] --> queued: enqueued with the receipt and its round
  queued --> running: claim (attempts + 1, lease 90 s)
  running --> succeeded: receipt completed (or nothing left to do)
  running --> queued: retryable failure, run_at = now + backoff
  running --> queued: every provider cooling, attempt not spent
  running --> dead: not retryable, or the 4th attempt failed
  running --> queued: lease expired, reaped (dead on the last attempt)
  queued --> cancelled: cancel, or a user retry supersedes it
  running --> cancelled: cancel (the handler is interrupted)
  dead --> [*]: receipt settled as failed
  cancelled --> [*]
```

`queued` includes "waiting to retry": `run_at` is then in the future. Only the job's final-failure hook marks the
receipt `failed`, so a failed first attempt leaves the receipt `processing` while the job retries.

## Who runs the queue

`tick(budget)` in [`runner.ts`](../../../packages/core/src/jobs/runner.ts) reaps expired leases, then claims and runs
jobs until nothing is runnable or the budget says stop. Every runner calls it; nothing else changes between them.

| Runner (today)                                    | When                                                          | Budget and waits                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `runJobNow` in `POST /api/receipts` instant mode  | First attempt of the upload                                   | In the request, this job only, no waiting                                                      |
| `drainJobs` in `after()` of uploads and retries   | After the response                                            | Until 290 s after the route started; sleeps through backoff only for its own job, 90 s max     |
| `kickJob` in `after()` of `GET /api/receipts/:id` | A poll finds the receipt's job due, claimable and not running | That one job only, no waiting; returns at once if it can't claim it                            |
| `drainOnce` in `GET/POST /api/jobs/drain`         | Supabase `pg_cron` each minute, Vercel Cron daily             | 55 s budget, claims only in the first 5 s, at most 10 jobs, 3 at once; never waits for backoff |
| `runWorkerLoop` (future `apps/worker`)            | Continuously                                                  | `drainOnce` back to back, `idleMs` sleep when idle, stops on abort after the pass in progress  |

Upload and retry drains also run anyone else's due jobs; the poll kick never does, so poll traffic can't become
queue concurrency. Every unfiltered tick (one that may claim any job of its kinds, such as a drain)
records the time per kind it serves in `job_controls` (scope `tick:<kind>`, at most every 30 s per process per kind),
which the orphan rule below reads. Ticks filtered to a few ids (`runJobNow`, the poll kick) record nothing: they
don't drain anyone else's jobs.

The drain route and the worker loop are the two runners that need no request: both call `drainOnce`
([`drain.ts`](../../../packages/core/src/jobs/drain.ts)), a bounded `tick` with a job cap (`maxJobs`) and no
waiting for retries, free of any HTTP type. The route checks `CRON_SECRET` first (`401` wrong, `503` unset); it is
the only thing standing between the internet and every workspace's queue. A job cut off by a deploy or a timeout is
reaped when its lease runs out and re-run by the next drain, so recovery needs no open page. The `pg_cron` and Vault
setup is in [production environment, step 8](../../production-environment.md#8-queue-drain-cron).

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant R as POST /api/receipts
  participant DB as Postgres
  participant A as after()

  B->>R: upload
  R->>DB: one transaction: lock user, quota, receipt, ocr_rounds, jobs row
  R->>DB: instant: claim this job, run attempt 1
  alt completed or dead
    R-->>B: 200 completed / failed
  else retrying
    R-->>B: 202 processing
    R->>A: drainJobs, waits for this job's backoff
    A->>DB: claim, run attempt 2, 3, 4
  end
  loop polling
    B->>R: GET /api/receipts/{id}
    R->>A: job due, claimable, nobody running it: run that job
  end
```

## Claim, lease and fencing

- **Claim** is one statement: lock up to `4n` runnable candidates with `FOR UPDATE SKIP LOCKED`, rank them per user
  with `row_number()`, keep those under the per-user running cap (2), take `n` in priority then `run_at` order, and
  mark them `running` with `attempts + 1` and a lease. Paused kinds and a paused queue (`job_controls`) are skipped.
  Concurrent claimers never wait on each other or claim the same row.
- **Heartbeat** renews the lease every third of it. It touches no indexed column, so it is a HOT update. If it
  matches no row (reaped, cancelled), the handler is interrupted; its `AbortSignal` stops the model call.
- **Fencing.** Every write after the claim matches `id`, `locked_by`, `attempts` and `state = 'running'`. A worker
  whose lease expired, even one that claimed the same job again under the same id, changes nothing. The receipt write
  keeps its own guard (`status = 'processing' and attempts = round`), so a job for an older round can't overwrite a
  newer one.
- **Reaper**, at the start of every tick: running jobs past their lease go back to `queued`, or to `dead` on their
  last attempt (then the receipt is settled, with one `timeout` row for the attempt that never reported).
- Everything is plain statements and transactions: no LISTEN, no session advisory locks, no prepared statements. It
  works through Supabase's transaction pooler.

## Retries, dead jobs and cooldowns

| Failure                                                                                                                                                                                                                                                                                   | Next                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `timeout`, `rate-limited`, `provider-error`, storage (other than a missing file), DB (other than below)                                                                                                                                                                                   | Retry after backoff, up to 4 attempts                                                                           |
| `invalid-output`, `bad-image`, `not-configured`, `refused`, `unsupported-file`, unreadable stored file, a stored file missing from the bucket (`stored-file-missing`: the SDK's typed `NoSuchKey`), bad payload, a DB data or constraint error (SQLSTATE class 22 or 23, `db-data-error`) | Dead now (`refused` and `unsupported-file` already tried every model; each has its own receipt message)         |
| A chain where any step hit `timeout`, `rate-limited` or `provider-error`, whatever the last step's kind (e.g. a 429, then HEIC skipped)                                                                                                                                                   | Retry after backoff, as that transient kind                                                                     |
| Steps left out for a cooling provider and the rest failed for good (`refused`, `unsupported-file`, ...)                                                                                                                                                                                   | Retry, as `providers-cooling`, once the first left-out provider is back (spends an attempt, so the cap ends it) |
| Every provider in the chain cooling down                                                                                                                                                                                                                                                  | Back to `queued` at the cooldown end, attempt not spent                                                         |

- Backoff: `min(10 min, 10 s x 2^(attempt-1))`, jittered to 50 to 100%. A provider's Retry-After (a header, or
  Gemini's `RetryInfo.retryDelay` in the 429 body) is a floor, and so is the cooldown the failure starts (30 s for a
  429 with no hint), so a retry never runs while its own provider is still left out (capped at 10 min). Delays are computed with the database's `now()`, so app and database clock skew doesn't matter.
- A 429 writes a cooldown for the whole provider (`job_controls` scope `provider:<id>`, Retry-After or 30 s, at most
  10 min). Every job reads cooldowns before calling the model and skips cooling providers, so one 429 slows every job
  for that provider, not only the one that hit it.
- Each attempt's calls go to `ocr_calls` with its `job_attempt`, whether it succeeded or not.

## Quota and cost

- The quota is reserved once per round, when the job is enqueued, under the user's advisory lock. Automatic retries
  reuse the round and never touch `ocr_rounds`.
- While a round's own job is live it counts as in flight, whatever calls it has made, so a failed first attempt
  can't make room under the daily limit. Once the job is settled, the usual rules apply (a read counts once; failed
  rounds beyond the first five a day count).
- `OCR_DAILY_CAP` counts rounds plus every retry attempt that called a model, because the cap bounds spend and one
  round can make four attempts. The cap is checked when a round is admitted; rounds already running may finish
  their retries past it.

## Orphaned jobs

A job can be left with nobody running it: a backoff or cooldown longer than the request's budget, or a function
killed at its time limit. Two things cover that until a worker or cron drain exists:

1. The receipt page polls `GET /api/receipts/:id` (for up to 6 minutes of visible polling, past the worst-case
   retry chain of about 4 minutes; "Check again" polls once more). A poll that finds the job queued and due, or
   running past its lease, runs that job in `after()`, unless a pause or the owner's running cap would stop the
   claim anyway. A job nobody polls for waits for the next drain.
2. A job stops counting as live (`liveReceiptJob` in [`live.ts`](../../../packages/core/src/jobs/live.ts), one SQL
   fragment for the stale rule, the quota rule and receipt lookups) only when it is really orphaned:
   - queued, past its `run_at` by more than 5 minutes, **and** no unfiltered tick serving its kind has run anywhere for
     5 minutes, so nothing is draining that kind at all (a kind no handler serves ages out this way too); or
   - running with its lease expired more than 5 minutes ago.

   A job that is only waiting its turn (a backlog, its owner at the running cap, a pause) stays live, because ticks
   keep running, so its receipt reads as processing and its round keeps holding quota. An orphaned job's receipt
   reads as failed, its round frees the quota, and the user's retry cancels the old job.

## Other job kinds

`email.welcome` ([`kinds/welcome-email.ts`](../../../packages/core/src/jobs/kinds/welcome-email.ts)) sends a new user's
welcome email. The payload is the user id only. At send time the job reads the user's address and plan
(`accountPlan(...).policy.receiptsPerDay`, so the copy follows the plan table) and calls the `WelcomeMailer` service, which
the web app provides (`lib/welcome-mailer.ts`; core has no mail dependency). Once-only: the idempotency key
`welcome:<userId>` stops two live jobs, and `enqueueWelcomeEmail` also checks for any earlier welcome job of that user,
so a finished or dead one is never repeated. An undelivered send is retried (up to 5 attempts, 30 s backoff doubling);
with no mailer configured the job succeeds without sending. It logs `email.welcome_sent` (user id, plan, `delivered`;
never the address or content).

`billing.apply_event` ([`kinds/billing-apply.ts`](../../../packages/core/src/jobs/kinds/billing-apply.ts)) applies one
stored Paddle webhook (`billing_events` row) to `billing_subscriptions`. The payload is the event row id only. It is
enqueued in the same transaction that stores the event, with the idempotency key `billing:event:<id>`, and started with
`after()` right after the webhook response. Up to 8 attempts (30 s lease, backoff 5 s doubling to 10 min). A database
error retries; the outcome (`applied`, `stale`, `ignored`, `unmatched`) is logged. See [Billing](billing.md).

`billing.refund_wait_check` ([`kinds/billing-refund-check.ts`](../../../packages/core/src/jobs/kinds/billing-refund-check.ts))
is enqueued by `billing.apply_event` when it keeps a full refund waiting for its transaction, keyed
`billing:refund-wait:<adjustment id>` (one check per refund, however many events report it) and due three days later (`REFUND_WAIT_ALERT_MS`, past Paddle's two-day redelivery
window). If the refund is still `unmatched` it logs `billing.refund_unresolved` at warn level, once; otherwise nothing.
Priority 9, read-only.

`storage.delete` ([`kinds/storage-delete.ts`](../../../packages/core/src/jobs/kinds/storage-delete.ts)) deletes the
stored files of receipts a user deleted. `ReceiptRepo.removeMany` enqueues it in the transaction that deletes the rows,
with the object keys as the payload (at most 1,000, one bulk delete) and the workspace id, but no user, so it never
takes one of the user's running slots. Priority 9, behind receipt reads. Both delete routes start it in `after()`;
otherwise the next drain runs it. A key already gone counts as deleted, so a retry is safe. Up to 8 attempts (backoff
30 s doubling to 1 h); storage not configured is dead at once. It is not a `receipt.%` kind, so the per-receipt live-job
index and the stale rule ignore it.

`email.contact-reply` ([`kinds/contact-reply.ts`](../../../packages/core/src/jobs/kinds/contact-reply.ts)) sends the
"we got your message" reply to a contact-form sender. `/api/contact` queues it only after Turnstile passes and the
message is stored, and only within `allowContactReply` in `lib/email-limits.ts`: 1 reply per address and 3 per IP a
day (hashed keys in `rate_limits`; a limiter failure skips the reply). The payload is the typed address, a first name
already cleaned by `greetingName` and the topic id, never the message. It is sent through `ContactReplyMailer`
(`lib/contact-reply-mailer.ts`), 3 attempts. The kind sets `scrubPayload`, so `settle` replaces the payload with `{}` when the job
succeeds or dies (a retry keeps it); the address and name are not kept in the `jobs` row.

`email.support-notify` ([`kinds/support-notify.ts`](../../../packages/core/src/jobs/kinds/support-notify.ts)) mails a notice (kind, sender name, short id and a link to `/admin/support`, never the text) of a
stored support message to `SUPPORT_EMAIL`, reply-to the sender. `submitSupportMessage` enqueues it in the transaction
that inserts the `support_messages` row, so every stored message is notified. The payload is the row id only; the job
reads the row at send time and succeeds without sending if the row is gone (the account was deleted). It is sent
through `SupportNotifyMailer` (`lib/support-notify-mailer.ts`), 10 attempts with backoff from 1 minute doubling to 1
hour (about four hours of a provider outage). In production a missing `SUPPORT_EMAIL` counts as a failed send, so the
job ends dead and shows in the jobs admin.

`maintenance.purge` ([`kinds/maintenance-purge.ts`](../../../packages/core/src/jobs/kinds/maintenance-purge.ts))
deletes data past its retention period, each table in turn:

| Table                     | Deleted                                                                                                                                          | Function                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `support_messages`        | 12 months after `closed_at`, or, while a message isn't closed, 12 months after the later of `created_at` and `updated_at` (a reopen restarts it) | `purgeSupportMessages` (`support.ts`)     |
| `step_up_codes`           | 1 day after `expires_at` (a code lives 10 minutes; the send limit counts the last 10 minutes)                                                    | `purgeStepUpCodes` (`step-up/store.ts`)   |
| `jobs`, succeeded         | 30 days after `finished_at`: the Operations page's longest range                                                                                 | `purgeFinishedJobs` (`jobs/retention.ts`) |
| `jobs`, dead or cancelled | 90 days after `finished_at`: what an admin investigates or re-runs                                                                               | `purgeFinishedJobs`                       |

Each delete repeats its predicate on the locked rows, so a row changed meanwhile (a reopened message, a job an admin
re-ran) is kept. Deleting a finished job frees no idempotency key: keys only dedupe against live jobs, and an email's
provider key is `job:<id>`, a random id never reused. The one reader of finished jobs is `enqueueWelcomeEmail`
(welcome a user once ever), so `email.welcome` jobs stay while their user exists; account deletion nulls `user_id` and
they go with the rest. `step_up_events` has no retention yet. The run's event has `counts` per table.

It runs once a day. The app has no scheduler of its own, so `drainQueue` (the drain route) first inserts the next day's
run, due 00:00 UTC by the database clock and keyed `maintenance.purge:<that day>`; the key dedupes against the queued
job, so every later drain's insert is a no-op, and keying by the next day stops a second run on the day one finished.
Deletes go 500 rows per statement, at most 20 statements per table a run (10,000 rows); the rest waits for the next
day. Priority 9, 5
attempts, payload `{}`.

Cancelling a queued `maintenance.purge` doesn't stick: the key is free again, so the next drain queues it again. To stop
it, pause the kind in `/admin/jobs`. After a rollback to a release without the kind, a due `maintenance.purge` job is
never claimed (the old registry doesn't run it) and waits, queued, until the roll-forward.

## Tables

`jobs` and `job_controls` come from migration
[`0000_baseline.sql`](../../../apps/web/drizzle/0000_baseline.sql); see the [data model](../data-model.md#background-jobs).
