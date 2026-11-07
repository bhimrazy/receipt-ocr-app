/** The wording for Settings → Receipt reading, kept apart from the page so it can be tested. */

export type Reader = { label: string; provider: string };

/** "A", "A, then B if that fails", "A, then B if that fails, then C if that fails". */
export function readingSentence(readers: readonly Reader[]): string | null {
  if (readers.length === 0) return null;
  const [first, ...rest] = readers;
  return `Platform default: ${[first!.label, ...rest.map((r) => `${r.label} if that fails`)].join(", then ")}`;
}

/** Provider names once each, in first-use order, as the company users should look up in the policy. */
export function providerNames(readers: readonly Reader[]): string[] {
  const names: Record<string, string> = { google: "Google", anthropic: "Anthropic" };
  return [...new Set(readers.map((r) => names[r.provider]).filter((n): n is string => !!n))];
}
