import { deleteGroup, updateGroup, updateGroupSchema } from "@receipt-ocr/core";
import { NextResponse } from "next/server";
import { crossOriginResponse, jsonError, runRoute } from "@/lib/http";
import { readJson } from "@/lib/json-body";
import { getActiveScope } from "@/lib/session";

type Params = { params: Promise<{ id: string }> };

/** Renames or recolours a group: its creator, or a workspace owner or admin. */
export async function PATCH(request: Request, { params }: Params) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const body = await readJson(request, updateGroupSchema);
  if ("response" in body) return body.response;
  const { id } = await params;
  return runRoute(updateGroup(scope, id, body.data), (group) => NextResponse.json({ group }));
}

/** Deletes a group; its receipts are kept. Creator, owner or admin. */
export async function DELETE(request: Request, { params }: Params) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const { id } = await params;
  return runRoute(deleteGroup(scope, id), () => NextResponse.json({ ok: true }));
}
