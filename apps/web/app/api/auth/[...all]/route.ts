import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { auth, authEnabled } from "@/lib/auth";

const handler = toNextJsHandler(auth);

function notConfigured() {
  return NextResponse.json(
    { error: "Auth is not configured. Set DATABASE_URL and BETTER_AUTH_SECRET." },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  if (!authEnabled) return notConfigured();
  return handler.GET(request);
}

export async function POST(request: Request) {
  if (!authEnabled) return notConfigured();
  return handler.POST(request);
}
