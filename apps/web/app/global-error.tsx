"use client";

import { useEffect } from "react";

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
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1rem",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: "28rem" }}>
          <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#a3a3a3", lineHeight: 1.5 }}>
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
              background: "#10b981",
              color: "#052e1f",
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
