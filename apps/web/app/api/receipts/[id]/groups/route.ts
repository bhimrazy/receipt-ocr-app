import { groupsOfReceipt, receiptGroupBodySchema, setReceiptGroup } from "@receipt-ocr/core";
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

/** The groups this receipt is in. */
export const GET = withRequestEvent(
  { event: "receipt.groups", route: "/api/receipts/[id]/groups", routine: true },
  async (_request, { params }: Params, event: WideEvent) => {
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    const { id } = await params;
    event.receipt_id = id;
    return runRoute(
      groupsOfReceipt(scope, id),
      (groups) => {
        event.count = groups.length;
        return NextResponse.json({ groups }, { headers: { "Cache-Control": "no-store" } });
      },
      event,
    );
  },
);

/** `{ groupId }`: POST adds this receipt to the group, DELETE takes it out. Returns its groups. */
const change = (action: "add" | "remove") =>
  withRequestEvent(
    {
      event: action === "add" ? "receipt.group_add" : "receipt.group_remove",
      route: "/api/receipts/[id]/groups",
    },
    async (request, { params }: Params, event: WideEvent) => {
      const forbidden = crossOriginResponse(request);
      if (forbidden) return forbidden;
      const scope = await getActiveScope();
      if (!scope) return jsonError(401, "Unauthorized");
      annotateCaller(event, { scope });
      const { id } = await params;
      event.receipt_id = id;
      const body = await readJson(request, receiptGroupBodySchema);
      if ("response" in body) return body.response;
      event.group_id = body.data.groupId;
      return runRoute(
        setReceiptGroup(scope, id, body.data.groupId, action),
        (groups) => {
          // How many groups the receipt is in now.
          event.count = groups.length;
          return NextResponse.json({ groups });
        },
        event,
      );
    },
  );

export const POST = change("add");
export const DELETE = change("remove");
