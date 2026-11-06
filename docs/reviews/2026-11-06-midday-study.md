# Midday as a reference for Receipt OCR (2026-11-06)

A study of [midday-ai/midday](https://github.com/midday-ai/midday) to decide what to adopt, improve on, or skip. Read
via the GitHub API and raw files at commit
[`51587319`](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7) (latest on `main`,
2026-06-13). File links below point at that commit.

**Ground rule:** patterns and ideas only. No Midday code is copied into this repo; every adopted idea gets our own
design that fits Effect services, Better Auth, Drizzle and the AI SDK. Their `apps/worker` and `packages/workbench` are
already covered in [jobs queue](../plans/2026-11-06-jobs-queue.md) section 3 and are not repeated here.

## Status of the project (confirmed)

- **License: AGPL-3.0.** GitHub reports `AGPL-3.0`; [`LICENSE`](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/LICENSE)
  is the GNU AGPL, "Copyright (c) 2023-present Midday Labs AB". The README adds that commercial use needs a separate
  license from them. Copying code into a hosted product would trigger AGPL source-offer duties, so ideas only.
- **Winding down: confirmed.** Commit [`4420ce4b`](https://github.com/midday-ai/midday/commit/4420ce4bb6c34e252c70e7eb0cdb76dda43cf9d0)
  (2026-05-07, "wip (#887)") contains "chore: wind down Midday over 90 days, joining Ramp": pricing removed, trial and
  plan gating removed, sunset banners. The last commit, [`51587319`](https://github.com/midday-ai/midday/commit/51587319f26a0ffaa9dfccab1920373cb65689b7)
  (2026-06-13), disables checkout and adds a bulk Polar cancellation script. On 2026-05-07 CI `validate` and eval jobs
  were set to `if: false`. The repo is not archived, but treat it as frozen: no fixes, no security updates, and parts of
  it (Trigger.dev jobs alongside BullMQ, README listing Expo with no mobile app in the tree) are mid-migration.

## The most valuable lessons

1. **Two kinds of failure, and nothing stays stuck.** Midday separates a hard failure (file missing, storage error:
   red, "Retry processing") from a soft one (file is fine, the AI read failed: amber, "Retry reading"), and treats
   anything pending for more than 10 minutes as stale with a retry button
   ([document-processing.md](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/docs/document-processing.md)).
   We should make the same distinction in our receipt states, and detect stale rows on the server, not only in the
   browser as they do.
2. **Deterministic checks decide whether to escalate.** Their extraction engine scores each result (critical fields,
   field priorities, quality threshold 70), and only a poor score triggers a second pass with a stronger model and a
   different prompt, then targeted re-extraction of the missing fields, then arithmetic checks
   ([base-extraction-engine.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/documents/src/processors/base-extraction-engine.ts),
   [extraction-config.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/documents/src/config/extraction-config.ts)).
   This supports roadmap item 4 (cheap-first cascade). Our version should be simpler: one escalation step, and every
   pass recorded in `ocr_calls`.
3. **Flag arithmetic mismatches, never silently "fix" them.** Midday's
   [cross-field-validation.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/documents/src/utils/cross-field-validation.ts)
   overwrites `total_amount` with subtotal + tax when the gap is under 5%. On a receipt, the printed total is the
   source of truth, and a 4% gap is usually a missed tip or discount. We check the same equations but surface them as
   "fields to check" and keep what the model read.
4. **Tell the model who the customer is.** Their prompt factory takes the team's company name so the model can tell
   the vendor from the buyer
   ([prompts/factory.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/documents/src/prompts/factory.ts)).
   This costs a few tokens and fixes "merchant = my own company" on invoices addressed to the user. Run it on the
   benchmark before shipping.
5. **Forward-to-email is the capture channel users ask for.** Each team gets an inbox address; Postmark posts
   inbound mail to a webhook guarded by basic auth and an IP allowlist; attachments are filtered (images under 100 KB
   are dropped as logos, PDFs are kept), mail from their own domain is ignored to prevent loops, and Gmail's
   forwarding-confirmation email is relayed to the team so setup can finish
   ([webhooks/inbox/index.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/api/src/rest/routers/webhooks/inbox/index.ts),
   [utils.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/api/src/rest/routers/webhooks/inbox/utils.ts)).
   Worth building after the jobs queue, with stronger sender controls (see area 4).
6. **Golden datasets and read-only evals for every algorithm.** Matching has a curated golden set with captured scores
   ([golden-dataset.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/test/golden-dataset.ts))
   and an evaluation CLI that runs on production data inside `BEGIN TRANSACTION READ ONLY` with a statement timeout
   ([inbox-matching.md](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/docs/inbox-matching.md)).
   We need both: the benchmark's golden receipts, and a read-only script that measures field correction rates from
   users' edits.
7. **User corrections are labels.** Midday learns per-team aliases from confirmations and decayed penalties from
   declines, and calibrates thresholds per team. For us the equivalent signal is "which fields did the user edit after
   OCR". Record field-level edits now (ids and field names only) so accuracy can be measured on real traffic later.
8. **Typed URL state for filters, shared by server and client.** They declare filter params once with `nuqs` parsers
   and use the same schema in a server loader and a client hook
   ([use-inbox-filter-params.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/hooks/use-inbox-filter-params.ts)).
   Our history toolbar builds `URLSearchParams` by hand. One Zod (or nuqs) schema for history filters also closes the
   "Zod at every boundary" follow-up for query params.
9. **One typed event catalogue.** All analytics events live in one file with a name and channel
   ([events.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/events/src/events.ts)).
   Our observability plan already has an event catalogue; keep it typed and in one place. Do not copy their
   privacy posture (see area 8).
10. **Deploys check themselves.** Turbo `--affected` decides which services build and deploy, and after the API
    deploys, CI waits on `/health` and runs e2e smoke tests against production
    ([production.yml](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/.github/workflows/production.yml)).
    A post-deploy smoke test against our Vercel production URL is cheap and catches env mistakes like the ones in
    STATUS "Production to-dos".

## Area by area

Verdicts: **Adopt** (take the pattern, our own design), **Improve** (take the idea, do it better, says how),
**Skip** (says why). "Roadmap" refers to the numbered list in [STATUS.md](../STATUS.md).

### 1. Monorepo layout and package boundaries

**What they did.** 5 apps (`api` on Hono + tRPC, `dashboard` Next.js 16, `website`, `worker` on BullMQ, `desktop`
on Tauri) and 31 packages, most of them domain packages: `documents` (extraction), `inbox` (Gmail/Outlook OAuth
sync), `accounting`, `banking`, `invoice`, `import`, `plans`, `encryption`, `cache`, `logger`, `events`, `health`,
`job-client`, `notifications`. Queries live in `packages/db/src/queries/*` (40+ files), one per domain. The API and
the worker both import the same packages
([tree](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7/packages)).

**Verdict.**

- **Adopt** the split of a provider-neutral extraction package from orchestration. We already have it
  (`packages/ai` versus `packages/core`). Keep `packages/ai` free of DB and storage imports, as their `documents`
  package mostly is.
- **Adopt** small single-purpose packages only when a second consumer exists. When `apps/worker` arrives, `inbox`
  (email-in parsing) and `exports` are the likely next packages. Until then they belong in `packages/core`.
- **Improve** on queries scattered by domain in `packages/db`. Midday's db package mixes schema, queries, matching
  algorithms and eval scripts, so `db` became a second business-logic layer beside the API. Keep ours as is: schema
  and client in `packages/db`, queries in `packages/core` repositories behind Effect services.
- **Skip** a separate `apps/api`. Their Hono API exists because the dashboard, desktop app, MCP, bots and public REST
  all share it. Route handlers in `apps/web` are enough until there is a second client.

Roadmap: framing for jobs queue (worker) and item 8 (exports).

### 2. Tooling: Biome, Turbo, CI, release flow

**What they did.**

- Biome 2 for lint and format
  ([biome.json](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/biome.json)), with
  many rules off: five a11y rules, `useExhaustiveDependencies`, `noExplicitAny`, `noDangerouslySetInnerHtml`.
- Bun catalogs for shared versions, but with caret ranges, no release cooldown, `bun install` without
  `--frozen-lockfile` in CI, and an explicit `trustedDependencies` list for install scripts
  ([package.json](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/package.json),
  [setup action](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/.github/actions/setup/action.yml)).
- Turbo with `--affected` and `TURBO_SCM_BASE` to scope lint, typecheck, test and deploy. Remote cache through Vercel.
  `globalDependencies: ["**/.env"]` and a long `passThroughEnv` list
  ([turbo.json](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/turbo.json)).
- CI: `staging.yml` on every non-main push (deploys to one shared staging), `production.yml` on `main`, deploys to
  Railway and Vercel, Trigger.dev deploy, post-deploy e2e. Actions pinned by tag (`@v4`), not SHA. Validation
  currently disabled. Desktop releases by manual `workflow_dispatch` reading the version from `Cargo.toml`.
- No changesets, no semver for the web apps; `main` is the release.

**Verdict.**

- **Skip** a move to Biome. ESLint + `eslint-config-next` gives us the Next and React hooks rules and a11y rules that
  Midday had to switch off. Prettier and ESLint are not our bottleneck. Revisit only if lint time exceeds a minute.
- **Skip** caret catalogs and unfrozen installs. Our exact pins, 7-day cooldown, frozen lockfile and SHA-pinned
  actions are stricter and correct. **Adopt** Bun catalogs later, but with exact versions, once `apps/worker` and
  `apps/web` need the same `ai`, `effect` and `zod` versions.
- **Adopt** `trustedDependencies` as an explicit allowlist if any dependency needs an install script (sharp, for
  example), so the exception is reviewed in a diff.
- **Adopt** `turbo --affected` only when CI time hurts. With one app it saves little.
- **Adopt** a post-deploy smoke job in our `production.yml`: wait for a `/api/health` route, then run a few read-only
  Playwright checks (landing renders, sign-in page renders, health reports DB and storage OK). Midday's health
  [probe registry](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/health/src/registry.ts)
  is a good shape: named probes with timeouts, critical versus optional.
- **Skip** disabling validation to keep deploys flowing. Their wind-down shows how fast "temporarily" becomes
  permanent. Our STATUS decision 8 (branch protection requiring CI) is the right fix.

Roadmap: decision 8; observability item 3 (health route doubles as uptime check).

### 3. UI system and dashboard UX

**What they did.**

- `packages/ui`: shadcn on Radix, Tailwind v3 config, plus app-specific pieces (currency input, date range picker,
  editor, combobox, plan cards) and about 20 marketing animations
  ([ui src](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/ui/src/components)).
- Tables on TanStack Table + TanStack Virtual, data via tRPC + React Query, client state in Zustand.
- Filters in the URL via `nuqs` with typed parsers and a server loader; filter state is also persisted.
- A command menu on `cmdk` ("Type a command or search...") that mixes navigation actions with global search results,
  with a debounce that grows for multi-word queries
  ([search.tsx](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/search/search.tsx)).
- Keyboard shortcuts with `react-hotkeys-hook`, for example toggling review status and moving to the next row in the
  transaction sheet
  ([transaction-shortcuts.tsx](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/transaction-shortcuts.tsx)).
- Empty states split into "nothing yet" (title, description, one action) and "no results" (clear filters)
  ([tables/core/empty-states.tsx](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/tables/core/empty-states.tsx)),
  plus a connected-but-empty inbox state that says when the next check happens
  ([inbox-empty.tsx](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/inbox/inbox-empty.tsx)).
- Onboarding as numbered steps (name, team, bank, inbox, reconciliation, chat), tracked as analytics events
  ([onboarding steps](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/components/onboarding/steps)).

**Verdict.**

- **Adopt** the two empty states as one `Empty` primitive in `packages/ui` (it is on our follow-ups list), with a
  "no results" variant that clears filters. Use tokens, not their hard-coded `text-[#606060]`.
- **Adopt** typed URL filter state with one schema used by both `app/app/history/page.tsx` and `history-toolbar.tsx`.
  A Zod schema plus a small helper is enough; `nuqs` is optional and would be a new dependency to vet.
- **Adopt** a review flow with shortcuts in the receipt view: `J`/`K` for next and previous receipt, `E` to edit,
  `Enter` to mark reviewed and move to the next one that needs review. Users clearing a backlog of "needs review"
  receipts get the most from this. Show the shortcuts in a `?` dialog. Write the handler ourselves (one `keydown`
  listener that ignores inputs) before adding a dependency.
- **Improve** on the command menu: build it when there are more than about 6 destinations. Base UI has no command
  primitive, so it would be `cmdk` or our own combobox. Search receipts by merchant and amount, plus jump-to actions.
- **Skip** marketing animations in `packages/ui`. Keep `packages/ui` for primitives only; marketing belongs to
  `apps/web` (and most of it goes away with the lab, decision 2).
- **Skip** Zustand and React Query for now. Server components plus a small poller cover our screens.
- **Improve** on onboarding: ours needs one step, "upload your first receipt" (or "forward one" once email-in
  exists), with a sample receipt for people who have none at hand. Track step events through the telemetry interface.

Roadmap: follow-ups (Empty primitive, Zod for query params), item 2 (usage surfaces use the same empty states),
item 8 (product).

### 4. Receipts and document capture

**What they did.**

- **Inbox** as the receipt landing zone with statuses `new -> analyzing -> pending -> suggested_match / done /
  no_match` ([inbox-matching.md](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/docs/inbox-matching.md)).
- **Capture channels:** upload, forward-to-address (Postmark inbound), Gmail/Outlook OAuth sync of PDF attachments
  ([packages/inbox](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/inbox/README.md)),
  plus WhatsApp, Telegram, Slack and iMessage (Sendblue) bots, and a sender blocklist by email or domain.
- **Dedupe at the source:** `reference_id` (provider message plus attachment id) skips re-imports;
  `grouped_inbox_id` groups the same document arriving twice.
- **Extraction** (`packages/documents`): Zod schema with long `.describe()` hints, `document_type` classified first
  (`invoice | receipt | other`, where "other" leaves amounts null), primary Mistral Small, then Gemini 3 Flash, then
  Gemini 3 Pro; four passes (extract, chain-of-thought re-extract and confidence-weighted merge, per-field
  re-extraction, cross-field fixes); a PDF text-extraction fallback on timeout; website inferred from the email
  domain ([schema.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/documents/src/schema.ts),
  [merging.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/documents/src/utils/merging.ts),
  [validation.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/documents/src/utils/validation.ts)).
- **Image prep** server-side with sharp: EXIF rotate, fit inside 2048 px, HEIC through sharp then `heic-convert` as a
  fallback.
- **Matching to bank transactions** by a deterministic scorer (name, amount, currency, date), `pg_trgm` candidate
  retrieval, per-team calibrated thresholds, alias memory and decayed negative memory, conservative auto-match.
  They dropped their earlier embedding-based matcher as harder to debug and more expensive.

**Verdict.**

- **Adopt** `document_type` with an "other" class. Today a non-receipt (a menu, a screenshot) gets a forced read.
  An "other" result should not count against quota after the first few a day (as with our free failed reads) and
  should show "this doesn't look like a receipt".
- **Adopt** the vendor-versus-buyer hint: pass the workspace name to the prompt (lesson 4).
- **Improve** on the four-pass engine. A hard receipt can take many calls (a three-model cascade with retries, a second full read, then one call
  per missing field), and the engine does not record per-call tokens or cost. Ours: pass 1 on the cheap model; if deterministic checks fail or a required
  field is missing, one escalation call on the stronger model with the check results in the prompt ("the items sum to
  41.50 but the total reads 4.15"); pick the result that passes more checks, never a field-by-field merge of two
  reads. Each call is an `ocr_calls` row with its `step`. This is roadmap item 4 as planned, now with evidence that a
  production product converged on the same shape.
- **Improve** on cross-field fixes (lesson 3): show, never overwrite.
- **Adopt** email-in, after the jobs queue, as `<token>@in.<our domain>`:
  - an unguessable per-workspace token (not a short id), rotatable from Settings;
  - by default only accept senders that are verified emails of workspace members, with an opt-in "accept from
    anyone" for forwarding rules (Midday accepts any sender and relies on a blocklist);
  - a signed webhook (Resend inbound, Postmark, or Cloudflare Email Workers since we are on Cloudflare), not an IP list;
  - their attachment rules (drop tiny images, keep PDFs, cap count and size), loop protection, and relaying the
    Gmail forwarding confirmation;
  - the provider `Message-ID` plus attachment index as the dedupe key;
  - quota counts per receipt read, exactly as uploads.
- **Adopt** duplicate detection in two layers, matching our plan item 7: a SHA-256 of the bytes (exact) and a fuzzy
  match on merchant, date and total. Like Midday's `grouped_inbox_id`, group duplicates and ask, don't delete.
- **Skip** Gmail/Outlook OAuth mailbox sync. It needs restricted Google scopes (a security assessment) and token
  storage. Forwarding rules get most of the value.
- **Skip** chat bots for capture. Our mobile answer is a PWA with camera and share target (area 10).
- **Skip** bank transaction matching. We have no transactions. If accounting sync arrives, the lesson that stands is
  theirs: a deterministic, explainable scorer with a golden set beats embeddings.
- Server-side image prep: already done client-side (#25). **Adopt** their HEIC fallback idea only if the WebKit e2e
  shows conversion failures.

Roadmap: item 4 (accuracy and cascade), item 8 (duplicate detection), a new item after the jobs queue (email-in).

### 5. Accuracy handling

**What they did.** A 0-100 quality score with fixed deductions for missing critical fields and invalid values
(currency code, date range, amount sign, tax rate range); a confidence number per extraction used to weight merges;
stored `processingStatus`; an amber UI state for "completed but unclassified"; golden datasets for matching only.
There is no golden set or eval for receipt extraction in the tree; their evals cover matching and the assistant's
tool selection
([apps/api/evals](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/api/evals)).

**Verdict.**

- **Adopt** validators as small pure functions (valid ISO 4217, date not in the future and not before 2000, amounts
  non-negative, tax rate 0 to 30%, currency magnitude) that feed both "needs review" and escalation. They belong in
  `packages/core`, unit-tested, next to the arithmetic checks.
- **Improve** on their confidence: theirs is computed from the same rules as the score, so it adds nothing. Ours:
  checks pass or fail per field, and the UI lists which fields to check. A single number is for admins only.
- **Improve** on their eval coverage: a golden receipt set with expected field values in `bench/`, scored per field,
  run on every model or prompt change (roadmap item 4 already lists 20 to 30 real receipts). Add a no-network CI
  test that replays recorded model outputs through the checks so a validator change can't silently move results.

Roadmap: item 4.

### 6. Data layer

**What they did.**

- Drizzle schema with Supabase `pgPolicy` RLS policies (111 of them), but the API and worker connect with a direct
  Postgres role through Drizzle, so team scoping is done in the app: a tRPC middleware resolves the user's current
  team and every query takes `teamId`
  ([team-permission.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/api/src/trpc/middleware/team-permission.ts),
  [schema.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/schema.ts)).
  Some policies, on shared lookup tables, are `using: true` for any authenticated user.
- Migrations: the drizzle journal has only `0000`; `0001` to `0038` are hand-written SQL files applied outside
  `drizzle-kit migrate`, with duplicate numbers (two `0010`, two `0011`, two `0012`, two `0013`)
  ([migrations](https://github.com/midday-ai/midday/tree/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/migrations)).
- Read replicas in 3 regions with `withReplicas`, plus a "primary read after write" middleware so a user reads their
  own write; Supavisor in transaction mode, documented in
  [database-connection-pooling.md](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/docs/database-connection-pooling.md)
  (which also sets `ssl.rejectUnauthorized: false`).
- In-flight query dedupe per DB instance
  ([dedupe.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/utils/dedupe.ts)).
- Redis caches for team membership (30-minute TTL, explicit invalidation), API keys, permissions.
- Search: generated FTS columns, `pg_trgm` indexes, prefix-matching `tsquery` builder, and SQL functions
  `global_search` and `global_semantic_search`
  ([search.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/queries/search.ts)).
- A test database in Docker on tmpfs, schema pushed with `drizzle-kit push`, truncation between tests.

**Verdict.**

- **Skip** RLS as a second, partial enforcement layer. Policies that the app's connection bypasses give a false sense
  of safety. Keep one enforcement point: scope in `packages/core` repositories (`ReceiptScope`), tested by
  integration tests that try cross-workspace access. If RLS is ever added, the app must connect as a non-bypass role
  with the workspace id set per transaction, or it adds nothing.
- **Skip** hand-applied migrations. Our generated, journaled `drizzle-kit` migrations are better. **Adopt** a CI
  check that the journal matches the files and that two migrations never share a number (cheap insurance for
  stacked PRs, which already need `0008`/`0009` coordination).
- **Skip** replicas and Redis membership caches. One region, and a 30-minute cache on "is this user still a member"
  means a removed member keeps access for up to 30 minutes unless every code path remembers to invalidate.
- **Skip** `rejectUnauthorized: false`. Verify the Supabase CA.
- **Adopt** `pg_trgm` for history search when it gets slow. Our `repository.ts` uses `ILIKE '%term%'` on merchant
  and file name with no index; a GIN trigram index on `merchant` makes that indexable without changing the query.
  Full-text search is not needed until we search line items.
- **Adopt** a written pooling note: which URL is the transaction pooler (6543) for runtime and which is session or
  direct for migrations. Our deployment guide and memory already cover this; check it states the prepared-statement
  rule for the pooler.
- In-flight dedupe: **skip**; React `cache()` covers the same need within a request.

Roadmap: follow-ups (one permission map in core), item 6 and 7 (migration numbering), item 8 (search).

### 7. Auth, teams and roles

**What they did.** Supabase Auth with an MFA route, OAuth apps and API keys with scopes, roles `owner | member`
only, the current team stored on the user row (`users.team_id`), invites, a waitlist gate added in April 2026.

**Verdict.**

- **Skip** their model. Better Auth's organization plugin already gives us owner, admin and member, the active
  workspace on the session (so two tabs can differ), invitations, and the admin plugin. Ours is richer.
- **Adopt** scoped API keys later, if there is a public API or MCP server (area 11). Hash them, show once, scope to a
  workspace and to read or write.
- **Adopt** their pattern of logging every permission denial with the procedure, user and team ids. It is a good
  signal for both bugs and probing. Route it through our telemetry interface as a wide-event field.

Roadmap: item 6 (passkeys and 2FA, theirs is TOTP only), item 7 (members and seats).

### 8. Observability

**What they did.**

- Logging: a pino wrapper with a context prefix and a pretty mode
  ([logger](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/logger/src/index.ts)).
  Scattered `logger.info` calls per step, not one event per request.
- DB instrumentation: a pool wrapper that warns on queries over 100 ms and slow pool acquires
  ([db/instrument.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/db/src/instrument.ts)).
- Sentry in API, worker and dashboard, `tracesSampleRate: 0.1`, `sendDefaultPii: true` in the API, browser session
  replay at 10% of sessions and 100% on error
  ([api instrument.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/api/src/instrument.ts),
  [instrumentation-client.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/dashboard/src/instrumentation-client.ts)).
  The `release` is the git SHA and the environment comes from Railway.
- OpenPanel for analytics, browser and server, no-op outside production, with a typed event catalogue. The client
  `track` calls `useOpenPanel()` inside a plain function, which breaks the rules of hooks
  ([client.tsx](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/events/src/client.tsx)).

**Verdict.**

- **Adopt** release = git SHA and environment from the platform (`VERCEL_ENV`), and drop health and `OPTIONS`
  transactions in `beforeSendTransaction`. Both fit our Sentry plan.
- **Adopt** a slow-query warning (over 200 ms, table and operation only, never the SQL parameters) as a field on the
  wide event rather than its own log line.
- **Improve** on everything that touches PII: no `sendDefaultPii`, no session replay (receipts are financial data),
  server-first analytics with ids only. Our [security plan](2026-11-06-security-plan.md) already requires this; Midday
  is the counter-example to cite when someone suggests turning replay on.
- **Improve** on logging: one wide event per request (our pipeline already collects step timings for it), instead of
  per-step lines.
- **Skip** OpenPanel. PostHog is the decided tool (decision 6).

Roadmap: item 3 (observability).

### 9. Deployment, environments and secrets

**What they did.** Dashboard, API and worker on Railway (API in 3 regions), website on Vercel, jobs on Trigger.dev,
Supabase for DB and storage, Cloudflare in front. One shared staging (`beta.midday.ai`) for all non-main branches.
Secrets in Railway and Vercel; `vercel env pull` in CI for the website build; build-time env listed in turbo
`passThroughEnv`; AES-256-GCM for stored OAuth tokens with an env key
([encryption](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/encryption/src/index.ts)).
`.env-template` files per app.

**Verdict.**

- **Skip** Railway multi-service and multi-region. The jobs plan already decided when a worker host is needed.
- **Skip** one shared staging. Vercel preview deployments per PR (our `preview.yml`) are better; add a seeded
  preview database only if previews need real data.
- **Adopt** per-app `.env.example` files when there is a second app, listing key names and which are optional.
- Encryption: ours already has versioned secrets (#19), which Midday's single key lacks. Keep ours.

Roadmap: jobs queue (worker host), deployment guide.

### 10. Desktop and mobile

**What they did.** `apps/desktop` is a Tauri shell that loads `app.midday.ai` (dev, staging or production URL) with a
transparent macOS title bar; its own React entry is "Hello World"
([desktop README](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/desktop/README.md)).
The README lists Expo, but there is no mobile app in the current tree. Mobile capture went through chat bots instead.

**Verdict.**

- **Skip** a desktop shell. A webview wrapper adds a signing and release pipeline for little user value.
- **Improve** with a PWA: we already have `manifest.ts`. Add a Web Share Target so "Share -> Receipt OCR" from the
  phone's photo app or a PDF lands in upload, and a camera-first upload button on mobile. That covers what bots and
  a native app would, at a fraction of the cost. A native app only if share target and camera prove insufficient.

Roadmap: item 8 (product).

### 11. Exports and accounting integrations

**What they did.**

- CSV and XLSX transaction export in a background job, in batches of 100, zipped with attachments, emailed as a short
  link, transactions marked as exported
  ([export.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/apps/worker/src/processors/transactions/export.ts)).
  The column list is a good checklist: amount and currency, base amount and base currency, tax type, rate and amount,
  base tax amount, counterparty, category, tax reporting code, status, attachments, note, tags.
- A full team data export from Settings (April 2026).
- `packages/accounting` with an `AccountingProvider` interface (consent URL, token exchange and refresh, accounts,
  sync transactions, upload and delete attachment, tenants, connection check) and Xero, QuickBooks and Fortnox
  implementations; per-transaction sync records; error codes derived from provider messages
  ([ARCHITECTURE.md](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/accounting/ARCHITECTURE.md),
  [provider.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/accounting/src/provider.ts)).
- An AI CSV column mapper for imports
  ([csv-mapping-prompt.ts](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/packages/import/src/csv-mapping-prompt.ts)).

**Verdict.**

- **Adopt** their export columns as the base for ours, plus our line items and per-currency totals. Add an
  "exported at" marker per receipt so users can export "everything since last time". Every cell through `cell()`
  (security plan T8).
- **Adopt** an "export everything" (ZIP of originals + CSV) in Settings. It answers "can I leave?" and is a cheap
  trust signal on the landing page. Their wind-down is a reminder of why users ask.
- **Improve** on the accounting interface when we get there: start with file formats accountants already import
  (Xero and QuickBooks bank-statement or bill CSV templates) before OAuth integrations, which need app review,
  token refresh and per-provider error mapping. When OAuth comes, map errors from structured provider codes, not
  substring matches on messages (theirs matches the Swedish word "konto").
- **Skip** AI import mapping. We don't import transactions.

Roadmap: item 8 (accounting exports, per-currency totals).

### 12. Testing and code quality

**What they did.** About 50 API tests (tRPC routers with factories and a test context), DB tests against a real
Postgres on tmpfs, golden-dataset regression tests, unit tests in `accounting`, `import`, `encryption` and `inbox`,
evals for assistant tool selection, e2e tests against production after deploy. No Playwright browser tests for the
dashboard in the tree. CI validation is currently disabled.

**Verdict.**

- **Adopt** golden sets with captured baselines and dated comments (lesson 6) for extraction checks.
- **Adopt** factories for integration tests if our test setup code keeps growing (`receipt()`, `workspace()`,
  `ocrCall()` builders).
- **Adopt** tmpfs for the compose test Postgres to speed up `scripts/test.sh`.
- Our Playwright e2e on every PR is already ahead of theirs. Keep it.

Roadmap: item 4 (benchmark set), CI.

### 13. Docs

**What they did.** Engineering docs per subsystem in `docs/` with mermaid diagrams, state tables, and a "Design
decisions" section answering "why" (for example
[document-processing.md](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/docs/document-processing.md)
and [inbox-matching.md](https://github.com/midday-ai/midday/blob/51587319f26a0ffaa9dfccab1920373cb65689b7/docs/inbox-matching.md)).
Package READMEs for `inbox` and `accounting`. User docs as MDX on the website (52 pages: "Forward receipts via
email", "Receipt matching", "Export transactions CSV", connect guides).

**Verdict.**

- **Adopt** one doc per subsystem with a state diagram and a "why" section. The receipt state machine (uploaded,
  processing, needs review, done, soft and hard failure, stale) is the first one to write, alongside lesson 1.
- **Adopt** short user help pages for the questions support will get: supported files and limits, what "needs
  review" means, how usage is counted, exports, and later forwarding setup. Plain MDX or static pages under
  `apps/web`; no docs framework.
- Our dated plans and reviews are already a better decision log than theirs.

## Mapping to our roadmap

| Roadmap (STATUS.md)          | From Midday                                                                                            | Verdict |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| 2. Usage surfaces            | Empty and no-results states, typed URL filters                                                         | Adopt   |
| 3. Observability             | Release = SHA, drop health transactions, slow-query field, event catalogue; not PII or replay          | Adopt / Improve |
| 4. Accuracy                  | Score-driven escalation, validators, `document_type: other`, workspace-name hint, golden set, flag not fix | Adopt / Improve |
| 5. Second provider           | Their cross-provider cascade (Mistral, then Gemini) confirms a provider-neutral chain                  | Adopt (already planned) |
| 6. Passkeys and 2FA          | Theirs is TOTP only; nothing new                                                                       | n/a     |
| 7. Members and seats         | Log permission denials; skip Redis membership cache                                                    | Adopt / Skip |
| 8. Product                   | Duplicate grouping, export columns, export-everything, PWA share target, help pages                    | Adopt   |
| Jobs queue (planned)         | Soft versus hard failure, stale detection on the server, deterministic job ids                         | Adopt   |
| New, after jobs queue        | Email-in with token address, member-only senders, signed webhook                                       | Improve |
| CI and decision 8            | Post-deploy smoke test with `/api/health`; migration numbering check                                   | Adopt   |
| Follow-ups                   | `Empty` primitive, Zod schema for history params, receipt state doc                                    | Adopt   |

## What to avoid (seen in Midday)

- Silent arithmetic "fixes" of extracted totals.
- RLS policies that the app's own connection bypasses.
- Hand-applied SQL migrations outside the journal, with duplicate numbers.
- Caching authorization decisions (membership) for 30 minutes.
- `sendDefaultPii: true` and session replay on financial screens.
- Caret ranges, unfrozen installs, tag-pinned actions, and CI checks switched off to keep deploying.
- Error classification by substring matching on provider messages.
- Marketing code inside the shared UI package.
