import { NextResponse } from "next/server";
import { annotateCaller, jsonError, runRoute, withRequestEvent } from "@/lib/http";
import type { WideEvent } from "@/lib/log";
import { matchingReceiptIds, strictFiltersFromQuery, WORKSPACE_CHANGED } from "@/lib/receipts";
import { getActiveScope } from "@/lib/session";

/**
 * Ids of the receipts matching History's filters, for "Add to group" on "all that match".
 * `?org=` is the workspace the selection was made in (`409` once the session moved to
 * another); every other param must be a History filter (`400` otherwise). Up to
 * MAX_BULK_DELETE; `truncated` says there were more.
 */
export const GET = withRequestEvent(
  { event: "receipt.ids", route: "/api/receipts/ids" },
  async (request: Request, _context: unknown, event: WideEvent) => {
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const params = new URL(request.url).searchParams;
    if (params.get("org") !== scope.organizationId) return jsonError(409, WORKSPACE_CHANGED);
    params.delete("org");
    const filters = strictFiltersFromQuery(params.toString());
    if (!filters) return jsonError(400, "The filters weren't recognised. Reload and try again.");
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
