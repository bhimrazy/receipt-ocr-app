import { deleteReceipts, MAX_BULK_DELETE } from "@receipt-ocr/core";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  annotateCaller,
  crossOriginResponse,
  jsonError,
  runRoute,
  withRequestEvent,
} from "@/lib/http";
import { kickJob } from "@/lib/jobs";
import { readJson } from "@/lib/json-body";
import type { WideEvent } from "@/lib/log";
import { cleanFilters, filtersFromSearchParams } from "@/lib/receipts";
import { getActiveScope } from "@/lib/session";

/** Room for MAX_BULK_DELETE ids. */
const MAX_BODY_BYTES = 64 * 1024;

const bodySchema = z.union([
  z.strictObject({
    ids: z
      .array(z.uuid({ error: "Receipt ids must be UUIDs." }))
      .min(1, "Choose at least one receipt.")
      .max(MAX_BULK_DELETE, `Up to ${MAX_BULK_DELETE} receipts at a time.`),
  }),
  z.strictObject({
    /** History's query string (`status=failed&q=…`): every receipt it matches. */
    filter: z.string().max(4000),
    /** How many matched when the user confirmed. */
    expected: z.number().int().min(1),
  }),
]);

/** A few seconds of row deletes, then the file clean-up job after the response. */
export const maxDuration = 60;

/**
 * Permanently deletes receipts: `{ ids }`, or `{ filter, expected }` for everything matching
 * History's filters. Members delete only their own uploads; the rest are reported as skipped.
 * The stored files go with a `storage.delete` job, started after the response.
 */
export const POST = withRequestEvent(
  { event: "receipt.bulk_delete", route: "/api/receipts/delete" },
  remove,
);

async function remove(request: Request, _context: unknown, event: WideEvent) {
  const forbidden = crossOriginResponse(request);
  if (forbidden) return forbidden;
  const scope = await getActiveScope();
  if (!scope) return jsonError(401, "Unauthorized");
  annotateCaller(event, { scope });
  const read = await readJson(request, bodySchema, MAX_BODY_BYTES);
  if ("response" in read) return read.response;
  const body = read.data;
  const target =
    "ids" in body
      ? { ids: body.ids }
      : {
          filters: cleanFilters(filtersFromSearchParams(new URLSearchParams(body.filter))),
          expected: body.expected,
        };
  event.mode = "ids" in body ? "ids" : "filter";
  event.count = "ids" in body ? body.ids.length : body.expected;

  return runRoute(
    deleteReceipts({ scope, target }),
    ({ jobId, ...result }) => {
      event.counts = {
        deleted: result.deleted,
        skipped: result.skipped,
        not_found: result.notFound,
      };
      if (jobId) {
        event.job_id = jobId;
        after(() => kickJob(jobId, { request_id: event.request_id, trigger: "delete" }));
      }
      return NextResponse.json(result);
    },
    event,
  );
}
