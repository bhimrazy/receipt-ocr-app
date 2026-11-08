# Pricing unit options: workspace, account, seat or credits (2026-11-08)

_Research · status: **to explore later; no change now**. The decision of 2026-11-08 stands: plans are per workspace
([decisions.md](../decisions.md), [billing flow](../architecture/flows/billing.md))._

The question the owner asked: we bill **per workspace** today. Vercel and other platforms bill per team with seats,
GitHub bills per account, Supabase per organization with a pooled quota, receipt tools per active member or per
document. Which unit fits ReceiptOCR's three kinds of users (individuals, freelancers and accountants with several
clients, small teams), and when would we switch? Prices and rules below were read from the official pages on
2026-11-08; third-party figures are marked **(third-party)**.

## What others do

| Product                                                                                                                      | Unit of billing                                                                               | Free tier scope                                                                                                                                | Seats / members                                                                                                                                                     | Usage pool                                                                                                 | Several workspaces                                                                                                           | Notable rule or pitfall                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [Vercel](https://vercel.com/pricing) ([Hobby](https://vercel.com/docs/plans/hobby))                                          | Team. Pro $20/mo per team (includes $20 usage credit) + seats                                 | Hobby is a personal, non-commercial team: 1 developer seat, fixed caps, "cannot purchase additional usage"; paused for the month when exceeded | Developer seat $20/mo; viewers free. Auto Approval adds a **billed** seat the moment a committer pushes ([accounts](https://vercel.com/docs/accounts))              | Credit and included usage per team; overage pay-as-you-go with a spend budget                              | "No limit on the number of teams"; each Pro team is its own bill                                                             | Free usage can be multiplied across Hobby teams (one per login connection), but Hobby forbids commercial use. Default spend budget $200   |
| [Linear](https://linear.app/pricing) ([billing](https://linear.app/docs/billing-and-plans))                                  | Workspace, per user: Basic $10, Business $16 /user/mo                                         | Free: unlimited members, 2 teams, 250 issues                                                                                                   | "billed for the number of unsuspended users within a workspace", any role. Monthly: add mid-month is free until next month, remove gives no credit; yearly prorated | n/a (feature gates, not usage)                                                                             | "your paid plan only applies to the single workspace associated with it"                                                     | Free is generous on members and tight on content (250 issues), so a free workspace cannot replace a paid one                              |
| [Notion](https://www.notion.com/pricing) ([billing](https://www.notion.com/help/billing))                                    | Workspace, per member: Plus $10, Business $20 /member/mo                                      | Free is for individuals: solo has no block limit; a multi-member Free workspace has a block cap                                                | Guests free within a limit; added members prorated, "No proration for removals", seats recalculated at renewal                                                      | n/a                                                                                                        | "Plans only apply to a single workspace and don't cover your whole account"; the same person in two workspaces is paid twice | Free gets tighter once you invite someone: the block cap is the lever that pushes teams to pay                                            |
| [Slack](https://slack.com/pricing) ([Fair Billing](https://slack.com/help/articles/218915077))                               | Workspace, per active user                                                                    | Free: 1 workspace, 90 days of history, 10 apps                                                                                                 | Inactive for 28 days = prorated credit; single-channel guests and bots free; at least one member is always billed                                                   | n/a                                                                                                        | One workspace per plan below Enterprise                                                                                      | Fair Billing is friendly but needs activity tracking, credits and reactivation charges                                                    |
| [GitHub](https://github.com/pricing) ([plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans))   | Account. Pro is a flat fee on a **personal** account; Team is per user on an **organization** | Free for personal accounts and for organizations                                                                                               | Team "bills on a per-user basis"; Pro $4/mo flat, Team $4/user/mo **(third-party)**                                                                                 | "each GitHub account receives storage and a monthly included compute usage" ($12 Free, $18 Pro/Team)       | Each org is its own account with its own plan and quota                                                                      | Two products for two units: a personal plan that upgrades the person, and an org plan that upgrades the team                              |
| [Supabase](https://supabase.com/pricing) ([billing](https://supabase.com/docs/guides/platform/billing-on-supabase))          | Organization: Pro $25/mo, plus compute per project                                            | "The project limit applies across all organizations where you are an Owner or Administrator" (2 active free projects per person)               | No seats                                                                                                                                                            | "applied to your entire organization, independent of how many projects"; compute per project               | "To have projects on different plans, you must create separate organizations"; "bills separately for each organization"      | The free cap is per **person across orgs**, the paid quota is pooled per org: the same shape as our Free-per-user, Pro-per-workspace rule |
| [Figma](https://www.figma.com/pricing/)                                                                                      | Team or org, per seat by type: Full $16, Dev $12, Collab $3 /mo                               | Starter team, limited                                                                                                                          | Viewers free; on Organization and Enterprise "admins need to approve new seats that incur costs"                                                                    | n/a                                                                                                        | Each team is billed on its own                                                                                               | Tiered seats match what each person does; approval stops seat creep                                                                       |
| Expensify ([plan types](https://help.expensify.com/articles/new-expensify/billing-and-subscriptions/Plan-types-and-pricing)) | Workspace, per active member per month                                                        | Free "Submit" plan for an individual whose company has no workspace                                                                            | Collect about $5/member; Control $36 pay-per-use or $18 on an annual commitment, up to half off with the Expensify Card **(third-party)**                           | Scans are a feature, not a metered quota                                                                   | A company usually has one workspace; accountants manage many                                                                 | "Active member" is anyone who touched an expense that month, so a quiet month costs less                                                  |
| [Zoho Expense](https://www.zoho.com/us/expense/pricing/)                                                                     | Per active user: Standard $3, Premium $5 /user/mo (annual)                                    | Free: up to 3 users, 20 autoscans per user per month                                                                                           | "Users who create expenses or expense reports are charged"                                                                                                          | Autoscans per **user** per month (200 Standard, 1,000 Premium), not pooled                                 | One organization per plan                                                                                                    | A per-user scan cap means a team's unused scans are wasted; closest competitor shape to ours                                              |
| Dext (formerly Receipt Bank)                                                                                                 | Per business entity with a monthly document cap; partner plans per client                     | None                                                                                                                                           | Users included per plan (about 5) **(third-party)**                                                                                                                 | About 250 documents a month per business at about $25/mo annual **(third-party)**                          | Accountants pay per client entity, with a 10-client minimum on practice plans **(third-party)**                              | The "one bill per client" model is exactly what bookkeepers expect; pricing page not reachable from here, so figures are unverified       |
| [Veryfi](https://www.veryfi.com/pricing/)                                                                                    | Per document (API)                                                                            | 100 documents a month, "Free Forever"                                                                                                          | n/a                                                                                                                                                                 | Receipts $0.08 each; Starter plan from $500/mo                                                             | n/a                                                                                                                          | Pure usage pricing works for developers, not for a person with a phone                                                                    |
| [Taggun](https://www.taggun.io/pricing)                                                                                      | Monthly scan allowance with overage (API)                                                     | None; 30-day trial of 1,000 scans                                                                                                              | n/a                                                                                                                                                                 | Developer $28 for 500 scans, $0.06 overage; "One submitted file equals one scan", failed validations count | n/a                                                                                                                          | Counting failed reads as scans mirrors our `FREE_FAILED_ROUNDS` rule                                                                      |

Patterns worth keeping in mind:

- **Collaboration tools bill the container (workspace, team, org) and multiply by members.** Nobody bills a person's
  plan across several workspaces except GitHub Pro, and GitHub keeps a separate per-user product for organizations.
- **Free tiers are scoped to stop multiplication.** Supabase caps free projects per person across all orgs; Notion and
  Linear cap content, not members; Vercel bans commercial use on Hobby. Our Free-per-person rule is the Supabase shape.
- **Paid usage is pooled per paying container.** Supabase pools quota across projects in the org; Vercel pools credit per
  team. Zoho's per-user autoscans are the outlier and waste a team's unused scans.
- **Seat billing needs machinery:** proration (Notion, Linear yearly), inactivity credits (Slack), seat approval
  (Figma, Vercel Manual Approval). Each is a product surface and a reconciliation job.
- **Receipt tools bill the entity whose books they are** (Dext per business or client, Expensify per workspace), because
  that is how an accountant's costs are passed on.

## Paddle facts that shape the options

- One customer can hold several subscriptions: a customer entity "can be related to multiple subscriptions and
  transactions" ([feature comparison](https://developer.paddle.com/migrate/paddle-classic/features)). Model A already
  relies on this (two Pro workspaces = two subscriptions, one customer).
- Per-seat is `items[].quantity` on the subscription. A price carries `quantity.minimum` (default 1) and
  `quantity.maximum` (default 100) ([create price](https://developer.paddle.com/api-reference/prices/create-price)).
  Changes go through `PATCH /subscriptions/{id}` with `proration_billing_mode` (`prorated_immediately`,
  `prorated_next_billing_period`, `full_immediately`, ...), are blocked while `past_due` or within 30 minutes of
  renewal, and all recurring items must share one billing interval
  ([add or change items](https://developer.paddle.com/build/subscriptions/add-remove-products-prices-addons)).
- One-time and recurring add-ons can be billed to an existing subscription (same feature comparison page), which is
  how scan packs would attach to a Pro subscription; a Free workspace would buy a pack as a stand-alone transaction.
- Transactions under $10 "may require custom pricing" (payments plan). Every model with a $5 pack or a $3 seat pays
  5% + $0.50 per transaction, so a $5 pack loses 15% to fees.

## Four models for ReceiptOCR

Shared facts: Free is 20 a day and 100 a month per person; Pro is $9/mo or $90/yr for 500 scans a month (200 a day);
packs are $5 for 500 and $15 for 2,000. Schema today: `billing_subscriptions` has both `organization_id` (the
entitlement key) and `user_id` (who paid); `PlanPolicy.scope` in `plans.ts` is `user` (Free) or `workspace` (Pro).

### A. Per workspace (current)

One subscription = one workspace; its members share the pool. A Pro owner may own 2 workspaces, the second starts
Free.

- **Individuals:** fine; the personal workspace is the thing they pay for.
- **Freelancers and accountants:** the honest fit for "one bill per client" (Dext shape), but at $9 per client with no
  volume price it gets expensive past 2 or 3 clients, and the 2-workspace cap stops them there.
- **Small teams:** good: 500 scans shared, no seat count to manage, invite anyone.
- **Abuse:** multiplication is closed (Free scans per person, ownership cap, Pro pool per workspace). Residual risk is
  free-account farming, covered by the 300-a-day Free pool. A Pro workspace with 50 members shares 500 scans, so seat
  sharing is self-limiting.
- **Schema and Paddle:** built. Nothing to do.

### B. Per account, workspaces inherit

The person is Pro (GitHub Pro shape). Every workspace they own is Pro, and the 500-a-month pool belongs to the account
and is drawn down by all of those workspaces together, members included.

- **Individuals:** same as A.
- **Freelancers and accountants:** best fit: one $9 subscription, one pool, as many client workspaces as the cap
  allows (say 5 or 10). The pool keeps cost in line with usage, not with client count.
- **Small teams:** worse. The pool belongs to one person; if the owner leaves or stops paying, every workspace drops
  to Free at once. Members also draw from an allowance they cannot see or buy.
- **Abuse:** no multiplication (one pool per account). New risk: one Pro owner creating workspaces for other
  businesses and reselling access; a workspace cap and the shared pool bound it.
- **Schema:** entitlement moves to `billing_subscriptions.user_id`; `organization_id` becomes informational. A new
  `QuotaScope` `owner` counts `ocr_rounds` across every workspace the paying user owns, so `UsageCounts` needs an
  owner-id join and a third advisory lock (owner) in `decideQuota`. The usage meter must say "your account's scans",
  not "this workspace's".
- **Migration from A:** every Pro row already has `user_id`; flip `workspacePlan` to check the owner's subscription and
  raise `workspaces` for Pro. Existing two-subscription owners need one cancelled and refunded by hand.
- **Paddle:** unchanged, one subscription per customer; the second subscription becomes impossible, which simplifies
  the customer portal story.

### C. Per-seat team plan with a pooled usage credit

Pro stays $9 for the owner and 500 scans; each extra member is a seat (say $4/mo) that adds scans to the pool (say
+200). Notion and Vercel Pro shape.

- **Individuals:** unchanged.
- **Freelancers and accountants:** no help; still per workspace.
- **Small teams:** revenue grows with the team, and the pool grows with it, so a 5-person firm is not stuck at 500.
  Cost of a 5-person workspace: $25/mo for 1,300 scans.
- **Abuse:** seat sharing (one login for the whole office) is the classic leak; the pool, not the seat, is what they
  want, so it is bounded. Inviting and removing members around renewal needs Linear's rule (no credit on removal).
- **Schema:** `billing_subscriptions.quantity`; a `billing.sync_seats` job that reads the member count and PATCHes
  Paddle with `proration_billing_mode`; `PlanPolicy` gains `receiptsPerSeat`; member invite and removal become billing
  events with a confirmation step (Figma-style approval) and must refuse while `past_due`.
- **Migration from A:** additive. Existing Pro rows get `quantity = 1`; the owner opts members into seats.
- **Paddle:** the Pro price needs `quantity.maximum` above the default 100 or a cap on members; every seat change is a
  subscription update with a preview, so the billing page needs a "this will charge $X now" step.

### D. Usage first: scan packs, small or no base fee

Free stays. Everyone else buys scans: Pro as a 500-a-month subscription for the daily cap and features, plus packs for
overage; or packs only, no subscription (Taggun and Veryfi shape). Credits sit on the workspace.

- **Individuals:** a $5 pack lasts a year of light use, cheaper than $9/mo. Good for the user, hard on margin and on the
  fee floor.
- **Freelancers and accountants:** very good: pay for volume, not for client count; a busy quarter buys a bigger pack.
- **Small teams:** fine as a top-up; weak as the only product because there is no recurring revenue.
- **Abuse:** none beyond Free; credits are paid for. The daily cap still applies so a leaked account cannot burn a pack
  in an hour.
- **Schema:** the credit grant table already sketched in the billing flow (workspace, scans bought and used,
  `expires_at`, transaction id); `ocr_rounds.plan` gains a `pack` source; `decideQuota` gains the "month exhausted,
  then pack" step. Packs on Free workspaces is a product decision.
- **Migration from A:** additive, and already planned. Making packs the **only** product would mean cancelling
  subscriptions, which we would not do.
- **Paddle:** a one-time price per pack; `transaction.completed` with the pack price id becomes a handler in
  `applyBillingEvent`. Under-$10 transactions may need custom pricing; the $5 pack pays about 15% in fees.

## Comparison

| Criterion                        | A. Per workspace (now) | B. Per account         | C. Seats + pool          | D. Usage first           |
| -------------------------------- | ---------------------- | ---------------------- | ------------------------ | ------------------------ |
| Individuals                      | Good                   | Good                   | Good                     | Cheaper for them         |
| Accountants with several clients | Expensive past 2       | Best                   | No help                  | Good                     |
| Small teams                      | Good, capped at 500    | Fragile (owner leaves) | Best                     | Fine as a top-up         |
| Quota multiplication             | Closed                 | Closed                 | Closed                   | Closed (paid)            |
| Seat sharing                     | Self-limiting          | Self-limiting          | Main leak                | n/a                      |
| Recurring revenue                | Yes                    | Yes                    | Yes, grows with the team | Weak alone               |
| Schema change                    | None                   | Scope + locks + meter  | Quantity + sync job      | Credit table (planned)   |
| Paddle work                      | None                   | None                   | Quantity, proration UX   | One-time prices, handler |
| Fee floor (5% + $0.50)           | 10% of $9              | 10% of $9              | 17% of a $4 seat         | 15% of a $5 pack         |
| Reversible                       | n/a                    | Hard (refunds)         | Additive                 | Additive                 |

## Recommendation (to explore later; no change now)

Keep **A**, and add **D as an add-on** (scan packs on top of Pro) as the first flex, because it is already designed,
additive, and serves the two complaints A will get first: a team that hits 500 and an accountant with uneven months.
Do not build B or C before launch; both need a real signal.

Signals that would make us switch:

- **To B (per account):** more than a handful of Pro owners ask to upgrade a second or third workspace, or
  support sees accountants making one workspace per client and complaining about the cap. Check
  `plan_limit_hit` by owner and the "Free accounts can own 1 workspace" refusal count.
- **To C (seats):** Pro workspaces with 4 or more members become common and hit the 500 pool regularly; those owners
  would pay per person for a bigger pool. Check member count per Pro workspace against monthly `plan_limit_hit`.
- **To D as the main product:** most Pro subscribers use under 150 scans a month (paying $9 for $0.60 of model cost)
  and churn after one or two months. A pack would keep them.
- **Away from per-workspace Free counting:** only if the Free pool (300 a day) is routinely exhausted by what looks like
  account farming; then tighten sign-up, not the plan unit.

What we would **not** do in any model: give a Pro owner's other workspaces Pro for free without a shared pool (that is
the quota multiplication the 2026-11-08 decision closed), or bill seats without a pool that grows with them (Zoho's
per-user caps waste a team's scans).
