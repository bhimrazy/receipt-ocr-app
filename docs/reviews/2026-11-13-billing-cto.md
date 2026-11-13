# CTO review (billing, plans, quota): 2026-11-13

`main` at `725ae6c`. Read-only on code. Question: are plans, quota and billing correct, and is the app ready to open
paid plans?

**Read:** `packages/core/src/billing/*`, `plans.ts`, `quota.ts`, `usage.ts`, `jobs/kinds/billing-apply.ts`, migration
`0001_billing`, the web billing routes, actions, pages and upgrade gate, `docs/architecture/flows/billing.md`, the
2026-11-07 CTO review and the 2026-11-09 Paddle docs review, test names in the billing suites, `ci.yml`.
**Ran:** `gh pr list --state merged --limit 20`, `gh run list` (CI and production deploy green on `main`, 2026-11-13
05:02 and 05:08 UTC); against the review server: `POST /api/billing/paddle/webhook` without a signature (503, billing
off), `GET /pay?_ptxn=<well-formed id>` (200, "Payments aren't open yet", no Paddle.js), `GET /pricing` ("opens
soon", $9 and $90). Looked at the Billing screenshots for the Pro owner, the member and the at-limit account.
**Not run:** tests, build, any Paddle call, anything on staging or production. The review server has no Paddle
settings, so no checkout, portal or webhook path was exercised live. The member screenshots show the member's own Free
workspace, not the Pro workspace, so the member view of a Pro workspace was not seen.

## Verdict: not ready to open paid plans

The design is sound and mostly simple: one plan resolver, a signed webhook stored once and applied by a job, quota
counted from the ledger under locks. Three things block taking money (P0 below): the flow has never run end to end
against Paddle, a workspace can end up with two charging subscriptions, and a payment that does not turn into Pro
raises no alert. P1-1 and P1-2 should land before the first refund or price change. Owner-side blockers are unchanged
from `docs/STATUS.md:162-182`: live account verification, Paddle's website review, live keys, and hosting that allows
commercial use.

## What is right (checked in code)

- **Plan state is single-sourced.** Every reader goes through `workspacePlan` or `accountPlan`
  (`billing/service.ts:167,191`): the upload and retry routes (`apps/web/lib/quota.ts:23-27`), the meter and pages
  (`lib/plan-limits.ts:39-53`), member and workspace limits (`service.ts:213,252`), checkout (`service.ts:982`). No
  cached plan in the session. `isEntitled` and `entitledSql` state the same rule (`entitlement.ts:36-57`,
  `service.ts:137-143`).
- **Idempotency.** Unique `(provider, provider_event_id)` (`0001_billing.sql`), insert and enqueue in one transaction
  (`service.ts:379-402`), `FOR UPDATE` on the event row and a `processed_at` check (`service.ts:491-510`).
- **Ordering.** A per-subscription advisory lock and the provider's `updated_at` (`service.ts:451-456,577`); an
  adjustment that arrives before its subscription is kept and applied on link (`service.ts:661-678`).
- **Entitlement.** `paused` never; `past_due` 30 days from the first failure; a scheduled cancel lapses on its own if
  the final event is lost; a non-Pro price or `revoked_at` never grants Pro.
- **Quota scope.** Free counts the user's Free rounds across workspaces, Pro the workspace's Pro rounds
  (`usage.ts:113-116`); user lock then workspace lock (`usage.ts:153-162`); the plan is recorded on the round.
- **Owner rules.** Checkout and portal check the owner on the server, refuse impersonation and are rate limited
  (`settings/billing/actions.ts:26-44`); the portal is buyer-only (`service.ts:949-953`); custom data only links a
  new subscription whose buyer is an owner and whose price is Pro (`service.ts:686-704`).
- **Placement.** Rules and Paddle are in `packages/core/src/billing`; the web side is thin actions and pages. The
  provider adapter has no SDK. This boundary earns its cost.

## Findings

### P0 (before any real payment)

**P0-1. The paid path has never run end to end against Paddle.**
`docs/STATUS.md:177` still lists "Test a sandbox checkout". The webhook fixtures are hand-written
(`billing/paddle.test.ts:21-40`), `route.test.ts` covers only the body cap, and the e2e suites stub Paddle.js and use
placeholder price ids (`ci.yml:189-194`). The one real call made so far (creating a transaction) found an account
setup failure the mocks could not. *Failure:* a field Paddle sends differently from the fixture (for example
`scheduled_change`, `items[].price`, the adjustment's `subscription_id`) parses as `bad-body` or as the wrong state,
and the first customer pays and stays Free. *Fix:* run the walkthrough in `docs/testing-payments.md` in the sandbox
and record it in a dated review: checkout to Pro, cancel at period end, immediate cancel, failed renewal to
`past_due`, full refund, partial refund, pause and resume. Save each delivered body (ids replaced) as a fixture for
`paddle.test.ts`.

**P0-2. One workspace can hold two subscriptions that both charge.**
`createCheckout` refuses only when the plan is already Pro (`service.ts:982-985`), and `linkNewSubscription` never
looks at the workspace's existing rows (`service.ts:686-704`); there is no constraint either (`0001_billing.sql`).
*Failure A:* a renewal fails, 30 days pass, the workspace is Free while Paddle can still retry the card. The upgrade
gate only checks `plan === "free"` (`apps/web/lib/upgrade-level.ts:68`), so the meter and modal offer Pro (Billing
itself hides the button, `settings/billing/page.tsx:89-91,132`). The owner buys again; the old subscription later
recovers; both charge. *Failure B:* Billing shows the checkout button beside a paused subscription by design
(`page.tsx:138`); the paused one resumes later. *Failure C:* the webhook is slow, the page still says Free, the owner
pays twice (or two owners each pay). `pickRow` then manages only one of them in the app (`service.ts:741-754`).
*Fix:* in `createCheckout`, refuse while `hasChargingSubscription(organizationId)` is true and send the buyer to the
portal; give `decideUpgradeOffer` the same input; when linking, log `billing.duplicate_subscription` at error level
if the workspace already has a charging row. Add an integration test for each.

**P0-3. A payment that does not become Pro is silent.**
An `unmatched` outcome is only a field on the job's wide event (`jobs/kinds/billing-apply.ts:82`); only
`orphan_charging` and a refused cancel log at error level (`:51,93`). No admin page reads `billing_events` or
`billing_subscriptions` (no reference outside `billing/service.ts`); the runbook says to find the row by SQL
(`flows/billing.md`, "Paid but still Free"). *Failure:* the buyer is demoted between checkout and webhook, or a price
id is wrong: the customer is charged, stays Free, and nobody is told. *Fix:* `Effect.logError("billing.unmatched")`
for reasons `workspace`, `owner` and `price` (not `subscription`, which resolves on link); a read-only Admin, Billing
list of subscriptions and the last events with outcome. Whether rejected webhooks (401, 503) are kept in the logs
was not verified (`lib/http.ts:176` drops some rejected requests); an alert on them is needed before live.

### P1

**P1-1. A full refund of any one payment ends the whole subscription, including refunds the policy promises.**
`adjustmentRevokesPro` is true for every approved full refund with a subscription id (`entitlement.ts:75-78`); the
apply step sets `revoked_at` and cancels with Paddle (`service.ts:537-552`). `/refunds` promises a refund for "being
charged twice" (`app/refunds/page.tsx:23`). *Failure:* support refunds a duplicate or goodwill renewal in full; the
customer's Pro ends at once and the subscription is cancelled. *Fix (simple):* state it in the runbook and refund
such cases as a partial refund or a credit; *(better):* revoke automatically on chargebacks only and make a full
refund revoke only when it is the subscription's latest payment. Decide with the owner.

**P1-2. Entitlement depends on environment values on every read, with no check that they still match.**
`loadProPriceIds` reads the three price variables per call (`service.ts:111-122`) and every plan read requires the
stored `price_id` to be in that set (`service.ts:128-138`). *Failure:* a price change without
`PADDLE_PRICE_PRO_LEGACY`, or a typo, turns every subscriber Free while Paddle keeps charging; no log line fires.
The same applies to state drift: if deliveries fail past Paddle's retries (about three days), a lost
`subscription.canceled` leaves Pro on for good and nothing reconciles. *Fix:* one scheduled job kind (daily) that
logs at error level any row that can charge but is not entitled inside its grace, and any entitled row not updated
within its period; an admin "resync from Paddle" (`GET /subscriptions/{id}`) for the second case.

**P1-3. A locked subscription is not retried when a cancel is owed.**
`cancelRevoked` treats every 4xx except 429 as final (`billing-apply.ts:47-53`). Paddle's lock errors are in the
known list (`paddle.ts:234-237`) and are transient. *Failure:* a chargeback lands while the subscription is locked for
renewal; the cancel is refused once, logged, and the revoked subscription renews. *Fix:* retry on 409 and on the three
`subscription_locked_*` codes; keep the other 4xx as now.

**P1-4. With billing off, a paying owner is told "Paid plans aren't open yet" and has no portal.**
`page.tsx:112-121` takes the `!checkout` branch before looking at the subscription (seen on the review server: an
active subscription with that line under it). Billing is off when any one Paddle value is missing
(`flows/billing.md`, Configuration). *Failure:* one variable is lost in production; subscribers cannot cancel or
update a card from the app, and the copy says paid plans do not exist. *Fix:* when a subscription exists, say billing
is unavailable for now and point to Paddle's emails; log at error level when `billing_subscriptions` has charging
rows and the config is off.

### P2

- **P2-1. SECURITY: see report.** Hardening in `startCheckoutAction` (`actions.ts:131`) and
  `createPaddleCheckoutTransaction` (`paddle.ts:355-374`). Not shown to be reachable with production defaults.
- **P2-2. A comp follows the comped user into any workspace they co-own.** `workspacePlan` grants Pro when any owner
  is comped (`service.ts:177-178`), and several owners are allowed (`lib/auth.ts:640-643`). The ownership cap is only
  checked on create (`service.ts:213-238`), so promotion also passes it. *Fix:* apply the comp only where the comped
  user is the earliest owner, or comp the workspace instead of the user.
- **P2-3. A lapsed Pro workspace can have more scans than a paying one.** Members over the Free limit stay
  (`flows/billing.md`, rule 4) and Free is 100 a month each, so 6 to 10 members get 600 to 1,000 on Free against a
  pool of 500 on Pro (bounded by the Free pool of 300 a day for everyone). Owner decision: pool size per member, or
  freeze uploads for members past the Free limit.
- **P2-4. Refund and calendar-month windows can be combined.** Pro's month is the UTC calendar month
  (`quota.ts:63-67`), and the first payment is refundable in full for 14 days (`lib/pricing.ts:14`): subscribe late
  in a month, use two months' pools, refund. Each new subscription has a new first payment. Accept, or add "one
  refund per customer" to the policy.
- **P2-5. `PRO_PRICE` in `lib/pricing.ts:6` is not checked against the Paddle price.** The pricing page and the
  terms print it. A sandbox check in P0-1 covers today; the admin "Paddle check" (F7 of the Paddle review) would keep it.
- **P2-6. `billing/service.ts` is 1,013 lines** holding plan resolution, member and workspace limits, deletion
  guards, the webhook, the apply step and the Paddle calls. Split plan resolution and limits from webhook apply; move
  the two message builders out of `entitlement.ts:80-106`. No behaviour change.
- **P2-7. Unreachable rule.** `canceled` with a scheduled cancel and a period ahead (`entitlement.ts:52-53`) does not
  occur with Paddle (a canceled subscription has no scheduled change). Harmless; confirm in P0-1 and delete if so.
- **P2-8. `docs/STATUS.md:4` says "Last updated 2026-11-08 (billing v1 in review)";** billing merged (#184, #193).
  The billing to-do at `:162` still names the PR.

## Tests and observability

Covered well: signature and parsing (`paddle.test.ts`), the entitlement table (`entitlement.test.ts`), and 31
integration tests against Postgres for redelivery, stale order, linking, refunds, early chargebacks, deletion guards,
member limits and the quota scopes (`billing.int.test.ts:231-1064`), run in CI (`ci.yml:208`). Action tests cover the
owner, sandbox and workspace-mismatch refusals.

Not covered, in the order worth writing:

1. Fixtures captured from the sandbox (P0-1), replacing the hand-written bodies.
2. A second subscription for a workspace that already has a charging one, for past due after grace, paused, and two
   paid checkouts (P0-2).
3. Route to plan: a signed body through `POST /api/billing/paddle/webhook`, the job, then `workspacePlan` is Pro; a
   redelivery returns 200 and changes nothing. Today the route test stops at the signature check.
4. Two apply jobs for one subscription at once (the advisory lock has no test).
5. `cancelRevoked` on a 409 lock (P1-3), and the billing page with a subscription while billing is off (P1-4).
6. `startCheckoutAction` as a member, an admin role and while impersonating are in `it.each` (not read line by line);
   add a member of a Pro workspace uploading while the pool is full.

Observability today: `billing.webhook` and `billing.apply_event` wide events with outcome, `plan_changed` to
analytics, error-level `billing.checkout_failed`, `billing.portal_failed`, `billing.cancel_refused`,
`billing.orphan_charging`, and dead jobs. Missing: `billing.unmatched` (P0-3), `billing.duplicate_subscription`
(P0-2), the daily mismatch check (P1-2), an alert on webhook 401 or 503, and any admin view of subscriptions.

## Recommendations

| #   | Step                                                                                              | Effort | Impact                                         |
| --- | ------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| 1   | Sandbox run of every state, written up, fixtures saved (P0-1)                                     | M      | The only proof the paid path works             |
| 2   | Refuse checkout while a subscription can charge; same input to the upgrade gate; log duplicates (P0-2) | S | No double charge                               |
| 3   | Error-level `billing.unmatched`; read-only Admin, Billing list (P0-3)                             | S-M    | Paid-but-Free is seen the same day             |
| 4   | Decide the full-refund rule; runbook line now, code after (P1-1)                                  | S      | Support cannot end a good subscription by accident |
| 5   | Daily mismatch job; admin resync (P1-2)                                                           | M      | Catches a wrong price variable and lost events |
| 6   | Retry the cancel on lock errors (P1-3); billing-off copy for subscribers (P1-4)                   | S      | No charge after a revoke; honest page          |
| 7   | Checkout hardening (P2-1)                                                                         | S      | Removes a dependency on one setting            |
| 8   | Split `service.ts`; delete the unreachable rule; refresh STATUS (P2-6 to P2-8)                    | S      | Smaller file, current handoff                  |

Not recommended now: a `packages/billing`, a second provider, scan packs, or a reconciliation service beyond the one
daily job. The current shape is enough for the first paying customers once 1 to 3 are done.
