import { AppLive, ReceiptRepository, type ReceiptPatch } from "@receipt-ocr/core";
import { Effect, Exit } from "effect";
import { NextResponse } from "next/server";
import { RECEIPT_CATEGORIES } from "@receipt-ocr/core";
import { getActiveScope } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getActiveScope();
  if (!scope) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const result = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* ReceiptRepository;
      return yield* repo.getReceipt(id, scope);
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

/** Decimal string for a numeric column, or null to clear it. */
function decimal(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return undefined;
  return parsed.toFixed(2);
}

function text(value: unknown, maxLength = 200): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed === "" ? null : trimmed;
}

/**
 * User corrections to an extracted receipt. OCR gets things wrong, and a
 * confidence score the user cannot act on is worse than no score at all.
 * Only the human-correctable fields are accepted — never status, confidence,
 * ownership, or the raw extraction.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getActiveScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const category = text(body.category, 40);
  if (category && !(RECEIPT_CATEGORIES as readonly string[]).includes(category)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }

  const receiptDate = text(body.receiptDate, 10);
  if (receiptDate && !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) {
    return NextResponse.json({ error: "Date must be in YYYY-MM-DD format" }, { status: 400 });
  }

  const currency = text(body.currency, 3);
  const patch: ReceiptPatch = {
    merchant: text(body.merchant),
    receiptDate,
    category,
    currency: currency ? currency.toUpperCase() : currency,
    subtotal: decimal(body.subtotal),
    tax: decimal(body.tax),
    tip: decimal(body.tip),
    total: decimal(body.total),
  };

  const result = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* ReceiptRepository;
      return yield* repo.updateReceipt(id, scope, patch);
    }).pipe(Effect.provide(AppLive)),
  );

  if (Exit.isFailure(result)) {
    return NextResponse.json({ error: "Failed to update receipt" }, { status: 500 });
  }
  if (!result.value) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getActiveScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* ReceiptRepository;
      return yield* repo.deleteReceipt(id, scope);
    }).pipe(Effect.provide(AppLive)),
  );

  if (Exit.isFailure(result)) {
    return NextResponse.json({ error: "Failed to delete receipt" }, { status: 500 });
  }
  if (!result.value) {
    return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
