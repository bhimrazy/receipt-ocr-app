import {
  addReceiptsToGroup,
  groupsOfReceipt,
  MAX_GROUPS_PER_RECEIPT,
  receiptGroupBodySchema,
  removeReceiptsFromGroup,
} from "@receipt-ocr/core";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { crossOriginResponse, jsonError, runRoute } from "@/lib/http";
import { readJson } from "@/lib/json-body";
import { getActiveScope } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/** The groups this receipt is in. */
export async function GET(_request: Request, { params }: Params) {
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const { id } = await params;
  return runRoute(groupsOfReceipt(scope, id), (groups) =>
    NextResponse.json({ groups }, { headers: { "Cache-Control": "no-store" } }),
  );
}

/** `{ groupId }`: POST adds this receipt to the group, DELETE takes it out. Returns its groups. */
async function change(request: Request, { params }: Params, action: "add" | "remove") {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const body = await readJson(request, receiptGroupBodySchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  const run = action === "add" ? addReceiptsToGroup : removeReceiptsFromGroup;
  return runRoute(
    Effect.gen(function* () {
      // Checks the receipt first, so a bad id is a 404 rather than a silent no-op.
      yield* groupsOfReceipt(scope, id);
      const result = yield* run(scope, body.data.groupId, [id]);
      return { result, groups: yield* groupsOfReceipt(scope, id) };
    }),
    ({ result, groups }) =>
      action === "add" && result.atLimit > 0
        ? jsonError(
            409,
            `A receipt can be in up to ${MAX_GROUPS_PER_RECEIPT} groups. Take it out of one first.`,
          )
        : NextResponse.json({ groups }),
  );
}

export const POST = (request: Request, context: Params) => change(request, context, "add");
export const DELETE = (request: Request, context: Params) => change(request, context, "remove");
