/**
 * Models an admin may put in the OCR chain. An allowlist, not free text: a
 * typo in a model id would only show up as failed receipts. Add an entry here,
 * with its prices, to offer another model.
 */

export type OcrProviderId = "google" | "fixture";

export interface OcrProvider {
  id: OcrProviderId;
  label: string;
  /** Env var holding the API key; null for providers that need none. */
  keyEnv: string | null;
}

/**
 * USD per 1M tokens, which is also micro-USD per token. `from` is the first
 * UTC day (YYYY-MM-DD) the row applies. Long-context tiers are left out: a
 * receipt is a few thousand tokens.
 */
export interface ModelPrice {
  from: string;
  input: number;
  cachedInput: number;
  /** Includes reasoning ("thinking") tokens. */
  output: number;
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
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  // Reasoning is already inside outputTokens; adding it again would double-count.
  const microUsd =
    (usage.inputTokens - cached) * price.input +
    cached * price.cachedInput +
    usage.outputTokens * price.output;
  return { microUsd: Math.round(microUsd), priceFrom: price.from };
}
