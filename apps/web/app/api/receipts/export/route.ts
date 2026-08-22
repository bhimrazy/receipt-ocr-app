import { AppLive, ReceiptRepository } from "@receipt-ocr/core";
import { Effect, Exit } from "effect";
import { NextResponse } from "next/server";
import { csvFilename, receiptsToCsv } from "@/lib/csv";
import { getActiveScope } from "@/lib/session";

/** Hard ceiling so one request can't try to stream an unbounded workspace. */
const MAX_EXPORT_ROWS = 5000;

/**
 * CSV export of the active workspace's receipts. Streamed as an attachment so
 * the browser saves it rather than rendering it — the previous "Export All"
 * button was wired to nothing.
 */
export async function GET() {
  const scope = await getActiveScope();
  if (!scope) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const repo = yield* ReceiptRepository;
      return yield* repo.listReceipts(scope, { limit: MAX_EXPORT_ROWS, offset: 0 });
    }).pipe(Effect.provide(AppLive)),
  );

  if (Exit.isFailure(result)) {
    return NextResponse.json({ error: "Failed to export receipts" }, { status: 500 });
  }

  const csv = receiptsToCsv(result.value.receipts);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("receipts")}"`,
      "Cache-Control": "no-store",
    },
  });
}
