/**
 * Runtime half of the email templates: fills the `{{slot}}` placeholders that
 * `scripts/generate.ts` left in the prerendered HTML and text (src/generated.ts). No React or
 * Tailwind runs here. Every value is normalized for its slot kind before it is placed, then
 * HTML-escaped in the HTML part; the generator guarantees only URL-like kinds sit in attributes.
 */

/**
 * - origin: an absolute http(s) URL reduced to its origin (logo, footer links).
 * - url: an absolute http(s) URL (buttons and fallback links).
 * - email: one line and shaped like an address, so it is safe after `mailto:`.
 * - line: user or computed text collapsed to one line.
 * - multiline: a contact-form message; keeps line breaks, drops other control characters.
 */
export type SlotKind = "origin" | "url" | "email" | "line" | "multiline";

export const SLOT_KINDS = {
  appOrigin: "origin",
  appHost: "line",
  supportEmail: "email",
  url: "url",
  urlLabel: "line",
  resetUrl: "url",
  resetUrlLabel: "line",
  expiry: "line",
  organizationName: "line",
  inviterEmail: "line",
  newEmail: "line",
  from: "line",
  topicLabel: "line",
  message: "multiline",
} as const satisfies Record<string, SlotKind>;

export type SlotName = keyof typeof SLOT_KINDS;

/** Kinds the generator allows inside an HTML attribute (href, src). */
export const ATTRIBUTE_KINDS: ReadonlySet<SlotKind> = new Set(["origin", "url", "email"]);

/** Escapes text for HTML element content and double- or single-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Collapses control characters and runs of whitespace, so text can't add lines to a plain-text mail. */
export function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\s]+/g, " ").trim();
}

/** Only absolute http(s) URLs go into a message: a relative link is dead in a mail client. */
export function absoluteUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Email links must be http(s), got ${url.protocol}`);
  }
  return url.toString();
}

const ADDRESS = /^[^\s@"'<>&?#/\\]+@[^\s@"'<>&?#/\\]+$/;

export function normalizeSlot(kind: SlotKind, value: string): string {
  switch (kind) {
    case "origin":
      return new URL(absoluteUrl(value)).origin;
    case "url":
      return absoluteUrl(value);
    case "email": {
      const address = oneLine(value);
      if (!ADDRESS.test(address)) throw new Error("Not an email address");
      return address;
    }
    case "line":
      return oneLine(value);
    case "multiline":
      return value
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "")
        .trim();
  }
}

const SLOT = /\{\{(\w+)\}\}/g;

/**
 * Replaces each placeholder in one pass, so a value that itself contains `{{x}}` is never
 * expanded. `values` must already be normalized; HTML output escapes them.
 */
export function fill(template: string, values: Record<string, string>, mode: "html" | "text") {
  return template.replace(SLOT, (_match, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Missing email slot ${name}`);
    return mode === "html" ? escapeHtml(value) : value;
  });
}

/** Every placeholder name in a prerendered template. */
export function slotNames(template: string): string[] {
  return [...template.matchAll(SLOT)].map((m) => m[1]);
}

/**
 * The fallback link's visible text: the host (so the reader sees where it goes) and the path when
 * it is short; never the token. 30 monospace characters fit one line in a 360px-wide client.
 * The href stays complete, and the plain-text part carries the full URL to copy.
 */
export function displayUrl(value: string, max = 30): string {
  const url = new URL(value);
  const shown = `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  return shown.length > max ? `${url.host}/…` : shown;
}

/** 3600 -> "1 hour", 604800 -> "7 days". */
export function formatDuration(seconds: number): string {
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds % 86_400 === 0) return unit(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return unit(seconds / 3_600, "hour");
  return unit(Math.max(1, Math.round(seconds / 60)), "minute");
}
