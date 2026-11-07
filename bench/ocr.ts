// OCR accuracy, latency and cost benchmark.
//   bun run bench:ocr [--models google:gemini-3.8-flash,anthropic:claude-haiku-5-5,...]
//     [--fixtures bench/fixtures] [--prep none,app,long:1568,short:1000] [--only id,id]
//     [--concurrency 2] [--prompt v1|v2] [--dry-run]
// Needs each chosen provider's key (GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY, OPENAI_API_KEY); --dry-run needs none
// and calls nothing. Fixtures: <id>.{png,jpg,jpeg,webp,pdf} + <id>.json (ground truth); images without one
// are skipped. Every model runs on every prep mode; images are prepared in memory, sources never change.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  costOf,
  extractReceipt,
  OCR_PROVIDERS,
  OcrCallError,
  ocrModel,
  priceAt,
  PROMPT_VERSION,
  PROMPT_VERSIONS,
  type ExtractionUsage,
  type ModelId,
  type PromptVersion,
} from "@receipt-ocr/ai";
import { imageTokens, parsePrep, prepare, prepLabel, type Prepared, type PrepSpec } from "./prep";
import {
  AMOUNT_FIELDS,
  EXACT_FIELDS,
  percentile,
  scoreReceipt,
  type Predicted,
  type Receipt,
} from "./score";

const root = import.meta.dirname;
const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

type Fixture = { id: string; file: string };
type Run = {
  fixture: string;
  prep: string;
  /** False when the prep mode didn't apply (a PDF is always sent as is). */
  prepApplied: boolean;
  bytesSent: number;
  mediaTypeSent: string;
  width: number | null;
  height: number | null;
  ok: boolean;
  timeout: boolean;
  ms: number;
  usage: ExtractionUsage | null;
  /** Micro-USD from the model registry's price table; null when unknown. */
  costMicroUsd: number | null;
  scores: Record<string, number>;
  /** The model's extraction, to inspect misses. The raw file is gitignored. */
  got?: Predicted;
  error?: string;
};

// The single call into packages/ai. Bare model names default to the Google provider.
const modelId = (model: string) => (model.includes(":") ? model : `google:${model}`) as ModelId;
const providerOf = (model: string) => ocrModel(modelId(model))?.provider ?? "google";

const keyEnvOf = (model: string) =>
  OCR_PROVIDERS.find((p) => p.id === providerOf(model))?.keyEnv ?? null;

async function extract(model: string, sent: Prepared) {
  const keys = Object.fromEntries(
    OCR_PROVIDERS.flatMap((p) => (p.keyEnv ? [[p.id, process.env[p.keyEnv]]] : [])),
  );
  const { extraction, usage } = await extractReceipt({
    model: modelId(model),
    file: { data: sent.data, mediaType: sent.mediaType },
    keys,
    promptVersion,
  });
  return { got: extraction as Predicted, usage };
}

function arg(name: string, fallback: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const only = arg("only", "").split(",").filter(Boolean);
const concurrency = Math.max(1, Number(arg("concurrency", "2")) || 2);
const dryRun = process.argv.includes("--dry-run");
const promptVersion = arg("prompt", PROMPT_VERSION) as PromptVersion;
if (!PROMPT_VERSIONS.includes(promptVersion)) {
  console.error(`unknown prompt "${promptVersion}" (one of ${PROMPT_VERSIONS.join(", ")})`);
  process.exit(2);
}
const fixtureDir = path.resolve(arg("fixtures", path.join(root, "fixtures")));
// Names the result files, so runs over different sets don't overwrite each other.
const setName = path.basename(fixtureDir);
const preps: PrepSpec[] = arg("prep", "none").split(",").filter(Boolean).map(parsePrep);
const models = arg("models", "google:gemini-3.8-flash")
  .split(",")
  .map((spec) => {
    // Allowlisted models only: their prices are what the run is costed with.
    if (spec === "fixture" || !ocrModel(modelId(spec))) {
      throw new Error(`unknown model "${spec}" (see OCR_MODELS in packages/ai/src/models.ts)`);
    }
    return spec;
  });

const missingKeys = [...new Set(models.map(keyEnvOf))].filter(
  (env): env is string => env !== null && !process.env[env],
);
if (!dryRun && missingKeys.length > 0) {
  console.error(
    `bench:ocr needs ${missingKeys.join(", ")} (real provider calls, billed to you). --dry-run estimates the cost without calling.`,
  );
  process.exit(2);
}

if (!existsSync(fixtureDir)) {
  console.error(`no fixture directory at ${fixtureDir}`);
  process.exit(2);
}
const fixtures: Fixture[] = readdirSync(fixtureDir)
  .filter((file) => MIME[path.extname(file).toLowerCase()])
  .map((file) => ({ id: path.basename(file, path.extname(file)), file }))
  // Ground truth is required; the load test's receipt has none.
  .filter(({ id }) => existsSync(path.join(fixtureDir, `${id}.json`)))
  .filter(({ id }) => only.length === 0 || only.includes(id))
  .sort((a, b) => a.id.localeCompare(b.id));
if (fixtures.length === 0) {
  console.error(`no fixtures with ground truth in ${fixtureDir}`);
  process.exit(2);
}

const truthOf = (id: string) =>
  JSON.parse(readFileSync(path.join(fixtureDir, `${id}.json`), "utf8")) as Receipt;

// Every fixture under every prep mode, once, shared by all models.
const prepared = new Map<string, Prepared>();
for (const spec of preps) {
  for (const { id, file } of fixtures) {
    const bytes = new Uint8Array(readFileSync(path.join(fixtureDir, file)));
    const mediaType = MIME[path.extname(file).toLowerCase()]!;
    prepared.set(`${prepLabel(spec)}|${id}`, await prepare(bytes, mediaType, spec));
  }
}

async function runOne(model: string, prep: string, { id }: Fixture): Promise<Run> {
  const sent = prepared.get(`${prep}|${id}`)!;
  const base = {
    fixture: id,
    prep,
    prepApplied: sent.applied,
    bytesSent: sent.data.byteLength,
    mediaTypeSent: sent.mediaType,
    width: sent.width,
    height: sent.height,
  };
  const started = performance.now();
  try {
    const { got, usage } = await extract(model, sent);
    return {
      ...base,
      ok: true,
      timeout: false,
      ms: performance.now() - started,
      usage,
      costMicroUsd: costOf(modelId(model), usage, new Date()).microUsd,
      scores: scoreReceipt(truthOf(id), got),
      got,
    };
  } catch (error) {
    // The message is the failure kind only, never the model's output.
    const usage = error instanceof OcrCallError ? error.usage : null;
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...base,
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

async function runModel(model: string, prep: string) {
  const runs: Run[] = [];
  const queue = [...fixtures];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) runs.push(await runOne(model, prep, f));
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
const kb = (bytes: number) => (Number.isNaN(bytes) ? "n/a" : `${Math.round(bytes / 1024)} KB`);
const mp = (sent: { width: number | null; height: number | null }[]) => {
  const sizes = sent.flatMap((s) => (s.width && s.height ? [(s.width * s.height) / 1e6] : []));
  return sizes.length ? `${mean(sizes).toFixed(2)} MP` : "n/a";
};
const safe = (s: string) => s.replace(/[^A-Za-z0-9.-]+/g, "_");

/**
 * A rough, generous estimate with no calls. Prompt + schema + structured-output overhead
 * ~2000 tokens for v1 and ~3500 for v2 (its system prompt and field definitions); the image per `imageTokens` on the prepared size (1600 when unknown, e.g. a
 * PDF page); output the ground truth's JSON at ~3 characters a token plus 1000 thinking tokens.
 */
function printEstimate() {
  const FIXED_INPUT = promptVersion === "v1" ? 2000 : 3500;
  const THINKING = 1000;
  const now = new Date();
  const lines = [
    `Dry run: ${fixtures.length} fixtures in ${setName} x ${models.length} models x ${preps.length} prep modes, prompt ${promptVersion}, no calls made.`,
    "",
    "| model | prep | avg bytes | avg size | input tokens | output tokens | est. cost |",
    "|---|---|---|---|---|---|---|",
  ];
  let grand = 0;
  for (const model of models) {
    for (const spec of preps) {
      const prep = prepLabel(spec);
      const sent = fixtures.map(({ id }) => prepared.get(`${prep}|${id}`)!);
      let input = 0;
      let output = 0;
      let micro = 0;
      fixtures.forEach(({ id }, i) => {
        const s = sent[i]!;
        const inputTokens =
          FIXED_INPUT + (imageTokens(providerOf(model), s.width, s.height) ?? 1600);
        const truth = readFileSync(path.join(fixtureDir, `${id}.json`), "utf8");
        const outputTokens = Math.ceil(truth.length / 3) + THINKING;
        input += inputTokens;
        output += outputTokens;
        const usage = {
          inputTokens,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens,
          reasoningTokens: THINKING,
        };
        micro += costOf(modelId(model), usage, now).microUsd ?? 0;
      });
      grand += micro;
      const bytes = kb(mean(sent.map((s) => s.data.byteLength)));
      lines.push(
        `| ${model} | ${prep} | ${bytes} | ${mp(sent)} | ${input} | ${output} | $${(micro / 1e6).toFixed(4)} |`,
      );
    }
  }
  lines.push(`| total | | | | | | $${(grand / 1e6).toFixed(4)} |`);
  console.log(lines.join("\n"));
}

if (dryRun) {
  printEstimate();
  process.exit(0);
}

const date = new Date().toISOString().slice(0, 10);
const runId = `${setName === "fixtures" ? date : `${date}-${safe(setName)}`}-prompt-${promptVersion}`;
mkdirSync(path.join(root, "results"), { recursive: true });
const fieldNames = [...EXACT_FIELDS, ...AMOUNT_FIELDS, "merchant", "itemsF1"];
const md = [
  `# OCR benchmark ${date}`,
  "",
  `${fixtures.length} fixtures from \`${setName}\`, prompt ${promptVersion}, concurrency ${concurrency}, prep ${preps.map(prepLabel).join(", ")}.`,
  "",
  `| model | prep | ${fieldNames.join(" | ")} | p50 | p95 | cold | failed | timeouts | avg bytes | avg size | avg tokens in | tokens in/out | cost |`,
  `|${"---|".repeat(fieldNames.length + 12)}`,
];

for (const model of models) {
  for (const spec of preps) {
    const prep = prepLabel(spec);
    console.log(`running ${model}, prep ${prep}, on ${fixtures.length} fixtures...`);
    const runs = await runModel(model, prep);
    const okRuns = runs.filter((r) => r.ok);
    const latencies = okRuns.map((r) => r.ms);
    const field = (f: string) =>
      mean(okRuns.map((r) => r.scores[f]).filter((v): v is number => v !== undefined));
    const tokens = runs.reduce(
      (t, r) => ({ i: t.i + (r.usage?.inputTokens ?? 0), o: t.o + (r.usage?.outputTokens ?? 0) }),
      { i: 0, o: 0 },
    );
    const avgIn = mean(
      okRuns.flatMap((r) => (r.usage?.inputTokens == null ? [] : [r.usage.inputTokens])),
    );
    const unpriced = runs.filter((r) => r.costMicroUsd === null).length;
    const micro = runs.reduce((sum, r) => sum + (r.costMicroUsd ?? 0), 0);
    const cost =
      unpriced === runs.length ? "n/a" : `$${(micro / 1e6).toFixed(4)}${unpriced ? "*" : ""}`;
    md.push(
      `| ${model} | ${prep} | ${fieldNames.map((f) => pct(field(f))).join(" | ")} | ${sec(percentile(latencies, 50))} | ${sec(percentile(latencies, 95))} | ${sec(okRuns[0]?.ms ?? NaN)} | ${runs.length - okRuns.length}/${runs.length} | ${runs.filter((r) => r.timeout).length} | ${kb(mean(runs.map((r) => r.bytesSent)))} | ${mp(runs)} | ${Number.isNaN(avgIn) ? "n/a" : Math.round(avgIn)} | ${tokens.i}/${tokens.o} | ${cost} |`,
    );
    const raw = path.join(root, "results", `${runId}-${safe(model)}-${safe(prep)}.json`);
    writeFileSync(
      raw,
      `${JSON.stringify({ date, set: setName, model, prep, promptVersion, priceFrom: priceFrom(model), runs }, null, 2)}\n`,
    );
    for (const r of runs.filter((r) => !r.ok)) console.error(`  ${r.fixture}: ${r.error}`);
  }
}

md.push(
  "",
  "Prices: the model registry (packages/ai/src/models.ts), row in effect today. * = some calls reported no usage, so the cost is a lower bound. Cold = first finished call. Bytes and size are what was sent after prep; a PDF is always sent as is.",
);
const summary = path.join(root, "results", `${runId}.md`);
writeFileSync(summary, `${md.join("\n")}\n`);
console.log(`\n${md.join("\n")}\nwrote ${path.relative(process.cwd(), summary)}`);
