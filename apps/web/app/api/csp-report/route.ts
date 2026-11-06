import { clientIp, withRequestEvent } from "@/lib/http";
import { createWindowLimiter, parseCspReports, readCappedText } from "@/lib/csp-report";
import type { WideEvent } from "@/lib/log";

/** Real reports are a few hundred bytes; a batch of them stays well under this. */
const MAX_BODY_BYTES = 16 * 1024;
/** Reports per client IP per minute that get logged. */
const limit = createWindowLimiter(60_000, 30);

/** Receives CSP violation reports (`report-uri` and `report-to`) and logs a redacted summary. */
export const POST = withRequestEvent({ event: "csp.violation", route: "/api/csp-report" }, report);

async function report(request: Request, _context: unknown, event: WideEvent) {
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
  event.count = violations.length;
  if (violations.length > 0) event.violations = violations;
  return new Response(null, { status: 204 });
}
