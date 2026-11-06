/**
 * Parsing for CSP violation reports, in both formats browsers send:
 * `report-uri` (application/csp-report, one `{"csp-report": {...}}`) and
 * `report-to` (application/reports+json, an array of `{type, body}`).
 *
 * Only the directive and the blocked host are kept. Report URLs can carry
 * reset tokens or receipt ids in their path and query, so none are logged.
 */

export interface CspViolation {
  directive: string;
  blocked: string;
}

/** Reports kept from one request; browsers batch a few at most. */
const MAX_REPORTS = 20;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === "string" ? value : "");

/** `script-src-elem`, from either field; `violated-directive` may carry the whole directive. */
function directiveOf(report: Json): string {
  const raw =
    str(report.effectiveDirective) ||
    str(report["effective-directive"]) ||
    str(report["violated-directive"]);
  const name = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return /^[a-z-]{1,40}$/.test(name) ? name : "unknown";
}

/** The blocked resource's host, or the CSP keyword (`inline`, `eval`, `data`...). */
export function blockedHost(value: string): string {
  const raw = value.trim();
  if (!raw) return "unknown";
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "wss:") {
      return url.host.toLowerCase();
    }
    return url.protocol.replace(/:$/, "");
  } catch {
    return /^[a-z-]{1,20}$/i.test(raw) ? raw.toLowerCase() : "unknown";
  }
}

function violationOf(report: Json): CspViolation {
  return {
    directive: directiveOf(report),
    blocked: blockedHost(str(report.blockedURL) || str(report["blocked-uri"])),
  };
}

/** The violations in a parsed report body; anything unrecognised is dropped. */
export function parseCspReports(payload: unknown): CspViolation[] {
  if (isObject(payload) && isObject(payload["csp-report"])) {
    return [violationOf(payload["csp-report"])];
  }
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((item): item is Json => isObject(item) && item.type === "csp-violation")
    .map((item) => (isObject(item.body) ? violationOf(item.body) : null))
    .filter((v): v is CspViolation => v !== null)
    .slice(0, MAX_REPORTS);
}

/**
 * Reads at most `maxBytes` of a request body as text; null when it is larger.
 * Content-Length is checked first, and the stream is cut once it passes the cap.
 */
export async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? "") > maxBytes) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Fixed-window counter per key, in memory. Per server instance on purpose: a report
 * storm should not turn into database writes. The map is cleared when it grows large.
 */
export function createWindowLimiter(windowMs: number, max: number, maxKeys = 10_000) {
  const windows = new Map<string, { start: number; count: number }>();
  return (key: string, now = Date.now()): boolean => {
    const current = windows.get(key);
    if (!current || now - current.start >= windowMs) {
      if (windows.size >= maxKeys) windows.clear();
      windows.set(key, { start: now, count: 1 });
      return true;
    }
    current.count++;
    return current.count <= max;
  };
}
