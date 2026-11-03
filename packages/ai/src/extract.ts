import { createGoogle } from "@ai-sdk/google";
import { createProviderRegistry, generateText, Output } from "ai";
import { CATEGORY_DESCRIPTIONS, RECEIPT_CATEGORIES } from "./categories";
import { fixtureExtraction } from "./fixture";
import { receiptExtractionSchema, type ReceiptExtraction } from "./schema";

/** `provider:model`, e.g. `google:gemini-3.7-flash`, or `fixture` for the offline provider. */
export type ModelId = `${string}:${string}` | "fixture";

export type ProviderKeys = {
  google?: string;
};

export type ExtractReceiptInput = {
  model: ModelId;
  file: { data: Uint8Array; mediaType: string };
  keys?: ProviderKeys;
  /** Wall-clock budget for the whole call, retries included. */
  timeoutMs?: number;
  /** Retry attempts on transient provider errors. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
};

export type ExtractionUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type ExtractReceiptResult = {
  extraction: ReceiptExtraction;
  usage: ExtractionUsage;
  model: ModelId;
};

/**
 * A congested model once stalled a request for 163 s while the SDK retried
 * "high demand" with backoff; a hard ceiling fails fast into the retryable
 * "failed" state instead.
 */
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRIES = 2;

const PROMPT = [
  "Extract this receipt into structured data.",
  "Use null for missing numeric/date fields; receiptDate must be ISO (YYYY-MM-DD) when present.",
  "currency must be an ISO 4217 code such as USD or EUR.",
  // Observed: an IDR receipt reading 31.000 (31 thousand) came back as 31.00.
  "Numbers use locale-specific separators. Decide from the receipt's own locale and currency whether '.' or ',' is the decimal mark, and emit every amount as a plain number with a '.' decimal point and no grouping separators. A trailing group of exactly three digits after a separator is almost always thousands, not cents.",
  `category must be exactly one of: ${RECEIPT_CATEGORIES.map((c) => `${c} (${CATEGORY_DESCRIPTIONS[c]})`).join("; ")}.`,
  "Confidence values must be between 0 and 1 and reflect how legible each value was.",
].join(" ");

const registries = new Map<string, ReturnType<typeof buildRegistry>>();

function buildRegistry(keys: ProviderKeys) {
  return createProviderRegistry({ google: createGoogle({ apiKey: keys.google }) });
}

/** One registry per key set, so provider clients are reused across calls. */
function registryFor(keys: ProviderKeys) {
  const cacheKey = JSON.stringify(keys);
  let registry = registries.get(cacheKey);
  if (!registry) {
    registry = buildRegistry(keys);
    registries.set(cacheKey, registry);
  }
  return registry;
}

const NO_USAGE: ExtractionUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export async function extractReceipt(input: ExtractReceiptInput): Promise<ExtractReceiptResult> {
  if (input.model === "fixture") {
    return { extraction: fixtureExtraction(input.file.data), usage: NO_USAGE, model: input.model };
  }

  const registry = registryFor(input.keys ?? {});
  const result = await generateText({
    model: registry.languageModel(input.model as `google:${string}`),
    output: Output.object({ schema: receiptExtractionSchema }),
    timeout: { totalMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    maxRetries: input.maxRetries ?? DEFAULT_MAX_RETRIES,
    abortSignal: input.abortSignal,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "file", data: input.file.data, mediaType: input.file.mediaType },
        ],
      },
    ],
  });

  return {
    extraction: result.output,
    usage: {
      inputTokens: result.usage.inputTokens ?? null,
      outputTokens: result.usage.outputTokens ?? null,
      totalTokens: result.usage.totalTokens ?? null,
    },
    model: input.model,
  };
}
