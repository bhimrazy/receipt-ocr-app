import { NextResponse } from "next/server";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS } from "@/lib/consent/config";
import { parseConsent, serializeConsent } from "@/lib/consent/state";
import { readCappedText } from "@/lib/csp-report";
import { authEnv } from "@/lib/env";
import { crossOriginResponse } from "@/lib/http";

const secure = new URL(authEnv.betterAuthUrl).protocol === "https:";

/**
 * Re-sets the consent cookie the browser already wrote, from the server, so Safari keeps it for
 * the full 6 months (it caps script-written cookies at 7 days). Same-origin only: another site
 * must not be able to record a choice for a visitor.
 */
export async function POST(request: Request) {
  const rejected = crossOriginResponse(request);
  if (rejected) return rejected;
  const text = await readCappedText(request, 256);
  const record = text === null ? null : parseConsent(text, Math.floor(Date.now() / 1000));
  if (!record) return new Response(null, { status: 400 });
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(CONSENT_COOKIE, serializeConsent(record), {
    path: "/",
    maxAge: CONSENT_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure,
    httpOnly: false,
  });
  return response;
}
