import { AppLive, ReceiptRepository } from "@receipt-ocr/core";
import { Effect, Exit } from "effect";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* ReceiptRepository;
      return yield* repo.getReceipt(id, userId);
    }).pipe(Effect.provide(AppLive)),
  );

  if (Exit.isFailure(result)) {
    return NextResponse.json({ error: "Failed to load receipt" }, { status: 500 });
  }
  if (!result.value) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }

  const receipt = result.value;
  return NextResponse.json({
    id: receipt.id,
    status: receipt.status,
    merchant: receipt.merchant,
    total: receipt.total,
    errorMessage: receipt.errorMessage,
    updatedAt: receipt.updatedAt,
  });
}
