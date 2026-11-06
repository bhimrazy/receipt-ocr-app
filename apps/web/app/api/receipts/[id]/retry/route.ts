import { claimRetry, extractStored, Ocr } from "@receipt-ocr/core";
import { Effect } from "effect";
import { after, NextResponse } from "next/server";
import { crossOriginResponse, jsonError, recordOcr, runBackground, runRoute } from "@/lib/http";
import { logger, type WideEvent } from "@/lib/log";
import { enforceUploadQuota } from "@/lib/quota";
import { getActiveScope, getSession } from "@/lib/session";

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
  const event: WideEvent = {
    event: "receipt.retry",
    request_id: requestId,
    receipt_id: id,
    user_id: scope.userId,
    ...(session.session.impersonatedBy ? { impersonated_by: session.session.impersonatedBy } : {}),
  };

  const response = await runRoute(
    enforceUploadQuota(session.user.id).pipe(
      Effect.tap((plan) => void (event.plan = plan)),
      Effect.zipRight(Effect.flatMap(Ocr, (ocr) => ocr.ready)),
      Effect.zipRight(claimRetry({ receiptId: id, scope })),
    ),
    () => {
      event.outcome = "queued";
      after(() =>
        runBackground(
          extractStored({ receiptId: id, scope }),
          {
            event: "receipt.extract.background",
            request_id: requestId,
            receipt_id: id,
            user_id: scope.userId,
            retry: true,
          },
          recordOcr,
        ),
      );
      return NextResponse.json({ receiptId: id, status: "processing", requestId }, { status: 202 });
    },
    event,
  );
  event.status_code ??= response.status;
  (event.outcome === "error" ? logger.error : logger.info)(event);
  return response;
}
