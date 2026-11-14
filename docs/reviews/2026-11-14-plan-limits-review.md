# Plan limits review, 2026-11-14

Review of the owner's 2026-11-14 proposal (members Free 2 / Pro 5, limits per workspace on both plans, Free 20 a day
and 50 a month) and of every other limit. Read-only on code. Numbers are marked **(m)** measured or **(e)** estimated.

**Verdict: adopt the proposal**, with one added rule (scans in a deleted workspace still count) and one code trap to
fix (the upload panel hides the upgrade offer whenever the scope is `workspace`). The final table is at the end.

Today (`packages/core/src/plans.ts`, no saved row in production): Free is per person, 20 a day, 30 a month, pool 300 a
day, 10 a minute, 1 workspace, 3 members. Pro is per workspace, 200 a day, 500 a month, 30 a minute, 2 workspaces, 10
members. Pro costs $9 a month or $90 a year per workspace (`apps/web/lib/pricing.ts`).

## 1. Unit economics

Cost of one scan, from `packages/bench/results/2026-11-07-*-app.json` (37 receipts as the app uploads them, prompt v1):

| Chain step            | Mean            | p95     | Max     | Source                                                             |
| --------------------- | --------------- | ------- | ------- | ------------------------------------------------------------------ |
| Claude Haiku 5.5      | $0.00061        | $0.0014 | $0.0016 | (m). Prompt v2 adds about 1,600 input tokens: about $0.0008 (e)    |
| Gemini 3.5 Flash-Lite | $0.0015         | $0.0044 | $0.0058 | (m)                                                                |
| Qwen 3.8 27B on Groq  | about $0.007    | n/a     | n/a     | (e) from list prices; never benchmarked; $0 billed on Groq's free plan |

Planning figures: **$0.001 a scan typical** (e), **$0.01 stress** (e: four job attempts with fallbacks, or a 10-page
PDF on a fallback model).

How scans are counted (`usage.ts`, `quota.ts`):

- One upload or one retry is one round. A receipt read successfully counts once. Only failed or stale receipts can be
  retried, so a good read cannot be re-run for free.
- The first 5 failed reads in a window are free (`FREE_FAILED_ROUNDS`), so a 50-scan month can cost 55 paid rounds.
- A PDF is one scan whatever its page count (up to 10). A 10-page PDF costs about $0.004 on Haiku (e), 5 times a
  photo. Still under half a cent, so page-weighted counting is not worth building.

| Case                                  | Scans a month         | Typical cost (e) | Stress cost (e) |
| ------------------------------------- | --------------------- | ---------------- | --------------- |
| Free workspace, proposal (50)         | 55 rounds             | $0.055           | $0.55           |
| Free today, 1 person (30)             | 35 rounds             | $0.035           | $0.35           |
| Free today, 3 members (3 x 30)        | 105 rounds            | $0.105           | $1.05           |
| Whole Free tier, any number of users  | 9,300 (pool 300 x 31) | $9.30            | $93             |
| Pro workspace (500)                   | 505 rounds            | $0.50            | $5.05           |

The pool, not the per-workspace limit, bounds Free spend. Demand at an assumed 25% active workspaces and 20 scans each
(e): 100 workspaces 500 a month ($0.50); 1,000 workspaces 5,000 a month ($5, peak days touch the pool); 10,000
workspaces 50,000 a month ($50), which needs a pool of about 5,000 a day.

Pro margin (Paddle 5% + $0.50 per transaction):

| Billing     | Price | Paddle fee | Net              | After typical scans | After stress scans |
| ----------- | ----- | ---------- | ---------------- | ------------------- | ------------------ |
| Monthly     | $9    | $0.95      | $8.05            | $7.55 (84%)         | $3.00              |
| Yearly      | $90   | $5.00      | $85.00 ($7.08/mo) | $6.58 a month       | $2.03 a month      |
| Yearly, if $90 includes 13% VAT | $90 | $5.00 | $74.65 ($6.22/mo) | $5.72 a month | $1.17 a month |

`pricing.ts` and the pricing page say tax is added on top. The Paddle sandbox reportedly charges $90 including tax for
the yearly price. If that is the price's tax mode, the site copy is wrong and the yearly net is 12% (13% VAT) to 18%
(20% VAT) lower.

**Recommendation:** cost does not constrain any of these limits. 50 a month per Free workspace costs about 5 cents.
Decide Free on conversion and abuse, not cost. Check the Paddle price tax mode before going live.

## 2. Abuse

- **Per-workspace scope removes the member multiplier.** Today each member of a Free workspace brings 30 scans (3
  members: 90), and removing and re-inviting members brings more. With workspace scope, members add no scans.
- **One Free workspace per owner still holds.** `workspaceCreationCheck` counts workspaces the user owns now. A person
  can be a member of any number of workspaces (membership is not capped per user), but joining one creates no
  allowance; it shares that workspace's.
- **New hole: delete and recreate.** Workspace-scoped counting filters on `ocr_rounds.organization_id`, and that
  column is set to null when the workspace is deleted. An owner can use 50, delete the workspace (the ownership count
  drops to 0), create a new one and get 50 more. Per-person counting does not have this hole. Fix: on a workspace-scoped
  Free plan, also count the uploader's own rounds whose workspace is gone
  (`organization_id is null and user_id = <uploader>`). One clause in `countUsage`; the existing
  `ocr_rounds_user_created_at_idx` covers it. This keeps the ledger's rule that deleting gives nothing back.
- **Sign-up farming** is unchanged in kind: each new account owns one workspace. The yield per account rises from 30
  to 50. Turnstile and the per-email limits slow it; the pool bounds the cost at $0.30 a day typical (e).
- **The pool is the denial-of-service surface, not a cost problem.** 15 workspaces at 20 a day fill 300. Without the
  day limit, 6 would. This is the best reason to keep a day limit on Free.
- **Burst a minute** counts the user across all plans (10 Free, 30 Pro). Unchanged by scope.
- **A Free user inside someone's Pro workspace** scans from the Pro allowance (`ocr_rounds.plan = 'pro'`); their own
  Free workspace keeps its 50. Same as today, and easier to explain: the workspace you are in decides.

**Recommendation:** per-workspace on Free is safer than per-person, provided the deleted-workspace clause ships in the
same PR. Keep the pool and the day limit.

## 3. User and product

- **Who needs what (e, no usage data before launch):** personal 10 to 30 receipts a month; freelancer 20 to 60; a
  small shop's VAT purchase register 30 to 150; a team with staff 100 to 400.
- **50 a month:** a micro-business can finish one full month's register and export it, which is the moment the product
  proves itself. A real shop runs out during its first month with work already invested, and $9 is small against
  that. Against today it is a raise for one person (30 to 50) and a cut for teams (2 members 60 to 50, 3 members 90 to
  50), and teams are who should pay. Pro stays 10 times Free.
- **Risk:** 50 is what two competitors sell as their entry paid plan (section 4), so freelancers under 50 will not
  pay. A limit is easy to raise later and costly to cut. Measure the share of Free workspaces reaching 80%.
- **20 a day under 50 a month:** it only bites on backlog days. A shoebox of 40 takes two sittings, 50 takes three.
  The wall at 20 arrives with scans still left, so it is not a dead end, and the upgrade line there ("Pro allows up to
  200 a day") is true.
- **Members 2 / 5:** Free 2 is owner plus accountant, or owner plus one staff. A third person is the second upgrade
  trigger. Pro 5 is owner, accountant and three staff. With workspace scope a member costs nothing, so this is
  packaging only. The sixth member on Pro has no self-serve path: Custom is handled by hand and per-workspace
  overrides are not built (STATUS, "Later").
- **Accountant seat:** an accountant can already join many clients' workspaces (only ownership is capped). A free,
  uncounted accountant seat needs a new role and is not needed while Free 2 covers owner plus accountant.
- **Messaging:** one sentence for both plans: "50 scans a month per workspace, shared by its members" and "500 scans a
  month per workspace". The per-person rule and its "across every Free workspace you use" footnotes go away.

**Recommendation:** Free 50 a month and 20 a day per workspace; members 2 and 5; no special accountant seat yet.

## 4. Competitors

From `docs/reviews/2026-11-06-market.md` (vendor pricing pages read 2026-11-06, not re-fetched today):

| Product       | Free                              | Entry paid plan                               |
| ------------- | --------------------------------- | --------------------------------------------- |
| Zoho Expense  | 3 users, 20 scans per user a month | $3 to $4 per user, 200 scans                  |
| SparkReceipt  | none (7-day trial)                | $6.90 a month, 50 documents, extra user $1, accountant free |
| Shoeboxed     | none                              | $9 a month, 50 scans, 3 users; $29, 250 scans, 5 users |
| Foreceipt     | 100 receipts in total             | $5 to $6.25 a month, 200 a month              |
| Dext Prepare  | none                              | $25.21 a month, 250 documents, 5 users        |

**Recommendation:** Free 50 with 2 members is close to Zoho's free plan (60 scans, 3 users) and equals what
SparkReceipt and Shoeboxed charge for. Pro at $9 for 500 scans and 5 members gives twice the scans of Shoeboxed's $29
plan with the same 5 users.
5 members on Pro is at or above the market at this price; no need for 10.

## 5. Technical and enforcement

No schema migration. With no saved row in production, changing `DEFAULT_PLANS` switches Free at deploy.

- `plans.ts`: Free `scope: "workspace"`, `receiptsPerMonth: 50`, `membersPerWorkspace: 2`; Pro
  `membersPerWorkspace: 5`.
- `usage.ts`: the deleted-workspace clause (section 2). `lockQuota` already takes the workspace lock for a
  workspace-scoped plan, so two members cannot both take the last Free scan.
- **Trap:** `apps/web/components/upload-panel.tsx:98` sets the upgrade offer to null when `usage.scope ===
  "workspace"`, treating that scope as Pro. With Free on workspace scope the at-limit offer disappears. Decide on the
  plan, not the scope. Check the same assumption in `limitCopy` (same file) and `upgrade-copy.ts:85`.
- Refusal messages in `quota.ts` for workspace scope do not say "Free"; `bannerCopy` in `upgrade-copy.ts` says
  "You've used all N Free scans". Make both read correctly for a Free workspace.
- A saved settings row keeps its own `scope` (the admin form does not edit it). Check Preview and staging for a saved
  row; re-save or reset it there.
- **Existing Free users:** this month's rounds already carry the workspace id, so the meter is right at deploy. One
  person moves from "9 / 30" to "9 / 50". A workspace whose members together passed 50 this month is blocked until
  the 1st; acceptable before launch.
- **Existing members above the new limits stay** (already the rule in `memberLimitCheck`). Only new invitations and
  acceptances are refused. A pending invitation sent under the old limit is refused at acceptance if the workspace is
  full; the invitee already gets a clear message.
- **No dated or phased offers:** one switch, no "until" copy. Kept members are a permanent state, not an offer.

**Recommendation:** one build PR; the touch list is at the end.

## 6. All other limits

| Limit                 | Today                       | Recommendation                                                                    |
| --------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| Burst a minute        | Free 10, Pro 30, per user   | Keep. 10 lets one full batch through.                                             |
| Batch                 | 10 (admin maximum 20)       | Keep. It is a phone-memory limit, not a plan lever.                               |
| Upload size           | 10 MB                       | Keep. The hosted site accepts 4 MB (`UPLOAD_LIMIT_BYTES`); copy must not promise 10. |
| PDF pages             | 10                          | Keep on both plans.                                                               |
| Workspaces to own     | Free 1, Pro 2               | Keep. A Pro owner's second workspace is Free with its own 50.                     |
| Failed-read allowance | 5 per window                | Keep.                                                                             |
| Free pool             | 300 a day                   | Keep at launch. Raise to 3 times the 7-day peak when the peak passes 180 a day or `quota.pool_full` fires. |
| `OCR_DAILY_CAP`       | docs disagree               | Set 1,000. Stress spend is then $10 a day (e).                                    |
| Storage per workspace | none                        | Defer; see below.                                                                 |
| Free retention        | none                        | None. Receipts are books that people keep for years.                              |

- **`OCR_DAILY_CAP`:** `docs/production-environment.md` says `200` for Production in one table and "about 1000" in
  another section; STATUS lists setting it as an open owner task. Not verified against the live environment in this
  review. A value of 200 sits below the Free pool, so Free traffic alone could stop Pro scanning. It must stay above
  the pool plus Pro's daily use: raise it when the 7-day peak passes half of it.
- **Storage:** a stored photo is 195 KB on average, 452 KB at p95 (m, `bytesSent` in the bench). A Free workspace adds
  about 10 MB a month and a Pro workspace about 100 MB (e). R2's free 10 GB holds about 51,000 receipts, and more costs
  about $0.015 per GB a month (list price, not re-checked today). The scan limits already bound growth, and no
  per-workspace byte total exists to enforce a cap. Defer until the bucket passes 5 GB or one workspace passes 1 GB.
  Then: Free 1 GB, Pro 10 GB, each about eight years of full use.

## Recommended table

|                               | Free                                   | Pro                 |
| ----------------------------- | -------------------------------------- | ------------------- |
| Scope                         | workspace, shared by members           | workspace, shared   |
| Scans a day                   | 20                                     | 200                 |
| Scans a month                 | 50                                     | 500                 |
| Burst a minute (per user)     | 10                                     | 30                  |
| Members, with pending invites | 2                                      | 5                   |
| Workspaces to own             | 1                                      | 2                   |
| Storage                       | no cap now; 1 GB when built            | no cap now; 10 GB when built |
| Upload                        | 10 MB (4 MB hosted), 10 PDF pages, batch 10 | same           |
| Pool                          | 300 a day across all Free workspaces   | none                |
| Global fuse                   | `OCR_DAILY_CAP` = 1,000, all plans     | same                |

**Changes against today:** Free scope user to workspace; Free month 30 to 50; members Free 3 to 2 and Pro 10 to 5;
new rule that scans in a deleted workspace still count; `OCR_DAILY_CAP` confirmed at 1,000. Everything else stays.

## Owner decisions

| #   | Decision                   | Recommendation                                          | Alternative                                              |
| --- | -------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| 1   | Free scope and month       | Per workspace, 50 a month                               | Per workspace, 30: more upgrades from freelancers, weaker first month |
| 2   | Free day limit             | Keep 20                                                 | Drop it (day = month): simpler copy, 6 workspaces can fill the pool |
| 3   | Members                    | Free 2, Pro 5; current members stay                     | Keep 3 and 10: fewer walls, and fewer Pro teams stuck at a limit with no self-serve way past it |
| 4   | Deleted-workspace scans    | Still count against the person                          | Accept the reset: about 5 cents per abuse, bounded by the pool |
| 5   | Storage cap                | Defer with the triggers above                           | Build now at 1 GB and 10 GB                              |
| 6   | `OCR_DAILY_CAP`            | 1,000 in Production; fix the doc that says 200          | 200: cheaper worst day, but below the Free pool          |
| 7   | Accountant seat            | Not special yet                                         | A free, uncounted accountant role (new role, new copy)   |
| 8   | Paddle tax mode            | Tax added on top, as the site says; verify in Paddle    | Tax-inclusive $9 and $90: change the copy, accept the lower margin |

## Touch list for the build PR

- **Core:** `packages/core/src/plans.ts` (defaults and comments), `usage.ts` (deleted-workspace clause, header
  comment), `quota.ts` (messages for a Free workspace), `billing/entitlement.ts` (member and workspace messages).
- **Web:** `components/upload-panel.tsx` (line 98 and `limitCopy`), `lib/upgrade-copy.ts`, `lib/plan-copy.ts`
  (`scansLine`, `allowanceOwner`, `welcomePlanLine`), `components/usage-meter.tsx`,
  `components/billing/plan-and-billing.tsx` (line 119), `app/admin/settings/plan-limits-form.tsx` (show the scope).
- **Marketing and legal:** `app/pricing/page.tsx` (the "per person" FAQ line and the limits FAQ), `app/terms/page.tsx`
  (line 54), `lib/llms.ts` (line 62), `lib/content/use-cases.ts` (line 548), landing plan cards (generated from the
  policy; check the result), `lib/welcome-mailer.ts`.
- **Tests:** `packages/core/tests/quota.test.ts`, `settings.test.ts`, `billing/billing.int.test.ts`; a new integration
  test for delete and recreate; `apps/web/tests/lib/plan-copy.test.ts`, `upgrade-copy.test.ts`, `upgrade-level.test.ts`,
  `plans.test.ts`, `email-mailers.test.ts`, `components/billing/plan-and-billing.test.tsx`; `e2e/pricing.spec.ts`,
  `e2e/upgrade.spec.ts`.
- **Docs:** `docs/architecture/flows/billing.md` (limits table, rules 2 to 4), `docs/architecture/core.md` (ledger
  semantics), `docs/decisions.md` (new row), `docs/STATUS.md` (close the plan-limits item, keep the storage item with
  its trigger), `docs/production-environment.md` (`OCR_DAILY_CAP` 200 to 1,000).
- **Operations:** set `OCR_DAILY_CAP` in Production; check Preview and staging for a saved plan row; check the Paddle
  price tax mode. Screenshots at 390 px in light and dark for the meter, the limit state and the pricing page.
