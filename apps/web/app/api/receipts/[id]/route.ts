import { parseCategory } from "@receipt-ocr/ai/categories";
import { deleteReceipt, ReceiptRepo, type ReceiptPatch } from "@receipt-ocr/core";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { crossOriginResponse, jsonError, runRoute } from "@/lib/http";
import { getActiveScope } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

const notFound = () => jsonError(404, "Receipt not found");

/** Status for the polling client. */
export async function GET(_request: Request, { params }: Params) {
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const { id } = await params;
  return runRoute(
    Effect.flatMap(ReceiptRepo, (repo) => repo.get(id, scope)),
    (receipt) =>
      receipt
        ? NextResponse.json({
            id: receipt.id,
            status: receipt.status,
            merchant: receipt.merchant,
            total: receipt.total,
            errorMessage: receipt.errorMessage,
            updatedAt: receipt.updatedAt,
          })
        : notFound(),
  );
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
 * User corrections to an extracted receipt. Only human-correctable fields
 * are accepted: never status, confidence, ownership or the raw extraction.
 * Members may edit only their own uploads (enforced in ReceiptRepo).
 */
export async function PATCH(request: Request, { params }: Params) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "Invalid request body");
  }

  const rawCategory = text(body.category, 40);
  const category = rawCategory ? parseCategory(rawCategory) : rawCategory;
  if (category === undefined && rawCategory) return jsonError(400, "Unknown category");

  const receiptDate = text(body.receiptDate, 10);
  if (receiptDate && !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate)) {
    return jsonError(400, "Date must be in YYYY-MM-DD format");
  }

  const currency = text(body.currency, 3);
  if (currency && !/^[A-Za-z]{3}$/.test(currency))
    return jsonError(400, "Currency must be a 3-letter code");

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

  return runRoute(
    Effect.flatMap(ReceiptRepo, (repo) => repo.update(id, scope, patch)),
    (updated) => (updated ? NextResponse.json({ ok: true }) : notFound()),
  );
}

/** Deletes the receipt and its stored file. Members may delete only their own uploads. */
export async function DELETE(request: Request, { params }: Params) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const { id } = await params;
  return runRoute(deleteReceipt({ receiptId: id, scope }), () => NextResponse.json({ ok: true }));
}
