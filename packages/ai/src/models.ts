/**
 * Models an admin may put in the OCR chain. An allowlist, not free text: a
 * typo in a model id would only show up as failed receipts. Add an entry here,
 * with its prices, to offer another model.
 */

export type OcrProviderId = "google" | "anthropic" | "groq" | "fixture";

export interface OcrProvider {
  id: OcrProviderId;
  label: string;
  /** Env var holding the API key; null for providers that need none. */
  keyEnv: string | null;
}

/**
 * USD per 1M tokens, which is also micro-USD per token. `from` is the first
 * UTC day (YYYY-MM-DD) the row applies.
 */
export interface ModelPrice {
  from: string;
  input: number;
  /** Reading from the prompt cache. Unset (not published): charged as input, an upper bound. */
  cachedInput?: number;
  /** Writing to the prompt cache (Anthropic bills 1.25× input). Unset: charged as input. */
  cacheWrite?: number;
  /** Includes reasoning ("thinking") tokens. */
  output: number;
  /**
   * Rates for the whole call once its prompt (cached tokens included) is over
   * `aboveInputTokens`. A receipt is a few thousand tokens; a 10-page PDF can cross it.
   */
  longContext?: Pick<ModelPrice, "input" | "cachedInput" | "cacheWrite" | "output"> & {
    aboveInputTokens: number;
  };
}

export interface OcrModel {
  id: `${OcrProviderId}:${string}` | "fixture";
  provider: OcrProviderId;
  label: string;
  /** Newest first. */
  prices: readonly ModelPrice[];
  /**
   * How much of the extraction JSON schema the model accepts. "no-array-bounds" drops
   * `maxItems` from the request (the reply is still checked against the full schema).
   * Default "full".
   */
  schemaMode?: "full" | "no-array-bounds" | "no-bounds";
}

export const OCR_PROVIDERS: readonly OcrProvider[] = [
  { id: "google", label: "Google Gemini", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "anthropic", label: "Anthropic Claude", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY" },
  // Deterministic offline stand-in; only offered when OCR_PROVIDER=fixture (tests, local).
  { id: "fixture", label: "Offline fixture", keyEnv: null },
];

// Google prices from https://ai.google.dev/gemini-api/docs/pricing (Standard, paid tier),
// checked 2026-11-06. The earliest `from` is that check, not the model's launch.
export const OCR_MODELS: readonly OcrModel[] = [
  {
    id: "google:gemini-3.8-flash",
    provider: "google",
    label: "Gemini 3.8 Flash",
    prices: [
      { from: "2027-01-01", input: 1.5, cachedInput: 0.15, output: 7.5 },
      { from: "2026-11-06", input: 0.75, cachedInput: 0.075, output: 3.75 },
    ],
  },
  {
    id: "google:gemini-3.5-flash-lite",
    provider: "google",
    label: "Gemini 3.5 Flash-Lite",
    // Verified 2026-11-07: a `maxItems` on the schema makes generateContent answer 400
    // INVALID_ARGUMENT ("Request contains an invalid argument.") with no detail.
    schemaMode: "no-array-bounds",
    prices: [{ from: "2026-11-06", input: 0.3, cachedInput: 0.03, output: 2.5 }],
  },
  // Anthropic prices from https://platform.claude.com/docs/en/about-claude/pricing, checked
  // 2026-11-07. Bare ids only: a date-suffixed id is a different, pinned snapshot.
  {
    id: "anthropic:claude-haiku-5-5",
    provider: "anthropic",
    label: "Claude Haiku 5.5",
    // Cache reads 0.1x input, 5-minute cache writes 1.25x input, in both tiers. No request sets
    // cache_control today, so these stay unused until one does.
    prices: [
      {
        from: "2026-11-07",
        input: 0.1,
        cachedInput: 0.01,
        cacheWrite: 0.125,
        output: 0.5,
        longContext: {
          aboveInputTokens: 100_000,
          input: 0.5,
          cachedInput: 0.05,
          cacheWrite: 0.625,
          output: 2.5,
        },
      },
    ],
  },
  {
    id: "anthropic:claude-sonnet-5-5",
    provider: "anthropic",
    label: "Claude Sonnet 5.5",
    prices: [{ from: "2026-11-07", input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 }],
  },
  {
    id: "anthropic:claude-opus-5-5",
    provider: "anthropic",
    label: "Claude Opus 5.5",
    prices: [{ from: "2026-11-07", input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 }],
  },
  // Groq: only models its docs list with image input (https://console.groq.com/docs/vision, checked
  // 2026-11-07). muse-spark-open is vision-capable but in limited preview by request, so it is not
  // offered. The price is the paid rate; the free plan bills nothing but is capped at 8K tokens a
  // minute and 1K requests a day (docs/architecture/ai.md), so the ledger's cost is an upper bound there.
  {
    id: "groq:qwen/qwen3.8-27b",
    provider: "groq",
    label: "Qwen 3.8 27B (Groq, preview)",
    // Groq's docs list no supported keywords for best-effort json_schema, so size bounds are
    // dropped from the request. The reply is still checked against the full schema.
    schemaMode: "no-bounds",
    prices: [{ from: "2026-11-07", input: 0.8, output: 4 }],
  },
  {
    id: "fixture",
    provider: "fixture",
    label: "Fixture receipts (no network)",
    prices: [{ from: "2000-01-01", input: 0, cachedInput: 0, output: 0 }],
  },
];

export function ocrModel(id: string): OcrModel | undefined {
  return OCR_MODELS.find((model) => model.id === id);
}

/** Token counts for one model call; null = the provider didn't say (timeout, API error). */
export type ExtractionUsage = {
  /** All prompt tokens, cached ones included. */
  inputTokens: number | null;
  /** The part of `inputTokens` read from the provider's cache. */
  cachedInputTokens: number | null;
  /** The part of `inputTokens` written to the provider's cache. */
  cacheWriteTokens: number | null;
  /** All generated tokens, reasoning included. */
  outputTokens: number | null;
  /** The part of `outputTokens` spent reasoning. */
  reasoningTokens: number | null;
};

/** The price row in effect on `at`'s UTC day. */
export function priceAt(model: OcrModel, at: Date): ModelPrice | undefined {
  const day = at.toISOString().slice(0, 10);
  return model.prices.find((price) => price.from <= day);
}

export type CallCost = { microUsd: number | null; priceFrom: string | null };

/**
 * What one call cost, in integer micro-USD. Null when the model, a price for
 * that day, or the token counts are unknown: unknown is not free.
 */
export function costOf(modelId: string, usage: ExtractionUsage | null, at: Date): CallCost {
  const model = ocrModel(modelId);
  const price = model && priceAt(model, at);
  if (!price || usage?.inputTokens == null || usage.outputTokens == null) {
    return { microUsd: null, priceFrom: null };
  }
  const { inputTokens, outputTokens } = usage;
  return {
    microUsd: priceCall(price, { ...usage, inputTokens, outputTokens }),
    priceFrom: price.from,
  };
}

/** Micro-USD for known token counts at one price row, rounded once. */
export function priceCall(
  price: ModelPrice,
  usage: ExtractionUsage & { inputTokens: number; outputTokens: number },
): number {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const written = Math.min(usage.cacheWriteTokens ?? 0, usage.inputTokens - cached);
  const long = price.longContext;
  const tier = long && usage.inputTokens > long.aboveInputTokens ? long : price;
  // Reasoning is already inside outputTokens; adding it again would double-count.
  const microUsd =
    (usage.inputTokens - cached - written) * tier.input +
    cached * (tier.cachedInput ?? tier.input) +
    written * (tier.cacheWrite ?? tier.input) +
    usage.outputTokens * tier.output;
  return Math.round(microUsd);
}
