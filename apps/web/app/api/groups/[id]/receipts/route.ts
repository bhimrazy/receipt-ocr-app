import { addReceiptsToGroup, receiptIdsSchema, removeReceiptsFromGroup } from "@receipt-ocr/core";
import { NextResponse } from "next/server";
import { crossOriginResponse, jsonError, runRoute } from "@/lib/http";
import { logGroupEvent } from "@/lib/group-log";
import { readJson } from "@/lib/json-body";
import { getActiveScope } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/**
 * Bulk membership: `{ receiptIds }` (up to 100). POST adds, DELETE removes.
 * Any member may. The result counts what changed, what was already so,
 * what hit the per-receipt group limit and what isn't in this workspace.
 */
async function change(request: Request, { params }: Params, action: "add" | "remove") {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const body = await readJson(request, receiptIdsSchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  const run = action === "add" ? addReceiptsToGroup : removeReceiptsFromGroup;
  return runRoute(run(scope, id, body.data.receiptIds), (result) => {
    logGroupEvent(action === "add" ? "group.receipts_added" : "group.receipts_removed", scope, {
      groupId: id,
      ...result,
    });
    return NextResponse.json(result);
  });
}

export const POST = (request: Request, context: Params) => change(request, context, "add");
export const DELETE = (request: Request, context: Params) => change(request, context, "remove");
