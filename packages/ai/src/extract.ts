import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
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
import { CLIENT_CACHE_MAX, configKey, LruCache } from "./client-cache";
import { CATEGORY_DESCRIPTIONS, RECEIPT_CATEGORIES } from "./categories";
import { classifyOcrError, OcrCallError, UnsupportedFileError } from "./errors";
import { fixtureExtraction, fixtureLatencyMs } from "./fixture";
import { imageSize } from "./image-size";
import type { ExtractionUsage, OcrProviderId } from "./models";
import { receiptExtractionSchema, type ReceiptExtraction } from "./schema";

/** Providers reached through the AI SDK registry; `fixture` is handled locally. */
type RegistryProviderId = Exclude<OcrProviderId, "fixture">;

type ProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

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
  // Observed: an IDR receipt reading 31.000 (31 thousand) came back as 31.00. Three-decimal currencies are the exception.
  "Numbers use locale-specific separators. Decide from the receipt's own locale and currency whether '.' or ',' is the decimal mark, and emit every amount as a plain number with a '.' decimal point and no grouping separators. A trailing group of exactly three digits after a separator is almost always thousands, not cents (IDR \"25.000\" is 25000), unless the currency has three minor-unit digits: for KWD, BHD, OMR, JOD, TND and LYD (judge by symbol, code such as KD, BD, RO, JD or DT, or country), three digits after the decimal mark are the fraction (KWD \"1.250\" is 1.25, \"1,250.500 KD\" is 1250.5).",
  `category must be exactly one of: ${RECEIPT_CATEGORIES.map((c) => `${c} (${CATEGORY_DESCRIPTIONS[c]})`).join("; ")}.`,
  "Confidence values must be between 0 and 1 and reflect how legible each value was.",
].join(" ");

const registries = new LruCache<ReturnType<typeof buildRegistry>>(CLIENT_CACHE_MAX);

/** The cache keys, for tests: they must never contain a key. */
export const registryCacheKeys = () => registries.keys();

function buildRegistry(keys: ProviderKeys) {
  return createProviderRegistry({
    google: createGoogle({ apiKey: keys.google }),
    anthropic: createAnthropic({ apiKey: keys.anthropic }),
  } satisfies Record<RegistryProviderId, unknown>);
}

/** One registry per key set (bounded LRU, keyed by a hash), so provider clients are reused across calls. */
export function registryFor(keys: ProviderKeys) {
  const cacheKey = configKey(Object.entries(keys).sort(([a], [b]) => (a < b ? -1 : 1)));
  let registry = registries.get(cacheKey);
  if (!registry) {
    registry = buildRegistry(keys);
    registries.set(cacheKey, registry);
  }
  return registry;
}

/**
 * Claude request settings, one entry per model so each choice is explicit.
 * - Structured output via `output_config.format` (JSON schema), never the forced
 *   `json` tool: Sonnet 5.5 and Opus 5.5 answer forced `tool_choice` with a 400.
 * - Effort `low`: reading a receipt is transcription, not reasoning. The API
 *   defaults are `medium` (Haiku 5.5, Opus 5.5) and `high` (Sonnet 5.5).
 * - No `thinking` setting: adaptive thinking is the default, and Sonnet 5.5 and
 *   Opus 5.5 reject `disabled` and `budget_tokens`. No temperature/top-p/top-k either.
 */
const ANTHROPIC_OPTIONS: Record<
  string,
  Pick<AnthropicLanguageModelOptions, "structuredOutputMode" | "effort">
> = {
  "claude-haiku-5-5": { structuredOutputMode: "outputFormat", effort: "low" },
  "claude-sonnet-5-5": { structuredOutputMode: "outputFormat", effort: "low" },
  "claude-opus-5-5": { structuredOutputMode: "outputFormat", effort: "low" },
};

/** Image types Claude reads; HEIC/HEIF are not among them. */
const ANTHROPIC_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Claude API limit per image: 10 MB base64-encoded
 * (https://platform.claude.com/docs/en/build-with-claude/vision, checked 2026-11-07).
 * Read as 10,000,000 to stay on the safe side of MB vs MiB. Uploads may be 10 MB raw,
 * about 13.4 MB in base64. PDFs fall under the 32 MB request limit instead.
 */
const ANTHROPIC_MAX_IMAGE_BASE64_BYTES = 10_000_000;
/** Same page: larger images are a 400, which would read as bad-image and stop the chain. */
const ANTHROPIC_MAX_IMAGE_EDGE = 8000;

/** The model stopped on a safety refusal; whatever it returned is not an extraction. */
export class RefusalError extends Error {
  override name = "RefusalError";
}

function providerOptionsFor(model: Exclude<ModelId, "fixture">) {
  const [provider, ...rest] = model.split(":");
  if (provider !== "anthropic") return undefined;
  const options = ANTHROPIC_OPTIONS[rest.join(":")];
  return options ? ({ anthropic: options } satisfies ProviderOptions) : undefined;
}

/**
 * Skips a step, before any request, for a file this model can't take. Not
 * `bad-image`: the file may be fine for the next model, so the chain goes on.
 */
function checkFile(model: Exclude<ModelId, "fixture">, file: ExtractReceiptInput["file"]) {
  if (!model.startsWith("anthropic:")) return;
  const unsupported = (why: string) =>
    new OcrCallError("unsupported-file", null, new UnsupportedFileError(`${model}: ${why}`));
  if (file.mediaType === "application/pdf") return;
  if (!ANTHROPIC_IMAGE_TYPES.has(file.mediaType)) throw unsupported(`no ${file.mediaType}`);
  if (Math.ceil(file.data.byteLength / 3) * 4 > ANTHROPIC_MAX_IMAGE_BASE64_BYTES) {
    throw unsupported("image over 10 MB base64");
  }
  const size = imageSize(file.data);
  if (size && Math.max(size.width, size.height) > ANTHROPIC_MAX_IMAGE_EDGE) {
    throw unsupported(`image over ${ANTHROPIC_MAX_IMAGE_EDGE} px`);
  }
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
    const latency = fixtureLatencyMs();
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
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
  checkFile(input.model, input.file);
  const { extraction, usage } = await extractWith(
    registryFor(input.keys ?? {}).languageModel(input.model),
    { ...input, providerOptions: providerOptionsFor(input.model) },
  );
  return { extraction, usage, model: input.model };
}

/** The model call itself, separate from the registry so tests can pass a mock model. */
export async function extractWith(
  model: LanguageModel,
  input: Omit<ExtractReceiptInput, "model" | "keys"> & { providerOptions?: ProviderOptions },
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
      providerOptions: input.providerOptions,
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
    // Claude's `stop_reason: "refusal"` (and Gemini's safety stop) arrive as
    // content-filter. Text that parsed is still not an extraction; text that
    // didn't throws NoObjectGeneratedError, which classifyOcrError also reads as refused.
    if (result.finishReason === "content-filter") {
      throw new OcrCallError("refused", usage, new RefusalError("model refused"));
    }
    return { extraction: result.output, usage };
  } catch (error) {
    if (error instanceof OcrCallError) throw error;
    throw new OcrCallError(classifyOcrError(error), usageOf(error) ?? usage, error);
  }
}
