import { claimRetry, Ocr } from "@receipt-ocr/core";
import { Effect } from "effect";
import { after, NextResponse } from "next/server";
import { crossOriginResponse, jsonError, runRoute } from "@/lib/http";
import { drainJobs, ROUTE_BUDGET_MS } from "@/lib/jobs";
import { logger, type WideEvent } from "@/lib/log";
import { enforceUploadQuota } from "@/lib/quota";
import { getActiveScope, getSession } from "@/lib/session";

/** Room for `after()` to run the new round's job through its automatic retries. */
export const maxDuration = 300;

/**
 * Re-runs extraction for a failed receipt on its stored file, as a new round
 * with its own job. Responds 202 once claimed; the client polls
 * GET /api/receipts/:id like a queued upload.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
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
      Effect.tap(({ plan }) => void (event.plan = plan)),
      Effect.tap(() => Effect.flatMap(Ocr, (ocr) => ocr.ready)),
      Effect.flatMap(({ limits }) => claimRetry({ receiptId: id, scope, limits })),
    ),
    ({ round, jobId }) => {
      event.outcome = "queued";
      event.round = round;
      event.job_id = jobId;
      after(() =>
        drainJobs(startedAt + ROUTE_BUDGET_MS, { request_id: requestId, user_id: scope.userId }, [
          jobId,
        ]),
      );
      return NextResponse.json({ receiptId: id, status: "processing", requestId }, { status: 202 });
    },
    event,
  );
  event.status_code ??= response.status;
  (event.outcome === "error" ? logger.error : logger.info)(event);
  return response;
}
