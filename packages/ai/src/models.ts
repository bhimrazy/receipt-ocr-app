/**
 * Models an admin may put in the OCR chain. An allowlist, not free text: a
 * typo in a model id would only show up as failed receipts. Add an entry here,
 * with its prices, to offer another model.
 */

export type OcrProviderId = "google" | "anthropic" | "fixture";

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
  longContext?: { aboveInputTokens: number; input: number; output: number };
}

export interface OcrModel {
  id: `${OcrProviderId}:${string}` | "fixture";
  provider: OcrProviderId;
  label: string;
  /** Newest first. */
  prices: readonly ModelPrice[];
}

export const OCR_PROVIDERS: readonly OcrProvider[] = [
  { id: "google", label: "Google Gemini", keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY" },
  { id: "anthropic", label: "Anthropic Claude", keyEnv: "ANTHROPIC_API_KEY" },
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
    prices: [{ from: "2026-11-06", input: 0.3, cachedInput: 0.03, output: 2.5 }],
  },
  // Anthropic prices from https://platform.claude.com/docs/en/about-claude/pricing, checked
  // 2026-11-07. Bare ids only: a date-suffixed id is a different, pinned snapshot.
  {
    id: "anthropic:claude-haiku-5-5",
    provider: "anthropic",
    label: "Claude Haiku 5.5",
    // No published cache-read rate for Haiku 5.5 yet; we send no cache_control, so reads stay 0.
    prices: [
      {
        from: "2026-11-07",
        input: 0.1,
        output: 0.5,
        longContext: { aboveInputTokens: 100_000, input: 0.5, output: 2.5 },
      },
    ],
  },
  {
    id: "anthropic:claude-sonnet-5-5",
    provider: "anthropic",
    label: "Claude Sonnet 5.5",
    prices: [{ from: "2026-11-07", input: 2, cachedInput: 0.2, output: 10 }],
  },
  {
    id: "anthropic:claude-opus-5-5",
    provider: "anthropic",
    label: "Claude Opus 5.5",
    prices: [{ from: "2026-11-07", input: 4, cachedInput: 0.2, output: 20 }],
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
    cached * (price.cachedInput ?? tier.input) +
    written * (price.cacheWrite ?? tier.input) +
    usage.outputTokens * tier.output;
  return Math.round(microUsd);
}
