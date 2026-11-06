import { ReceiptRepo } from "@receipt-ocr/core";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { annotateCaller, jsonError, runRoute, withRequestEvent } from "@/lib/http";
import { getActiveScope } from "@/lib/session";

/** Workspace-wide receipt counts, so list pollers refresh only when something changed. */
export const GET = withRequestEvent(
  { event: "receipt.counts", route: "/api/receipts/status", routine: true },
  async (_request, _context, event) => {
    const scope = await getActiveScope();
    if (!scope) return jsonError(401, "Unauthorized");
    annotateCaller(event, { scope });
    return runRoute(
      Effect.flatMap(ReceiptRepo, (repo) => repo.counts(scope)),
      (counts) => NextResponse.json(counts, { headers: { "Cache-Control": "no-store" } }),
      event,
    );
  },
);
