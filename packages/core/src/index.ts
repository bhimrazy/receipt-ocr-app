import { extractReceiptWithGemini, type ReceiptExtraction } from "@receipt-ocr/ai";
import {
  createDb,
  receiptItems,
  receipts,
  type DbClient,
  type Receipt,
  type ReceiptItem,
} from "@receipt-ocr/db";
import {
  getReceiptImageUrl as getS3ReceiptImageUrl,
  putReceiptImage as putS3ReceiptImage,
  type S3StorageConfig,
} from "@receipt-ocr/storage";
import { and, count, desc, eq } from "drizzle-orm";
import { Context, Data, Duration, Effect, Layer } from "effect";

export type ReceiptWithItems = Receipt & { items: ReceiptItem[]; imageUrl?: string };

export { RECEIPT_CATEGORIES, type ReceiptCategory } from "@receipt-ocr/ai/categories";

export type AppConfig = {
  databaseUrl: string;
  geminiApiKey: string;
  geminiModel: string;
  geminiTimeoutMs: number;
  storage: S3StorageConfig;
};

export class ConfigError extends Data.TaggedError("ConfigError")<{
  message: string;
}> {}

export class StorageError extends Data.TaggedError("StorageError")<{
  message: string;
  cause?: unknown;
}> {}

export class AiOcrError extends Data.TaggedError("AiOcrError")<{
  message: string;
  cause?: unknown;
}> {}

export class RepositoryError extends Data.TaggedError("RepositoryError")<{
  message: string;
  cause?: unknown;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  message: string;
}> {}

export class ConfigService extends Context.Tag("ConfigService")<
  ConfigService,
  AppConfig
>() {}

export type StorageServiceShape = {
  putReceiptImage(input: {
    userId: string;
    receiptId: string;
    fileName: string;
    mimeType: string;
    body: Uint8Array;
  }): Effect.Effect<{ objectKey: string }, StorageError>;
  getReceiptImageUrl(objectKey: string): Effect.Effect<string, StorageError>;
};

export class StorageService extends Context.Tag("StorageService")<
  StorageService,
  StorageServiceShape
>() {}

export type AiOcrServiceShape = {
  extractReceipt(input: {
    imageBytes: Uint8Array;
    mimeType: string;
  }): Effect.Effect<ReceiptExtraction, AiOcrError>;
};

export class AiOcrService extends Context.Tag("AiOcrService")<
  AiOcrService,
  AiOcrServiceShape
>() {}

/**
 * Receipts belong to a workspace, not to a person: every member of the
 * organization can read and act on them. `userId` is carried alongside for
 * attribution ("uploaded by") and quota accounting — it never narrows reads.
 */
export type ReceiptScope = {
  organizationId: string;
  userId: string;
};

export type ListReceiptsOptions = {
  /** Rows to return. Omit for the default page size. */
  limit?: number;
  offset?: number;
};

export type ReceiptPage = {
  receipts: ReceiptWithItems[];
  total: number;
};

export type ReceiptRepositoryShape = {
  createUploaded(input: {
    scope: ReceiptScope;
    fileName: string;
  }): Effect.Effect<Receipt, RepositoryError>;
  markProcessing(id: string, scope: ReceiptScope, objectKey: string): Effect.Effect<void, RepositoryError>;
  completeReceipt(
    id: string,
    scope: ReceiptScope,
    extraction: ReceiptExtraction,
  ): Effect.Effect<void, RepositoryError>;
  failReceipt(id: string, scope: ReceiptScope, message: string): Effect.Effect<void, RepositoryError>;
  getReceipt(id: string, scope: ReceiptScope): Effect.Effect<ReceiptWithItems | null, RepositoryError>;
  listReceipts(
    scope: ReceiptScope,
    options?: ListReceiptsOptions,
  ): Effect.Effect<ReceiptPage, RepositoryError>;
  /** Deletes a receipt and its items. Returns false when nothing matched. */
  deleteReceipt(id: string, scope: ReceiptScope): Effect.Effect<boolean, RepositoryError>;
  /** Applies user corrections to an extracted receipt. */
  updateReceipt(
    id: string,
    scope: ReceiptScope,
    patch: ReceiptPatch,
  ): Effect.Effect<ReceiptWithItems | null, RepositoryError>;
};

/** Fields a user may correct on an extracted receipt. */
export type ReceiptPatch = {
  merchant?: string | null;
  receiptDate?: string | null;
  category?: string | null;
  currency?: string | null;
  subtotal?: string | null;
  tax?: string | null;
  tip?: string | null;
  total?: string | null;
};

export class ReceiptRepository extends Context.Tag("ReceiptRepository")<
  ReceiptRepository,
  ReceiptRepositoryShape
>() {}

export type ProcessingStepTiming = { step: string; ms: number };

export type ProcessingResult = {
  receipt: ReceiptWithItems;
  timings: ProcessingStepTiming[];
};

export type UploadInput = {
  scope: ReceiptScope;
  fileName: string;
  mimeType: string;
  body: Uint8Array;
};

export type ReceiptProcessingServiceShape = {
  /** Stage 1: create the receipt row and store the image (fast, always synchronous). */
  ingestUpload(
    input: UploadInput,
  ): Effect.Effect<
    { receipt: Receipt; timings: ProcessingStepTiming[] },
    StorageError | RepositoryError | ValidationError
  >;
  /** Stage 2: run OCR and persist results; marks the receipt failed on any error. */
  extractStored(input: {
    receiptId: string;
    scope: ReceiptScope;
    mimeType: string;
    body: Uint8Array;
  }): Effect.Effect<ProcessingResult, AiOcrError | RepositoryError>;
  /** Both stages back to back — the instant path. */
  processUpload(
    input: UploadInput,
  ): Effect.Effect<ProcessingResult, StorageError | AiOcrError | RepositoryError | ValidationError>;
};

export class ReceiptProcessingService extends Context.Tag("ReceiptProcessingService")<
  ReceiptProcessingService,
  ReceiptProcessingServiceShape
>() {}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError({ message: `Missing required environment variable: ${name}` });
  }
  return value;
}

export const ConfigLive = Layer.effect(
  ConfigService,
  Effect.sync((): AppConfig => {
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE;
    return {
      databaseUrl: requireEnv("DATABASE_URL"),
      geminiApiKey: requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"),
      geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.7-flash",
      geminiTimeoutMs: Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? "", 10) || 45_000,
      storage: {
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION ?? "auto",
        bucket: requireEnv("S3_BUCKET"),
        accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
        forcePathStyle: forcePathStyle === undefined ? true : forcePathStyle === "true",
      },
    };
  }),
);

export const StorageLive = Layer.effect(
  StorageService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return {
      putReceiptImage: (input) =>
        Effect.tryPromise({
          try: () => putS3ReceiptImage(config.storage, input),
          catch: (cause) => new StorageError({ message: "Failed to upload receipt image", cause }),
        }),
      getReceiptImageUrl: (objectKey) =>
        Effect.tryPromise({
          try: () => getS3ReceiptImageUrl(config.storage, objectKey),
          catch: (cause) => new StorageError({ message: "Failed to sign receipt image URL", cause }),
        }),
    } satisfies StorageServiceShape;
  }),
);

export const AiOcrLive = Layer.effect(
  AiOcrService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return {
      extractReceipt: (input) =>
        Effect.tryPromise({
          try: () =>
            extractReceiptWithGemini({
              apiKey: config.geminiApiKey,
              model: config.geminiModel,
              timeoutMs: config.geminiTimeoutMs,
              imageBytes: input.imageBytes,
              mimeType: input.mimeType,
            }),
          catch: (cause) => new AiOcrError({ message: "Gemini OCR extraction failed", cause }),
        }),
    } satisfies AiOcrServiceShape;
  }),
);

/** Every read and write is narrowed to the caller's workspace. */
function scopeWhere(id: string, scope: ReceiptScope) {
  return and(eq(receipts.id, id), eq(receipts.organizationId, scope.organizationId));
}

const DEFAULT_PAGE_SIZE = 25;

function repositoryFromDb(db: DbClient): ReceiptRepositoryShape {
  return {
    createUploaded: (input) =>
      Effect.tryPromise({
        try: async () => {
          const [created] = await db
            .insert(receipts)
            .values({
              organizationId: input.scope.organizationId,
              userId: input.scope.userId,
              status: "uploaded",
              rawJson: { fileName: input.fileName },
            })
            .returning();
          if (!created) {
            throw new Error("Insert returned no row");
          }
          return created;
        },
        catch: (cause) => new RepositoryError({ message: "Failed to create receipt", cause }),
      }),
    markProcessing: (id, scope, objectKey) =>
      Effect.tryPromise({
        try: async () => {
          await db
            .update(receipts)
            .set({ status: "processing", imageObjectKey: objectKey, updatedAt: new Date() })
            .where(scopeWhere(id, scope));
        },
        catch: (cause) => new RepositoryError({ message: "Failed to mark receipt processing", cause }),
      }),
    completeReceipt: (id, scope, extraction) =>
      Effect.tryPromise({
        try: async () => {
          await db.transaction(async (tx) => {
            await tx
              .update(receipts)
              .set({
                status: "completed",
                merchant: extraction.merchant,
                receiptDate: extraction.receiptDate,
                category: extraction.category,
                currency: extraction.currency,
                subtotal: extraction.subtotal == null ? null : String(extraction.subtotal),
                tax: extraction.tax == null ? null : String(extraction.tax),
                tip: extraction.tip == null ? null : String(extraction.tip),
                total: String(extraction.total),
                confidence: String(extraction.confidence),
                rawJson: extraction,
                errorMessage: null,
                updatedAt: new Date(),
              })
              .where(scopeWhere(id, scope));

            await tx.delete(receiptItems).where(eq(receiptItems.receiptId, id));
            if (extraction.items.length > 0) {
              await tx.insert(receiptItems).values(
                extraction.items.map((item) => ({
                  receiptId: id,
                  name: item.name,
                  quantity: Math.max(1, Math.round(item.quantity || 1)),
                  unitPrice: String(item.unitPrice),
                  totalPrice: String(item.totalPrice),
                  confidence: String(item.confidence),
                })),
              );
            }
          });
        },
        catch: (cause) => new RepositoryError({ message: "Failed to complete receipt", cause }),
      }),
    failReceipt: (id, scope, message) =>
      Effect.tryPromise({
        try: async () => {
          await db
            .update(receipts)
            .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
            .where(scopeWhere(id, scope));
        },
        catch: (cause) => new RepositoryError({ message: "Failed to mark receipt failed", cause }),
      }),
    getReceipt: (id, scope) =>
      Effect.tryPromise({
        try: async () => {
          const receipt = await db.query.receipts.findFirst({
            where: scopeWhere(id, scope),
            with: { items: true },
          });
          return receipt ?? null;
        },
        catch: (cause) => new RepositoryError({ message: "Failed to load receipt", cause }),
      }),
    listReceipts: (scope, options) =>
      Effect.tryPromise({
        try: async () => {
          const limit = options?.limit ?? DEFAULT_PAGE_SIZE;
          const offset = options?.offset ?? 0;
          const where = eq(receipts.organizationId, scope.organizationId);
          const [rows, totals] = await Promise.all([
            db.query.receipts.findMany({
              where,
              with: { items: true },
              orderBy: [desc(receipts.createdAt)],
              limit,
              offset,
            }),
            db.select({ value: count() }).from(receipts).where(where),
          ]);
          return { receipts: rows, total: Number(totals[0]?.value ?? 0) };
        },
        catch: (cause) => new RepositoryError({ message: "Failed to list receipts", cause }),
      }),
    deleteReceipt: (id, scope) =>
      Effect.tryPromise({
        try: async () => {
          // receipt_items cascades on the FK, so one delete is enough.
          const deleted = await db.delete(receipts).where(scopeWhere(id, scope)).returning({
            id: receipts.id,
          });
          return deleted.length > 0;
        },
        catch: (cause) => new RepositoryError({ message: "Failed to delete receipt", cause }),
      }),
    updateReceipt: (id, scope, patch) =>
      Effect.tryPromise({
        try: async () => {
          const fields = Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined),
          );
          if (Object.keys(fields).length > 0) {
            await db
              .update(receipts)
              .set({ ...fields, updatedAt: new Date() })
              .where(scopeWhere(id, scope));
          }
          const updated = await db.query.receipts.findFirst({
            where: scopeWhere(id, scope),
            with: { items: true },
          });
          return updated ?? null;
        },
        catch: (cause) => new RepositoryError({ message: "Failed to update receipt", cause }),
      }),
  };
}

export const ReceiptRepositoryLive = Layer.effect(
  ReceiptRepository,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return repositoryFromDb(createDb(config.databaseUrl));
  }),
);

/**
 * Runs a pipeline step and records its duration into `timings`. Timings are
 * returned to the caller so the request boundary can emit one wide event
 * (canonical log line) instead of scattered per-step logs.
 */
const timedStep = <A, E, R>(
  timings: ProcessingStepTiming[],
  step: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.timed(effect).pipe(
    Effect.map(([duration, value]) => {
      timings.push({ step, ms: Math.round(Duration.toMillis(duration)) });
      return value;
    }),
  );

export const ReceiptProcessingLive = Layer.effect(
  ReceiptProcessingService,
  Effect.gen(function* () {
    const storage = yield* StorageService;
    const ai = yield* AiOcrService;
    const repo = yield* ReceiptRepository;

    const ingestUpload = (input: UploadInput) =>
      Effect.gen(function* () {
        if (!input.mimeType.startsWith("image/")) {
          return yield* Effect.fail(new ValidationError({ message: "Only image uploads are supported" }));
        }

        const timings: ProcessingStepTiming[] = [];
        const receipt = yield* timedStep(
          timings,
          "db.create",
          repo.createUploaded({ scope: input.scope, fileName: input.fileName }),
        );
        const stored = yield* timedStep(
          timings,
          "storage.put",
          storage.putReceiptImage({
            userId: input.scope.userId,
            receiptId: receipt.id,
            fileName: input.fileName,
            mimeType: input.mimeType,
            body: input.body,
          }),
        );
        yield* timedStep(
          timings,
          "db.markProcessing",
          repo.markProcessing(receipt.id, input.scope, stored.objectKey),
        );
        return { receipt, timings };
      });

    const extractStored = (input: {
      receiptId: string;
      scope: ReceiptScope;
      mimeType: string;
      body: Uint8Array;
    }) =>
      Effect.gen(function* () {
        const timings: ProcessingStepTiming[] = [];
        const extraction = yield* timedStep(
          timings,
          "ai.extract",
          ai.extractReceipt({ imageBytes: input.body, mimeType: input.mimeType }),
        );
        yield* timedStep(
          timings,
          "db.complete",
          repo.completeReceipt(input.receiptId, input.scope, extraction),
        );
        const completed = yield* timedStep(
          timings,
          "db.load",
          repo.getReceipt(input.receiptId, input.scope),
        );
        if (!completed) {
          return yield* Effect.fail(new RepositoryError({ message: "Completed receipt could not be loaded" }));
        }
        return { receipt: completed, timings };
      }).pipe(
        // A failed extraction must never leave the receipt stuck in "processing".
        Effect.tapError((error) =>
          repo
            .failReceipt(input.receiptId, input.scope, error.message)
            .pipe(
              Effect.catchAll(() =>
                Effect.logError(`receipt.failReceipt_failed: ${input.receiptId}`),
              ),
            ),
        ),
      );

    return {
      ingestUpload,
      extractStored,
      processUpload: (input) =>
        Effect.gen(function* () {
          const ingested = yield* ingestUpload(input);
          const extracted = yield* extractStored({
            receiptId: ingested.receipt.id,
            scope: input.scope,
            mimeType: input.mimeType,
            body: input.body,
          });
          return {
            receipt: extracted.receipt,
            timings: [...ingested.timings, ...extracted.timings],
          };
        }),
    } satisfies ReceiptProcessingServiceShape;
  }),
);

const InfrastructureLive = Layer.mergeAll(
  StorageLive,
  AiOcrLive,
  ReceiptRepositoryLive,
).pipe(Layer.provide(ConfigLive));

export const AppLive = Layer.merge(
  InfrastructureLive,
  ReceiptProcessingLive.pipe(Layer.provide(InfrastructureLive)),
);
