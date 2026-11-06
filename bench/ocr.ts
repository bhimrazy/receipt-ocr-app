// OCR accuracy, latency and cost benchmark over bench/fixtures.
//   bun run bench:ocr [--models google:gemini-3.8-flash,...] [--concurrency 2] [--only id,id]
// Needs GOOGLE_GENERATIVE_AI_API_KEY. Fixtures: <id>.{jpg,png,pdf} + <id>.json (ground truth).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  costOf,
  extractReceipt,
  OcrCallError,
  ocrModel,
  priceAt,
  type ExtractionUsage,
  type ModelId,
} from "@receipt-ocr/ai";
import { AMOUNT_FIELDS, EXACT_FIELDS, percentile, scoreReceipt, type Receipt } from "./score";

const root = import.meta.dirname;
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

type Fixture = { id: string; file: string };
type Run = {
  fixture: string;
  ok: boolean;
  timeout: boolean;
  ms: number;
  usage: ExtractionUsage | null;
  /** Micro-USD from the model registry's price table; null when unknown. */
  costMicroUsd: number | null;
  scores: Record<string, number>;
  error?: string;
};

// The single call into packages/ai. Bare model names default to the Google provider.
const modelId = (model: string) => (model.includes(":") ? model : `google:${model}`) as ModelId;

async function extract(model: string, bytes: Uint8Array, mimeType: string) {
  const { extraction, usage } = await extractReceipt({
    model: modelId(model),
    file: { data: bytes, mediaType: mimeType },
    keys: { google: process.env.GOOGLE_GENERATIVE_AI_API_KEY },
  });
  return { got: extraction as Receipt, usage };
}

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
const models = arg("models", "google:gemini-3.8-flash")
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

async function runOne(model: string, { id, file }: Fixture): Promise<Run> {
  const truth = JSON.parse(
    readFileSync(path.join(root, "fixtures", `${id}.json`), "utf8"),
  ) as Receipt;
  const bytes = new Uint8Array(readFileSync(path.join(root, "fixtures", file)));
  const started = performance.now();
  try {
    const { got, usage } = await extract(model, bytes, MIME[path.extname(file)]!);
    return {
      fixture: id,
      ok: true,
      timeout: false,
      ms: performance.now() - started,
      usage,
      costMicroUsd: costOf(modelId(model), usage, new Date()).microUsd,
      scores: scoreReceipt(truth, got),
    };
  } catch (error) {
    // The message is the failure kind only, never the model's output.
    const usage = error instanceof OcrCallError ? error.usage : null;
    const message = error instanceof Error ? error.message : String(error);
    return {
      fixture: id,
      ok: false,
      timeout: error instanceof OcrCallError && error.kind === "timeout",
      ms: performance.now() - started,
      usage,
      costMicroUsd: costOf(modelId(model), usage, new Date()).microUsd,
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

const priceFrom = (model: string) => {
  const entry = ocrModel(modelId(model));
  return (entry && priceAt(entry, new Date())?.from) ?? null;
};

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
    (t, r) => ({ i: t.i + (r.usage?.inputTokens ?? 0), o: t.o + (r.usage?.outputTokens ?? 0) }),
    { i: 0, o: 0 },
  );
  const unpriced = runs.filter((r) => r.costMicroUsd === null).length;
  const micro = runs.reduce((sum, r) => sum + (r.costMicroUsd ?? 0), 0);
  const cost =
    unpriced === runs.length ? "n/a" : `$${(micro / 1e6).toFixed(4)}${unpriced ? "*" : ""}`;
  md.push(
    `| ${model} | ${fieldNames.map((f) => pct(field(f))).join(" | ")} | ${sec(percentile(latencies, 50))} | ${sec(percentile(latencies, 95))} | ${sec(okRuns[0]?.ms ?? NaN)} | ${runs.length - okRuns.length}/${runs.length} | ${runs.filter((r) => r.timeout).length} | ${tokens.i}/${tokens.o} | ${cost} |`,
  );
  const raw = path.join(root, "results", `${date}-${model}.json`);
  writeFileSync(
    raw,
    `${JSON.stringify({ date, model, priceFrom: priceFrom(model), runs }, null, 2)}\n`,
  );
  for (const r of runs.filter((r) => !r.ok)) console.error(`  ${r.fixture}: ${r.error}`);
}

md.push(
  "",
  "Prices: the model registry (packages/ai/src/models.ts), row in effect today. * = some calls reported no usage, so the cost is a lower bound. Cold = first finished call.",
);
const summary = path.join(root, "results", `${date}.md`);
writeFileSync(summary, `${md.join("\n")}\n`);
console.log(`\n${md.join("\n")}\nwrote ${path.relative(process.cwd(), summary)}`);
