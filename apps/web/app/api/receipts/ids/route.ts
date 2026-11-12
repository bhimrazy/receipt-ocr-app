import { NextResponse } from "next/server";
import { annotateCaller, jsonError, runRoute, withRequestEvent } from "@/lib/http";
import type { WideEvent } from "@/lib/log";
import { filtersFromSearchParams, matchingReceiptIds } from "@/lib/receipts";
import { getActiveScope } from "@/lib/session";

/**
 * Ids of the receipts matching History's query params, in the list's order, for "Add to
 * group" on "all that match". Up to MAX_BULK_DELETE; `truncated` says there were more.
 */
export const GET = withRequestEvent(
  { event: "receipt.ids", route: "/api/receipts/ids" },
  async (request: Request, _context: unknown, event: WideEvent) => {
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const filters = filtersFromSearchParams(new URL(request.url).searchParams);
    return runRoute(
      matchingReceiptIds(scope, filters),
      (result) => {
        event.count = result.ids.length;
        return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
      },
      event,
    );
  },
);
