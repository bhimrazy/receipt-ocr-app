import { ReceiptRepo } from "@receipt-ocr/core";
import { Effect } from "effect";
import { NextResponse } from "next/server";
import { jsonError, runRoute } from "@/lib/http";
import { getActiveScope } from "@/lib/session";

/** Workspace-wide receipt counts, so list pollers refresh only when something changed. */
export async function GET() {
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  return runRoute(
    Effect.flatMap(ReceiptRepo, (repo) => repo.counts(scope)),
    (counts) => NextResponse.json(counts, { headers: { "Cache-Control": "no-store" } }),
  );
}
