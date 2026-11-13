import { claimRetry, Ocr } from "@receipt-ocr/core";
import { Effect } from "effect";
import { after, NextResponse } from "next/server";
import {
  annotateCaller,
  crossOriginResponse,
  jsonError,
  runRoute,
  withRequestEvent,
} from "@/lib/http";
import { drainJobs, ROUTE_BUDGET_MS } from "@/lib/jobs";
import type { WideEvent } from "@/lib/log";
import { enforceUploadQuota } from "@/lib/quota";
import { getActiveScope, getSession } from "@/lib/session";

/** Room for `after()` to run the new round's job through its automatic retries. */
export const maxDuration = 300;

/**
 * Re-runs extraction for a failed receipt on its stored file, as a new round
 * with its own job. Responds 202 once claimed; the client polls
 * GET /api/receipts/:id like a queued upload.
 */
export const POST = withRequestEvent(
  { event: "receipt.retry", route: "/api/receipts/[id]/retry" },
  retry,
);

async function retry(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
  event: WideEvent,
) {
  const startedAt = Date.now();
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const [session, scope] = await Promise.all([getSession(), getActiveScope()]);
  if (!session || !scope) return jsonError(401, "Unauthorized");
  annotateCaller(event, { session, scope });
  const { id } = await params;
  const requestId = event.request_id ?? crypto.randomUUID();
  event.receipt_id = id;

  return runRoute(
    enforceUploadQuota(scope, session.user.createdAt).pipe(
      Effect.tap(({ plan }) => void (event.plan = plan)),
      Effect.tap(() => Effect.flatMap(Ocr, (ocr) => ocr.ready)),
      Effect.flatMap(({ limits }) => claimRetry({ receiptId: id, scope, limits })),
    ),
    ({ round, jobId }) => {
      event.outcome = "queued";
      event.round = round;
      event.job_id = jobId;
      after(() =>
        drainJobs(startedAt + ROUTE_BUDGET_MS, { request_id: requestId, trigger: "retry" }, [
          jobId,
        ]),
      );
      return NextResponse.json({ receiptId: id, status: "processing", requestId }, { status: 202 });
    },
    event,
  );
}
