import { claimRetry, extractStored, loadOcrConfig } from "@receipt-ocr/core";
import { Effect } from "effect";
import { after, NextResponse } from "next/server";
import { crossOriginResponse, jsonError, runBackground, runRoute } from "@/lib/http";
import { logger, type WideEvent } from "@/lib/log";
import { enforceUploadQuota } from "@/lib/quota";
import { getActiveScope, getSession, planFor } from "@/lib/session";

export const maxDuration = 60;

/**
 * Re-runs extraction for a failed receipt on its stored file. Responds 202
 * once claimed; the client polls GET /api/receipts/:id like a queued upload.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const [session, scope] = await Promise.all([getSession(), getActiveScope()]);
  if (!session || !scope) return jsonError(401, "Unauthorized");
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const event: WideEvent = { event: "receipt.retry", request_id: requestId, receipt_id: id, user_id: scope.userId };

  const response = await runRoute(
    enforceUploadQuota(session.user.id, planFor(session)).pipe(
      Effect.zipRight(loadOcrConfig),
      Effect.zipRight(claimRetry({ receiptId: id, scope })),
    ),
    (file) => {
      event.outcome = "queued";
      after(() =>
        runBackground(extractStored({ receiptId: id, scope, file }), {
          event: "receipt.extract.background",
          request_id: requestId,
          receipt_id: id,
          user_id: scope.userId,
          retry: true,
        }),
      );
      return NextResponse.json({ receiptId: id, status: "processing", requestId }, { status: 202 });
    },
    event,
  );
  event.status_code ??= response.status;
  (event.outcome === "error" ? logger.error : logger.info)(event);
  return response;
}
