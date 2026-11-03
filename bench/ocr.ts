// OCR accuracy, latency and cost benchmark over bench/fixtures.
//   bun run bench:ocr [--models google:gemini-3.7-flash,...] [--concurrency 2] [--only id,id]
// Needs GOOGLE_GENERATIVE_AI_API_KEY. Fixtures: <id>.{jpg,png,pdf} + <id>.json (ground truth).
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractReceipt, type ModelId } from "@receipt-ocr/ai";
import { AMOUNT_FIELDS, EXACT_FIELDS, percentile, scoreReceipt, type Receipt } from "./score";

const root = import.meta.dirname;
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

type Usage = { inputTokens: number; outputTokens: number };
type Fixture = { id: string; file: string };
type Run = {
  fixture: string;
  ok: boolean;
  timeout: boolean;
  ms: number;
  usage: Usage;
  scores: Record<string, number>;
  error?: string;
};

// The single call into packages/ai. Bare model names default to the Google provider.
async function extract(model: string, bytes: Uint8Array, mimeType: string): Promise<Receipt> {
  const id = (model.includes(":") ? model : `google:${model}`) as ModelId;
  const { extraction } = await extractReceipt({
    model: id,
    file: { data: bytes, mediaType: mimeType },
    keys: { google: process.env.GOOGLE_GENERATIVE_AI_API_KEY },
  });
  return extraction as Receipt;
}

// The extraction function returns no token counts, so read Gemini's `usageMetadata` off the
// AI SDK's HTTP responses, attributed to the run that made the call.
const usageScope = new AsyncLocalStorage<Usage>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const res = await realFetch(...args);
  const sink = usageScope.getStore();
  if (sink && res.headers.get("content-type")?.includes("json")) {
    const body = (await res
      .clone()
      .json()
      .catch(() => null)) as { usageMetadata?: Record<string, number> } | null;
    const meta = body?.usageMetadata;
    if (meta) {
      sink.inputTokens += meta.promptTokenCount ?? 0;
      sink.outputTokens += (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0);
    }
  }
  return res;
}) as typeof fetch;

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error(
    "bench:ocr needs GOOGLE_GENERATIVE_AI_API_KEY (real provider calls, billed to you).",
  );
  process.exit(2);
}

const only = arg("only", "").split(",").filter(Boolean);
const concurrency = Math.max(1, Number(arg("concurrency", "2")) || 2);
const models = arg("models", "google:gemini-3.7-flash")
  .split(",")
  .map((spec) => {
    const [provider, ...rest] = spec.split(":");
    if (provider !== "google" || rest.length === 0) {
      throw new Error(`unsupported model "${spec}" (only google:<model> today)`);
    }
    return rest.join(":");
  });

const fixtures: Fixture[] = readdirSync(path.join(root, "fixtures"))
  .filter((file) => MIME[path.extname(file)])
  .map((file) => ({ id: path.basename(file, path.extname(file)), file }))
  .filter(({ id }) => only.length === 0 || only.includes(id));
if (fixtures.length === 0) {
  console.error("no fixtures found in bench/fixtures");
  process.exit(2);
}

const prices = JSON.parse(readFileSync(path.join(root, "prices.json"), "utf8")) as {
  updated: string;
  models: Record<string, { input: number | null; output: number | null }>;
};

async function runOne(model: string, { id, file }: Fixture): Promise<Run> {
  const truth = JSON.parse(
    readFileSync(path.join(root, "fixtures", `${id}.json`), "utf8"),
  ) as Receipt;
  const bytes = new Uint8Array(readFileSync(path.join(root, "fixtures", file)));
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const started = performance.now();
  try {
    const got = await usageScope.run(usage, () => extract(model, bytes, MIME[path.extname(file)]!));
    const ms = performance.now() - started;
    return { fixture: id, ok: true, timeout: false, ms, usage, scores: scoreReceipt(truth, got) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      fixture: id,
      ok: false,
      timeout: /timeout|timed out|abort/i.test(message),
      ms: performance.now() - started,
      usage,
      scores: {},
      error: message.slice(0, 300),
    };
  }
}

async function runModel(model: string) {
  const runs: Run[] = [];
  const queue = [...fixtures];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) runs.push(await runOne(model, f));
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return runs.sort((a, b) => a.fixture.localeCompare(b.fixture));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (n: number) => (Number.isNaN(n) ? "n/a" : `${(n * 100).toFixed(0)}%`);
const sec = (ms: number) => (Number.isNaN(ms) ? "n/a" : `${(ms / 1000).toFixed(1)}s`);

const date = new Date().toISOString().slice(0, 10);
mkdirSync(path.join(root, "results"), { recursive: true });
const fieldNames = [...EXACT_FIELDS, ...AMOUNT_FIELDS, "merchant", "itemsF1"];
const md = [
  `# OCR benchmark ${date}`,
  "",
  `${fixtures.length} fixtures, concurrency ${concurrency}.`,
  "",
  `| model | ${fieldNames.join(" | ")} | p50 | p95 | cold | failed | timeouts | tokens in/out | cost |`,
  `|${"---|".repeat(fieldNames.length + 8)}`,
];

for (const model of models) {
  console.log(`running ${model} on ${fixtures.length} fixtures...`);
  const runs = await runModel(model);
  const okRuns = runs.filter((r) => r.ok);
  const latencies = okRuns.map((r) => r.ms);
  const field = (f: string) =>
    mean(okRuns.map((r) => r.scores[f]).filter((v): v is number => v !== undefined));
  const tokens = runs.reduce(
    (t, r) => ({ i: t.i + r.usage.inputTokens, o: t.o + r.usage.outputTokens }),
    { i: 0, o: 0 },
  );
  const price = prices.models[model];
  const cost =
    price?.input != null && price.output != null
      ? `$${((tokens.i * price.input + tokens.o * price.output) / 1e6).toFixed(4)}`
      : "n/a";
  md.push(
    `| ${model} | ${fieldNames.map((f) => pct(field(f))).join(" | ")} | ${sec(percentile(latencies, 50))} | ${sec(percentile(latencies, 95))} | ${sec(okRuns[0]?.ms ?? NaN)} | ${runs.length - okRuns.length}/${runs.length} | ${runs.filter((r) => r.timeout).length} | ${tokens.i}/${tokens.o} | ${cost} |`,
  );
  const raw = path.join(root, "results", `${date}-${model}.json`);
  writeFileSync(
    raw,
    `${JSON.stringify({ date, model, pricesUpdated: prices.updated, runs }, null, 2)}\n`,
  );
  for (const r of runs.filter((r) => !r.ok)) console.error(`  ${r.fixture}: ${r.error}`);
}

md.push("", `Prices: bench/prices.json (updated ${prices.updated}). Cold = first finished call.`);
const summary = path.join(root, "results", `${date}.md`);
writeFileSync(summary, `${md.join("\n")}\n`);
console.log(`\n${md.join("\n")}\nwrote ${path.relative(process.cwd(), summary)}`);
