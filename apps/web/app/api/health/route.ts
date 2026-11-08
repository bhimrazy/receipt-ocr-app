import { NextResponse } from "next/server";
import { commitSha } from "@/lib/health";
import { skipEvent, withRequestEvent } from "@/lib/http";

/** Liveness: the server is up and answering. Touches no dependency. */
export const GET = withRequestEvent(
  { event: "health.live", route: "/api/health", routine: true },
  (_request, _context, event) => {
    // An uptime pinger's answers carry nothing; only a failure (thrown) is written.
    skipEvent(event);
    return NextResponse.json(
      { ok: true, commit: commitSha() },
      // Cached at Vercel's edge for 10 s so a flood is served by the CDN, not the function.
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=10" } },
    );
  },
);
