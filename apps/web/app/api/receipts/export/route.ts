import { NextResponse } from "next/server";
import { z } from "zod";
import { SORT_KEYS } from "@/components/history/list-view";
import { csvFilename, receiptsToCsv } from "@/lib/csv";
import {
  annotateCaller,
  crossOriginResponse,
  jsonError,
  runRoute,
  withRequestEvent,
} from "@/lib/http";
import { readJson } from "@/lib/json-body";
import type { WideEvent } from "@/lib/log";
import {
  exportRows,
  filtersFromSearchParams,
  MAX_EXPORT_ROWS,
  type ReceiptListFilters,
} from "@/lib/receipts";
import { getActiveScope } from "@/lib/session";

/**
 * CSV of the active workspace's receipts. GET takes the same query params as
 * History (q, category, status, from, to, group, sort, dir); POST takes a
 * selection, `{ ids, sort? }`. Built in memory: fine up to MAX_EXPORT_ROWS; a
 * truncated export says so in a header.
 */
export const GET = withRequestEvent(
  { event: "receipt.export", route: "/api/receipts/export" },
  async (request: Request, _context: unknown, event: WideEvent) => {
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const filters = filtersFromSearchParams(new URL(request.url).searchParams);
    // Which filters were used, never their values (a search can be a merchant name).
    event.flags = Object.fromEntries(
      Object.entries(filters).flatMap(([key, value]) =>
        value && key !== "pageSize" ? [[key, true]] : [],
      ),
    );
    return csv(scope, filters, event);
  },
);

/** Room for MAX_EXPORT_ROWS ids. */
const MAX_BODY_BYTES = 256 * 1024;

const selectionSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(MAX_EXPORT_ROWS),
  sort: z.strictObject({ by: z.enum(SORT_KEYS), dir: z.enum(["asc", "desc"]) }).optional(),
});

export const POST = withRequestEvent(
  { event: "receipt.export", route: "/api/receipts/export" },
  async (request: Request, _context: unknown, event: WideEvent) => {
    const forbidden = crossOriginResponse(request);
    if (forbidden) return forbidden;
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const read = await readJson(request, selectionSchema, MAX_BODY_BYTES);
    if ("response" in read) return read.response;
    event.mode = "selection";
    return csv(scope, { ids: read.data.ids, sort: read.data.sort }, event);
  },
);

function csv(
  scope: { organizationId: string; userId: string },
  filters: ReceiptListFilters,
  event: WideEvent,
) {
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
