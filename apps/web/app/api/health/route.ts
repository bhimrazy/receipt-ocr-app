import { NextResponse } from "next/server";
import { commitSha } from "@/lib/health";

/** Liveness: the server is up and answering. Touches no dependency. */
export function GET() {
  return NextResponse.json(
    { ok: true, commit: commitSha() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
