# Benchmarks

## OCR accuracy, latency and cost

```bash
GOOGLE_GENERATIVE_AI_API_KEY=... bun run bench:ocr [--models google:gemini-3.8-flash] [--only npr-lakh,idr-dot] [--concurrency 2]
ANTHROPIC_API_KEY=... bun run bench:ocr --models anthropic:claude-haiku-5-5,anthropic:claude-sonnet-5-5,anthropic:claude-opus-5-5
bun run bench:ocr --dry-run --models anthropic:claude-haiku-5-5,anthropic:claude-sonnet-5-5   # cost estimate, no calls
```

Real provider calls, billed to the keys. `--models` takes any id in `OCR_MODELS`; a missing key for a chosen provider
exits with a message. `--dry-run` needs no key and prints an estimate from the fixture sizes (assumptions in
`printEstimate`, deliberately generous), so spend can be approved before a run. Fixtures without a `.json` (the load
test's receipt) are skipped.

- Fixtures: `fixtures/<id>.{jpg,png,pdf}` plus `<id>.json` ground truth (same fields as the extraction; omit a
  field to skip it). The six starters are synthetic, from `bun run bench:fixtures`: NPR lakh grouping, KWD three decimals, EUR comma
  decimals, IDR dot thousands, a tip, a 34-line receipt. Add real, PII-free receipts the same way (faded
  thermal, skewed phone shots, handwritten totals).
- Scoring (`score.ts`, unit-tested): exact currency/date; category against the app's canonical list (a fixture may
  list several acceptable ones, and legacy labels are normalised with `parseCategory`; a test checks every fixture); total/tax/subtotal/tip within 0.01 (a missing
  tip equals zero); merchant by normalised edit similarity >= 0.8; items F1 (name similarity >= 0.7 and the
  same total price).
- Output: `results/<date>.md` (summary, commit it) and `results/<date>-<model>.json` (raw, gitignored, with each
  run's extraction so misses can be inspected). Latency is
  p50/p95 of successful calls, `cold` the first one to finish.
- Cost: the usage `extractReceipt` returns (or a failed call's `OcrCallError.usage`), priced with `costOf` from the
  model registry's effective-dated table in `packages/ai/src/models.ts`, the same prices the app stores per call.
  `n/a` when no call reported usage.
- **Category scores before this fix are invalid for every model**, including the first Claude run
  (`results/2026-11-07.md`, 0%): the fixtures used pre-`0004` labels (Restaurant, Grocery, Shopping) that the
  extraction schema can never produce. Every other column of that run stands.
- The only call into `packages/ai` is `extract()` in `ocr.ts`; change that one function if the export is renamed.

## Image shrinker

```bash
bun run bench:encode
```

Runs `apps/web/lib/upload-prep.ts` in headless Chromium over the fixture PNGs and synthetic noisy photos (a 12 MP
photo, tall 1:4 and 1:6 receipts) and prints dimensions, bytes, final quality and encode attempts. No model calls.

## Load test (small server)

Proves what one small server holds: the production image (`docker/Dockerfile.prod`, Bun) limited to **1 vCPU and
1 GB**, Postgres limited to 1 vCPU / 512 MB, and `OCR_PROVIDER=fixture` with `FIXTURE_LATENCY_MS=3000` so the model
takes about as long as a real call without costing anything. k6 runs from the official `grafana/k6` image, pinned by
digest, on the compose network. Nothing to install but Docker and Bun.

```bash
scripts/load.sh                 # smoke + load + spike, about 6 minutes after the build
scripts/load.sh capacity        # step the rate up to find the breaking point, about 25 minutes
scripts/load.sh soak            # 30 minutes at the load rate (SOAK_DURATION=2h for longer)
scripts/load.sh smoke load      # any combination
APP_CPUS=2 APP_MEM=2g scripts/load.sh capacity   # try a bigger box
```

Output: `bench/results/load-<date>.md` (commit this), `.json` (everything, gitignored) and a `load-<date>/` folder with
the raw k6 summaries and logs, the container samples and the app's logs. The exit status is non-zero when a smoke, load, spike or soak threshold
is crossed. `capacity` always exits 0 (it is meant to find the failing step) and the report names the highest passing rate. In CI: Actions, "Load test", Run workflow (inputs: scenarios, app CPUs, app memory); by hand only, because a scheduled
run on a shared 2-vCPU runner fails on noise more often than on regressions. It needs no secrets, writes
`bench/results/latest.md` (gitignored) and uploads that report as an artifact plus a job summary.

| Piece                            | What it does                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.load.yml`        | Overlay with the CPU/memory limits, `pg_stat_statements`, fixture provider and its latency                            |
| `bench/load/seed.js`, `seed.sql` | Creates `USERS` (50) accounts, raises plan limits so quota doesn't dominate, seeds `RECEIPTS` (200, under 10000) each |
| `bench/load/load.js`             | The scenarios and thresholds. Signs every user in once (`setup`) and holds the sessions                               |
| `bench/load/report.mjs`          | Joins k6 summaries, `docker stats` samples, Postgres connections and the app's wide events into the report            |

Each simulated user has its own `x-forwarded-for` (the stack sets `TRUSTED_IP_HEADERS=x-forwarded-for`), so the per-IP
sign-in and sign-up limits see many clients. Static assets are not requested: on Vercel they come from the CDN.

**Scenarios** (`SCENARIO` in k6; all arrival-rate based, so a slow server shows up as latency and dropped iterations
instead of k6 politely slowing down):

- `smoke`: one pass over every route and one upload; the gate that the stack works.
- `reads`: browsing mix at `RATE_READS`/s: landing 8%, `/app` 17%, history 15% + filtered 10% + page 2 5%, receipt
  detail 30%, CSV export 5%, receipt status poll 10%.
- `uploads`: `RATE_UPLOADS`/s, 70% JPEG (84 KB) and 30% PDF, sent as the browser does (`mode=queued`), then polled
  every second until the receipt completes. `UPLOAD_MODE=instant` holds the connection through the model call.
- `load`: reads at 20/s and uploads at 2/s together.
- `spike`: the load rates for 20 s, 5x for 40 s, back to the load rates for 70 s.
- `soak`: the load rates for `SOAK_DURATION`; watch memory (`app mem`) and DB connections drift.
- `capacity` (a `load.sh` mode): `reads` then `uploads` at rising rates, 40 s each; a failing step is retried once, the
  ramp stops at the second failure. The highest passing rate is the capacity.

**Thresholds** (the SLOs, k6 `thresholds` in `load.js`; first measured run: page p95 about 25 ms and api p95 about
12 ms at the load rates, so these leave room for noise but catch real regressions):

| SLO                                                       | Threshold                           |
| --------------------------------------------------------- | ----------------------------------- |
| Page loads (landing, `/app`, history, detail), p95        | under 500 ms                        |
| API reads (CSV export, receipt status), p95               | under 300 ms                        |
| Failed requests, checks                                   | under 1%, over 99%                  |
| Upload accepted (`POST /api/receipts`), p95               | under 1 s                           |
| Upload to completed receipt, p95                          | under model latency + 3 s           |
| Uploads answered with 5xx, uploads never completing       | 0, 0                                |
| Dropped iterations (server too slow to take the arrivals) | 0                                   |
| Spike: pages and API p95, upload to completed p95, 5xx    | under 1.5 s, under latency + 6 s, 0 |

**Results** (2026-11-06, after the job queue landed; Docker Desktop, an 8-CPU / 3.6 GiB Docker VM on a 10-core Mac;
host load 2 to 3 during the runs; full tables in [`results/load-2026-11-06.md`](results/load-2026-11-06.md)). The
ladder was short this time (reads 40 to 200, uploads 12 to 80).

| On 1 vCPU / 1 GB, 3 s model           | Held every SLO           | First failing step | What ran out                                                                         |
| ------------------------------------- | ------------------------ | ------------------ | ------------------------------------------------------------------------------------ |
| Reads (pages + API)                   | the 200/s step held      | not reached        | App CPU at 80% avg, page p95 448 ms: next to the 500 ms limit                        |
| Uploads (queued, with status polling) | 12 uploads/s (48 failed) | 48/s               | Postgres CPU 87%; the quota count query is the top statement, jobs queries come next |

- Before the job queue and the merged hot-path trims the same ladder held 160 reads/s (200 failed) and 64 uploads/s
  (80 failed). Reads improved; uploads got more expensive: at 48/s upload-to-completed p95 was 17 s and 152 iterations
  were dropped, and 24 and 36/s were not measured in this run, so the new upload ceiling lies between 12 and 48/s.
- Uploads still complete through the queue (upload to completed p95 4.0 s at 12/s with a 3 s model).
- At the load rates (20 reads/s, 2 uploads/s) p95 is 24 ms for pages, 13 ms for API reads and 30 ms to accept an
  upload. The app uses about 25% of its CPU and 430 MiB.
- Spike (5x for 40 s, 100 reads/s and 10 uploads/s): no errors, page p95 19 ms.
- Past the limit the server degrades by queueing, not by failing (0 errors and 0 5xx), with memory up to 800 MiB of
  the 1 GB limit and no OOM kill in earlier runs.
- Postgres connections: 10 at most during reads and 5 during uploads, against a pool max of 5.
- The first run after boot is slower (route compilation, JIT), so `load.sh` warms up for about 35 s before measuring.

Reading the report: "DB conns" is `pg_stat_activity` (total, and active at the busiest sample); the app's pool max is
`DATABASE_POOL_MAX` (5). "App CPU" is `docker stats`, where 100% is the whole 1 vCPU limit. The wide-event table is
the app's own `duration_ms` per request, so it excludes network and queueing before the request is read. Pages don't
emit wide events yet, only API routes do.

Caveats: k6, the app, Postgres and RustFS share one Docker host, so a busy laptop (or a 2-vCPU CI runner) lowers the
numbers; the report prints the host load average per run. A failed run on a loaded host is worth repeating before
believing it. The fixture model costs a timer, not CPU or tokens, so real extractions will use somewhat more memory and
socket time than measured here. Postgres runs locally, so round trips cost microseconds; with Supabase in another
region every one of the 10-12 sequential round trips per upload ([CTO review](../docs/reviews/2026-11-06-cto.md))
adds its network latency.

How the benchmark and tooling fit the rest of the repo: [docs/architecture/tooling.md](../docs/architecture/tooling.md).
