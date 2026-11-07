import { NextResponse } from "next/server";
import { csvFilename, receiptsToCsv } from "@/lib/csv";
import { annotateCaller, jsonError, runRoute, withRequestEvent } from "@/lib/http";
import type { WideEvent } from "@/lib/log";
import { exportRows, filtersFromSearchParams, MAX_EXPORT_ROWS } from "@/lib/receipts";
import { getActiveScope } from "@/lib/session";

/**
 * CSV of the active workspace's receipts, filtered by the same query params
 * as History (q, category, status, from, to). Built in memory: fine up to
 * MAX_EXPORT_ROWS; a truncated export says so in a header.
 */
export const GET = withRequestEvent(
  { event: "receipt.export", route: "/api/receipts/export" },
  exportCsv,
);

async function exportCsv(request: Request, _context: unknown, event: WideEvent) {
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  annotateCaller(event, { scope });
  const filters = filtersFromSearchParams(new URL(request.url).searchParams);
  // Which filters were used, never their values (a search can be a merchant name).
  event.flags = Object.fromEntries(
    Object.entries(filters).flatMap(([key, value]) => (value ? [[key, true]] : [])),
  );

  return runRoute(
    exportRows(scope, filters),
    ({ rows, truncated }) => {
      event.count = rows.length;
      return new NextResponse(receiptsToCsv(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${csvFilename("receipts")}"`,
          "Cache-Control": "no-store",
          "X-Export-Rows": String(rows.length),
          ...(truncated ? { "X-Export-Truncated": `first ${MAX_EXPORT_ROWS} rows` } : {}),
        },
      });
    },
    event,
  );
}
