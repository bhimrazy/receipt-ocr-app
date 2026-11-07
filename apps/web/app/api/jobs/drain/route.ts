import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { cronSecret } from "@/lib/env";
import { jsonError, withRequestEvent } from "@/lib/http";
import { drainQueue } from "@/lib/jobs";
import type { WideEvent } from "@/lib/log";
import { runtime } from "@/lib/runtime";

/** Matches the pg_net call's 60 s timeout; `DRAIN_BUDGET_MS` in `lib/jobs.ts` fits inside it. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Runs the job queue once: reaps expired leases, then claims and runs due
 * jobs within a time and job budget. Called by Vercel Cron (GET, daily) and
 * Supabase pg_cron through pg_net (POST, every minute) with
 * `Authorization: Bearer $CRON_SECRET`. It sees every workspace's jobs, so
 * the secret is the only gate: a missing one refuses everything.
 */
const spec = { event: "jobs.drain", route: "/api/jobs/drain", routine: true };
export const GET = withRequestEvent(spec, drain);
export const POST = withRequestEvent(spec, drain);

async function drain(request: Request, _context: unknown, event: WideEvent) {
  const auth = checkCronAuth(request.headers.get("authorization"), cronSecret());
  if (auth !== "ok") {
    // Only a missing secret is a notice (rare, an ops problem). Unauthorized calls are anyone's to send, so
    // they stay routine and sampled; callers get the same 401 either way and can't tell if CRON_SECRET is set.
    if (auth === "unconfigured") event.notices = ["jobs.drain_unconfigured"];
    else event.outcome = "unauthorized";
    return jsonError(401, "Unauthorized", { "Cache-Control": "no-store" });
  }
  const summary = await runtime.runPromise(drainQueue({ request_id: event.request_id }));
  event.count = summary.claimed;
  event.outcome = summary.claimed === 0 && summary.reaped === 0 ? "idle" : "ran";
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
