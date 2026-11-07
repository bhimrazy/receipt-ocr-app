import { NextResponse } from "next/server";
import { commitSha, readiness } from "@/lib/health";
import { withRequestEvent } from "@/lib/http";

/** Readiness: database (and storage, when configured) answer within 2 s. 503 otherwise. */
export const GET = withRequestEvent(
  { event: "health.ready", route: "/api/health/ready", routine: true },
  async (_request, _context, event) => {
    const result = await readiness();
    event.checks = result.checks;
    return NextResponse.json(
      { ...result, commit: commitSha() },
      { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  },
);
