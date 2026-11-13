# Support messages and outbound email: what to store (CTO review, 2026-11-13)

Question from the owner: should support and feedback submissions, and outbound emails, be kept in the database and
tracked? Read-only review at `42fa840`. Nothing was built, run or sent; no staging or production access.

## Answer

- **Support and feedback: yes, store them**, in one small `support_messages` table, written before any email goes
  out. Today a message exists only as an email in the support mailbox. When Resend fails, the visitor gets a `503` and
  the message is lost. Nothing ties a message to a user, workspace or receipt, there is no status, and account
  deletion can't find it. No helpdesk tool before launch.
- **Outbound email: no `email_log` table yet.** Queued mail already has an outbox: the `jobs` table. Auth mail is
  sent inline on purpose. Close three gaps instead: no message kind on `email.sent`, no idempotency key on the Resend
  call, and no bounce or complaint signal. At launch, add a Resend webhook that feeds a hashed suppression table.

## What exists today (evidence)

| Area                | Fact                                                                                                                                                   | Where                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Contact route       | Origin check, 5 per 10 min per IP, honeypot, field limits (name 80, message 2,000), Turnstile, then a synchronous `sendEmail` to `SUPPORT_EMAIL`         | `apps/web/app/api/contact/route.ts:35-127`                               |
| Message loss        | Undelivered in production returns `503`: the visitor must retype, and nothing is kept                                                                  | `route.ts:128-135`                                                       |
| Context             | Payload is `name, email, message, topic, company`; no user, workspace or receipt id, even when signed in                                              | `components/support-panel.tsx:113-116`                                   |
| Auto-reply          | `email.contact-reply` job, 3 attempts, payload scrubbed when it ends                                                                                  | `packages/core/src/jobs/kinds/contact-reply.ts:70-90`                    |
| Welcome             | `email.welcome` job, `idempotencyKey: welcome:{userId}` plus a check over finished jobs                                                               | `jobs/kinds/welcome-email.ts:47-75`                                      |
| Auth mail           | Inline, and `deliver()` throws in production when undelivered, so the request fails rather than lies                                                  | `apps/web/lib/auth.ts:115-120`; table in `docs/architecture/email.md:37-51` |
| Resend call         | No `idempotencyKey` passed; returned `id` not logged                                                                                                   | `packages/email/src/index.ts:95-108`                                     |
| SDK support         | Installed `resend` 6.35.0 sets `Idempotency-Key` from `options.idempotencyKey` and ships `webhooks.verify()`, with events including `email.bounced`, `email.complained`, `email.suppressed` | `packages/email/node_modules/resend/dist/index.d.cts` (grep)             |
| Email log event     | `email.sent`, `email.send_failed`, `email.not_configured`: no field for which message                                                                  | `packages/email/src/index.ts:26-31`                                      |
| Webhooks            | Only Paddle; no Resend webhook route                                                                                                                   | `apps/web/app/api/billing/paddle/webhook/route.ts`                       |
| Privacy             | "Messages" names name, email and message, with no retention and nothing about deletion                                                                  | `apps/web/app/privacy/page.tsx:41`                                       |
| Deletion            | The delete table has no messages; the mailbox copy is outside it                                                                                       | `docs/architecture/data-model.md:410-423`                                |
| Retention           | No purge job exists (`maintenance.purge` is an open DB-review item)                                                                                    | `docs/STATUS.md:429-436`                                                 |
| Prior plan          | `feedback` table with 20 columns, an admin inbox, screenshots, votes, 5 phases                                                                         | `docs/plans/2026-11-07-feedback-and-requests.md:143-182`                 |

## Support and feedback messages

**Options.**

| Option                     | Gives                                                                                    | Costs                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Email only (today)         | Zero code; reply from the mailbox                                                        | Loses messages on send failure; no link to user or receipt; no status; can't honour deletion; no metrics |
| `support_messages` table   | Never lost; user, workspace and receipt link; status; deletion and retention; counts      | One migration, one service, one admin list (about 2 to 3 days)                                            |
| Helpdesk (Help Scout etc.) | Shared inbox, SLAs, macros                                                               | A new processor for message text (privacy page, DPA); $20+ a month a seat; overkill for one person          |

**What a team of one needs.** A list of new messages, the sender's account and workspace in one click, the receipt
when it came from "Report a problem", one status (`new`, `open`, `closed`), and a reply that still goes from the
mailbox. Skip tags, assignees, GitHub links, votes and screenshots until volume asks for them. They are most of
the prior plan's phases 2 to 5.

**Dedupe.** A double tap or a retried request must not create two rows. The form sends a client-generated
`submission_id` (UUID), and a unique index makes the second insert a no-op, the same idea as
`billing_events (provider, provider_event_id)`. Two messages about one bug are merged by hand: set the second one
`closed`. Fuzzy dedupe isn't worth building.

**Abuse.** Keep Turnstile, the honeypot and the IP limit. For signed-in senders, add a per-user cap (say 10 a day)
keyed on `user_id`, because every user of a shared NAT shares one IP bucket. Store the message as plain text, and in
the admin view render it as text, never as HTML or Markdown.

**Receipt link.** "Report a problem" sends a `receipt_id`. The route must check that the receipt is in the sender's
active workspace before storing it. Otherwise a user could point an admin at another tenant's receipt. The stored
row is also the record behind "administrators access an account only to handle a support request" (`privacy:110`).

**Privacy.**

- Messages from "Report a problem" will often quote receipt contents. Treat `message` like receipt data: never in
  logs, PostHog or Sentry. Telemetry gets only `kind`, `source`, `has_receipt` and `message_length`.
- Account deletion: `user_id` cascades, and `prepareUserDeletion` also deletes signed-out rows whose `email`
  matches the account's address (one statement).
- Retention: purge closed messages 12 months after `closed_at`, using the `maintenance.purge` job kind that STATUS
  already needs for `step_up_events` and old `jobs` rows.
- Mailbox copy: the notification mail today carries the message text, so a copy lives outside deletion and
  retention. Decision 1 below.

## Outbound email tracking

**Options.**

| Option                       | Verdict                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider logs (Resend)       | Enough for one-off "did X get mail?" checks before launch, if each send's Resend `id` is logged so a send can be matched to its request. Retention per plan, not verified |
| Telemetry only (wide events) | The right home for rates and alerts, once events say which message they were                                                                                      |
| `email_log` / outbox table   | Not now. Queued mail is already in `jobs` (state, attempts, `attempt_log`), and auth mail is synchronous by design. A table per send means storing addresses, which the "logs carry no address" rule (`email.md:153`) avoids |

**Idempotency.** A job retries on `"failed"`, and `"failed"` includes a network error after Resend accepted the
mail (`lib/welcome-mailer.ts:23-24`, `contact-reply.ts:90`). That can send the same mail twice. Fix: an optional
`idempotencyKey` on `SendEmailInput`, passed through to Resend; job senders use `job:{id}`. Resend keeps a key for a
limited window (length not verified), which covers queue backoff (capped at 10 minutes for contact replies).

**Bounces and complaints.** Resend suppresses hard-bounced and complaining addresses on its side (the SDK has an
`email.suppressed` event). The app can't see that today. It needs three things:

1. Rates for domain reputation: per message kind, bounces and complaints over sends.
2. A clear answer to the user: an invitation that bounced should show "Bounced", not "Pending" forever.
3. A rule to skip non-essential mail (welcome, product updates) to suppressed addresses, so they don't count as
   failures.

The route follows the Paddle pattern: verify the signature (`resend.webhooks.verify`), insert the event idempotently,
and return 200. No job is needed, because the write is a single upsert.

**"Did my invitation send?"** Today an invite request fails when the mail isn't accepted (`email.md:42`), so
"Pending" already means "Resend took it". The only unknown is a bounce. With suppression rows keyed by the
address's HMAC digest (the same `digestOf` used by the rate-limit keys, `lib/email-limits.ts:76-81`), the members
page can mark a pending invitation "Bounced" without storing the address or changing Better Auth's `invitation`
table.

## What to measure

| Metric                                                     | Exists today                                                                                                        | Add                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Support volume, outcomes, abuse drops                      | `contact.submit` with `outcome`, `topic`, `message_length`, `delivered`, `auto_reply`, `turnstile_errors` (`telemetry/schema.ts:237-242`) | `source`, `has_receipt`, `kind` once the table exists       |
| Open messages and time to first reply                      | No                                                                                                                  | From `support_messages` (an admin count; no event needed)   |
| Sends and failures per message kind                        | Only `auth.notice_sent.kind` (`auth.ts:180-190`) and job events (`contact_reply`, welcome)                          | `email_kind` token on `email.*` events, plus Resend `id`     |
| Dead email jobs                                            | Yes, through the jobs admin and wide events                                                                         | An alert on any dead `email.*` job                         |
| Bounce and complaint rate                                  | No                                                                                                                  | Webhook events, per `email_kind`                            |

Open and click tracking: no. The templates promise no tracking pixels (`email.md:156`).

## Recommendation

**Now (smallest useful step, before the new Help UI ships):** PR 1 and PR 2. The owner's "Report a problem" and
"Help and feedback" entry points should post to the new route from day one, so no support data ever lives only in
email.

**At launch:** PR 3 (the admin list) and PR 4 (the webhook and suppression), plus the purge job (PR 5).

**Later, on a trigger:**

- "Your messages" in Settings, once replies happen in the app.
- A helpdesk, at about 20 messages a week or a second person answering.
- An `email_log` table, only if user-visible notification mail (digests, "we shipped it") or a provider switch
  needs per-user history.

**Rough schema** (Drizzle in `packages/db`, RLS on with no policies like every table, migration through the workflow
with `SET LOCAL lock_timeout`, `organization_id` on the row for scoping):

```text
support_messages
  id               uuid pk default gen_random_uuid()
  submission_id    uuid not null unique          -- client-generated; retry = no-op
  kind             text not null check (kind in ('question','problem','feedback','sales'))
  source           text not null check (source in ('help','receipt','public','pricing'))
  status           text not null default 'new' check (status in ('new','open','closed'))
  user_id          text null references user(id) on delete cascade
  organization_id  text null references organization(id) on delete set null
  receipt_id       uuid null references receipts(id) on delete set null
  name             text not null check (char_length(name) <= 80)
  email            text not null                 -- reply address
  message          text not null check (char_length(message) between 5 and 2000)
  context          jsonb not null default '{}'   -- allowlisted: route, app version, browser family
  created_at, updated_at timestamptz not null default now()
  closed_at        timestamptz null
  index (status, created_at desc); index (user_id) where user_id is not null

email_suppressions                               -- at launch
  address_digest   text pk                       -- HMAC of the normalized address, never the address
  reason           text not null check (reason in ('bounce','complaint'))
  provider_event_id text not null unique
  email_kind       text null
  created_at       timestamptz not null default now()
```

The route inserts the row and enqueues an `email.support-notify` job in one transaction (`enqueueJob(tx, ...)`, the
same shape as `storageDeleteJob` in `repository.ts:938`). It then answers 200: the message is safe even when Resend
is down, and the retrying job delivers the mailbox notification. This removes the `503` path.

## PR-sized steps

| #   | PR                                                                                                                                                         | Effort | Impact                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| 1   | `email_kind` (allowlisted) and `provider_message_id` on `email.*` events; optional `idempotencyKey` through `sendEmail`, set to `job:{id}` by job senders; schema field audit | S      | Per-kind counts; no double sends on retry      |
| 2   | `support_messages` migration and core service; `/api/contact` writes the row and enqueues `email.support-notify` in one transaction; signed-in user, workspace and checked `receipt_id`; per-user cap; deletion by `user_id` and email; privacy "Messages" text; `*.int.test.ts` for dedupe, scoping and cascade | M      | No lost messages; link to user and receipt     |
| 3   | `/admin/support`: newest first, status filter, sender, workspace and receipt links, set status, mailto reply; open count on the admin home              | S      | Triage in one place                            |
| 4   | `/api/email/resend` webhook (signature verify, idempotent upsert into `email_suppressions`, bounce and complaint telemetry); skip non-essential sends to suppressed addresses; "Bounced" on pending invitations | M      | Deliverability signal; honest invitation state |
| 5   | `maintenance.purge` job kind: closed support messages after 12 months, plus the STATUS items (`step_up_events`, finished `jobs`)                         | S      | Retention we can state on the privacy page     |

PR 2 replaces phase 1 of the prior feedback plan with a smaller table. The plan's phase 2 to 5 extras wait for
their triggers.

## Decisions for the owner

1. **Mailbox notification contents.** Keep the full message in the notification mail, so you can reply from the
   inbox? A copy then lives outside deletion and retention, and the privacy page must say so. Or send only kind,
   sender and a link to `/admin/support`, and reply by mailto from there? Recommended: the full message until PR 3
   lands, then the link only.
2. **Retention.** Closed support messages purged after 12 months (the prior plan said 24)?
3. **Bounce handling at launch.** Build the Resend webhook and suppression table (PR 4) before launch, or start with
   Resend's own suppression and dashboard and add PR 4 at the first bounce complaint? Recommended: before launch,
   because invitations are the first mail a paying workspace depends on.

## Not verified

- Resend's idempotency-key window, log retention per plan, and automatic suppression behaviour: from the SDK types
  only, not the docs or a live call.
- No tests, build or server were run. No staging or production data was read.
