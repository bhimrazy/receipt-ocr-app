# Benchmarks

## OCR accuracy, latency and cost

```bash
GOOGLE_GENERATIVE_AI_API_KEY=... bun run bench:ocr [--models google:gemini-3.8-flash] [--only npr-lakh,idr-dot] [--concurrency 2]
```

Real provider calls, billed to the key. Without the key the script exits with a message.

- Fixtures: `fixtures/<id>.{jpg,png,pdf}` plus `<id>.json` ground truth (same fields as the extraction; omit a
  field to skip it). The five starters are synthetic, from `bun run bench:fixtures`: NPR lakh grouping, EUR comma
  decimals, IDR dot thousands, a tip, a 34-line receipt. Add real, PII-free receipts the same way (faded
  thermal, skewed phone shots, handwritten totals).
- Scoring (`score.ts`, unit-tested): exact currency/date/category; total/tax/subtotal/tip within 0.01 (a missing
  tip equals zero); merchant by normalised edit similarity >= 0.8; items F1 (name similarity >= 0.7 and the
  same total price).
- Output: `results/<date>.md` (summary, commit it) and `results/<date>-<model>.json` (raw, gitignored). Latency is
  p50/p95 of successful calls, `cold` the first one to finish.
- Cost: the usage `extractReceipt` returns (or a failed call's `OcrCallError.usage`), priced with `costOf` from the
  model registry's effective-dated table in `packages/ai/src/models.ts`, the same prices the app stores per call.
  `n/a` when no call reported usage.
- The only call into `packages/ai` is `extract()` in `ocr.ts`; change that one function if the export is renamed.

## Upload load test

k6 is a standalone binary (not installed by this repo): https://grafana.com/docs/k6/latest/set-up/install-k6/

```bash
# stack on :3004 with OCR_PROVIDER=fixture (see apps/web e2e), then:
k6 run -e BASE_URL=http://localhost:3004 bench/upload.k6.js
```

Ramps 0 to 20 virtual users posting a ~80 KB receipt to `POST /api/receipts`. Thresholds: under 1% failed requests,
p95 under 3 s. While it runs, watch Postgres connections to validate the pool size:
`select count(*) from pg_stat_activity where datname = current_database();`

How the benchmark and tooling fit the rest of the repo: [docs/architecture/tooling.md](../docs/architecture/tooling.md).
