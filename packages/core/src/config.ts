import type { ModelId } from "@receipt-ocr/ai";
import type { S3StorageConfig } from "@receipt-ocr/storage";
import { Config, Effect, Option, Redacted } from "effect";
import { NotConfigured } from "./errors";

/**
 * Config is split per service and read where it is used, so a missing Gemini
 * key only disables extraction: history, receipt pages and export keep working.
 */

const required = (name: string) =>
  Config.string(name).pipe(
    Config.validate({ message: `${name} must not be empty`, validation: (v) => v.trim() !== "" }),
  );

const optional = (name: string) =>
  Config.option(Config.string(name)).pipe(
    Config.map(Option.filter((v) => v.trim() !== "")),
    Config.map(Option.getOrUndefined),
  );

export const DatabaseUrl = Config.redacted(required("DATABASE_URL"));

const storageConfig = Config.all({
  endpoint: optional("S3_ENDPOINT"),
  region: Config.string("S3_REGION").pipe(Config.withDefault("auto")),
  bucket: required("S3_BUCKET"),
  accessKeyId: required("S3_ACCESS_KEY_ID"),
  secretAccessKey: Config.redacted(required("S3_SECRET_ACCESS_KEY")),
  forcePathStyle: Config.boolean("S3_FORCE_PATH_STYLE").pipe(Config.withDefault(true)),
});

export const loadStorageConfig: Effect.Effect<S3StorageConfig, NotConfigured> = storageConfig.pipe(
  Effect.map((c) => ({ ...c, secretAccessKey: Redacted.value(c.secretAccessKey) })),
  Effect.mapError((cause) => new NotConfigured({ message: "Receipt storage is not configured", cause })),
);

export type OcrSettings = {
  model: ModelId;
  googleApiKey?: string;
  timeoutMs: number;
};

const ocrProvider = Config.literal("google", "fixture")("OCR_PROVIDER").pipe(
  Config.withDefault("google" as const),
);

const googleConfig = Config.all({
  model: Config.string("GEMINI_MODEL").pipe(Config.withDefault("gemini-3.7-flash")),
  apiKey: Config.redacted(required("GOOGLE_GENERATIVE_AI_API_KEY")),
  timeoutMs: Config.integer("GEMINI_TIMEOUT_MS").pipe(Config.withDefault(45_000)),
});

export const loadOcrConfig: Effect.Effect<OcrSettings, NotConfigured> = Effect.gen(function* () {
  if ((yield* ocrProvider) === "fixture") return { model: "fixture", timeoutMs: 0 } as const;
  const google = yield* googleConfig;
  return {
    model: `google:${google.model}`,
    googleApiKey: Redacted.value(google.apiKey),
    timeoutMs: google.timeoutMs,
  } satisfies OcrSettings;
}).pipe(
  Effect.mapError((cause) => new NotConfigured({ message: "Receipt extraction is not configured", cause })),
);

/** Optional ceiling on receipts created per UTC day across all users: a spend guard. */
export const loadDailyOcrCap: Effect.Effect<number | undefined, NotConfigured> = Config.option(
  Config.integer("OCR_DAILY_CAP"),
).pipe(
  Effect.map(Option.getOrUndefined),
  Effect.mapError((cause) => new NotConfigured({ message: "OCR_DAILY_CAP must be an integer", cause })),
);
