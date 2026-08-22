import { AppLive, ReceiptProcessingService, ValidationError } from "@receipt-ocr/core";
import { Cause, Effect, Exit, Option } from "effect";
import { NextResponse } from "next/server";
import { after } from "next/server";
import { logger, type WideEvent } from "@/lib/log";
import { checkUploadQuota, quotaMessage } from "@/lib/quota";
import { getSession, planFor } from "@/lib/session";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function failureContext(cause: Cause.Cause<{ readonly message: string; readonly _tag?: string }>) {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    return {
      message: failure.value.message,
      type: failure.value._tag ?? "UnknownError",
      status: failure.value instanceof ValidationError ? 400 : 500,
    };
  }
  return { message: "Receipt processing failed", type: "Defect", status: 500 };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const event: WideEvent = {
    event: "receipt.upload",
    method: "POST",
    path: "/api/receipts",
    request_id: requestId,
  };

  try {
    const session = await getSession();
    const userId = session?.user.id ?? null;
    if (!userId) {
      event.status_code = 401;
      event.outcome = "unauthorized";
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    event.user_id = userId;

    const plan = planFor(session);
    event.plan = plan;
    const quota = await checkUploadQuota(userId, plan);
    event.quota_used = quota.used;
    event.quota_limit = quota.limit;
    if (!quota.allowed) {
      event.status_code = 429;
      event.outcome = "rate_limited";
      event.quota_window = quota.window;
      return NextResponse.json(
        { error: quotaMessage(quota) },
        {
          status: 429,
          headers: quota.retryAfterSeconds
            ? { "Retry-After": String(quota.retryAfterSeconds) }
            : undefined,
        },
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    const mode = form.get("mode") === "queued" ? "queued" : "instant";
    event.mode = mode;

    if (!(file instanceof File)) {
      event.status_code = 400;
      event.outcome = "invalid_input";
      return NextResponse.json({ error: "A receipt image file is required" }, { status: 400 });
    }
    event.file = { name: file.name, size_bytes: file.size, mime_type: file.type };

    if (file.size > MAX_FILE_SIZE) {
      event.status_code = 400;
      event.outcome = "file_too_large";
      return NextResponse.json({ error: "Receipt image must be 10MB or smaller" }, { status: 400 });
    }

    const body = new Uint8Array(await file.arrayBuffer());
    const upload = {
      userId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      body,
    };

    if (mode === "queued") {
      const ingested = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const processor = yield* ReceiptProcessingService;
          return yield* processor.ingestUpload(upload);
        }).pipe(Effect.provide(AppLive)),
      );

      if (Exit.isFailure(ingested)) {
        const failure = failureContext(ingested.cause);
        event.status_code = failure.status;
        event.outcome = "error";
        event.error = { message: failure.message, type: failure.type };
        return NextResponse.json({ error: failure.message }, { status: failure.status });
      }

      const receiptId = ingested.value.receipt.id;
      event.receipt_id = receiptId;
      event.timings = ingested.value.timings;
      event.status_code = 202;
      event.outcome = "queued";

      // Extraction continues after the response is sent; the client polls
      // GET /api/receipts/:id (or the receipt page) for the outcome.
      after(async () => {
        const extractStartedAt = Date.now();
        const extractEvent: WideEvent = {
          event: "receipt.extract.background",
          request_id: requestId,
          receipt_id: receiptId,
          user_id: userId,
          file: event.file,
        };
        const extracted = await Effect.runPromiseExit(
          Effect.gen(function* () {
            const processor = yield* ReceiptProcessingService;
            return yield* processor.extractStored({
              receiptId,
              userId,
              mimeType: upload.mimeType,
              body,
            });
          }).pipe(Effect.provide(AppLive)),
        );
        extractEvent.duration_ms = Date.now() - extractStartedAt;
        if (Exit.isFailure(extracted)) {
          const failure = failureContext(extracted.cause);
          extractEvent.outcome = "error";
          extractEvent.error = { message: failure.message, type: failure.type };
          logger.error(extractEvent);
          return;
        }
        extractEvent.outcome = "success";
        extractEvent.timings = extracted.value.timings;
        extractEvent.merchant = extracted.value.receipt.merchant;
        extractEvent.confidence = extracted.value.receipt.confidence;
        extractEvent.items_count = extracted.value.receipt.items.length;
        logger.info(extractEvent);
      });

      return NextResponse.json(
        { receiptId, status: "processing", requestId, timings: ingested.value.timings },
        { status: 202 },
      );
    }

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const processor = yield* ReceiptProcessingService;
        return yield* processor.processUpload(upload);
      }).pipe(Effect.provide(AppLive)),
    );

    if (Exit.isFailure(result)) {
      const failure = failureContext(result.cause);
      event.status_code = failure.status;
      event.outcome = "error";
      event.error = { message: failure.message, type: failure.type };
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }

    event.receipt_id = result.value.receipt.id;
    event.timings = result.value.timings;
    event.merchant = result.value.receipt.merchant;
    event.confidence = result.value.receipt.confidence;
    event.items_count = result.value.receipt.items.length;
    event.status_code = 200;
    event.outcome = "success";

    return NextResponse.json({
      receiptId: result.value.receipt.id,
      status: "completed",
      requestId,
      timings: result.value.timings,
    });
  } catch (error) {
    event.status_code = 500;
    event.outcome = "error";
    event.error = {
      message: error instanceof Error ? error.message : String(error),
      type: error instanceof Error ? error.name : "UnknownError",
    };
    return NextResponse.json({ error: "Receipt processing failed" }, { status: 500 });
  } finally {
    event.duration_ms = Date.now() - startedAt;
    if (event.outcome === "error") {
      logger.error(event);
    } else {
      logger.info(event);
    }
  }
}
