import { createGroup, createGroupSchema, listGroups } from "@receipt-ocr/core";
import { NextResponse } from "next/server";
import { crossOriginResponse, jsonError, runRoute } from "@/lib/http";
import { logGroupEvent } from "@/lib/group-log";
import { readJson } from "@/lib/json-body";
import { getActiveScope } from "@/lib/session";

/** The active workspace's groups, with receipt counts and whether the caller may manage each. */
export async function GET() {
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  return runRoute(listGroups(scope), (groups) =>
    NextResponse.json({ groups }, { headers: { "Cache-Control": "no-store" } }),
  );
}

/** Creates a group. Any member may. */
export async function POST(request: Request) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  const body = await readJson(request, createGroupSchema);
  if ("response" in body) return body.response;
  return runRoute(createGroup(scope, body.data), (group) => {
    logGroupEvent("group.created", scope, { groupId: group.id });
    return NextResponse.json({ group }, { status: 201 });
  });
}
