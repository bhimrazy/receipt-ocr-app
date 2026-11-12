import { Billing } from "@receipt-ocr/core";
import { Effect } from "effect";
import { after, NextResponse } from "next/server";
import { jsonError, runRoute, withRequestEvent } from "@/lib/http";
import { kickJob } from "@/lib/jobs";
import { readCapped } from "@/lib/json-body";
import type { WideEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Paddle's events are a few KB; anything far larger isn't one. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Paddle's webhook destination. Verifies `Paddle-Signature` over the raw
 * body, stores the event once by its id and answers 200 at once; the
 * `billing.apply_event` job applies it, started right after the response and
 * otherwise picked up by the queue drain. A refused signature is 401 and a
 * body we can't read is 400 (Paddle retries both); 503 while billing is off.
 */
export const POST = withRequestEvent(
  { event: "billing.webhook", route: "/api/billing/paddle/webhook" },
  webhook,
);

async function webhook(request: Request, _context: unknown, event: WideEvent) {
  // Refuse by the declared length before reading anything; the read itself stops at the
  // limit for a body sent without one or longer than it said.
  const declared = request.headers.get("content-length");
  if (declared !== null && !(Number(declared) <= MAX_BODY_BYTES)) {
    return jsonError(413, "Too large");
  }
  let bytes: Uint8Array | null;
  try {
    bytes = await readCapped(request, MAX_BODY_BYTES);
  } catch {
    return jsonError(400, "Unreadable event");
  }
  if (!bytes) return jsonError(413, "Too large");
  const rawBody = new TextDecoder().decode(bytes);
  const signature = request.headers.get("paddle-signature");

  return runRoute(
    Effect.flatMap(Billing, (billing) => billing.receiveWebhook(rawBody, signature)),
    (result) => {
      event.billing = { ...event.billing, outcome: result.kind };
      if (result.kind === "rejected") {
        event.billing.rejection = result.reason;
        event.outcome = "rejected";
        return result.reason === "bad-body"
          ? jsonError(400, "Unreadable event")
          : jsonError(401, "Invalid signature");
      }
      event.outcome = result.kind;
      if (result.kind === "recorded") {
        event.job_id = result.jobId;
        const jobId = result.jobId;
        after(() => kickJob(jobId, { request_id: event.request_id, trigger: "webhook" }));
      }
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    },
    event,
  );
}
