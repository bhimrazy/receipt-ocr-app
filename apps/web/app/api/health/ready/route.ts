import { NextResponse } from "next/server";
import { commitSha, readiness } from "@/lib/health";

/** Readiness: database (and storage, when configured) answer within 2 s. 503 otherwise. */
export async function GET() {
  const result = await readiness();
  return NextResponse.json(
    { ...result, commit: commitSha() },
    { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
