"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readThemePreference, resolvesToLight } from "@/lib/theme";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { reportBoundaryError } from "@/lib/telemetry/client-errors";

// Theme tokens from packages/ui/src/styles.css, inline because the app's CSS may not have loaded.
const css = `
:root{--bg:#0a0a0b;--fg:#e4e4e7;--muted:#9a9aa3;--primary:#34d399;--on-primary:#07110d;color-scheme:dark}
:root.light{--bg:#f7f7f8;--fg:#18181b;--muted:#5f5f68;--primary:#036c4d;--on-primary:#fff;color-scheme:light}
`;

const noSubscribe = () => () => {};

/**
 * Last-resort boundary for errors in the root layout, where the app's CSS and fonts may not
 * have loaded. It brings its own <html> and uses inline styles for that reason.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "app.global_error",
        message: error.message,
        digest: error.digest,
      }),
    );
    reportBoundaryError(error);
  }, [error]);

  // Server-rendered, THEME_SCRIPT sets the class before paint; rendered in place of a crashed
  // page, the script doesn't run, so the class comes from here.
  const light = useSyncExternalStore(
    noSubscribe,
    () =>
      resolvesToLight(readThemePreference(), matchMedia("(prefers-color-scheme: light)").matches),
    () => false,
  );

  return (
    <html className={light ? "light" : undefined} lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <style>{css}</style>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1rem",
          background: "var(--bg)",
          color: "var(--fg)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "var(--muted)", lineHeight: 1.5 }}>
            The page could not be shown. Try again, and if it keeps happening, contact support
            {error.digest ? ` with this reference: ${error.digest}` : ""}.
          </p>
          <button
            onClick={reset}
            style={{
              minHeight: "2.75rem",
              padding: "0 1rem",
              borderRadius: "0.5rem",
              border: 0,
              background: "var(--primary)",
              color: "var(--on-primary)",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
            type="button"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
