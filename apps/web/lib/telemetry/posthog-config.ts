/**
 * PostHog is on only with a project key (`phc_…`) and an https host. A
 * personal API key (`phx_…`) or anything else leaves it off: that key can
 * read and change the whole project, so it must never be used for capture.
 */
export function parsePostHog(env: Record<string, string | undefined>): {
  key: string;
  host: string;
} | null {
  const key = env.POSTHOG_KEY?.trim();
  if (!key || !/^phc_[A-Za-z0-9]{16,64}$/.test(key)) return null;
  const rawHost = env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
  try {
    const url = new URL(rawHost);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { key, host: url.origin };
  } catch {
    return null;
  }
}
