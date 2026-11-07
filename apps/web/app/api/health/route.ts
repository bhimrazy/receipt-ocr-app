import { NextResponse } from "next/server";
import { commitSha } from "@/lib/health";
import { withRequestEvent } from "@/lib/http";

/** Liveness: the server is up and answering. Touches no dependency. */
export const GET = withRequestEvent(
  { event: "health.live", route: "/api/health", routine: true },
  () =>
    NextResponse.json(
      { ok: true, commit: commitSha() },
      // Cached at Vercel's edge for 10 s so a flood is served by the CDN, not the function.
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=10" } },
    ),
);
