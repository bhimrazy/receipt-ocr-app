import { addReceiptsToGroup, receiptIdsSchema, removeReceiptsFromGroup } from "@receipt-ocr/core";
import { NextResponse } from "next/server";
import {
  annotateCaller,
  crossOriginResponse,
  jsonError,
  runRoute,
  withRequestEvent,
} from "@/lib/http";
import { readJson } from "@/lib/json-body";
import type { WideEvent } from "@/lib/log";
import { getActiveScope } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/**
 * Bulk membership: `{ receiptIds }` (up to 100). POST adds, DELETE removes.
 * Any member may. The result counts what changed, what was already so,
 * what hit the per-receipt group limit and what isn't in this workspace.
 */
const change = (action: "add" | "remove") =>
  withRequestEvent(
    {
      event: action === "add" ? "group.receipts_add" : "group.receipts_remove",
      route: "/api/groups/[id]/receipts",
    },
    async (request, { params }: Params, event: WideEvent) => {
      const forbidden = crossOriginResponse(request);
      if (forbidden) return forbidden;
      const scope = await getActiveScope();
      if (!scope) return jsonError(401, "Unauthorized");
      annotateCaller(event, { scope });
      const { id } = await params;
      event.group_id = id;
      const body = await readJson(request, receiptIdsSchema);
      if ("response" in body) return body.response;
      event.count = body.data.receiptIds.length;
      const run = action === "add" ? addReceiptsToGroup : removeReceiptsFromGroup;
      return runRoute(
        run(scope, id, body.data.receiptIds),
        (result) => {
          event.counts = {
            changed: result.changed,
            unchanged: result.unchanged,
            at_limit: result.atLimit,
            not_found: result.notFound,
          };
          return NextResponse.json(result);
        },
        event,
      );
    },
  );

export const POST = change("add");
export const DELETE = change("remove");
