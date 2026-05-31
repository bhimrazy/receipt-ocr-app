import { auth } from "@clerk/nextjs/server";
import { AppLive, ReceiptProcessingService } from "@receipt-ocr/core";
import { Effect } from "effect";
import { NextResponse } from "next/server";

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "A receipt image file is required" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Receipt image must be 10MB or smaller" }, { status: 400 });
  }

  const body = new Uint8Array(await file.arrayBuffer());
  const program = Effect.gen(function* () {
    const processor = yield* ReceiptProcessingService;
    return yield* processor.processUpload({
      userId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      body,
    });
  }).pipe(Effect.provide(AppLive));

  const result = await Effect.runPromiseExit(program);

  if (result._tag === "Failure") {
    const message = result.cause.toString();
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ receiptId: result.value.id });
}
