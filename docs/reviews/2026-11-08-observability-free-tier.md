# Observability on free plans, 2026-11-08

Read-only review of the three observability tracks as they stand on 2026-11-08: OTLP export to Axiom (#135),
Sentry errors-only (#139) and server-side PostHog (#141, branch `feat/observability-posthog`, in a fix round). Code
was read from those branches; nothing was built or run. Vendor figures come from the vendors' own pages, fetched
today and linked inline; third-party pricing blogs were ignored where they disagreed.

Three questions: does each setup follow the vendor's current guidance, does it stay inside the free plan at 100 and
1,000 active users, and will the owner actually look at what it collects.

**Summary.** Volume is not the problem on any of the three: at 1,000 active users we use under 1% of Axiom's and
PostHog's free allowances and about 15% of Sentry's, and none of the three can bill us (no card on file). The real
risks are different: a client-side error loop burning Sentry's 5k/month in an afternoon (fix: inbound filters and
spike protection, both dashboard toggles); PostHog's `groups` doing nothing on the free plan (group analytics is a paid
add-on) so a plain `workspace_id` property is needed; and Axiom's tight 10 GB-hours/month of query compute, which
dashboards with wide time ranges can exhaust. The setup is sound; what is missing is the small set of dashboards and
alerts that turn it into something a solo founder reads on Monday morning. Those are specified below.

## 1. Free-plan limits

| | Axiom **Personal** | Sentry **Developer** | PostHog **Free** |
| --- | --- | --- | --- |
| Price | $0, permanent, no card | $0, no card | $0, no card ("add a card if and when you need it") |
| Core allowance | 500 GB/month data loading; 25 GB storage; 10 GB-hours/month query compute | 5,000 errors/month (also 5M spans, 50 replays, 1 GB attachments: unused) | 1M product-analytics events/month (also 100k exceptions, 1M flag requests: unused) |
| Retention | 30 days (maximum on Personal) | 30-day lookback | 1 year on the free plan |
| Datasets / projects | 3 datasets, 256 fields per dataset | unlimited projects | 1 project |
| Users | 1 | 1 | unlimited |
| Alerting | 3 monitors; notifiers: email and Discord only | email alerts (issue alerts); Slack and metric alerts are paid | usage emails at 80% and 100% of the free allotment; insight alerts are paid |
| Region | US edge only (EU edge is a paid feature) | US or EU org at sign-up | US or EU at sign-up |
| At the limit | No spend, so no bill; Axiom "may temporarily restrict ingest" for high-frequency senders. Over 256 fields: the event is rejected | Events over quota are rejected (HTTP 429 with `Retry-After`; SDKs drop, not retry) until the month resets; owner gets an email | Events over the free allotment are dropped ("lost forever") until the month resets; no charge |

Sources: [Axiom pricing](https://axiom.co/pricing), [Axiom limits and requirements](https://axiom.co/docs/usage/field-restrictions),
[Sentry pricing](https://sentry.io/pricing/), [Sentry: manage your error quota](https://docs.sentry.io/pricing/quotas/manage-event-stream-guide/),
[Sentry quotas](https://docs.sentry.io/pricing/quotas/), [PostHog pricing](https://posthog.com/pricing),
[PostHog billing limits](https://posthog.com/docs/billing/limits-alerts),
[PostHog anonymous vs identified events](https://posthog.com/docs/data/anonymous-vs-identified-events).

Two things the plan tables don't say but matter here:

- **Axiom's binding constraint is query compute, not ingest.** 10 GB-hours/month is spent by every dashboard load
  and monitor run over the data they scan. Keep dashboards on short default ranges (24 h) and monitors on short
  windows (5 to 15 minutes); watch **Settings → Usage**.
- **PostHog group analytics is a paid add-on** ([docs](https://posthog.com/docs/product-analytics/group-analytics)),
  and a group type is created by `groupIdentify`, not by `groups` on a capture. On the free plan the `groups: { workspace }`
  we send is stored but unusable in insights. See the #141 note below.

## 2. Volume at 0, 100 and 1,000 active users

Counted from the code: one wide event per request (`withRequestEvent`), per `/app` and `/admin` page render
(`logPageRender`, 19 pages), per job attempt and per drain tick; routine units (polls, health, session reads, group
reads, successful page renders, idle ticks) are kept at `LOG_SAMPLE_RATE`, planned at 0.1 in production; errors, slow
units and anything with a model call are always kept. Uploads run `instant` by default, so most OCR runs inline and the
5-minute `pg_cron` ticks are idle.

**Per upload** (instant mode, `LOG_SAMPLE_RATE=0.1`): 1 `receipt.upload` + 1.1 `job.attempt` (4 attempts max, ~10%
retry) + ~10 `receipt.poll` × 0.1 + 2 `page.render` × 0.1 ≈ **3.3 events kept** (14 at rate 1).

**Per active user per month** (20 uploads, 30 sessions × 8 page views, 2 session reads per page view, ~10 other
actions):

| Source | Raw | Kept at 0.1 | Kept at 1 |
| --- | ---: | ---: | ---: |
| Uploads (20 × per-upload) | 280 | 66 | 280 |
| `page.render` | 240 | 24 | 240 |
| `auth.request` session reads | 480 | 48 | 480 |
| Group list / counts reads | 60 | 6 | 60 |
| Exports, group edits, settings, retries (never routine) | 10 | 10 | 10 |
| **Per user per month** | **1,070** | **154** | **1,070** |

**Fixed per month**, independent of users: `job.tick` every 5 minutes = 8,640 (864 kept idle at 0.1); an external
uptime check hitting `/api/health` once a minute = 43,200 `health.live` (4,320 kept at 0.1).

**Axiom** (≈1 KB per record as stored, resource attributes included; this is generous):

| Active users | Events/month at 0.1 | Ingest/month | Share of 500 GB | 30-day storage of 25 GB |
| --- | ---: | ---: | ---: | ---: |
| 0 (today, with a 1/min pinger) | ~5,200 | 5 MB | 0.001% | 0.02% |
| 100 | ~20,600 | 21 MB | 0.004% | 0.08% |
| 1,000 | ~159,000 | 160 MB | 0.03% | 0.6% |
| 1,000 at `LOG_SAMPLE_RATE=1` | ~1.1M | 1.1 GB | 0.2% | 4% |

Ingest would need roughly 450,000 active users at rate 1 to reach 500 GB. The 256-field cap is the limit to respect
in code: the flattened schema is ~110 fields today (45 top-level keys, the `file`, `ocr`, `queue`, `tick` and `error`
groups, the OTel resource and severity fields), but each key of the `flags`, `checks`, `counts` and `timings_ms` maps
becomes its own field, capped at 32 per map, so the theoretical maximum is ~240. Keep map keys to the fixed vocabulary
they already use.

**Sentry** (server 5xx and defects, dead jobs, browser errors; expected 4xx never sent):

| Active users | Server errors (0.2% of ~30 non-routine requests/user) | Dead jobs (1% of scans) | Browser errors (0.5/user) | Total | Share of 5,000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 6 | 20 | 50 | ~80 | 1.6% |
| 1,000 | 60 | 200 | 500 | ~760 | 15% |

The quota is not a steady-state problem; it is a **bug-loop** problem. One browser error thrown on every render of a
common page is one event per page view: at 1,000 users that is 240,000 per month, so the 5,000 are gone in hours and
Sentry is blind for the rest of the month. `dedupeIntegration` only stops repeats within one page session. The defences
are dashboard settings (inbound filters, spike protection; section 3) and, as a backstop, nothing: no card means no bill.

**PostHog** (per active user per month: 1 `signed_up` once, 20 `receipt_uploaded`, ~20 `receipt_scanned`,
~0.2 `receipt_scan_failed`, 1 `csv_exported`, ~1 `plan_limit_hit` ≈ 43):

| Active users | Events/month | Share of 1M |
| --- | ---: | ---: |
| 100 | ~4,300 | 0.4% |
| 1,000 | ~43,000 | 4.3% |

The free tier is exceeded at about 23,000 active users per month. All events are identified (server SDKs create a
person profile per `distinctId`); identified events are the pricier kind once paid, but the first million is free either
way, and user-level funnels and retention need them. Keep them identified.

## 3. Best practice vs our implementation

### Axiom (OTLP logs)

| Vendor guidance | Ours | Verdict |
| --- | --- | --- |
| OTLP/HTTP to `https://api.axiom.co/v1/logs`, headers `Authorization: Bearer <token>`, `X-Axiom-Dataset: <dataset>`, protobuf preferred ([docs](https://axiom.co/docs/send-data/opentelemetry)) | Standard `OTEL_EXPORTER_OTLP_*` env, `http/protobuf` default, the SDK appends `/v1/logs` | OK |
| Ingest-only token scoped to one dataset | Documented in prod-env §9b | OK |
| One dataset per OTel signal; nothing on per-environment datasets. Personal: 3 datasets | One dataset `receipt-ocr`; `deployment.environment.name` from `VERCEL_ENV` as a resource attribute | OK. Set the variables for Production only, not Preview: previews don't need a dataset and would eat query compute. If preview logs are ever wanted, a second dataset `receipt-ocr-preview` with its own token |
| Batch, don't send one event per request; Axiom may restrict high-frequency senders | `BatchLogRecordProcessor`, 512 per batch, one `forceFlush` per request in `after()` | OK |
| Field limit 256 per dataset; event rejected beyond it | ~110 fields, worst case ~240 (above) | OK; keep the map-key rule |
| `_time` within 24 h | Record timestamp is `new Date()` at emit | OK |
| Severity matching for OTel logs | `SeverityNumber` 9/17 and `SeverityText` `info`/`error` | OK |
| Export failures must not recurse | `telemetry.export_failed` to stderr only, once a minute | OK |
| Monitors (3), email/Discord notifiers | None defined yet | **Gap**: section 4 defines the three |
| Regional edge | Prod-env §9b says "EU org: use the regional edge URL" | **Doc fix**: Personal is US-only; EU edge is a paid feature |

### Sentry (errors only, `@sentry/node` + bare `@sentry/browser`)

| Vendor guidance | Ours | Verdict |
| --- | --- | --- |
| `beforeSend` scrubbing; `sendDefaultPii` off | Allowlist rebuild (`scrubEvent`), `dataCollection` all off, no user, no headers, no cookies, no bodies, no frame variables | Better than the default. OK |
| Inbound filters: browser extensions, legacy browsers, web crawlers, localhost ([docs](https://docs.sentry.io/concepts/data-management/filtering/)) | Dashboard setting, not yet listed in prod-env §9c | **Gap**: filtered events don't count against quota; turn them all on, plus ChunkLoadErrors (a service worker plus deploys makes them routine) |
| SDK-side filters (`ignoreErrors`, `allowUrls`) via the event-filters integration | The bare `BrowserClient` has only global handlers, dedupe and breadcrumbs, so Sentry's default `ignoreErrors` list ("Script error.", ResizeObserver loops, extension URLs) is **not** applied; third-party scripts (Turnstile, GA) can report | **Code (small)**: add `eventFiltersIntegration({ allowUrls: [own host], ignoreErrors: ... })` to `sentry-client.ts` |
| Allowed Domains: Origin/Referer check for browser events; server events (no Origin) are always accepted | Not set | Set to the production host; a noise filter only, Origin is spoofable |
| Spike protection: per project, enabled in **Settings → Spike Protection** ([docs](https://docs.sentry.io/pricing/quotas/spike-protection/)) | Not mentioned | **Gap**: turn it on; it needs a baseline, so it protects the second month onward |
| Per-key rate limit, per minute ([docs](https://docs.sentry.io/pricing/quotas/manage-event-stream-guide/)) | Not set | Sentry's docs and a 2023 staff comment say Business plan; a Team user reports it works. If the **Rate limits** field on the key is editable, set 30/min |
| `release` and `environment` on every event | Short commit SHA (same as `/api/health`), `VERCEL_ENV` | OK. Filter alerts to `environment:production` |
| Source maps | Deferred to a separate `sentry-cli` step (security plan M11) | OK for now; stack frames point at built files, grouping still works on type + frames |
| Alert rules | Prod-env §9c: "Alerts → new issue, email" | Add a regression condition (section 4) |
| Quota exhausted → 429, SDK drops | `sendClientReports: false` means we don't learn how many were dropped | Acceptable; the Stats page shows it |

The server side is lean and correct: no tracing, no OTel provider, no default integrations, dead jobs captured as a
fingerprinted message. `onUncaughtExceptionIntegration()` exits the process after capture, which is the Node default
behaviour anyway.

### PostHog (`posthog-node`, server side only)

| Vendor guidance ([Node docs](https://posthog.com/docs/libraries/node)) | Ours | Verdict |
| --- | --- | --- |
| Serverless: `flushInterval: 0`, await `flush()` before the function ends, catch flush errors, bound the wait | `flushInterval: 0` on Vercel, `flushAt: 20`, `flush()` in the shared `after()` bounded at 2 s by `settleWithin`; 10 s timer + SIGTERM in Docker | OK. `flush()` has no timeout of its own; our bound covers it |
| One shared client | One, started in `register()` | OK |
| `distinctId` = stable opaque user id; no PII in properties | Better Auth user id; closed catalogue with runtime check (`checkEvent`) | OK, stricter than the guidance |
| Groups: pass `groups` on every server capture; `groupIdentify` creates the type; **paid add-on** | `groups: { workspace }` on every event, no `groupIdentify` | **Does nothing on the free plan** (section 1). Add `workspace_id` as a plain property so insights can filter and break down by workspace today; keep `groups` for when the add-on is wanted |
| GeoIP off (`disableGeoip` defaults to true since v3) | `disableGeoip: true` and `$geoip_disable: true` per event | Redundant, harmless |
| Person profiles: identified by default for server SDKs | Identified | OK (needed for funnels/retention) |
| Event names: `[object] [verb]`, lowercase | `receipt_uploaded`, snake_case | Fine: consistent beats conventional; don't rename |
| `privacyMode` | `privacyMode: true` | This option is for `@posthog/ai` LLM capture; harmless here |
| Billing limit | Not mentioned | On the free plan (no card) there is nothing to set: usage is hard-capped at the free allotment and the owner is emailed at 80%/100%. **If a card is ever added** (for group analytics), set **Product analytics → billing limit $0** the same day |

Two behaviours worth fixing in the #141 round:

1. **`track()` doesn't schedule a flush.** The sink flush is requested by `logger.emit` (`requestFlush`), not by
   `track()`. Today the only caller is the sign-up hook inside the `/api/auth` request, whose own wide event schedules
   the flush, so it works. A future `track()` from a server action (no wide event) would sit in the queue until the next
   request on that instance, and be lost when Vercel freezes it. Export a `scheduleFlush` from core and call it from
   `track()` (or route `track()` through the sink path).
2. **Admin reruns count as user scans.** `fromRecord` skips impersonated requests but not `job.attempt` events with
   `trigger: "admin_rerun"`, so an admin re-running a user's job emits `receipt_scanned` for that user. Skip that
   trigger (it is already an allowed prop, so nothing else changes).

## 4. What we'll actually look at

Fewer, high-signal items. Each question says whether today's events answer it, what is missing, and the one artefact
to create. Axiom field names: Axiom nests OTel attributes under `attributes.*` (non-semantic ones typically under
`attributes.custom.*`); confirm the exact path from one event in the dataset's Stream view before saving the queries;
the APL below writes `attr.<field>` as a placeholder for that prefix.

### Axiom: "is it working, and where is it slow or expensive?"

| Question | Answerable today? | Artefact |
| --- | --- | --- |
| Are scans succeeding right now, and are retries climbing? | **Yes**: `job.attempt` with `queue.outcome` (`succeeded`/`retry`/`dead`/`lost`), `ocr.failure_kind`, `ocr.model`, `trigger` | Dashboard panel **Scans by outcome**, 1 h bins, 24 h; Monitor 2 |
| Which requests fail with 5xx, on which route, with what error? | **Yes**: `status_code`, `route`, `error.type/kind/code`, `request_id` (same id is a Sentry tag) | Monitor 1; saved query **Errors by route** |
| Where does upload-to-result time go? | **Yes**: `timings_ms.storage.put/get`, `timings_ms.ai.extract`, `timings_ms.db.*`, `queue.wait_ms`, `duration_ms` | Panel **p50/p95 `ai.extract` by model** |
| Is the queue healthy (backlog, lost leases, reaper)? | **Yes**: `job.tick` (`claimed`, `reaped`, `lost`, `dead`), `queue.wait_ms`. Idle ticks are sampled, non-idle never | Panel **Tick summary**, 24 h |
| What are we spending on OCR per hour / per scan, by model? | **Yes** per attempt (`ocr.cost_micro_usd`, `tokens_*`); **by plan: no** (`plan` is on the request event, not on `job.attempt`) | Monitor 3 (spend guard). Cost-per-scan-by-plan belongs in Postgres (`cost_micro_usd` per attempt is stored), not in 30-day logs: a saved SQL/admin panel. If wanted in logs too, add `plan` to the job context |
| Is the site up? | **No, by design**: logs show activity, not its absence, and at 0 users there is no activity. | A free external uptime check on `/api/health/ready` every 5 minutes (not 1: see noise). Don't try to derive uptime from logs |

**Noise to cut (code):** a 1/min uptime pinger makes `health.live` the largest line in the dataset (4,320 kept
events/month: 80% of everything at 0 users, ~25% at 1,000) with zero information. Call `skipEvent` on 2xx health
responses (keep non-2xx), or sample health at 0.01. Everything else is proportionate.

**Monitors** (the free plan's 3; notifier: email):

| # | Name | Type | APL | Every / window | Alert when |
| --- | --- | --- | --- | --- | --- |
| 1 | Server errors | Threshold | `['receipt-ocr'] \| where severity_text == "error" and attr.event != "job.attempt" \| summarize count()` | 5 min / 10 min | count ≥ 3 |
| 2 | Scans retrying | Threshold | `['receipt-ocr'] \| where attr.event == "job.attempt" and attr['queue.outcome'] in ("retry", "lost") \| summarize count()` | 5 min / 15 min | count ≥ 5 (provider degradation before anything dies; dead jobs already page via Sentry) |
| 3 | OCR spend | Threshold | `['receipt-ocr'] \| where attr.event == "job.attempt" \| summarize sum(attr['ocr.cost_micro_usd'])` | 15 min / 60 min | sum ≥ 2,000,000 ($2/h; ~400 scans/h at today's cost, far above expected load) |

**Dashboard "Ops"** (one, default range 24 h, 5 panels): requests by status class (2xx/4xx/5xx) per 15 min; p95
`duration_ms` by route (top 8); scans by `queue.outcome` per hour; p50/p95 `timings_ms.ai.extract` by `ocr.model`;
`sum(ocr.cost_micro_usd)` per hour. Saved query **Find a request**: `where attr.request_id == "<id>"` (paste the
`x-request-id` from a user's report).

### Sentry: "which errors hit real users, and are they new?"

| Question | Answerable today? | Artefact |
| --- | --- | --- |
| Did a new error appear, or an old one come back, in production? | **Yes**: issues with `release` and `environment` | Alert A |
| Is a receipt pipeline dying, for which error kind? | **Yes**: `job_dead:<kind>:<error_kind>` issues, fingerprinted per kind | Alert A covers it (first seen); the issue title says what |
| Which request was it, and what else happened in it? | **Yes**: `request_id` tag → Axiom "Find a request". No user id in Sentry, by design | none |
| Is the browser build broken after a deploy (chunk, hydration)? | **Yes**, but mostly noise | Inbound filters for ChunkLoadErrors and hydration errors on; revisit if a real hydration bug is suspected |

**Alerts** (Developer plan: issue alerts to email):

- **A. New or regressed issue, production**: Alerts → Create Alert → Issues → conditions "A new issue is created" OR
  "The issue changes state from resolved to unresolved"; filter `environment` equals `production`; action: email the
  owner; frequency 30 minutes. One rule; the Sentry default rule it replaces fires on every event.
- Nothing else. Metric alerts and Slack need Team.

**Noise to cut:** none in code beyond the `eventFiltersIntegration` above.

### PostHog: "where do people drop, and who comes back?"

| Question | Answerable today? | Artefact |
| --- | --- | --- |
| Sign-up → first upload → first successful scan → export → upgrade | **Mostly**: `signed_up` → `receipt_uploaded` → `receipt_scanned` → `csv_exported` are there; PostHog's "first time ever" filter gives the "first" semantics without extra events. **Upgrade is missing**: no event when a workspace changes plan | Funnel insight; add `plan_changed { from, to }` (or `subscription_started { plan }`) in the billing PR (#143) |
| Are the users we have coming back? | **Yes**: `receipt_uploaded` unique users | Weekly retention and WAU trend |
| Which sign-up method brings users who upload? | **Yes**: `signed_up.method`, funnel breakdown | Funnel breakdown by `method` |
| Are people hitting the free limit (upgrade pressure)? | **Yes**: `plan_limit_hit` (`limit`, `plan`), never sampled | Trend, weekly |
| Does scan quality differ per workspace / plan? | **Partly**: `receipt_scanned.fallback`, `receipt_scan_failed.error_kind`, `plan` on `receipt_uploaded` only; `groups.workspace` unusable without the add-on | Add `workspace_id` prop (above); per-user breakdown is fine for now |
| Cost per scan vs plan | **No, and shouldn't be**: cost is deliberately not sent to PostHog | Postgres / admin page (see Axiom row) |

**Dashboard "Founder weekly"** (one, 4 insights, range last 30 days; Dashboard → ⋯ → Subscribe → weekly email):

1. **Activation funnel**: `signed_up` → `receipt_uploaded` → `receipt_scanned` → `csv_exported`; unique users; 7-day
   conversion window; breakdown by `method` on step 1.
2. **Weekly active uploaders**: trend, `receipt_uploaded`, unique users, weekly.
3. **Retention**: `receipt_uploaded` → `receipt_uploaded`, weekly cohorts, 8 weeks.
4. **Limit hits by plan**: trend, `plan_limit_hit`, total count, breakdown by `plan`, weekly.

**Noise to cut:** none; six event types at ~43 per user per month is already minimal. Don't add `receipt_retried`
(`receipt_scanned.trigger = retry` covers it) or `workspace_created`/invites until there is a team feature to measure.

## 5. Ranked actions

Ranking: (impact × confidence) / effort. Owner items are dashboard settings; code items are small PRs.

### Code changes

| # | Change | Where | Why | Effort |
| --- | --- | --- | --- | --- |
| C1 | Add `workspace_id` as a plain prop on every workspace-scoped product event (keep `groups`) | #141 `analytics.ts` (`EVENTS` + `fromRecord`), `posthog.ts` | Group analytics is a paid add-on; without this nothing in PostHog can be split by workspace | S |
| C2 | Skip `receipt_scanned`/`receipt_scan_failed` when `trigger === "admin_rerun"` | #141 `fromRecord` | Admin reruns inflate a user's scans | XS |
| C3 | Make `track()` schedule the `after()` flush (export `scheduleFlush` from core) | #141 `analytics.ts`, core `logger.ts` | A `track()` outside a request's wide event can be lost on freeze | S |
| C4 | `eventFiltersIntegration({ allowUrls: [production host], ignoreErrors: Sentry defaults })` in the browser client | `sentry-client.ts` (follow-up to #139) | The bare client applies none of Sentry's default ignore list; third-party script errors burn quota | S |
| C5 | `skipEvent` on 2xx `health.live` / `health.ready` | `apps/web/app/api/health/*` | A 1/min pinger would be the biggest line in Axiom with no information | XS |
| C6 | Prod-env docs: §9b drop the EU-edge line (Personal is US-only); add §9b/9c/9d dashboard steps below; §9d replace "turn off session recording and autocapture" (no browser SDK) with the billing note | `docs/production-environment.md` | Accuracy | XS |
| C7 | `plan_changed { from, to }` product event when billing lands | #143 | Completes the funnel to upgrade | S |
| C8 | Optional: `plan` on the job context so `job.attempt` carries it | core jobs | Cost by plan in logs; otherwise Postgres answers it | S |

### Dashboard settings for the owner

| # | Vendor | Setting | Click path and value |
| --- | --- | --- | --- |
| O1 | Sentry | Inbound filters on | Settings → Projects → receipt-ocr → **Inbound Filters** → toggle on: Browser extension errors, Events from localhost, Legacy browsers (all), Web crawlers, React hydration errors, ChunkLoadErrors, Health-check transactions |
| O2 | Sentry | Spike protection on | Settings → **Spike Protection** → enable for receipt-ocr; expand → Add Action → Sentry Notification; then User Settings → Notifications → Spike Protection on |
| O3 | Sentry | Alert rule A | Alerts → Create Alert → Issues: "new issue" OR "resolved → unresolved", filter environment = production, email, 30-min frequency; delete the default "send a notification for every new issue" rule if it was created |
| O4 | Sentry | Allowed Domains; rate limit if editable | Settings → Projects → receipt-ocr → **Client Keys (DSN)** → Configure: Allowed Domains `receipt-ocr.bhimraj.com.np`; Rate limits **30 per minute** if the field isn't locked. General Settings → Security & Privacy: Data scrubbing on, Prevent storing IP addresses on (already in §9c) |
| O5 | Axiom | Monitors 1 to 3 | Monitors → New → Threshold, the APL above, notifier Email; confirm the attribute prefix from one event in Stream first |
| O6 | Axiom | Production only | Vercel env vars `OTEL_EXPORTER_OTLP_*` for **Production** only (not Preview); dataset `receipt-ocr`, ingest-only token |
| O7 | Axiom | Dashboard "Ops" | 5 panels as above, default range 24 h; check **Settings → Usage** monthly for query GB-hours |
| O8 | PostHog | Stay on Free, no card | Organization → Billing: no card. If a card is ever added: Product analytics → **Set billing limit → $0** that day. Usage emails at 80%/100% are automatic |
| O9 | PostHog | Dashboard "Founder weekly" + subscription | The 4 insights above; Dashboard → ⋯ → Subscribe → weekly, Monday morning |
| O10 | Uptime | External check | A free monitor (UptimeRobot, Better Stack or similar) on `GET /api/health/ready`, every 5 minutes, email on 2 failures |

## 6. What this review did not verify

- Axiom's exact APL field path for OTel log attributes (`attributes.custom.*` vs `attributes.*`): take it from a
  real event once the dataset receives one.
- Whether Sentry's per-key rate limit is editable on the Developer plan (sources disagree; harmless to try).
- Actual event sizes and sample rates in production; the tables use 1 KB per record and `LOG_SAMPLE_RATE=0.1`.
- Query-compute cost of the proposed monitors and dashboard; check Axiom usage after the first week.
