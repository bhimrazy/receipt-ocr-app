# Plan: in-app feedback, feature requests and issue reports

2026-11-07. Owner's ask: "in their dashboard we can also present stuff to share any feedback or request a feature or
share any issue in a better way; research with better practice on that too." Read-only research on `main` at
`8202d50`; no code changed. Fits with the per-receipt flag in
[review state and flagging](../reviews/2026-11-07-review-state-and-flagging.md) and does not duplicate it.

## Summary

- **Today the signed-in app has no way to reach us.** The support widget (`components/support-widget*.tsx`,
  `support-panel.tsx`) is mounted only on the landing and legal pages. It posts to `/api/contact`, which emails
  `SUPPORT_EMAIL` through Resend and stores nothing. A signed-in user must retype their email, and nothing records
  what they sent, so there is no status, no history and no metrics.
- **Build a small private intake now, buy a public board later.** One `feedback` table, a "Send feedback" sheet in
  the app (reusing the support panel), a "Your feedback" list for users and an admin inbox. About 6 days for the first
  three phases (7 to 8 with notifications and retention). Every tool below costs $25 to $79 a month for features we would barely use at launch, and the cheap
  free tiers are capped (Canny 25 tracked users, Fider Cloud 250 items, Featurebase one board).
- **Public board at about 300 monthly active users or 20 feature requests a month**, whichever comes first.
  Recommended then: **Featurebase Free** (one board and one roadmap, $0) or **self-hosted Fider** (AGPL-3.0) if the
  owner wants no vendor. Not GitHub Discussions: our users are not developers and need a GitHub account to vote.
- **The receipt flag stays the place for "this reading is wrong".** General feedback links to it on receipt pages
  and never asks for receipt contents. Both share one admin triage habit, not one table.
- **Privacy first:** auto-attach page, app commit, browser, workspace id. Never receipt contents. Screenshots are
  opt-in, with a "may show receipt data" note and a redaction step before upload.

## How others do it (fetched 2026-11-07)

| Product   | What they do                                                                                                                                                                                                       | Source                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raycast   | One in-app "Send Feedback" form: plain text and optional email, **no categories**. A weekly on-call person reads, filters and replies within 48 h; daily Slack digest; "we don't keep a backlog or have a roadmap" | [Raycast blog, 2021-02-10](https://raycast.com/blog/feedback); [manual](https://manual.raycast.com/contact-support) (also lists a public Featurebase board with categories)             |
| Linear    | Support page for "product questions, report problems … leave feedback"; mobile Settings has "send feedback". Internally, Customer Requests link a request to an issue and its customer                             | [Contact support](https://linear.app/contact/support), [Get the app](https://linear.app/docs/get-the-app), [Customer Requests](https://linear.app/docs/customer-requests)               |
| Notion    | "Send us a message in the app by clicking ? at the bottom of your sidebar"; Android "Shake phone to report". Support sees workspace data only after the admin enables access, per action, for 28 days              | [Workspaces on mobile](https://www.notion.com/help/workspaces-on-mobile), [Data access consent](https://www.notion.com/help/data-access-consent)                                        |
| Vercel    | Toolbar Comments: feedback pinned to a page of a deployment, with an inbox. Users report that clients need a Vercel account                                                                                        | [Vercel Toolbar docs](https://vercel.com/docs/vercel-toolbar), [community thread](https://community.vercel.com/t/feedback-on-vercel-toolbar-big-potential-if-adapted-for-clients/15661) |
| Expensify | Everything goes through Concierge chat (in app, email, SMS), escalating to a human in the same thread                                                                                                              | [Concierge basics](https://help.expensify.com/articles/new-expensify/concierge-ai/Concierge-Basics)                                                                                     |
| Dext      | Public UserVoice forum for Prepare with categories (extraction, integrations, submission methods) and votes                                                                                                        | [Dext UserVoice](https://dext.uservoice.com/forums/934215-prepare)                                                                                                                      |

Takeaways: (1) the entry point lives where the user already is (sidebar ?, account menu, a command), not a separate
site; (2) small teams win on **reply speed**, not on boards; (3) receipt-adjacent products (Dext) use a public voting
board only at scale; (4) Notion's per-request consent is the model for looking at a user's content.

## Tools and pricing for a solo founder (fetched 2026-11-07)

| Tool                    | Cheapest useful tier                                                  | Fit                                                                                       | Source                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Canny                   | Free: 25 tracked users; Pro from $79/mo billed yearly                 | Strong (dedupe, status updates) but 25 users is a demo, $79 is too early                  | [canny.io/pricing](https://canny.io/pricing)                                                                                |
| Featurebase             | Free: 1 seat, 1 board, 1 roadmap; Growth $29/seat/mo                  | **Best free tier for a later public board**; widget, changelog, in-app and email updates  | [featurebase.app/pricing](https://www.featurebase.app/pricing)                                                              |
| Frill                   | Startup $25/mo, 50 active ideas                                       | No free tier; idea cap                                                                    | [frill.co/pricing](https://frill.co/pricing)                                                                                |
| Productboard portal     | Business plan only, price on request                                  | Built for product teams; no                                                               | [productboard.com/pricing](https://www.productboard.com/pricing/)                                                           |
| Fider                   | Self-host free (AGPL-3.0, Docker); cloud free to 250 items, Pro $25   | **Self-host option** next to our Docker stack; voting and discussion                      | [fider.io](https://fider.io/), [GitHub](https://github.com/getfider/fider)                                                  |
| Astuto                  | Self-host                                                             | **Archived 2026-02-08, unmaintained.** No                                                 | [GitHub](https://github.com/astuto/astuto)                                                                                  |
| GitHub Discussions      | Free on our public repo; categories, polls, Q&A answers               | Needs a GitHub account and exposes requests next to code. Fine for developers (MCP users) | [GitHub docs](https://docs.github.com/en/discussions/collaborating-with-your-community-using-discussions/about-discussions) |
| Userback                | Free: 2 seats, screenshots; Team $39/mo yearly                        | Screenshot widget; feature portal is an add-on                                            | [userback.io/pricing](https://www.userback.io/pricing/)                                                                     |
| Marker.io               | Starter $39/mo yearly ($59 monthly), screenshots; replay on Team $149 | Built for QA and agencies; no                                                             | [marker.io/pricing](https://marker.io/pricing)                                                                              |
| Resend (already in use) | Free: 100/day, 3,000/mo; Pro $20/mo                                   | Replies and "we shipped it" mail; watch the 100/day cap                                   | [resend.com/pricing](https://resend.com/pricing)                                                                            |
| Turnstile (in use)      | Free, unlimited challenges, 20 widgets                                | Not needed for signed-in feedback; keep for public                                        | [Cloudflare docs](https://developers.cloudflare.com/turnstile/plans/)                                                       |

Screenshot SaaS (Userback, Marker.io) would send screens that show receipts to another processor: a privacy-page
change and a DPA for little gain. Build the screenshot as a browser capture we store in our own bucket instead.

## 1. Entry points

| Where                        | What                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account menu / account sheet | "Send feedback" (`MessageSquarePlus`) above "Cookie settings" in `components/user-menu.tsx`; same row in the phone account sheet from #46                                                                                                       |
| Settings                     | A "Help and feedback" section at the bottom: Send feedback, Your feedback, privacy link, support email                                                                                                                                          |
| Receipt page                 | "Something wrong with this reading? **Report it**" opens the receipt flag dialog (flagging review). A footer link "Other feedback" opens the general sheet with type Bug                                                                        |
| After a milestone            | One quiet card on Home after the 10th completed receipt, and once after the first export: "How is it going? Tell us in one line." Dismiss stores `dismissed_at`; shown at most once per 60 days per user; never in a modal, never during upload |
| Error and empty states       | `app/app/error.tsx` and failed-receipt alerts: "Report this problem" prefilled with type Bug and the request id / error kind (never the message). Empty History: none (no nagging)                                                              |
| Public pages                 | Unchanged: the existing widget stays for visitors (questions, plans)                                                                                                                                                                            |
| 390 px                       | The form is a bottom sheet (`Drawer` from #46), full width, 44 px targets, the type chips wrap in two rows, Send button sticks above the keyboard and the tab bar inset                                                                         |

No floating launcher inside the app: it would collide with the Scan tab and toasts on phones.

## 2. Form

Fields: **type** (Bug or problem, Idea or feature request, Question, Praise; default from the entry point), **message**
(5 to 2,000 chars, as `/api/contact`), **screenshot** (optional), and "You can reply to me at `<session email>`"
(shown, not editable). Then "Send". Success state: "Thanks. We read every message and usually reply within two working
days." Only promise what the owner can keep.

Screenshot:

- Two buttons: "Capture this page" (`html-to-image`-style DOM capture, run only after the click; a new dependency, so
  it goes through the supply-chain rules) and "Upload image". PNG/JPEG/WebP, ≤ 2 MB after browser re-encode (reuse
  `lib/upload-prep.ts`).
- Note under it: "Screenshots can show receipt details such as merchants, amounts and card digits. Cover anything you
  don't want us to see." A **redaction step**: draw black boxes on a canvas before upload; the receipt image area is
  pre-blurred by default on capture (opt out per screenshot).
- Stored under `feedback/<org>/<id>.png` in our own bucket via `packages/storage`; never sent to a third party.

Auto-attached context (shown under a "What we attach" disclosure so it is not hidden):

| Field                    | Source                                      | Note                                                |
| ------------------------ | ------------------------------------------- | --------------------------------------------------- |
| page                     | route pattern (`/app/receipts/[id]`)        | Pattern, not the URL: ids and query strings dropped |
| receipt id               | only from a receipt page                    | Id only, never values                               |
| app commit               | `commitSha()` in `lib/health.ts`            | Short SHA                                           |
| browser, OS, viewport    | user agent parsed to family + major version | Plus "installed PWA" yes/no                         |
| workspace id, plan, role | session scope                               | For triage                                          |
| request id / error kind  | error states only                           | Matches a wide event                                |

Receipt contents (image, extracted values) are attached only through the flag flow's own consent checkbox.

## 3. Feature requests: private now, public later

- **Now (private intake):** requests land in our table. The owner merges duplicates in the inbox (`duplicate_of`
  points at the canonical row; the duplicate's author is counted as a requester). Demand per request = number of
  merged rows plus distinct workspaces. No public votes, so no empty-board problem.
- **Later (public board), trigger:** ~300 monthly active users, or ≥ 20 feature requests a month, or the same request
  from ≥ 5 workspaces. Then Featurebase Free (or Fider self-hosted), seeded with the top 10 merged requests, linked
  from the account menu; the in-app form keeps working and files into the board via its API (to check).
- **Closing the loop:** when a request moves to `done`, every requester (canonical + duplicates) gets one email from a
  template: "You asked for X. It's live: <link to changelog or page>." Optional in-app badge on "Your feedback".
  Won't-do gets a short reason. This is the step most teams skip and users remember.

## 4. Admin: Feedback inbox (`/admin/feedback`)

- List with filters: status (`new`, `triaged`, `planned`, `done`, `wont_do`, `duplicate`), type, tag, has screenshot,
  age. Default view: `new`, oldest first. Assignee is the owner (column exists for later).
- Detail: message, context, screenshot behind an audited "Show screenshot" (`admin_audit_log`, as decided for receipt
  photos), status, tags (free text, a short list: `ocr`, `export`, `mobile`, `billing`, `auth`…), internal note,
  `github_issue_url`.
- **GitHub link, with care:** the repo is **public**. "Create issue" opens a prefilled issue with our own summary and
  the feedback id only, never the user's message, email or screenshot.
- **Reply by email** via `@receipt-ocr/email` (Resend) with templates: Thanks/received, Need more detail, Fixed,
  Shipped your request, Won't do. Reply-To is `SUPPORT_EMAIL` so the thread continues in the owner's mailbox; the
  first reply sets `first_replied_at`. Resend Free's 100/day cap is shared with auth mail; move to Pro ($20) first.
- Metrics card: volume by type per week, median time to first reply, open `new` count and oldest age, share of
  requests closed with a notification.
- Spam and abuse: signed-in only (Turnstile not needed); `hitRateLimit` per user (5 per 10 min, 30 per day) and per
  workspace; banned users can't submit; message length caps; screenshots size- and type-checked on the server. Reuse
  the [readiness review](../reviews/2026-11-06-readiness.md) item 24 signals (ban, disposable-domain list if added).
  Public widget keeps its honeypot, Turnstile and IP limit, and can start writing rows too (`user_id` null).

## 5. "Your feedback" for users

Settings → Help and feedback → Your feedback: own submissions, newest first, with type, first line, status chip
(Received, Planned, Done, Won't do) and our replies (from the email we sent, stored as `admin_reply`). Internal notes
and tags never show. Workspace members see only their own items, not each other's.

## 6. Data model, retention, privacy, analytics

`feedback` (one table, migration after the baseline, RLS enabled like every table):

| Column                                                           | Type / note                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| id                                                               | uuid                                                                 |
| user_id, organization_id                                         | text, set null on delete (public widget rows: null)                  |
| email                                                            | text, from session or public form                                    |
| type                                                             | text check (`bug`, `idea`, `question`, `praise`)                     |
| message                                                          | text ≤ 2,000; content, never logged                                  |
| context                                                          | jsonb, allowlisted keys from the table in section 2                  |
| receipt_id                                                       | uuid null, on delete set null                                        |
| screenshot_key                                                   | text null                                                            |
| source                                                           | text (`menu`, `settings`, `receipt`, `error`, `milestone`, `public`) |
| status, tags `text[]`, assignee_id, internal_note                | triage                                                               |
| duplicate_of                                                     | uuid null → feedback.id                                              |
| github_issue_url, admin_reply                                    | text null                                                            |
| created_at, triaged_at, first_replied_at, closed_at, notified_at | timestamptz                                                          |

`feedback_votes (feedback_id, user_id, created_at)` only if we build in-app voting instead of buying a board; not in
the first phases. Prompt dismissals live in a tiny `user_prompts (user_id, prompt, dismissed_at)` or the user row.

Retention: delete screenshots 90 days after close; delete rows 24 months after close; on account deletion delete the
user's rows and screenshots (feedback is personal, not workspace-owned). Privacy page: extend "Messages" to cover
in-app feedback, screenshots, the attached context and retention; Terms: an optional line that ideas you send can be
used without obligation. Telemetry: `feedback.submit` wide event with `feedback.type`, `feedback.source`,
`feedback.has_screenshot` (all token/bool, no PII) added to `telemetry/schema.ts` and the PR field audit. Analytics:
counts only (volume by type and source, response times); no message text in PostHog or GA, ever.

## 7. Build vs buy, phases, estimates

Build the intake and inbox (they reuse the support panel, Resend, `hitRateLimit`, storage, the admin shell and the
Drawer); buy the public board later. Building voting, a roadmap page and a changelog ourselves is not worth it.

| Phase | Scope                                                                                                                                                                                                       | Estimate   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1     | `feedback` table + migration; core `Feedback` service; `POST /api/feedback`; Send feedback sheet in account menu, account sheet and Settings; context attach; `/api/contact` also writes rows; privacy text | 2 days     |
| 2     | `/admin/feedback` inbox: statuses, tags, duplicates, notes, GitHub link, reply templates via Resend, metrics card; "Your feedback" list                                                                     | 2 days     |
| 3     | Screenshot capture + redaction + storage + audited view; receipt-page and error-state entry points; milestone card                                                                                          | 1.5–2 days |
| 4     | "We shipped it" notifications on `done`; retention purge as a job kind                                                                                                                                      | 1 day      |
| 5     | At the trigger: Featurebase Free (or Fider) board, seeded, linked; in-app form syncs ideas                                                                                                                  | 1 day      |

## Open questions for the owner

1. Promise a reply time in the UI (two working days?) or just "We read every message"?
2. Public board trigger: 300 MAU / 20 requests a month OK? Featurebase (hosted, free) or Fider (self-hosted)?
3. Should the public support widget also write rows, so one inbox holds everything? (Recommended: yes.)
4. Screenshots in phase 3, or drop them and ask for "attach a photo of the problem" via upload only?
5. Milestone prompt at all, and at the 10th receipt?
6. Retention: 90 days for screenshots, 24 months for rows?
7. Move Resend to Pro ($20/mo) before replies and notifications go out?

## Sources not verified

- Linear's desktop Help menu and Vercel dashboard feedback entry: not found in official docs; only the support page
  and mobile Settings line were confirmed.
- Raycast's 2021 blog may be out of date; the manual now also names a public Featurebase board.
- Notion help pages disagree on where the support button sits (sidebar ? vs bottom-right AI icon).
- Pricing pages were read by a text extractor; per-plan feature checkmarks (Featurebase dedupe, changelog, widget)
  did not come through. Canny's monthly-billed Pro price and Productboard prices are not published.
- Whether GitHub Discussions supports upvotes in all categories, and whether Featurebase's API can file ideas from our
  form on the free plan.
- Fider's latest release date and its duplicate-merge feature.
