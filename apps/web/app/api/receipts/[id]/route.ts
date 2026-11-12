import { parseCategory } from "@receipt-ocr/ai/categories";
import { deleteReceipt, JobQueue, ReceiptRepo, type ReceiptPatch } from "@receipt-ocr/core";
import { Effect } from "effect";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  annotateCaller,
  crossOriginResponse,
  jsonError,
  runRoute,
  withRequestEvent,
} from "@/lib/http";
import { MAX_FORM_JSON_BYTES, readJson } from "@/lib/json-body";
import { kickJob } from "@/lib/jobs";
import type { WideEvent } from "@/lib/log";
import { getActiveScope } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

const notFound = () => jsonError(404, "Receipt not found");

/** Room for a kicked job's attempt (OCR deadline 50 s) and its writes. */
export const maxDuration = 120;

/**
 * Status for the polling client. While the receipt is processing, a poll
 * that finds its job due and claimable but not running (its drain ran out of
 * time, or its function was killed) runs that job after the response. A job
 * nobody polls for still waits for the next drain.
 */
export const GET = withRequestEvent(
  { event: "receipt.poll", route: "/api/receipts/[id]", routine: true },
  poll,
);

async function poll(_request: Request, { params }: Params, event: WideEvent) {
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  annotateCaller(event, { scope });
  const { id } = await params;
  event.receipt_id = id;
  return runRoute(
    Effect.gen(function* () {
      const receipt = yield* Effect.flatMap(ReceiptRepo, (repo) => repo.get(id, scope));
      const dueJob =
        receipt?.status === "processing"
          ? yield* Effect.flatMap(JobQueue, (queue) => queue.dueReceiptJob(receipt.id)).pipe(
              Effect.orElseSucceed(() => null),
            )
          : null;
      return { receipt, dueJob };
    }),
    ({ receipt, dueJob }) => {
      if (dueJob) {
        event.job_id = dueJob;
        after(() => kickJob(dueJob, { request_id: event.request_id, trigger: "poll" }));
      }
      return receipt
        ? NextResponse.json({
            id: receipt.id,
            status: receipt.status,
            merchant: receipt.merchant,
            total: receipt.total,
            errorMessage: receipt.errorMessage,
            updatedAt: receipt.updatedAt,
          })
        : notFound();
    },
    event,
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
 * User corrections to an extracted receipt, or `{ reviewed: boolean }` on its
 * own to mark it reviewed or not. Only human-correctable fields are accepted:
 * never status, confidence, ownership or the raw extraction. Members may edit
 * only their own uploads (enforced in ReceiptRepo).
 */
export const PATCH = withRequestEvent(
  { event: "receipt.update", route: "/api/receipts/[id]" },
  update,
);

async function update(request: Request, { params }: Params, event: WideEvent) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  annotateCaller(event, { scope });

  const { id } = await params;
  event.receipt_id = id;
  const read = await readJson(request, z.record(z.string(), z.unknown()), MAX_FORM_JSON_BYTES);
  if ("response" in read) return read.response;
  const body = read.data;

  if ("reviewed" in body) {
    const { reviewed, ...rest } = body;
    if (typeof reviewed !== "boolean") return jsonError(400, "reviewed must be true or false");
    if (Object.keys(rest).length > 0) return jsonError(400, "Send reviewed on its own");
    event.flags = { reviewed };
    return runRoute(
      Effect.flatMap(ReceiptRepo, (repo) => repo.setReviewed(id, scope, reviewed)),
      (updated) => (updated ? NextResponse.json({ ok: true }) : notFound()),
      event,
    );
  }

  const rawCategory = text(body.category, 40);
  const category = rawCategory ? parseCategory(rawCategory) : rawCategory;
  if (category === undefined && rawCategory) return jsonError(400, "Unknown category");

  // Checked in ReceiptRepo.update: a real day from 2000 to a day past the upload.
  const receiptDate = text(body.receiptDate, 32);

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

  // Which fields changed, never their values.
  event.flags = Object.fromEntries(
    Object.entries(patch).flatMap(([key, value]) => (value === undefined ? [] : [[key, true]])),
  );
  return runRoute(
    Effect.flatMap(ReceiptRepo, (repo) => repo.update(id, scope, patch)),
    (updated) => (updated ? NextResponse.json({ ok: true }) : notFound()),
    event,
  );
}

/** Deletes the receipt and its stored file. Members may delete only their own uploads. */
export const DELETE = withRequestEvent(
  { event: "receipt.delete", route: "/api/receipts/[id]" },
  remove,
);

async function remove(request: Request, { params }: Params, event: WideEvent) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  annotateCaller(event, { scope });
  const { id } = await params;
  event.receipt_id = id;
  return runRoute(
    deleteReceipt({ receiptId: id, scope }),
    () => NextResponse.json({ ok: true }),
    event,
  );
}
