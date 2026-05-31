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
import { and, desc, eq } from "drizzle-orm";
import { Context, Data, Effect, Layer } from "effect";

export type ReceiptWithItems = Receipt & { items: ReceiptItem[]; imageUrl?: string };

export type AppConfig = {
  databaseUrl: string;
  geminiApiKey: string;
  geminiModel: string;
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

export type ReceiptRepositoryShape = {
  createUploaded(input: {
    userId: string;
    fileName: string;
  }): Effect.Effect<Receipt, RepositoryError>;
  markProcessing(id: string, userId: string, objectKey: string): Effect.Effect<void, RepositoryError>;
  completeReceipt(
    id: string,
    userId: string,
    extraction: ReceiptExtraction,
  ): Effect.Effect<void, RepositoryError>;
  failReceipt(id: string, userId: string, message: string): Effect.Effect<void, RepositoryError>;
  getReceipt(id: string, userId: string): Effect.Effect<ReceiptWithItems | null, RepositoryError>;
  listReceipts(userId: string): Effect.Effect<ReceiptWithItems[], RepositoryError>;
};

export class ReceiptRepository extends Context.Tag("ReceiptRepository")<
  ReceiptRepository,
  ReceiptRepositoryShape
>() {}

export type ReceiptProcessingServiceShape = {
  processUpload(input: {
    userId: string;
    fileName: string;
    mimeType: string;
    body: Uint8Array;
  }): Effect.Effect<ReceiptWithItems, StorageError | AiOcrError | RepositoryError | ValidationError>;
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
      geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
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
              imageBytes: input.imageBytes,
              mimeType: input.mimeType,
            }),
          catch: (cause) => new AiOcrError({ message: "Gemini OCR extraction failed", cause }),
        }),
    } satisfies AiOcrServiceShape;
  }),
);

function repositoryFromDb(db: DbClient): ReceiptRepositoryShape {
  return {
    createUploaded: (input) =>
      Effect.tryPromise({
        try: async () => {
          const [created] = await db
            .insert(receipts)
            .values({
              userId: input.userId,
              status: "uploaded",
              rawJson: { fileName: input.fileName },
            })
            .returning();
          return created;
        },
        catch: (cause) => new RepositoryError({ message: "Failed to create receipt", cause }),
      }),
    markProcessing: (id, userId, objectKey) =>
      Effect.tryPromise({
        try: async () => {
          await db
            .update(receipts)
            .set({ status: "processing", imageObjectKey: objectKey, updatedAt: new Date() })
            .where(and(eq(receipts.id, id), eq(receipts.userId, userId)));
        },
        catch: (cause) => new RepositoryError({ message: "Failed to mark receipt processing", cause }),
      }),
    completeReceipt: (id, userId, extraction) =>
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
              .where(and(eq(receipts.id, id), eq(receipts.userId, userId)));

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
    failReceipt: (id, userId, message) =>
      Effect.tryPromise({
        try: async () => {
          await db
            .update(receipts)
            .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
            .where(and(eq(receipts.id, id), eq(receipts.userId, userId)));
        },
        catch: (cause) => new RepositoryError({ message: "Failed to mark receipt failed", cause }),
      }),
    getReceipt: (id, userId) =>
      Effect.tryPromise({
        try: async () => {
          const receipt = await db.query.receipts.findFirst({
            where: and(eq(receipts.id, id), eq(receipts.userId, userId)),
            with: { items: true },
          });
          return receipt ?? null;
        },
        catch: (cause) => new RepositoryError({ message: "Failed to load receipt", cause }),
      }),
    listReceipts: (userId) =>
      Effect.tryPromise({
        try: () =>
          db.query.receipts.findMany({
            where: eq(receipts.userId, userId),
            with: { items: true },
            orderBy: [desc(receipts.createdAt)],
          }),
        catch: (cause) => new RepositoryError({ message: "Failed to list receipts", cause }),
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

export const ReceiptProcessingLive = Layer.effect(
  ReceiptProcessingService,
  Effect.gen(function* () {
    const storage = yield* StorageService;
    const ai = yield* AiOcrService;
    const repo = yield* ReceiptRepository;

    return {
      processUpload: (input) =>
        Effect.gen(function* () {
          if (!input.mimeType.startsWith("image/")) {
            return yield* Effect.fail(new ValidationError({ message: "Only image uploads are supported" }));
          }

          const receipt = yield* repo.createUploaded({
            userId: input.userId,
            fileName: input.fileName,
          });
          const stored = yield* storage.putReceiptImage({
            userId: input.userId,
            receiptId: receipt.id,
            fileName: input.fileName,
            mimeType: input.mimeType,
            body: input.body,
          });

          yield* repo.markProcessing(receipt.id, input.userId, stored.objectKey);

          const extraction = yield* ai.extractReceipt({
            imageBytes: input.body,
            mimeType: input.mimeType,
          });

          yield* repo.completeReceipt(receipt.id, input.userId, extraction);
          const completed = yield* repo.getReceipt(receipt.id, input.userId);
          if (!completed) {
            return yield* Effect.fail(new RepositoryError({ message: "Completed receipt could not be loaded" }));
          }
          return completed;
        }).pipe(
          Effect.tapError((error) =>
            "message" in error
              ? Effect.logError(error.message)
              : Effect.logError("Receipt processing failed"),
          ),
        ),
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
