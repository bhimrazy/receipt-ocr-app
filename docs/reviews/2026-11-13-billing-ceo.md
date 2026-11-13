# CEO review: billing, plans, pricing and sales surfaces — 2026-11-13

_Read-only, on `main` at `725ae6c`, against the review server (billing off there) and the review screenshots
(`review-shots/<account>/…`, named below by account and file). Market facts were fetched 2026-11-13 unless marked.
**Guess** marks an unverified judgement. Builds on [11-07 CEO](2026-11-07-full-ceo.md)._

## Verdict

The machinery to take money is built and careful: per-workspace plans, a signed-webhook ledger, a pricing page, a
refund policy and terms that agree with each other and with `plans.ts`. What is not ready is the **offer**. Cost is no
longer the constraint (a full Pro month costs about $0.30 to serve); the constraint is that **Free is generous enough
that almost nobody we are aiming at will reach the wall**, and the people most likely to want it (Nepal) can't pay
through Paddle easily. Fix the shape before opening checkout, because the price-change commitment in STATUS makes
every later change slower.

## 1. What happened to the 11-07 recommendations

| # | Recommendation | Outcome |
|---|---|---|
| 1 | Default chain to Haiku 5.5, then Flash-Lite | **Done** (decision 2026-11-08, STATUS decision 4) |
| 2 | Paddle application and the site it needs | **Half.** Price, `/refunds` and legal name in Terms are live. Live account verification and the website review are still owner to-dos (STATUS, billing step 5) |
| 3 | Claims sweep | **Partly.** "Let's talk"-only pricing is gone. Still wrong: FAQ model line, repo link, hero "98% confidence" (see §4) |
| 4 | Checkout to plan | **Built, sandbox only** (#143, upgrade surfaces #184). Hidden from everyone but platform admins |
| 5 | Review state | **Done** (migration `0002_receipt_review`, review reasons in #224) |
| 6 | Monthly, workspace-pooled limits | **Done**, but Free landed at 100 a month, not the 25 to 30 recommended |
| 7 | Funnel by SQL | **Not done.** No mention in STATUS or next-up |
| — | Vercel Hobby is non-commercial | **Open** (next-up item 5, `docs/decisions.md:64`) |
| — | Backups and restore drill | **Open.** #131 is a draft, untouched since 2026-11-08 |
| — | Five customer conversations | **Not done.** Still zero interviews on record |

## 2. Ranked findings

### F1. Free covers the whole target user, so Pro has no trigger (plan shape)

- Free is 100 scans a month **per person** with 3 members: a three-person workspace scans **300 a month for $0**.
  Pro is 500 a month **pooled** across up to 10 members for $9. A ten-person Pro team gets 50 each, half of what a
  Free member gets. Evidence: `packages/core/src/plans.ts:74-95`, `/pricing` cards
  (`public/pricing@1440-light.png`).
- A freelancer keeps roughly 20 to 60 receipts a month (**guess**; nobody has been asked). They never see the limit,
  so they never see the offer, which is gated on usage (`decideUpgradeOffer`).
- The field is far tighter. Zoho Expense Free: 20 autoscans per user, 3 users. SparkReceipt: no free plan, 7-day
  trial. Shoeboxed: no free plan, $9 buys 50 scans. Only API products match 100 (Veryfi 100, Tabscanner 200), and they
  sell to developers (§5).
- Pro's only other differences are members (3 to 10) and a second workspace. There is no feature a solo user wants
  that Free lacks: exports, line items, history and review flags are all Free.

**Effect:** conversion near zero from the segment the landing page names first. **Fix:** Free at 30 a month (keep 20 a
day as the pace), or keep 100 only as a dated early-access allowance and say so. Give Pro one non-volume reason: see
R2.

### F2. The buyer we understand best can't pay

- Paddle is card and wallet in USD. Local price points in South Asia are an order of magnitude lower: Zoho Expense
  India is ₹79 to ₹199 per user a month (about $1 to $2.50), and Nepal SaaS snippets show NPR 199 to 1,000 a month
  (third-party snippets, unverified). $9 is about NPR 1,200 (unverified rate).
- No dedicated receipt-OCR expense tool with public pricing turned up for Nepal. That is the opening, and Bikram
  Sambat dates plus PAN and bill-number fields (#224, #228) are built for it. But Khalti and eSewa are "later"
  (next-up item 23), and they need a registered firm.
- So the roadmap builds Nepal features and sells to international card holders. Pick one launch customer (decision 1).

### F3. At the limit, the highest-intent moment captures nothing

- Home and Upload say "Upgrade a workspace to Pro for more scans" as plain text with no link, while Billing on the
  same account says "Paid plans aren't open yet". Evidence: `limit/app-upload@390-light.png`,
  `limit/app-settings-billing@1440-light.png`; `apps/web/components/upload-panel.tsx:147`.
- The only action offered is "Review the receipts you already have". No "tell me when Pro opens", although the
  product-updates signup is built (STATUS, newsletter). Every at-limit user before launch is a lost lead.
- "Uploads open again on the 1st at 00:00 UTC, **in 426 hours**." Say "in 18 days".
- A passkey banner sits above the limit message on Home, Upload and Billing and holds the only filled buttons on the
  screen. At the limit, the limit is the message.

### F4. A paying owner can lose the cancel button

- The Pro owner's Billing shows "Pro, monthly · Active · Renews on 1 Dec 2026" and directly under it "Paid plans
  aren't open yet. See pricing for what Pro will include." There is no portal or cancel button. Evidence:
  `pro/app-settings-billing@1440-light.png`.
- Cause: `apps/web/app/app/settings/billing/page.tsx` checks `!checkout` before `portalOpen`. On the review server
  that is only a config state, but in production any gap in the `PADDLE_*` variables breaks the promise made three
  times in writing ("Cancel from Settings, Billing": pricing FAQ, `/refunds`, `/terms`). Show the portal whenever a
  subscription exists; fall back to "manage it at paddle.net" if the portal can't open.

### F5. The upgrade surfaces can't be reviewed, and one starts too early

- With billing off, none of #184 renders (Home card, meter button, account-menu item, banner, modal). No screenshot in
  this round shows an upgrade button. Before launch someone has to walk them with sandbox keys as each of the five
  account types. This review judges them from `docs/architecture/flows/billing.md#upgrade-offer` only.
- By the spec, placement is mostly right: the button lands on the meter and on the limit state, the banner stays off
  Home, Upload, Billing and receipt pages, members get one sentence and no button, dismissals stick.
- One change: the Home card from **20% used** (`WARM_RATIO`) is a pitch at the 20th scan to someone who has not yet
  exported anything. Start it at 50%, or after the first export, whichever is later. The meter button and menu item
  are enough before that.

### F6. Invited members land outside the workspace that pays for them

- `member@example.test` opens on "Pro Member's Workspace", Free, 0 of 100, "Scan your first receipt". Nothing on Home
  or Billing mentions the Pro workspace they belong to. Evidence: `member/app@1440-light.png`,
  `member/app-settings-billing@390-light.png`.
- May be a seeding artifact (**unverified**: I did not accept a fresh invitation). If a real invitee also lands in
  their personal workspace, their receipts go to the wrong place and the owner sees an empty team. Accepting an
  invitation should make that workspace active. The member-inside-Pro view was not captured this round.

### F7. Monthly billing loses 10.6% to fees and is the default

- Paddle is 5% + $0.50 ([paddle.com/pricing](https://www.paddle.com/pricing)): $0.95 of a $9 month (10.6%), $5.00 of
  a $90 year (5.6%). The toggle opens on Monthly (`pricing-plans.tsx`, `useState("month")`).
- Paddle's FAQ invites sellers of products under $10 to ask for bespoke pricing. Ask, and open the toggle on Yearly.

### F8. Custom promises what one person can't deliver

- "A direct line to the team", "Shape the roadmap with your feedback", "Higher monthly and daily limits". There is no
  team, and STATUS says a single customer's higher limit "has no mechanism" (limits change per plan only).
- Keep the card, cut it to one honest line: "Need more than Pro? Tell us what you need and we'll say what we can do."

## 3. Who sees what

| Viewer | Sees today (review server) | Verdict |
|---|---|---|
| Visitor | Landing: Free "Start here", Pro "$9" with "See pricing"; `/pricing`: "Pro checkout opens soon." | Honest. Add an email capture next to "opens soon" |
| New free user | Meter 0 of 100, Billing "No subscription", no pitch | Right: no pitch before value |
| Power free user (85) | Amber meter "15 left today, 15 this month", nothing else | Right place for the button once checkout opens |
| At-limit user | Limit card on Home and Upload, red meter, unlinked "Upgrade" sentence | Dead end (F3) |
| Paying owner | Meter 120 of 500, "Active", no cancel, "aren't open yet" | Broken promise (F4) |
| Member | Own Free workspace, no sign of Pro | Wrong landing (F6) |

## 4. Claims we can't back up today

| Claim | Where | Problem |
|---|---|---|
| "Receipts are scanned by Google Gemini" | `apps/web/lib/home-faqs.ts:15` | Default chain is Claude Haiku 5.5 first since 2026-11-08. Terms name both. Third review to flag this |
| "Open source on GitHub" | `site-footer.tsx:114`, `about-settings.tsx:45`, `llms.ts:40` | `LICENSE` is "All rights reserved… published for viewing only". Say "Source on GitHub". `repoUrl` (`lib/site.ts:13`) still points at a different repository |
| "up to 20 at a time" | `landing-page.tsx:86` | The app says and enforces 10 (`DEFAULT_BATCH_MAX`; `member/app@1440-light.png`) |
| "98% confidence" in the hero | `product-preview.tsx:37` | An invented figure in the most-seen spot. Use a measured one or a neutral label |
| "we'll tell you by email before" a price change | `/terms`, Plans and limits | No such email exists (STATUS billing step 7). Fine while it is done by hand; write the runbook step before the first subscriber |
| Custom card lines | `plan-copy.ts` `CUSTOM_PLAN` | F8 |
| "Cancel from Settings, Billing" | `/pricing`, `/refunds`, `/terms` | True only while checkout config loads (F4) |

Backed up and worth keeping: 14-day refund wording, "Paddle is the merchant of record", scan-pack line ("aren't on
sale yet"), "What counts as a scan", the shared Free pool disclosed on `/pricing`. The refund and terms pages are in
good shape for Paddle's website review.

## 5. Market and unit economics

Vendor pages fetched 2026-11-13 unless marked.

| Product | Free | Paid entry | Scans and users | Source |
|---|---|---|---|---|
| **ReceiptOCR** | 100/mo per person, 3 members | $9/mo, $90/yr flat | 500/mo pooled, 10 members, line items | `plans.ts` |
| SparkReceipt | none, 7-day trial | Pro $6.90/mo; Elite $12.90/mo | 50 docs; unlimited; +$1 per extra user; line items on Elite | [sparkreceipt.com/pricing](https://sparkreceipt.com/pricing/) |
| Shoeboxed | none | Starter $9; Pro $29; Plus $79 | 50 / 250 / 1,000 scans; 3 / 5 / 10 users | [shoeboxed.com/pricing](https://www.shoeboxed.com/pricing) |
| Dext | 14-day trial | $25.21/mo billed yearly | 250 docs, 5 users | [dext.com](https://www.dext.com/us/pricing/prepare-direct/) |
| Zoho Expense (US) | 20 autoscans per user, 3 users | $3 to $6 per user | 200 / 1,000 per user | [zoho.com/us/expense/pricing](https://www.zoho.com/us/expense/pricing/) |
| Zoho Expense (India) | 20 scans, 3 users | ₹79 to ₹199 per user, min 5 users | same | [zoho.com/in/expense/pricing](https://www.zoho.com/in/expense/pricing/) |
| Wave | none | receipts add-on $8/mo | — | third-party, vendor page not fetched |
| Veryfi (API) | 100 docs/mo | $0.08 a receipt, $500/mo minimum | — | [veryfi.com/pricing](https://www.veryfi.com/pricing/) |
| Tabscanner (API) | 200 credits/mo | $24 for 300 ($0.08 each) | — | [tabscanner.com/pricing](https://tabscanner.com/pricing) |

Not checked this round: Expensify (vendor page unreachable), Khatabook, Vyapar, myBillBook, Tally add-ons, Fyle.

- **$9 for 500 is the cheapest paid volume in the table** by 5 to 10 times per scan ($0.018 against Shoeboxed $0.18,
  SparkReceipt $0.14, Dext $0.10). Pro is not too expensive; if anything it is too big. Nobody above bundles 10 seats
  flat.
- **Line items included** is a real difference: SparkReceipt and FreshBooks put them on the higher tier.
- **Upgrade triggers competitors use:** scan count, seats, line items, storage or retention. Ours is scan count alone,
  set where few reach it.

**Model prices** (fetched 2026-11-13): Haiku 5.5 $0.10 in / $0.50 out per million tokens
([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)); Gemini 3.5 Flash-Lite $0.30 / $2.50; Gemini
3.8 Flash $0.75 / $3.75, doubling 2027-01-01 ([Google](https://aistudio.google.com/docs/pricing)). Unchanged since
11-07. **Measured per receipt** (`packages/bench/results/2026-11-07-real.md`, 31 receipts): Haiku $0.0006,
Flash-Lite $0.0014. Extraction v3 (#228) adds fields; re-run the benchmark before trusting these.

| Case | Revenue after Paddle | OCR cost | Left |
|---|---|---|---|
| Pro monthly, all 500 used | $8.05 | $0.30 (Haiku) to $0.70 (Flash-Lite) | about $7.50 |
| Pro yearly, per month | $7.08 | same | about $6.60 |
| Free user at 100 | $0 | $0.06 | — |
| Free pool full every day (300) | $0 | $5.40 a month | — |
| Scan pack, $5 for 500 | $4.25 | $0.30 | $3.95, and it undercuts Pro (500 for $5 against $9) |

- Fixed costs once commercial: Vercel Pro about $20 and Supabase Pro about $25 a month (**unverified this round**), so
  break-even is about **6 Pro workspaces**.
- Free is cheap to serve, so trimming it is about conversion, not cost. The Free pool already caps the downside.
- The planned scan pack is priced below Pro per scan with no expiry pressure. Reprice it ($5 for 200) or drop it.
- Storage has no cap on either plan (STATUS, "Storage limit per plan"). It is the one unbounded cost and a natural Pro
  line.

## 6. Before opening paid plans, in order

1. **Decide the offer** (decisions 1 and 2), then set `plans.ts`, `/pricing` and `/terms` once. Owner, 1 hour; 0.5 d.
2. **Hosting off Vercel Hobby** and **backups with one restore drill** (#131). Taking money on a non-commercial plan
   with no restorable backup is the largest non-product risk. 1 d plus about $45 a month.
3. **Fix F4** (portal independent of checkout) and **F3** (link or lead capture, "18 days"). 1 d.
4. **Claims in §4.** 0.5 d.
5. **Walk the sandbox as five accounts** with screenshots: free new, free 85%, at limit, owner through checkout,
   cancel, refund, failed payment, and an invited member. Confirm F6. 1 d.
6. **Paddle live verification and website review** (owner). Start now; it runs in parallel and takes days.
7. **Funnel query**: sign-up, first completed receipt, first export, limit reached, `upgrade_cta`,
   `checkout_started`, weekly. Without it nobody will know whether F1 was right. 0.5 d.

Defer until a subscriber asks: scan packs, per-workspace overrides, BYOK, Khalti and eSewa unless decision 1 says
Nepal first.

## 7. Recommendations

| # | Do | Expected effect | Cost |
|---|---|---|---|
| R1 | Free to 30 a month per person (20 a day stays); label today's 100 as an early-access allowance until then | Users who get value reach the offer in week 2 or 3 instead of never | 0.5 d, one decision |
| R2 | Give Pro one non-volume reason. Cheapest candidates: a storage or retention cap on Free (already an open owner item), or accountant-ready export (Excel, per-group export) | A reason to pay for the solo user who never hits a count | 2 to 3 d |
| R3 | At the limit and on "checkout opens soon": a one-field "email me when Pro opens", using the built signup | A launch list of the highest-intent users; costs nothing to serve | 0.5 d |
| R4 | Portal and cancel always available to a subscriber; member lands in the inviting workspace | Keeps the three written cancel promises; fewer refund disputes | 1 d |
| R5 | Five conversations before launch, three of them in Nepal, asking one thing: receipts a month and what they'd pay, and how | Replaces the two biggest guesses in this review (F1 volume, F2 payment) | Owner, 3 hours |

## 8. Owner decisions

1. **Who is the launch customer?** International freelancers on cards through Paddle (then stop pulling Nepal work
   forward), or Nepal first (then Khalti or eSewa prepaid months and an NPR price come before Paddle polish).
2. **Free allowance:** 30 a month, or 100 as a dated early-access offer, or stay at 100 and accept that Pro sells on
   seats alone. And which single extra Pro gets (R2).
3. **Hosting and backups before the first charge:** Vercel Pro or the Docker image on a VPS, and Supabase Pro or
   #131, with a date.

_Gaps: checkout-open states were not visible on the review server; the member-inside-Pro view was not captured;
receipts-per-month for the target user is a guess; several South Asia products and Expensify were not checked; the
NPR exchange rate and hosting prices are unverified._
