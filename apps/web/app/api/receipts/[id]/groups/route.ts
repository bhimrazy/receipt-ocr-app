import { groupsOfReceipt, receiptGroupBodySchema, setReceiptGroup } from "@receipt-ocr/core";
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
  return runRoute(setReceiptGroup(scope, id, body.data.groupId, action), (groups) =>
    NextResponse.json({ groups }),
  );
}

export const POST = (request: Request, context: Params) => change(request, context, "add");
export const DELETE = (request: Request, context: Params) => change(request, context, "remove");
