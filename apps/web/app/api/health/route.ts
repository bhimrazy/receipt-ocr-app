import { NextResponse } from "next/server";
import { commitSha } from "@/lib/health";
import { withRequestEvent } from "@/lib/http";

/** Liveness: the server is up and answering. Touches no dependency. */
export const GET = withRequestEvent(
  { event: "health.live", route: "/api/health", routine: true },
  () =>
    NextResponse.json(
      { ok: true, commit: commitSha() },
      { headers: { "Cache-Control": "no-store" } },
    ),
);
