# Status and handoff

Where the project stands, what is in flight, and what needs a decision. Read this first when picking the work up on a
new machine; keep it current when something merges or a decision is made. Last updated 2026-11-08 (billing v1 in review).

How the system is built (every app and package, the main flows and the data model) is in
[architecture](architecture/README.md).

## Shipped to `main` (2026-11-06)

| PR            | What                                                                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #13           | Classic landing lab (`/final-classic`, noindex), SEO plumbing (site URL, robots, sitemap), Vercel `--archive=tgz` deploys                                                                                              |
| #17           | Redesigned sign-in, sign-up, verification, reset and invite flows                                                                                                                                                      |
| #18           | Signed-in app redesign; preview/mock-data flow removed; no-workspace state                                                                                                                                             |
| #19           | Security hardening: email escaping, workspace-name rules, trusted IP headers, hashed tokens, encrypted OAuth tokens, versioned secrets, receipt write policy                                                           |
| #20           | UI foundations: design tokens, Alert/Field, history and members split                                                                                                                                                  |
| #21           | Admin panel: overview, users, workspaces, audit log, settings (plan limits, OCR model chain); migration `0006`                                                                                                         |
| #22           | Receipt completion guarded by attempt; OCR loads receipts by id                                                                                                                                                        |
| #23           | [Deployment guide](deployment.md)                                                                                                                                                                                      |
| #24           | Default model `gemini-3.8-flash`, `gemini-3.5-flash-lite` offered (`gemini-3.7-flash` doesn't exist)                                                                                                                   |
| #25           | Photos shrunk and re-encoded in the browser (fixes Vercel 4.5 MB 413s, strips camera metadata); PDFs accepted                                                                                                          |
| #26, #28      | Handoff docs: this page, plans and reviews; parser/benchmark/open-model survey                                                                                                                                         |
| #27           | OCR usage ledger: `ocr_rounds` + `ocr_calls` with per-call tokens, cost and latency; quota counted from the ledger under a per-user lock (deletes no longer refund; first 5 failed reads a day free); migration `0007` |
| #29, #30, #33 | Status updates, working principles, Next.js/React/shadcn reviews, job queue plan, security audit                                                                                                                       |
| #31           | Streaming app pages, fewer client auth fetches, polling paused while hidden, lab pages hidden in production, skip link, global error page                                                                              |
| #32           | Better Auth mitigations: exact workspace roles (GHSA-c85h), cookie cache off (revoked sessions stop at once), manual deploy runs only from `main`                                                                      |
| #34           | [Architecture guide](architecture/README.md) with per-package pages, flows and diagrams                                                                                                                                |
| #35           | Optional Cloudflare Turnstile on sign-up, sign-in, password reset, resend verification and the support form, with hostname pinning                                                                                     |
| #36           | UX sweep: honest landing copy, no sideways scroll at 390 px, quota wording that matches the ledger                                                                                                                     |
| #37           | Postgres job queue: `jobs` table, leases, retries with backoff, per-user fairness, provider cooldowns; uploads and retries run through it in `after()` ([flow](architecture/flows/jobs.md)); migration `0008`          |
| #38           | Hardening: session check before the upload body, PDF page cap, per-email auth limits, CSP reports, health endpoints, SECURITY.md, [runbook](runbook.md)                                                                |
| #40           | Load test suite on a 1 vCPU / 1 GB server (`scripts/load.sh`, manual `load.yml`); [results](../packages/bench/results/load-2026-11-06.md)                                                                              |

## Shipped to `main` (2026-11-07)

Every PR merged 2026-11-07 (plus #42 and #44 from 2026-11-06), by number. Details are in each PR and in the
[architecture](architecture/README.md) pages.

| PR   | What                                                                               |
| ---- | ---------------------------------------------------------------------------------- |
| #41  | Close five PDF page-count evasions                                                 |
| #42  | Size-target image encoder                                                          |
| #43  | Installable PWA with offline fallback and Android share target                     |
| #44  | Currencies and FX conversion plan                                                  |
| #45  | Three-decimal currencies in the extraction prompt                                  |
| #46  | Phone app shell (tab bar with Scan, app bar with Back, sheets)                     |
| #47  | In-app camera, review step and batch upload                                        |
| #48  | Receipt groups                                                                     |
| #49  | Spending dashboard on Home                                                         |
| #51  | Operations page and jobs view                                                      |
| #52  | Wide events with one schema, allowlist and tail sampling                           |
| #53  | Cookie consent and privacy-respecting analytics                                    |
| #54  | Faster public pages and per-page SEO metadata                                      |
| #55  | Manual database migrations, deploy gate, preview sign-in on staging                |
| #56  | Fix the between-retries quota test flake                                           |
| #57  | Squash migrations into a baseline with row-level security on every table           |
| #58  | Reorganise the env examples                                                        |
| #59  | Anthropic Claude as a second OCR provider                                          |
| #60  | Add an all-rights-reserved license                                                 |
| #61  | Fewer Vercel previews, faster CI, hydration-safe auth e2e                          |
| #62  | Real receipt benchmark set and long-receipt capture plans                          |
| #63  | Product idea review for receipt review state and flagging                          |
| #64  | Real receipt fixtures (CORD, Wikimedia Commons)                                    |
| #65  | Plan for a read-only MCP server                                                    |
| #66  | Release-based deploys and self-hosting, for later                                  |
| #67  | Find the last deploy from workflow runs, stop moving a git tag                     |
| #68  | Step-by-step Vercel environment setup                                              |
| #69  | Plan for bring your own AI key and storage                                         |
| #70  | Check connections panel                                                            |
| #71  | Preview environment keys and R2 CORS guidance                                      |
| #72  | Plan for in-app feedback and feature requests                                      |
| #73  | Show which model reads your receipts                                               |
| #74  | Security hardening and incident readiness plan                                     |
| #75  | Run the M1 quota tests with one attempt per failed read                            |
| #76  | Production-environment.md, sign-in clients per environment                         |
| #77  | Fixed preview domain from the preview branch                                       |
| #78  | Redact secret shapes from telemetry, hash and bound client caches                  |
| #79  | Default Reply-To to SUPPORT_EMAIL                                                  |
| #80  | Label-only previews until launch                                                   |
| #81  | Turnstile setup for Preview                                                        |
| #82  | Edge-cache healthy health checks                                                   |
| #83  | Consistent answer-key format for the real fixtures                                 |
| #84  | Gemini Flash-Lite 400 on every call (maxItems in response schema)                  |
| #85  | Results on 31 real receipts (five models)                                          |
| #86  | Dual-calendar (AD and Bikram Sambat) receipt dates                                 |
| #87  | Extraction prompt v2, proven with a v1/v2 benchmark A/B                            |
| #88  | Show the in-app camera only on touch devices                                       |
| #89  | Rename workspace Admin role to Manager, clearer descriptions                       |
| #90  | Upgrade Better Auth to 1.7.18 (security fixes)                                     |
| #91  | Branded, light/dark-safe emails, prerendered from React Email at build time        |
| #92  | Confirm account deletion by email, step-up for sensitive changes, password notices |
| #93  | Default to Claude Sonnet 5.5, with Gemini as fallback                              |
| #94  | Payment provider research for a Nepal-based seller                                 |
| #96  | Cron-driven queue drain route and worker loop                                      |
| #97  | UX decisions for mobile nav, install prompt, name and push                         |
| #98  | Smoother tab navigation and a centred Scan tab                                     |
| #99  | Two-step review with a filtered preview, loupe and stable layout                   |
| #100 | Scan line mark, masters and asset generator                                        |
| #101 | IOS startup images and maker credit in footer and settings                         |
| #102 | Scope vercel alias set to the team                                                 |
| #103 | Index only the production host, llms.txt, richer structured data                   |
| #104 | Deploy a labelled preview once, skip production deploys that ship nothing          |
| #105 | BYOK admin controls, limits and states                                             |
| #106 | Add Groq as an OCR provider (Qwen 3.8 27B vision)                                  |
| #107 | Two-tier OCR (LiteParse, OCRia-1) and what fits receipts                           |
| #108 | Spell it ReceiptOCR and say scanned                                                |
| #109 | Make the concurrent drain tests race-free                                          |
| #110 | Add OpenAI as an OCR provider                                                      |

## Migrations squashed (2026-11-07, again 2026-11-08)

Pre-launch, all migrations `0000`-`0010` were squashed into one `0000_baseline` that also enables row-level security on
every table (no policies; the app role bypasses it, so it is defence in depth for Supabase's Data API). On 2026-11-08
the four files since then (`0000`-`0003`) were squashed again into a new `0000_baseline`; its schema dump matches the
old files' on Postgres 17 and 18 apart from column order in two tables. Both databases hold only test data and get
reset. **From the first real user onward we never squash again.** Details:
[data layer](architecture/db.md#migrations).

## Production to-dos (owner)

Steps are in [deployment.md](deployment.md).

- Reset `staging-db` and `production-db` with the 2026-11-08 SQL (23 tables, two enum types, the `drizzle`
  bookkeeping schema; [release note](deployment.md#squashed-baseline-again-2026-11-08), not `DROP SCHEMA public`),
  run **Database Migration** on `staging-db`, then `production-db` (owner approves), then deploy by hand. This applies
  the squashed baseline with row-level security. Then check the **RLS enabled** badge in the Supabase dashboard and remove `public` from the
  Data API's exposed schemas ([deployment.md](deployment.md#release-notes)).
- Queue drain: done 2026-11-08. A new `CRON_SECRET` is in Vercel and in Supabase Vault (`cron_secret`); pg_cron job
  `drain-jobs` calls `/api/jobs/drain` every 5 minutes ([step 8](production-environment.md#8-queue-drain-cron)). Check
  `net._http_response` for 200s after the next deploy.
- Production deploys automatically after CI passes on a push to `main`. Manual runs are allowed only from `main`.
  Once `ci/db-migrations` lands, the automatic deploy skips any release that changes `apps/web/drizzle/` since the
  last successful production deploy run; migrations run only by hand (**Database Migration**: `staging-db`, then `production-db`
  with the owner's approval), then the deploy is run by hand. Production and staging are reset to the squashed baseline.
- `staging-db` and `production-db` exist (`main` only, `DIRECT_URL` set, required reviewer on `production-db`).
  Still to do for `ci/db-migrations`: point Vercel's Preview variables at `receipt-ocr-staging`, leave
  `BETTER_AUTH_URL` unset there and turn on Deployment Protection for previews
  ([deployment.md](deployment.md#staging-and-previews)). After merging, once: run **Database Migration** for
  `staging-db`, then `production-db` (applies the baseline), then **Vercel Production Deployment** by hand. Manual
  deploys need a successful `production-db` run with the same migrations. The automatic gate compares with the last
  run of the workflow on `main` whose `deploy-production` job succeeded; CI creates no git tags (tags are for real
  releases, later).
- `vercel` environment (review P2-1): previews and production share it, so the same `VERCEL_TOKEN`, which can deploy
  to production, reaches same-repo PR runs; it can't get a `main`-only policy without breaking previews. Mitigations:
  every production secret is stored as Vercel Sensitive (`vercel pull` can't read them back), and the repository has
  no outside collaborators. The full fix is a separate Vercel project for previews, with its own token.
- Keep every new production secret Sensitive in Vercel; the build tolerates their placeholders. The auth secret was
  replaced on 2026-11-08 (only `BETTER_AUTH_SECRET`; keep its copy in a password manager).
- Set `OCR_DAILY_CAP` in production as a spend guard.
- Billing v1 (in review, #143). Before it can take money, in this order:
  1. Run **Database Migration** (`staging-db`, then `production-db`) before deploying; the release adds `billing_events`,
     `billing_subscriptions` and `ocr_rounds.plan`, and replaces `ocr_rounds_organization_id_idx` (migration
     `0001_billing`, on top of the squashed baseline).
  2. Add the six `PADDLE_*` variables (sandbox first) and the webhook destination, including the `adjustment.*` events
     ([step 10](production-environment.md#10-payments-paddle)); redeploy so the CSP picks up the client token. Only
     `PADDLE_API_KEY` and `PADDLE_WEBHOOK_SECRET` are Sensitive: the other four are read at build time, when `vercel
pull` returns Sensitive values empty. `PADDLE_ENV` must match the account the secrets come from.
  3. Set `OCR_DAILY_CAP` to about 1000 (the all-plans fuse; the Free pool is 300 a day).
  4. Test a sandbox checkout, then submit Paddle's website review once `/pricing` and `/refunds` are live, finish live
     account verification, and switch to live values ([10c](production-environment.md#10c-switch-from-sandbox-to-live)).
  5. Not built yet: scan packs ([where they fit](architecture/flows/billing.md#how-scan-packs-will-fit)).
  6. Commitment: before any Pro price change, email current subscribers ahead of their next renewal at the new price,
     and keep the old price id in `PADDLE_PRICE_PRO_LEGACY` ([runbook](architecture/flows/billing.md#runbook)). There is
     no automated email for this yet.
- Vercel env: `SUPPORT_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`.
- Standing decisions and dated reminders: [decisions.md](decisions.md).
- The production Gemini key must belong to a paid Google project (free-tier content can be used by Google).
- If an admin saved an OCR chain naming `gemini-3.7-flash`, re-save it in Admin → Settings.
- `EMAIL_FROM` is `ReceiptOCR <noreply@receipt-ocr.bhimraj.com.np>` (set 2026-11-08). `GROQ_API_KEY` is set for Production and Preview (2026-11-08).
- Groq: enable Zero Data Retention in the Groq org's Data Controls before adding `GROQ_API_KEY`; without it Groq may
  keep inputs and outputs for up to 30 days, and the privacy policy says it does not ([deployment.md](deployment.md)).
- OpenAI: requests are kept up to 30 days for abuse monitoring; zero data retention needs OpenAI's approval. The
  privacy policy names OpenAI as an opt-in processor, so add `OPENAI_API_KEY` knowingly ([ai.md](architecture/ai.md#openai)).
- `receipt-ocr.vercel.app` belongs to another Vercel project, so it is not this app's URL; use the project's own
  `*.vercel.app` URL or the custom domain (the production host is `receipt-ocr.bhimraj.com.np`).
- After 2026-11-12, delete `minimumReleaseAgeExcludes` from `bunfig.toml`: it exempts Better Auth 1.7.18 (#90, security
  fixes and passkeys) from the 7-day cooldown, approved on 2026-11-07, and 1.7.18 clears the cooldown by then.

## In flight

Open pull requests only.

| PR   | Work                                                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #148 | SEO: home title leads with "receipt scanner" and names CSV and JSON (never Excel; nothing writes .xlsx); one source for the home title/description; WebApplication JSON-LD with featureList and the free Offer, no ratings |

Reviews from this round: [readiness audit](reviews/2026-11-06-readiness.md) (four lenses, ranked roadmap),
[Midday study](reviews/2026-11-06-midday-study.md), [UX sweep](reviews/2026-11-06-ux-sweep.md).

## Brand decisions (owner, 2026-11-07)

Logo: "Scan line" (receipt crossed by a bar that overshoots both edges; keep the overshoot in every drawing). Palette:
refined emerald (the current one; light-context tile `#047857` with a white glyph). Wordmark: `Receipt` + emerald
`OCR`, mono. Masters and the asset table: [`apps/web/brand/README.md`](../apps/web/brand/README.md); regenerate with
`bun run brand:assets`. Done: the name is spelled ReceiptOCR everywhere users see it (one constant, `SITE_NAME` in
`apps/web/lib/site.ts`; emails use `BRAND`), and copy says "scanned", not "read", where the app processes a receipt
(admin screens keep "reads" as operational jargon). "Receipt OCR" stays only as the category phrase in descriptions.

## Decisions waiting on the owner

1. ~~Classic as the homepage (then delete `app/(lab)` and `components/marketing`)~~ Done: the lab landing variants are removed.
2. Plan limits: daily per user (today) or monthly per workspace; prices; payment provider. See
   [CEO](reviews/2026-11-06-ceo.md) and [market](reviews/2026-11-06-market.md) reviews.
3. Who sees estimated cost (recommended: platform admins only); whether customers see the model name; whether
   members see each other's usage; admin access to receipt photos (recommended: hidden, logged "Show photo").
4. Default OCR chain: decided 2026-11-08. Claude Haiku 5.5, then Gemini 3.5 Flash-Lite, then Qwen 3.8 27B on Groq; steps
   without an API key are skipped ([ai.md](architecture/ai.md#default-chain)). Groq zero data retention must be on first.
5. PostHog: server-only first (recommended) or browser too; Sentry tracing off; source-map upload approach.
6. Members: free seats 3 or 5, single owner + transfer, pending invites count. See
   [members plan](plans/2026-11-06-members-admin-plan.md).
7. Branch protection on `main` requiring CI.
8. BYOK tables (`user_credentials`, `storage_source`): keep or delete.
9. Usage ledger: retention period (suggested 13 months, then a purge job and a privacy-page line); whether the
   global cap needs a platform-wide lock (it can overshoot by the number of users uploading at the same moment).
10. ~~Passkeys and two-factor~~ Decided 2026-11-08: go for #95 and migration `0002`; a recent sign-in no longer
    counts as step-up, so users without a factor confirm with the emailed code. Still open: whether the everyday
    History CSV export needs step-up.
11. Currencies and conversion ([plan](plans/2026-11-06-currencies-fx.md)): home currency per workspace,
    `numeric(19,4)` amounts, Frankfurter as the only v1 rate source (self-host as the exit), backfill depth,
    which amounts are converted, sign-up default from country.
12. UX decisions ([plan](plans/2026-11-07-ux-decisions.md)): five-slot phone bar with centred Scan and Groups (no
    drawer), install offer after the first read with a snooze and an iOS 26 guide, the name spelled ReceiptOCR,
    push notifications deferred until batch capture data.

## Roadmap (order)

**Next up (ordered, 2026-11-08):** [plans/2026-11-08-next-up.md](plans/2026-11-08-next-up.md). The list below is the
longer-term roadmap.

From the [combined plan](plans/2026-11-06-combined-plan.md):

1. ~~Usage capture + quota ledger~~ (shipped in #27).
2. Usage surfaces for customers and admins ([usage design](plans/2026-11-06-usage-design.md)).
3. Observability: wide events (#52), then OTLP export to Axiom (#135), Sentry errors (#139) and server PostHog (#141), all
   off unless their env is set; provider privacy settings done 2026-11-08
   ([§9e](production-environment.md#9e-provider-privacy-and-alert-settings); its quota, alert and dashboard
   steps are still to do). Next: Sentry source maps (separate `sentry-cli`
   step); browser PostHog after a consent decision, which needs `instrumentation-client.ts`, an `/ingest` rewrite
   proxy with `skipTrailingSlashRedirect`, cookieless mode or consent, `identify`/`reset`, and
   `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`/`HOST`; PostHog `groupIdentify` for the workspace plan once billing lands
   ([observability](plans/2026-11-06-observability.md)) with the [security requirements](reviews/2026-11-06-security-plan.md).
4. Accuracy: arithmetic checks, low thinking, a real benchmark set, then Flash-Lite-first cascade
   ([extraction cost and accuracy](plans/2026-11-06-extraction-cost-accuracy.md)). No Docling/OCR-first pipeline.
   Benchmark set and engines to compare (Qwen3-VL-8B via an OpenAI-compatible host, LlamaExtract, Mistral OCR):
   [parsers landscape](plans/2026-11-06-parsers-landscape.md). LangChain, Reducto, Unstructured and OCR-to-markdown
   models: no.
   Real benchmark set (CORD/CORU committed, SROIE/ReceiptBench local, the owner's 40 Nepal receipts, BS-date and
   Devanagari scoring fixes): [receipt benchmark set](plans/2026-11-07-receipt-benchmark-set.md). Long receipts as
   multi-part receipts: [long receipt capture](plans/2026-11-07-long-receipt-capture.md).
   Two-tier OCR (LiteParse, OCRia-1, open-weight OCR models): cheap model first, escalate on arithmetic checks; no
   OCR-first parser ([two-tier OCR review](reviews/2026-11-07-two-tier-ocr.md)).
5. Providers: Anthropic, Groq and OpenAI are wired in (#59, #106, #110) and benchmarked (#85). Next: per-model options
   and limits on the model table, effort per step (#111), then key source (BYOK).
6. ~~Passkeys and two-factor~~ (#95): TOTP, backup codes, passkeys, step-up and admin enforcement.
7. Members, seats and per-workspace quota; monthly limits and billing after decisions.
   Payment provider for a Nepal-based seller: Paddle (MoR) first, Dodo fallback, Khalti/eSewa prepaid months for NPR
   later; no Stripe Atlas yet ([payments](plans/2026-11-07-payments.md), [NPR rails](plans/2026-11-07-payments-nepal.md)).
8. Load test: `scripts/load.sh` (by hand, and from `.github/workflows/load.yml` on demand) runs the production image on
   1 vCPU / 1 GB against k6; [`packages/bench/README.md`](../packages/bench/README.md#load-test-small-server). Re-run it after changes
   to the hot path and commit the new summary. Latest: reads hold 200/s; uploads hold 12/s and fail by 48/s since the job queue (ladder not yet filled in).
9. Product: landing claims, free no-signup tool, duplicate detection, per-currency totals, accounting exports.
   Currency honesty (no USD default, 3-decimal amounts) and conversion to a home currency:
   [currencies and FX](plans/2026-11-06-currencies-fx.md).
10. Read-only agent access over MCP: personal tokens first, then OAuth for Claude.ai and ChatGPT ([MCP server](plans/2026-11-07-mcp-server.md)).
11. Bring your own AI key (Pro perk, maybe a capped Free on-ramp), then own storage (R2 first), on envelope
    encryption with rotation ([BYOK plan](plans/2026-11-07-byok.md)). After billing.
12. Security and incident readiness: owner MFA and secrets out of the Codespace, the 2026-11-10 upgrades, backups, admin kill switches with break-glass, a status page, abuse rules ([plan](plans/2026-11-07-security-incident-readiness.md)).
13. In-app feedback: "Send feedback" in the account menu and Settings, "Your feedback" list, admin inbox with email
    replies; public board later ([feedback and requests](plans/2026-11-07-feedback-and-requests.md)).
14. Dual-calendar dates: `receipt_date` as a real AD `date` (column, check and index landed in #127; the
    `receipt_date_check` column comes with the resolver), BS derived from a vendored month table, the model
    transcribes dates and code cross-checks AD against the Miti; BS display, `date_bs` CSV, Nepal fiscal-year
    presets ([dual-calendar dates](plans/2026-11-07-dual-calendar-dates.md)).

## Later, once the app is stable (owner notes, 2026-11-07)

- **Play Store app (Trusted Web Activity).** Wrap the PWA with Bubblewrap for a Play Store listing; its native
  splash should allow the Android 12+ bottom branding image ("A product by / BHIMRAJ YADAV"), which installed web
  apps can't show. Verify when building. Until then Android shows the icon only, the byline is iOS-only.
- **A distinctive product name before paid marketing.** "Receipt OCR" is the category's generic name: weak as a
  trademark and hard to find in search. Choose a distinctive name before spending on marketing, while renaming is
  still cheap ([UX decisions](plans/2026-11-07-ux-decisions.md)).
- **Release-based deploys.** Today every push to `main` deploys after CI (migrations by hand). Move to deploying
  tagged releases (for example `v0.x.y` with release notes), so `main` can take merges without each one going live.
- **Self-hosting.** Vercel's free (Hobby) plan is for non-commercial use and has hard monthly limits; a busy month or
  paying users outgrow it. The exit is already built: the Docker image (`docker/Dockerfile.prod`, Bun runtime), the
  compose stack and the 1 vCPU / 1 GB load test. Decide between Vercel Pro and a small VPS (plus managed Postgres and
  R2, which stay as they are) when traffic or billing makes it necessary.

## Known follow-ups

- The one-time "protect your receipts" card (after the fifth receipt) is dismissed with a per-browser cookie, so it
  shows once more on each new device. A per-user column (`user.security_prompt_dismissed_at`) needs a migration;
  fold it into the next schema change.
- The last-sign-in-method guard on `/unlink-account` reads, then Better Auth deletes: two disconnects sent at the same
  moment (Google and GitHub, no password or passkey) could both pass. Needs a lock on the user's account rows if it
  matters; the UI sends one at a time. Accepted (user-initiated, recoverable: Forgot password recreates a
  credential). The same read-then-delete applies to `/passkey/delete-passkey`. Recoverable because Better Auth
  1.7.18's `resetCredentialPassword` (`better-auth/dist/utils/password.mjs`, called by `/reset-password`) creates a
  `credential` account when the user has none; re-check that on every Better Auth upgrade, since the acceptance rests on
  it.
- Settings → Security shows a connected Google or GitHub account by its connection date only (the per-view
  `accountInfo` call to the provider was removed). Showing the address or username would mean storing it at link time.

- `/list-sessions` is an ungated read of the user's own sessions now that `freshAge` is 0 (Better Auth's freshness check
  was its only guard). Low: it shows a session thief the user's other devices; gate it with step-up if that matters.
- Sign-ins finished through `/two-factor/verify-totp` or `/two-factor/verify-backup-code` aren't in `isSignIn`
  (`lib/auth-two-factor.ts`), so a TOTP user's second sign-in from the same browser doesn't replace the earlier
  session. The password step clears the session cookie first, so the earlier token has to be carried through the
  challenge to find it.
- Database review items not done in the schema-fixes PR (#127): backups and a restore drill (H1), the
  `maintenance.purge` retention job and its `step_up_codes (expires_at)` index (H2, M5), revoking `anon` and
  `authenticated` grants and checking the Data API is off (H4), pool on `globalThis` and role-level timeouts (M3), the
  quota statement profile (M4), an `ocr_call_status` lookup table (M1), dropping `user_credentials` and
  `storage_source` with BYOK (M6, L5), trigram search and admin indexes when they slow down (L2, L3), lock ordering
  between admin re-run and user retry (L4).
- Step-up audit retention: `step_up_events` (with each check's IP) is kept until the account is deleted. Proposed: prune
  rows older than 90 days with a job kind in `packages/core/src/jobs` (there is no retention job yet), keeping the last
  pass and recent failures that the lockout reads; then update the privacy policy.

- Share target: a cross-site form can plant a share in a visitor's cache (the referrer can be hidden). The Keep and
  Discard prompt, the 10-minute expiry and the size caps are the guard.
- Encryption key rotation: re-encrypt job + per-version counts + split from the auth secret (see
  [BYOK plan](plans/2026-11-07-byok.md#9-key-rotation-and-encryption-at-rest)).
- FAQ uses a raw `<details>`; add a server-friendly Disclosure primitive to `packages/ui`.
- PDF page cap gaps: the hand-written page counter (`packages/core/src/pdf-pages.ts`) can undercount when the word
  `stream` sits inside a string or `/stream` is used as a name, when `endobj` sits inside a string, when comments sit
  inside a dictionary, and for encrypted object streams. The list is not exhaustive. The cap is a
  cost guard, not a security boundary: uploads are size-capped, the daily quota bounds total cost and the ledger
  records real tokens per call, so an outlier is visible. If abuse shows up, count with a real reader (pdf.js in a
  worker with a timeout) rather than parsing further by hand.
- Image shrinking (browser, `apps/web/lib/upload-prep.ts`): decode large photos at reduced size
  (`createImageBitmap` `resizeWidth`/`resizeHeight`, after reading the dimensions from the header) to cut peak memory
  on phones; and strip metadata on the server for files the browser couldn't decode or encode (for example HEIC
  outside Safari, or a canvas memory error), which still upload with their EXIF.
- Zod at every boundary: `PATCH /api/receipts/[id]` validates by hand and drops bad values; history/export query
  params, `apps/web/lib/env.ts` and customer forms should share Zod schemas (today Zod covers only the AI output
  schema, admin settings and admin actions).
- Bot protection: shipped, optional by env (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`). Turnstile guards
  sign-up, sign-in, password reset, resend confirmation (Better Auth `captcha` plugin) and `/api/contact`.
  `scripts/test.sh --turnstile` and the CI job "E2E (Turnstile test keys)" run its e2e with Cloudflare test keys.
- Contact-form auto-reply (`email.contact-reply` job, 1 per address and 3 per IP a day): the job's `scrubPayload` empties
  the address and first name once it succeeds or dies. The reply promises an answer "usually within 2 business
  days": owner to confirm or change that number.
- Best-practice reviews ([Next.js](reviews/2026-11-06-nextjs.md), [React](reviews/2026-11-06-react.md),
  [shadcn/UI](reviews/2026-11-06-shadcn-ui.md)): quick wins in progress; later, shared primitives (Spinner, Meter,
  Checkbox, Avatar, Empty, Pagination), Button aligned with base-nova, one form system on `Field`.
- Admin Settings shows "Last saved by…" for a saved OCR chain that was discarded as invalid.
- HEIC conversion untested (no fixture or Safari in CI); add a WebKit e2e project later.
- Better Auth: verify the OAuth callback turns a banned user into `?error=BANNED_USER`.
- Better Auth 1.7.18 (#90): `runInBackgroundOrAwait` now logs and drops errors thrown in email callbacks
  (`sendResetPassword`, `sendVerificationEmail`, `sendDeleteAccountVerification`, `sendChangeEmailConfirmation`), so
  `deliver()`'s "undelivered fails the request in production" no longer holds there: the user is told to check their
  inbox anyway. Refusals that must reach the user (sole owner, per-address caps for deletion and email change) run in
  `hooks.before` instead. Decide whether to surface delivery failures some other way.
- Settings → Delete account: in the type-your-email confirm dialog, Tab can move focus out while the confirm button
  is disabled (Base UI focus guards with a disabled last button; not reproduced locally).
- Account deletion grace period: soft-delete for 7 days with an undo link before the data goes (today the emailed
  link deletes at once).
- E2E for account deletion and email change: the e2e harness doesn't capture email yet (the dev mail log only goes to
  the server's stdout), so these flows are covered by `apps/web/lib/step-up.int.test.ts` only.
- Email change: the new address gets the sign-up wording ("finish setting up your account") from
  `verificationEmail`; and an unverified account's old address gets no notice (Better Auth skips the approval step).
- Delete `apps/web/lib/receipt-permissions.ts` in favour of one permission map in core.
- Benchmark: results are committed for 31 real receipts ([2026-11-07-real](../packages/bench/results/2026-11-07-real.md)); the Nepal set is still small, and the arithmetic-checks cascade (`--cascade`) does not exist yet.
- Load test findings (after #37): upload capacity on the small server fell from 64/s to between 12/s (holds) and
  48/s (fails: end-to-end p95 17 s, Postgres CPU 87%). The quota count (`ocr_rounds` per user, per page and twice per
  upload) is still the top Postgres statement, with the job queue queries next. Next: a performance track that fills
  in the 24/36/48 ladder after #38, profiles both, replaces the quota count with something cheaper, and runs a
  30-minute soak. The app also holds up to 10 connections against a pool max of 5. Pages emit `page.render` events
  from #52 on.

- Perf/SEO follow-ups from [the audit](reviews/2026-11-06-perf-seo.md) on files other tracks own: root layout
  preloads DM Sans with the `opsz` axis (62 KB) and JetBrains Mono (40 KB) on every page, and its `openGraph.url: "/"`
  and 179-char description reach pages without their own metadata (PWA track); receipt page `<img>` has no
  width/height and its `dl` wraps `dt`/`dd` in extra divs, and the history search box is the LCP element after
  hydration (mobile shell track).

## How to resume on another machine

1. `git clone`, `bun install --frozen-lockfile`, then follow the [README](../README.md) local setup.
2. Tests the way CI runs them: `scripts/test.sh` (compose Postgres on 5433 + RustFS on 9000, fresh test database,
   unit + Playwright e2e). Integration suites: `bun run --filter @receipt-ocr/core test:int` and `--filter @receipt-ocr/web test:int` against a throwaway database.
3. Conventions:
   - One worktree per track next to the repo (`git worktree add ../receipt-ocr-<track> -b <branch> origin/main`);
     remove it after merge.
   - Squash-merge every PR. For stacked PRs, update each child with merge commits only (no rebase or force push):
     merge the parent branch, then `git merge -s ours <parent squash commit>` after checking the trees match, then
     `git merge origin/main`. GitHub stacks need the async merge endpoint (`PUT …/pulls/{n}/merge-async`).
   - Every PR gets an independent review before merge; fix P0/P1 first.
   - Dependencies: exact pins, ≥7 days old (`bunfig.toml` cooldown), `bun run check:deps`.
   - PR descriptions start with "What does this PR do?".
4. Plans live in `docs/plans/`, reviews in `docs/reviews/`, dated. Add new ones there rather than in local notes.
