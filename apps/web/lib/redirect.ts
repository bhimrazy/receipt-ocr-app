/**
 * Only internal, single-slash paths are valid post-auth redirects. `//evil.com`
 * is a protocol-relative URL that browsers treat as absolute, so it must be
 * rejected alongside anything that doesn't start with a slash.
 */
export const DEFAULT_REDIRECT = "/app/upload";

export function safeRedirect(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return DEFAULT_REDIRECT;
  if (!raw.startsWith("/")) return DEFAULT_REDIRECT;
  if (raw.startsWith("//")) return DEFAULT_REDIRECT;
  // Backslashes are normalised to slashes by some browsers: /\evil.com
  if (raw.startsWith("/\\")) return DEFAULT_REDIRECT;
  return raw;
}
