import { createGroup, createGroupSchema, listGroups } from "@receipt-ocr/core";
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

/** The active workspace's groups, with receipt counts and whether the caller may manage each. */
export const GET = withRequestEvent(
  { event: "group.list", route: "/api/groups", routine: true },
  async (_request, _context, event: WideEvent) => {
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    return runRoute(
      listGroups(scope),
      (groups) => {
        event.count = groups.length;
        return NextResponse.json({ groups }, { headers: { "Cache-Control": "no-store" } });
      },
      event,
    );
  },
);

/** Creates a group. Any member may. The event carries its id, never its name. */
export const POST = withRequestEvent(
  { event: "group.create", route: "/api/groups" },
  async (request, _context, event: WideEvent) => {
    const forbidden = crossOriginResponse(request);
    if (forbidden) return forbidden;
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const body = await readJson(request, createGroupSchema);
    if ("response" in body) return body.response;
    return runRoute(
      createGroup(scope, body.data),
      (group) => {
        event.group_id = group.id;
        return NextResponse.json({ group }, { status: 201 });
      },
      event,
    );
  },
);
