import {
  EXTRACTION_FAILED_MESSAGE,
  ingestUpload,
  MAX_UPLOAD_BYTES,
  Ocr,
  PRIORITY_BULK,
  PRIORITY_INTERACTIVE,
  type ReceiptExtractResult,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { after, NextResponse } from "next/server";
import { crossOriginResponse, jsonError, readFormData, runRoute } from "@/lib/http";
import { drainJobs, ROUTE_BUDGET_MS, runJobNow } from "@/lib/jobs";
import { logger, type WideEvent } from "@/lib/log";
import { enforceUploadQuota } from "@/lib/quota";
import { getActiveScope, getSession } from "@/lib/session";

/**
 * Long enough for `after()` to run the queue through a receipt's automatic
 * retries (about 10 s, 20 s, 40 s of backoff). Until a worker or drain route
 * exists, this request is what runs the job.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const event: WideEvent = {
    event: "receipt.upload",
    method: "POST",
    path: "/api/receipts",
    request_id: requestId,
  };
  const respond = (response: Response) => {
    event.status_code ??= response.status;
    event.duration_ms = Date.now() - startedAt;
    (event.outcome === "error" ? logger.error : logger.info)(event);
    return response;
  };

  const forbidden = crossOriginResponse(request);
  if (forbidden) return respond(forbidden);

  // Start reading the body while the session and workspace resolve.
  const formPromise = readFormData(request, MAX_UPLOAD_BYTES);
  const [session, scope] = await Promise.all([getSession(), getActiveScope()]);
  if (!session) return respond(jsonError(401, "Unauthorized"));
  event.user_id = session.user.id;
  // Requests made while an admin impersonates carry the admin's id (security review).
  if (session.session.impersonatedBy) event.impersonated_by = session.session.impersonatedBy;
  if (!scope)
    return respond(jsonError(409, "No active workspace. Pick or create one before uploading."));
  event.organization_id = scope.organizationId;

  const form = await formPromise;
  if (form instanceof Response) return respond(form);
  const file = form.get("file");
  if (!(file instanceof File)) return respond(jsonError(400, "A receipt file is required"));
  const mode = form.get("mode") === "queued" ? "queued" : "instant";
  event.mode = mode;
  event.file = { size_bytes: file.size, declared_type: file.type };

  const body = new Uint8Array(await file.arrayBuffer());
  // Check quota and OCR config first, so nothing is stored for an upload that can't be read.
  const ingest = enforceUploadQuota(session.user.id).pipe(
    Effect.tap(({ plan }) => void (event.plan = plan)),
    Effect.tap(() => Effect.flatMap(Ocr, (ocr) => ocr.ready)),
    Effect.flatMap(({ limits }) =>
      ingestUpload({
        scope,
        fileName: file.name,
        body,
        limits,
        // A batch shouldn't hold up anyone's single upload.
        priority: mode === "queued" ? PRIORITY_BULK : PRIORITY_INTERACTIVE,
      }),
    ),
  );
  const jobContext = { request_id: requestId, user_id: scope.userId };
  // Runs queued work (this upload, its retries, anything else due) after the response.
  const drainAfter = (jobId: string) =>
    after(() => drainJobs(startedAt + ROUTE_BUDGET_MS, jobContext, [jobId]));

  if (mode === "queued") {
    const response = await runRoute(
      ingest,
      (ingested) => {
        const receiptId = ingested.receipt.id;
        event.receipt_id = receiptId;
        event.timings = ingested.timings;
        event.outcome = "queued";
        event.job_id = ingested.jobId;
        // The job runs after the response; the client polls GET /api/receipts/:id.
        drainAfter(ingested.jobId);
        return NextResponse.json(
          { receiptId, status: "processing", requestId, timings: ingested.timings },
          { status: 202 },
        );
      },
      event,
    );
    return respond(response);
  }

  const response = await runRoute(
    Effect.gen(function* () {
      const ingested = yield* ingest;
      event.receipt_id = ingested.receipt.id;
      event.job_id = ingested.jobId;
      // The first attempt runs in the request; retries, if it needs any, after the response.
      const run = yield* runJobNow(ingested.jobId, jobContext);
      return { receiptId: ingested.receipt.id, ingested, run };
    }),
    ({ receiptId, ingested, run }) => {
      event.timings = ingested.timings;
      const result = run?.result as ReceiptExtractResult | undefined;
      if (run?.outcome === "succeeded" && result?.kind === "completed") {
        event.outcome = "success";
        event.status_code = 200;
        event.model = result.model;
        event.cost_micro_usd = result.costMicroUsd;
        event.confidence = result.confidence;
        event.items_count = result.itemsCount;
        return NextResponse.json({
          receiptId,
          status: "completed",
          requestId,
          timings: ingested.timings,
        });
      }
      // The upload itself succeeded: an extraction failure is reported as the
      // receipt's state (failed, retryable), not as a failed request.
      if (run?.outcome === "dead") {
        event.outcome = "error";
        event.status_code = 200;
        event.error = { type: "ExtractionFailed", kind: run.errorKind };
        return NextResponse.json({
          receiptId,
          status: "failed",
          requestId,
          message: EXTRACTION_FAILED_MESSAGE,
        });
      }
      // Retrying after backoff, or not claimable yet: the client polls.
      event.outcome = "queued";
      event.status_code = 202;
      if (run?.errorKind) event.error = { type: "ExtractionRetrying", kind: run.errorKind };
      drainAfter(ingested.jobId);
      return NextResponse.json(
        { receiptId, status: "processing", requestId, timings: ingested.timings },
        { status: 202 },
      );
    },
    event,
  );
  return respond(response);
}
