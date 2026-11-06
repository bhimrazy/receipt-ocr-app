/** First tab stop in the app shells: jumps past the sidebar and header to <main id="main-content">. */
export function SkipLink() {
  return (
    <a
      className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus-visible:ring-2 focus-visible:ring-ring"
      href="#main-content"
    >
      Skip to content
    </a>
  );
}
