/**
 * For React error boundaries. A server render error (it has a digest) was
 * already reported by `onRequestError`; only browser-side errors go from
 * here. `NEXT_PUBLIC_SENTRY_DSN` is inlined at build, so without a DSN this
 * is `if (true) return` and the Sentry chunk is never referenced.
 */
export function reportBoundaryError(error: Error & { digest?: string }): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN || error.digest) return;
  void import("./sentry-client")
    .then((sentry) => sentry.captureBoundaryError(error))
    .catch(() => {});
}
