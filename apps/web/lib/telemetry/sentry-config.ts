/**
 * Sentry settings read from env. Pure, so next.config.ts, the server and the
 * browser bundle agree on one rule: Sentry is on only with a well-formed DSN.
 */

export type SentryDsn = { dsn: string; ingestOrigin: string };

/**
 * A DSN looks like `https://<public key>@o1.ingest.us.sentry.io/<project id>`.
 * Anything else (an auth token pasted by mistake, a typo) leaves Sentry off,
 * because the DSN is inlined into the public bundle (security plan M12).
 */
export function parseSentryDsn(value: string | undefined): SentryDsn | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.password || url.search || url.hash) return null;
  if (!/^[a-z0-9]{16,64}$/i.test(url.username)) return null;
  if (!/^\/\d{1,20}$/.test(url.pathname)) return null;
  return { dsn: raw, ingestOrigin: url.origin };
}

/**
 * The short commit SHA, so an issue names the build that threw. `GIT_COMMIT_SHA` comes first: the
 * production workflow sets it at build to the commit whose source maps it uploads.
 */
export function sentryRelease(env: Record<string, string | undefined>): string | undefined {
  const sha = env.GIT_COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : undefined;
}

export function sentryEnvironment(env: Record<string, string | undefined>): string {
  return env.VERCEL_ENV || env.NODE_ENV || "development";
}
