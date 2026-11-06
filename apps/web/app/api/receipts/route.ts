import {
  EXTRACTION_FAILED_MESSAGE,
  extractStored,
  ingestUpload,
  MAX_UPLOAD_BYTES,
  Ocr,
} from "@receipt-ocr/core";
import { Cause, Effect } from "effect";
import { after, NextResponse } from "next/server";
import {
  crossOriginResponse,
  failureResponse,
  jsonError,
  readFormData,
  recordOcr,
  runBackground,
  runRoute,
} from "@/lib/http";
import { logger, type WideEvent } from "@/lib/log";
import { enforceUploadQuota } from "@/lib/quota";
import { getActiveScope, getSession } from "@/lib/session";

/** The OCR chain shares a 50 s deadline (OCR_DEADLINE_MS); this leaves room for upload and persistence. */
export const maxDuration = 60;

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
    Effect.tap((plan) => void (event.plan = plan)),
    Effect.zipRight(Effect.flatMap(Ocr, (ocr) => ocr.ready)),
    Effect.zipRight(ingestUpload({ scope, fileName: file.name, body })),
  );

  if (mode === "queued") {
    const response = await runRoute(
      ingest,
      (ingested) => {
        const receiptId = ingested.receipt.id;
        event.receipt_id = receiptId;
        event.timings = ingested.timings;
        event.outcome = "queued";
        // Extraction continues after the response; the client polls GET /api/receipts/:id.
        after(() =>
          runBackground(
            extractStored({ receiptId, scope, file: ingested.file }),
            {
              event: "receipt.extract.background",
              request_id: requestId,
              receipt_id: receiptId,
              user_id: scope.userId,
            },
            recordOcr,
          ),
        );
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
      // The upload itself succeeded: an extraction failure is reported as the
      // receipt's state (failed, retryable), not as a failed request.
      const extracted = yield* extractStored({
        receiptId: ingested.receipt.id,
        scope,
        file: ingested.file,
      }).pipe(Effect.either);
      return { receiptId: ingested.receipt.id, ingested, extracted };
    }),
    ({ receiptId, ingested, extracted }) => {
      if (extracted._tag === "Left") {
        failureResponse(Cause.fail(extracted.left), event);
        event.outcome = "error";
        event.status_code = 200;
        return NextResponse.json({
          receiptId,
          status: "failed",
          requestId,
          message: EXTRACTION_FAILED_MESSAGE,
        });
      }
      const result = extracted.right;
      const timings = [...ingested.timings, ...result.timings];
      event.outcome = "success";
      event.status_code = 200;
      event.timings = timings;
      recordOcr(result, event);
      event.usage = result.usage;
      event.confidence = result.receipt.confidence;
      event.items_count = result.receipt.items.length;
      return NextResponse.json({ receiptId, status: "completed", requestId, timings });
    },
    event,
  );
  return respond(response);
}
