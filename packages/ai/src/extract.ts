import { createGoogle } from "@ai-sdk/google";
import {
  createProviderRegistry,
  generateText,
  NoObjectGeneratedError,
  Output,
  RetryError,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import { CATEGORY_DESCRIPTIONS, RECEIPT_CATEGORIES } from "./categories";
import { classifyOcrError, OcrCallError } from "./errors";
import { fixtureExtraction } from "./fixture";
import type { ExtractionUsage, OcrProviderId } from "./models";
import { receiptExtractionSchema, type ReceiptExtraction } from "./schema";

/** Providers reached through the AI SDK registry; `fixture` is handled locally. */
type RegistryProviderId = Exclude<OcrProviderId, "fixture">;

/** `provider:model`, e.g. `google:gemini-3.8-flash`, or `fixture` for the offline provider. */
export type ModelId = `${RegistryProviderId}:${string}` | "fixture";

export type ProviderKeys = Partial<Record<RegistryProviderId, string>>;

export type ExtractReceiptInput = {
  model: ModelId;
  file: { data: Uint8Array; mediaType: string };
  keys?: ProviderKeys;
  /** Wall-clock budget for the whole call, retries included. */
  timeoutMs?: number;
  /** Retries on transient provider errors within this one call. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
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
/**
 * Caps one call's output cost. Thinking tokens count toward it, so it sits
 * well above what a long receipt's JSON needs.
 */
const MAX_OUTPUT_TOKENS = 16_384;

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
  return createProviderRegistry({
    google: createGoogle({ apiKey: keys.google }),
  } satisfies Record<RegistryProviderId, unknown>);
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

const NO_USAGE: ExtractionUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

/** ai v7 totals already include cached input and reasoning output; the details split them out. */
export function toUsage(usage: LanguageModelUsage): ExtractionUsage {
  return {
    inputTokens: usage.inputTokens ?? null,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? null,
  };
}

/** A schema or parse failure was still a billed call; the SDK attaches its usage. */
function usageOf(error: unknown): ExtractionUsage | null {
  if (RetryError.isInstance(error)) return usageOf(error.lastError);
  if (NoObjectGeneratedError.isInstance(error) && error.usage) return toUsage(error.usage);
  return null;
}

/**
 * One extraction with one model: no fallback here, the caller owns routing.
 * Every failure is an `OcrCallError` with its kind and whatever usage is known.
 */
export async function extractReceipt(input: ExtractReceiptInput): Promise<ExtractReceiptResult> {
  if (input.model === "fixture") {
    try {
      return {
        extraction: fixtureExtraction(input.file.data),
        usage: NO_USAGE,
        model: input.model,
      };
    } catch (error) {
      throw new OcrCallError(classifyOcrError(error), null, error);
    }
  }
  const { extraction, usage } = await extractWith(
    registryFor(input.keys ?? {}).languageModel(input.model),
    input,
  );
  return { extraction, usage, model: input.model };
}

/** The model call itself, separate from the registry so tests can pass a mock model. */
export async function extractWith(
  model: LanguageModel,
  input: Omit<ExtractReceiptInput, "model" | "keys">,
): Promise<Omit<ExtractReceiptResult, "model">> {
  let usage: ExtractionUsage | null = null;
  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: receiptExtractionSchema }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
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
    // Before `output`: reading it throws on an empty or truncated reply, which was still billed.
    usage = toUsage(result.usage);
    return { extraction: result.output, usage };
  } catch (error) {
    throw new OcrCallError(classifyOcrError(error), usageOf(error) ?? usage, error);
  }
}
