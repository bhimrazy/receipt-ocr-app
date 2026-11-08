import {
  EXTRACTION_FAILED_MESSAGE,
  ingestUpload,
  MAX_UPLOAD_BYTES,
  Ocr,
  PRIORITY_BULK,
  PRIORITY_INTERACTIVE,
  type ReceiptExtractResult,
  sniffMediaType,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { after, NextResponse } from "next/server";
import {
  annotateCaller,
  crossOriginResponse,
  discardBody,
  jsonError,
  readFormData,
  runRoute,
  withRequestEvent,
} from "@/lib/http";
import { drainJobs, ROUTE_BUDGET_MS, runJobNow } from "@/lib/jobs";
import type { WideEvent } from "@/lib/log";
import { enforceUploadQuota } from "@/lib/quota";
import { getActiveScope, getSession } from "@/lib/session";

/**
 * Long enough for `after()` to run the queue through a receipt's automatic
 * retries (about 10 s, 20 s, 40 s of backoff). Until a worker or drain route
 * exists, this request is what runs the job.
 */
export const maxDuration = 300;

export const POST = withRequestEvent({ event: "receipt.upload", route: "/api/receipts" }, upload);

async function upload(request: Request, _context: unknown, event: WideEvent) {
  const startedAt = Date.now();
  const requestId = event.request_id ?? crypto.randomUUID();

  const forbidden = crossOriginResponse(request);
  if (forbidden) return discardBody(request, forbidden);

  // Session and workspace come before the body: an anonymous client must not
  // make the server buffer up to MAX_UPLOAD_BYTES (security audit L1).
  const [session, scope] = await Promise.all([getSession(), getActiveScope()]);
  if (!session) return discardBody(request, jsonError(401, "Unauthorized"));
  annotateCaller(event, { session, scope });
  if (!scope) {
    return discardBody(
      request,
      jsonError(409, "No active workspace. Pick or create one before uploading."),
    );
  }

  const form = await readFormData(request, MAX_UPLOAD_BYTES);
  if (form instanceof Response) return form;
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "A receipt file is required");
  const mode = form.get("mode") === "queued" ? "queued" : "instant";
  event.mode = mode;
  const body = new Uint8Array(await file.arrayBuffer());
  // The type sniffed from the bytes, from the upload allowlist; never the client's `file.type`.
  event.file = { size_bytes: file.size, media_type: sniffMediaType(body) ?? "unsupported" };
  // Check quota and OCR config first, so nothing is stored for an upload that can't be scanned.
  const ingest = enforceUploadQuota(scope).pipe(
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
  const jobContext = { request_id: requestId, trigger: "upload" };
  // Runs queued work (this upload, its retries, anything else due) after the response.
  const drainAfter = (jobId: string) =>
    after(() => drainJobs(startedAt + ROUTE_BUDGET_MS, jobContext, [jobId]));

  if (mode === "queued") {
    return runRoute(
      ingest,
      (ingested) => {
        const receiptId = ingested.receipt.id;
        event.receipt_id = receiptId;
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
  }

  return runRoute(
    Effect.gen(function* () {
      const ingested = yield* ingest;
      event.receipt_id = ingested.receipt.id;
      event.job_id = ingested.jobId;
      // The first attempt runs in the request; retries, if it needs any, after the response.
      const run = yield* runJobNow(ingested.jobId, jobContext);
      return { receiptId: ingested.receipt.id, ingested, run };
    }),
    ({ receiptId, ingested, run }) => {
      // Model, tokens and cost are on the attempt's `job.attempt` event.
      const result = run?.result as ReceiptExtractResult | undefined;
      if (run?.outcome === "succeeded" && result?.kind === "completed") {
        event.outcome = "success";
        event.status_code = 200;
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
}
