/**
 * Scrubbing for what vendor SDKs capture beyond our wide events (stack
 * frames, request URLs, breadcrumbs). Pure, so the browser bundle can use it.
 * Security plan B1 and B5: no query strings, no bearer secrets in paths, no
 * receipt contents or bound query params in error text.
 */

/** Path segments that are bearer secrets or record ids, by route. */
const PATH_RULES: [RegExp, string][] = [
  [/^\/api\/auth\/reset-password\/[^/]+/, "/api/auth/reset-password/:token"],
  [/^\/reset-password\/[^/]+/, "/reset-password/:token"],
  [/^\/accept-invitation\/[^/]+/, "/accept-invitation/:id"],
  [/^\/app\/receipts\/[^/]+/, "/app/receipts/:id"],
  [/^\/api\/receipts\/[^/]+/, "/api/receipts/:id"],
  [/^\/app\/groups\/[^/]+/, "/app/groups/:id"],
];

const scrubPath = (path: string) => {
  for (const [pattern, replacement] of PATH_RULES) {
    if (pattern.test(path)) return path.replace(pattern, replacement);
  }
  return path;
};

/** Drops query and hash, and replaces secret or id path segments. Keeps the origin. */
export function scrubUrl(value: string): string {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    const url = new URL(value, "http://relative.invalid");
    const path = scrubPath(url.pathname);
    return absolute ? `${url.origin}${path}` : path;
  } catch {
    return "[unparseable url]";
  }
}

const MAX_MESSAGE = 200;

/**
 * Error text that may be sent: AI SDK validation and parse errors embed the
 * model's whole output (the receipt), Drizzle errors end with bound `params:`.
 * Those are cut; emails and long digits are masked; the rest is capped.
 */
export function scrubMessage(message: string): string {
  let text = message;
  const cut = text.search(/params:|Value: |Text: |\{"/);
  if (cut >= 0) text = `${text.slice(0, cut)}[redacted]`;
  text = text
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\b(?:Bearer|Basic)\s+\S+/gi, "[credential]")
    .replace(/https?:\/\/\S+/g, (url) => scrubUrl(url))
    .replace(/\d{6,}/g, "[number]");
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}

/** AI SDK errors whose message or fields carry the receipt or the request body. */
const CONTENT_ERRORS =
  /^AI_(TypeValidationError|JSONParseError|NoObjectGeneratedError|APICallError)$/;

export const isContentError = (type: string | undefined): boolean =>
  type !== undefined && CONTENT_ERRORS.test(type);
