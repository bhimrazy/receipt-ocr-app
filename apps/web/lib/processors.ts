/**
 * Optional processors the privacy page names only when they are switched on.
 * Read at build time, like the page itself.
 */

/** "Axiom" for its endpoints, a generic name for any other OTLP backend, null when export is off. */
export function logStorageName(endpoint: string | undefined): string | null {
  const value = endpoint?.trim();
  if (!value) return null;
  try {
    const host = new URL(value).hostname;
    return host === "axiom.co" || host.endsWith(".axiom.co") ? "Axiom" : "A log storage provider";
  } catch {
    return "A log storage provider";
  }
}
