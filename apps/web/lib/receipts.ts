import { auth } from "@clerk/nextjs/server";
import { AppLive, ReceiptRepository, StorageService, type ReceiptWithItems } from "@receipt-ocr/core";
import { Effect } from "effect";
import { mockReceipts } from "./mock-data";

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

export async function getCurrentUserId() {
  const { userId } = await auth();
  return userId;
}

export async function listReceiptsForCurrentUser() {
  const userId = await getCurrentUserId();
  if (!userId || !process.env.DATABASE_URL) {
    return mockReceipts.map((receipt) => mockToReceipt(receipt.id)).filter(Boolean) as ReceiptWithItems[];
  }

  const program = Effect.gen(function* () {
    const repo = yield* ReceiptRepository;
    return yield* repo.listReceipts(userId);
  }).pipe(Effect.provide(AppLive));

  return Effect.runPromise(program).catch(
    () => mockReceipts.map((receipt) => mockToReceipt(receipt.id)).filter(Boolean) as ReceiptWithItems[],
  );
}

export async function getReceiptForCurrentUser(id: string) {
  const userId = await getCurrentUserId();
  if (!userId || id.startsWith("demo") || !process.env.DATABASE_URL) {
    return mockToReceipt(id);
  }

  const program = Effect.gen(function* () {
    const repo = yield* ReceiptRepository;
    const storage = yield* StorageService;
    const receipt = yield* repo.getReceipt(id, userId);
    if (!receipt?.imageObjectKey) return receipt;
    const imageUrl = yield* storage.getReceiptImageUrl(receipt.imageObjectKey);
    return { ...receipt, imageUrl };
  }).pipe(Effect.provide(AppLive));

  return Effect.runPromise(program).catch(() => mockToReceipt(id));
}
