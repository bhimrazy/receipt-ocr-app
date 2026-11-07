import { deleteGroup, updateGroup, updateGroupSchema } from "@receipt-ocr/core";
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

/** Renames or recolours a group: its creator, or a workspace owner or admin. */
export const PATCH = withRequestEvent(
  { event: "group.update", route: "/api/groups/[id]" },
  async (request, { params }: Params, event: WideEvent) => {
    const forbidden = crossOriginResponse(request);
    if (forbidden) return forbidden;
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const { id } = await params;
    event.group_id = id;
    const body = await readJson(request, updateGroupSchema);
    if ("response" in body) return body.response;
    // Which fields changed, never their values.
    event.flags = {
      renamed: body.data.name !== undefined,
      recoloured: body.data.color !== undefined,
    };
    return runRoute(
      updateGroup(scope, id, body.data),
      (group) => NextResponse.json({ group }),
      event,
    );
  },
);

/** Deletes a group; its receipts are kept. Creator, owner or admin. */
export const DELETE = withRequestEvent(
  { event: "group.delete", route: "/api/groups/[id]" },
  async (request, { params }: Params, event: WideEvent) => {
    const forbidden = crossOriginResponse(request);
    if (forbidden) return forbidden;
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const { id } = await params;
    event.group_id = id;
    return runRoute(deleteGroup(scope, id), () => NextResponse.json({ ok: true }), event);
  },
);
