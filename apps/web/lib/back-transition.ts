/** Longest the screen stays frozen waiting for Back to land, if the history step never commits. */
const MAX_WAIT_MS = 300;

/**
 * Calls `back` (a history step) inside a view transition that slides the pushed screen out to the
 * right. React commits a history step at once, without a view transition, so Back would otherwise
 * cut. Falls back to a plain `back()` without a pushed screen, without the View Transitions API,
 * or under prefers-reduced-motion.
 */
export function backWithTransition(back: () => void) {
  const screen = document.querySelector<HTMLElement>("[data-pushed-screen]");
  if (
    !screen ||
    typeof document.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    back();
    return;
  }
  // The same class the forward push uses; its exit animation is in globals.css.
  screen.style.setProperty("view-transition-name", "pushed-screen");
  screen.style.setProperty("view-transition-class", "push-out");
  const transition = document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, MAX_WAIT_MS);
        window.addEventListener(
          "popstate",
          () =>
            requestAnimationFrame(() => {
              window.clearTimeout(timer);
              resolve();
            }),
          { once: true },
        );
        back();
      }),
  );
  // If the screen is still there (Back went nowhere), it must not keep the name: React names
  // elements for its own transitions, and two of a name would cancel them.
  void transition.finished.finally(() => {
    screen.style.removeProperty("view-transition-name");
    screen.style.removeProperty("view-transition-class");
  });
}
