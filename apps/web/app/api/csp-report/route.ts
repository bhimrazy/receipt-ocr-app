import { clientIp } from "@/lib/http";
import { createWindowLimiter, parseCspReports, readCappedText } from "@/lib/csp-report";
import { logger } from "@/lib/log";

/** Real reports are a few hundred bytes; a batch of them stays well under this. */
const MAX_BODY_BYTES = 16 * 1024;
/** Reports per client IP per minute that get logged. */
const limit = createWindowLimiter(60_000, 30);

/** Receives CSP violation reports (`report-uri` and `report-to`) and logs a redacted summary. */
export async function POST(request: Request) {
  if (!limit(clientIp(request) ?? "unknown")) {
    await request.body?.cancel().catch(() => {});
    return new Response(null, { status: 429 });
  }
  const text = await readCappedText(request, MAX_BODY_BYTES);
  if (text === null) return new Response(null, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const violations = parseCspReports(payload);
  if (violations.length > 0) {
    logger.info({ event: "csp.violation", count: violations.length, violations });
  }
  return new Response(null, { status: 204 });
}
