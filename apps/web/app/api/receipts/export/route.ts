import { NextResponse } from "next/server";
import { csvFilename, receiptsToCsv } from "@/lib/csv";
import { jsonError, runRoute } from "@/lib/http";
import { exportRows, filtersFromSearchParams, MAX_EXPORT_ROWS } from "@/lib/receipts";
import { getActiveScope } from "@/lib/session";

/**
 * CSV of the active workspace's receipts, filtered by the same query params
 * as History (q, category, status, from, to). Built in memory: fine up to
 * MAX_EXPORT_ROWS; a truncated export says so in a header.
 */
export async function GET(request: Request) {
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const filters = filtersFromSearchParams(new URL(request.url).searchParams);

  return runRoute(exportRows(scope, filters), ({ rows, truncated }) =>
    new NextResponse(receiptsToCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvFilename("receipts")}"`,
        "Cache-Control": "no-store",
        "X-Export-Rows": String(rows.length),
        ...(truncated ? { "X-Export-Truncated": `first ${MAX_EXPORT_ROWS} rows` } : {}),
      },
    }),
  );
}
