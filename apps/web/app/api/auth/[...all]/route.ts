import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auth, authEnabled } from "@/lib/auth";
import { isRoutineAuthRead } from "@/lib/auth-routine";
import { withRequestEvent } from "@/lib/http";
import type { WideEvent } from "@/lib/log";

const handler = toNextJsHandler(auth);
const ROUTE = "/api/auth/[...all]";

/**
 * The endpoint's first path segment (`sign-in`, `get-session`), never the
 * rest: later segments can be reset tokens and the query an OAuth code.
 */
function annotate(request: Request, event: WideEvent) {
  const segment = new URL(request.url).pathname.split("/")[3];
  if (segment && /^[a-z0-9-]{1,40}$/.test(segment)) event.action = segment;
}

function notConfigured() {
  return NextResponse.json(
    {
      error:
        "Auth is not configured. Set DATABASE_URL and BETTER_AUTH_SECRET or BETTER_AUTH_SECRETS.",
    },
    { status: 503 },
  );
}

export const GET = withRequestEvent(
  { event: "auth.request", route: ROUTE, routine: isRoutineAuthRead },
  (request, _context, event) => {
    annotate(request, event);
    if (!authEnabled) return notConfigured();
    return handler.GET(request);
  },
);

export const POST = withRequestEvent(
  { event: "auth.request", route: ROUTE },
  (request, _context, event) => {
    annotate(request, event);
    if (!authEnabled) return notConfigured();
    return handler.POST(request);
  },
);
