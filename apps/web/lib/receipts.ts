import { AppLive, ReceiptRepository, StorageService, type ReceiptWithItems } from "@receipt-ocr/core";
import { Effect } from "effect";
import { mockReceipts } from "./mock-data";
import { getCurrentUserId } from "./session";

function mockToReceipt(id: string): ReceiptWithItems | null {
  const receipt = mockReceipts.find((item) => item.id === id) ?? mockReceipts[0];
  if (!receipt) return null;
  return {
    id: receipt.id,
    userId: "demo",
    merchant: receipt.merchant,
    receiptDate: receipt.receiptDate,
    category: receipt.category,
    currency: "USD",
    subtotal: null,
    tax: receipt.tax,
    tip: null,
    total: receipt.total,
    confidence: receipt.confidence,
    status: receipt.status as "uploaded" | "processing" | "completed" | "failed",
    imageObjectKey: null,
    storageSource: "managed",
    rawJson: receipt,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: receipt.items.map((item) => ({
      ...item,
      receiptId: receipt.id,
    })),
  };
}

/**
 * Preview mode: with no session or no database the app renders sample data so
 * the UI is explorable without credentials. This is the ONLY case that returns
 * mock receipts — a real query that fails must surface as an error rather than
 * quietly showing a signed-in user somebody else's demo data.
 */
function previewReceipts(): ReceiptWithItems[] {
  return mockReceipts.map((receipt) => mockToReceipt(receipt.id)).filter(Boolean) as ReceiptWithItems[];
}

export function isPreviewMode(userId: string | null): boolean {
  return !userId || !process.env.DATABASE_URL;
}

export async function listReceiptsForCurrentUser() {
  const userId = await getCurrentUserId();
  if (isPreviewMode(userId)) return previewReceipts();

  const program = Effect.gen(function* () {
    const repo = yield* ReceiptRepository;
    return yield* repo.listReceipts(userId!);
  }).pipe(Effect.provide(AppLive));

  return Effect.runPromise(program);
}

export async function getReceiptForCurrentUser(id: string) {
  const userId = await getCurrentUserId();
  if (isPreviewMode(userId)) return mockToReceipt(id);

  const program = Effect.gen(function* () {
    const repo = yield* ReceiptRepository;
    const storage = yield* StorageService;
    const receipt = yield* repo.getReceipt(id, userId!);
    if (!receipt?.imageObjectKey) return receipt;
    // A signed URL is nice-to-have: if signing fails, still render the data.
    const imageUrl = yield* storage
      .getReceiptImageUrl(receipt.imageObjectKey)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return imageUrl ? { ...receipt, imageUrl } : receipt;
  }).pipe(Effect.provide(AppLive));

  return Effect.runPromise(program);
}
