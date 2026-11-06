/** Where to land after auth when no safe redirect was requested. */
export const DEFAULT_REDIRECT = "/app";

/** Request header the proxy sets to the guarded path (and query) being requested. */
export const REQUESTED_PATH_HEADER = "x-requested-path";

const PROBE_ORIGIN = "http://redirect.invalid";

/**
 * Only same-origin paths are valid post-auth redirects. Rather than
 * blocklisting tricks (`//host`, `/\host`, `/<TAB>/host`, encoded slashes),
 * resolve the value the way a browser would and require it to stay on our
 * origin, then return the normalised path.
 */
export function safeRedirect(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !raw.startsWith("/")) return DEFAULT_REDIRECT;
  // Browsers strip tabs/newlines and treat "\" as "/", so `/\t/evil` becomes `//evil`.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return DEFAULT_REDIRECT;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return DEFAULT_REDIRECT;
  }
  if (url.origin !== PROBE_ORIGIN) return DEFAULT_REDIRECT;
  const path = `${url.pathname}${url.search}${url.hash}`;
  // An encoded slash can decode to `//host` in a later hop.
  if (path.startsWith("//") || /^\/(%2f|%5c)/i.test(path)) return DEFAULT_REDIRECT;
  return path;
}
