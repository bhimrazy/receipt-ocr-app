/** The wording for Settings → Receipt reading, kept apart from the page so it can be tested. */

export type Reader = { label: string; provider: string };

/**
 * "Your receipts are read by A." / "… by A. If it can't read one, B tries next." /
 * "… by A. If it can't read one, B tries next, then C."
 */
export function readingSentence(readers: readonly Reader[]): string | null {
  if (readers.length === 0) return null;
  const [first, second, ...rest] = readers;
  const lead = `Your receipts are read by ${first!.label}.`;
  if (!second) return lead;
  const others = rest.map((r) => `, then ${r.label}`).join("");
  return `${lead} If it can't read one, ${second.label} tries next${others}.`;
}

/** Provider names once each, in first-use order, as the company users should look up in the policy. */
export function providerNames(readers: readonly Reader[]): string[] {
  const names: Record<string, string> = {
    google: "Google",
    anthropic: "Anthropic",
    groq: "Groq",
    openai: "OpenAI",
  };
  return [...new Set(readers.map((r) => names[r.provider]).filter((n): n is string => !!n))];
}
