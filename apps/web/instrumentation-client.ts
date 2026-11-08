/**
 * Runs in the browser before the app hydrates. Browser error reporting is on
 * only when next.config.ts inlined a valid DSN (from SENTRY_DSN at build);
 * otherwise this branch is `if ("")`, removed at build, and no Sentry code
 * ships. The SDK loads in its own chunk, after this file runs.
 */
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void import("./lib/telemetry/sentry-client")
    .then((sentry) =>
      sentry.startSentryClient(
        process.env.NEXT_PUBLIC_SENTRY_DSN!,
        process.env.NEXT_PUBLIC_SENTRY_RELEASE,
        process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
      ),
    )
    .catch(() => {});
}
