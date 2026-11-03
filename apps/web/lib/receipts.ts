import {
  AppLive,
  ReceiptRepository,
  StorageService,
  type ReceiptPage,
  type ReceiptWithItems,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { mockReceipts } from "./mock-data";
import { getActiveScope } from "./session";

export const HISTORY_PAGE_SIZE = 25;

function mockToReceipt(id: string): ReceiptWithItems | null {
  const receipt = mockReceipts.find((item) => item.id === id) ?? mockReceipts[0];
  if (!receipt) return null;
  return {
    id: receipt.id,
    organizationId: "demo",
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
 * Preview mode: with no session, no workspace, or no database the app renders
 * sample data so the UI is explorable without credentials. This is the ONLY
 * case that returns mock receipts — a real query that fails must surface as an
 * error rather than quietly showing a signed-in user demo data.
 */
function previewReceipts(): ReceiptWithItems[] {
  return mockReceipts
    .map((receipt) => mockToReceipt(receipt.id))
    .filter(Boolean) as ReceiptWithItems[];
}

export async function listReceiptsForWorkspace(page = 1): Promise<ReceiptPage> {
  const scope = await getActiveScope();
  if (!scope || !process.env.DATABASE_URL) {
    const receipts = previewReceipts();
    return { receipts, total: receipts.length };
  }

  const offset = Math.max(0, page - 1) * HISTORY_PAGE_SIZE;
  const program = Effect.gen(function* () {
    const repo = yield* ReceiptRepository;
    return yield* repo.listReceipts(scope, { limit: HISTORY_PAGE_SIZE, offset });
  }).pipe(Effect.provide(AppLive));

  return Effect.runPromise(program);
}

export async function getReceiptForWorkspace(id: string) {
  const scope = await getActiveScope();
  if (!scope || !process.env.DATABASE_URL) return mockToReceipt(id);

  const program = Effect.gen(function* () {
    const repo = yield* ReceiptRepository;
    const storage = yield* StorageService;
    const receipt = yield* repo.getReceipt(id, scope);
    if (!receipt?.imageObjectKey) return receipt;
    // A signed URL is nice-to-have: if signing fails, still render the data.
    const imageUrl = yield* storage
      .getReceiptImageUrl(receipt.imageObjectKey)
      .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    return imageUrl ? { ...receipt, imageUrl } : receipt;
  }).pipe(Effect.provide(AppLive));

  return Effect.runPromise(program);
}
