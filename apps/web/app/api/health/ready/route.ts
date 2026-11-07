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
      {
        status: result.ok ? 200 : 503,
        // A healthy answer is cached at Vercel's edge for 10 s, so a flood of requests is served by the CDN
        // without running the function. Failures are never cached, so monitors see an outage at once.
        headers: {
          "Cache-Control": result.ok ? "public, max-age=0, s-maxage=10" : "no-store",
        },
      },
    );
  },
);
