# Billing security review — 2026-11-13

## Security review — Changes requested

Scope: billing, checkout and plan state on `main` at `725ae6c`. Read-only. Builds on the
[11-07 full review](2026-11-07-full-security.md) and the [Paddle docs review](2026-11-09-paddle-docs-review.md);
the design reviewed is [flows/billing.md](../architecture/flows/billing.md). Nothing from 11-07 is re-reported.

Method:

- Source read: `packages/core/src/billing`, `quota.ts`, `usage.ts`, the webhook route, the billing server actions,
  `/pay`, the upgrade offer and the workspace guards.
- Local review server (production build, compose database, fixture OCR, Paddle sandbox public settings, no API key)
  probed over HTTP with five seeded accounts and one probe account: auth endpoints, every billing and admin server
  action called directly by id, uploads and retries in parallel.
- `verifyPaddleSignature` and `parsePaddleEvent` driven directly with 21 hostile inputs.
- Unit suites for billing, the billing actions, the webhook route and quota: 68 tests, green.
- Better Auth 1.7.18 installed; all 12 advisories of 2026-11-03 are fixed in 1.7.16 and none is newer. The release
  cooldown has no exclusions left.

Not exercised: a real Paddle delivery or checkout (the local server has no API key, so the webhook answers 503 and
the actions stop at "not open yet"), `billing.int.test.ts` (read, not run), staging and production (not probed).
Statements about Paddle's own behaviour come from its documentation.

Findings S-1 to S-4 were listed by number only until their fix merged; they are fixed by #236 (deployed
2026-11-13 with migration 0004) and described below. S-5 stays open.

## Fixed in #236

- **S-1: billing portal for a customer the buyer chose. High. Fixed.** A subscription was linked from its
  `custom_data` alone and stored with whatever Paddle customer the webhook named. A checkout opened with Paddle.js
  outside our server, with someone else's email, reuses that person's Paddle customer, so "Manage billing" would
  open a portal session for them (invoices, address, card last four, cancel). Fix: every checkout is recorded in
  `billing_checkouts` before its id reaches the browser, and a subscription links only when its `transaction_id`
  is one we recorded for the same workspace, user and customer. The portal opens only for the buyer and only for a
  customer recorded for that buyer.
- **S-2: sandbox subscriptions on the live site. Medium. Fixed.** Test mode was enforced only where the client token
  was shown, so anyone holding the (non-secret) sandbox token could buy Pro with a test card. Fix: the same recorded
  checkout rule, plus the apply job refuses a sandbox-on-production link unless the buyer is a platform admin.
- **S-3: buyer named by custom data. Low. Fixed** by the S-1 change: the buyer is the checkout row's user, not
  `custom_data`, and one checkout links one subscription.
- **S-4: portal after the buyer's account is deleted. Low. Fixed.** An orphaned subscription row gets no portal
  session; the page points to support.
- **L4 (checkout without a verified email)** and **L5 (no test for the buyer-only portal rule)** are closed by the
  same PR.

Caveat: subscriptions linked before #236 have no checkout row, so their buyers get no portal until one exists.
Before launch these are test data.

## Open

- **S-5: the Free plan's shared daily pool. Low.** About 15 accounts at 20 a day fill the 300-a-day pool, counting
  failed rounds, and close Free scanning for everyone until 00:00 UTC. Fix: alert on the first pool hit; consider
  weighting by IP or sign-up day.

Open, safe to describe:

- **L1 · `active` never expires on its own.** `packages/core/src/billing/entitlement.ts:44-47`,
  `service.ts:139`. An `active` or `trialing` row grants Pro for as long as no later event changes it. If Paddle's
  deliveries for a subscription are lost for good (a destination removed, a secret rotated wrongly for longer than
  Paddle retries, an apply job left dead), the workspace stays Pro with nobody paying. Nothing an outsider can
  trigger. Fix: stop granting once `current_period_end` is more than a few days past, or reconcile live rows against
  `GET /subscriptions/{id}` on a schedule; alert on a dead `billing.apply_event` job.
- **L2 · Thirty days of grace on every failed renewal.** `entitlement.ts:13`. A subscription that pays once and then
  fails keeps the full Pro pool for another month, and a new subscription can repeat it. A product decision more
  than a defect. Options: a shorter grace, or the Free limits during grace.
- **L3 · The webhook has no limiter and logs every refusal.** `apps/web/app/api/billing/paddle/webhook/route.ts:21-24`.
  The route has no `routine` setting, so each unsigned request buffers up to 256 KB, computes one HMAC and writes one
  full log line at any sample rate. The same class as 11-07 M4. Fix: sample refused deliveries (keep `bad-body`,
  which means a real signed event we could not read) and add a per-IP limiter in front of the body read.
- **L4 · Checkout does not check `emailVerified` itself.** `apps/web/app/app/settings/billing/actions.ts:26-44`.
  The Paddle customer is found by the session's email, and the documented invariant is that only verified addresses
  get that far. That holds through sign-in configuration only, and turning verification off in production merely
  warns (`apps/web/lib/env.ts:402-406`). Fix: refuse in `billingCaller` when `session.user.emailVerified` is false,
  with a test.
- **L5 · The portal's buyer-only rule has no test.** `service.ts:938-964` and `openBillingPortalAction` are not
  covered by `actions.test.ts` or `billing.int.test.ts` (checkout's refusals are). Add: a non-buyer owner, a member,
  an impersonated owner and a workspace without a subscription are refused without a provider call.
- **L6 · A comp follows the comped user into any workspace they own.** `service.ts:177-178`. The ownership cap is
  checked only when a workspace is created (`auth-guards.ts:79-82`), not when an existing owner promotes someone.
  It needs the comped person's cooperation. Fix or accept: record a comp per workspace, or count promotions against
  the cap.
- **L7 · Retired prices keep granting Pro.** `packages/core/src/billing/config.ts:82-95`. Add to the price-change
  runbook: archive the old price in Paddle when its id moves to `PADDLE_PRICE_PRO_LEGACY`, so it serves existing
  subscribers only.
- **L8 · Portal action while billing is off.** `actions.ts:71-88` maps `NotConfigured` to "Paddle didn't answer" and
  logs `billing.portal_failed` at error level. Map it to the "not open yet" message, as checkout does.

## Verified secure

Webhook:

- **Signature.** HMAC-SHA256 over `<ts>:<raw body>`, constant-time compare, read before parsing
  (`paddle.ts:47-74`). Driven directly: a missing header, an empty or truncated `h1`, a wrong or empty secret, a
  changed body, a timestamp the MAC does not cover, a float or negative timestamp and a timestamp 31 s off in either
  direction are all refused; a second valid `h1` (secret rotation) and upper-case hex pass. Pinned in
  `paddle.test.ts`.
- **Replay.** Outside 30 s the signature is stale. Inside it the event id is unique per provider
  (`billing_events_provider_event_idx`, confirmed in the database), the insert and the job are one transaction, and
  a redelivery enqueues nothing (`billing.int` "stores an event once").
- **Ordering.** A snapshot older than the stored `updated_at` is `stale`; one advisory lock per subscription
  serializes writers; the job skips an event already processed (`service.ts:502-510,558-579`; `billing.int`
  "applies events in provider order").
- **Forged events.** Without the destination secret nothing is stored. Signed custom data is still not trusted: a new
  subscription links only to a workspace that exists, whose named buyer is an owner now, at a Pro price, and the
  link never moves (`service.ts:686-704`; `billing.int` "links … keeps the first link", "leaves a subscription
  bought by a member … unmatched", "at another price unmatched"). See S-2 and S-3 for what that check does not cover.
- **Body.** 300 KB answered 413 before the signature check (probed; `route.test.ts`). Unknown event types are
  acknowledged and not stored; an unknown status is `bad-body`. The stored payload is the normalized event only.

Checkout and portal (each called directly by action id on the review server):

- A member of the Pro workspace, with it active: `startCheckoutAction` and `openBillingPortalAction` both answer
  "Only the workspace owner can manage billing."
- A user naming a workspace that is not their active one, their own or anyone's: "Your active workspace changed."
  Switching the active workspace to one they are not in: 403 from Better Auth, and the scope is re-read from
  `member` on every request.
- Signed out: redirect to sign-in. A foreign `Origin`: refused by Next.
- Sixteen parallel checkout calls by one user from sixteen addresses: ten pass the limiter, six are refused (the
  limit is per user and atomic).
- The price is chosen on the server from the interval; the browser sends no price or custom data
  (`service.ts:986-995`). Pinned refusals in `actions.test.ts`: member, workspace admin, impersonated owner,
  non-admin on sandbox keys on the live site.

Plan state:

- **Quota under concurrency.** A probe account sent 30 uploads at once at 1/10 of its minute: 9 accepted. At 19/20
  of its day, 30 at once: exactly 1 accepted, 29 refused. The check and the round are one transaction under the user
  lock, and the workspace lock on a pooled plan (`usage.ts:153-162`, `repository.ts:700-706`).
- **Retries.** A retry runs the same gate under the same lock: refused at the day limit and at the month limit
  (probed). A retry of another workspace's receipt is 404.
- **Switching, leaving and rejoining.** Free usage is keyed on the user across every workspace and Pro usage on the
  workspace, both read from the append-only ledger, so neither changes with membership or the active workspace
  (`usage.ts:113-116`). The ledger's foreign keys are `SET NULL`, so deleting a workspace returns nothing to a user.
  Deleting the account still resets a person's Free count (known since 11-06; `OCR_DAILY_CAP` is the bound).
- **Entitlement.** Cancel at period end keeps Pro until that date and then ends without the final event; an
  immediate cancel, a pause, a full refund and an approved chargeback end it at once; `past_due` ends after the
  grace; a row at a price that is not Pro never grants it (`entitlement.ts:38-56`; `billing.int` "is Pro while
  subscribed, through past_due grace and a cancel at period end, then Free", "ends Pro at once on an approved
  chargeback", "ends Pro on a full refund, not a partial one"). The SQL and the function are kept in step by a test.
  A workspace or account with a subscription that can still charge cannot be deleted.

Access:

- **Admin comp.** `user.plan` is `input: false`. Probed: `update-user` with `plan` or `role` is refused
  (`FIELD_NOT_ALLOWED`); sign-up with `plan: "pro"` creates a Free user; Better Auth's `admin/*` endpoints refuse a
  non-admin; `setPlanAction`, `savePlansAction`, `setRoleAction` and `impersonateUserAction` called by id as a
  normal user answer 404 and change nothing (confirmed in the database). Only `setPlanAction` writes the comp, with
  an audit row. Not tested: whether an admin can set `plan` through Better Auth's own `admin/update-user`, which
  would skip that audit row (no admin login was provided).
- **Billing page.** Reads the active scope only; there is no id to tamper with. A member of the Pro workspace sees
  the plan and the status, and neither the buyer's email nor any Paddle id (probed).

Leaks:

- **Client bundles.** No Paddle token, price id, API key or webhook secret in `.next/static`; the only secret-shaped
  hit is Better Auth's env getter name. `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` is referenced from server code only.
- **Pages.** With sandbox keys on a production build, `/pay` with a well-formed id, `/pricing`, `/app` and Billing
  carry no client token and do not load Paddle.js for an anonymous visitor or a normal owner (probed). `/pay`
  reflects nothing from a malformed id.
- **Repository.** No client token in the tree or in history. The sandbox product, price and notification-setting
  ids in `docs/decisions.md` are identifiers, not credentials.
- **Logs and errors.** Billing wide events carry provider ids and states only. Paddle's error text never reaches a
  log or a customer; only a closed set of codes is logged, and the setup hint is shown to platform admins only.

## Owner actions

1. Do not set live Paddle keys until S-1 is merged.
2. Treat the sandbox client token as public when deciding how urgent S-2 is; it is stored as a plain value.
3. Decide L2 (grace length) and L6 (comp scope).
4. The review database now holds one extra account, `sec-probe-1@example.test`, with 20 receipts.
