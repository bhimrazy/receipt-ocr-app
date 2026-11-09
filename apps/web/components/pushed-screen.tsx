/**
 * A screen pushed on top of a tab (a receipt, a Settings page), used as the route's own layout.
 * Its slide transition is off: with React's <ViewTransition> here, leaving the screen could leave
 * the next page on its loading skeletons. Without the `data-pushed-screen` element,
 * `backWithTransition` falls back to a plain Back. TODO(2026-11-16): find the cause, then restore
 * `<ViewTransition default="none" enter="push-in" exit="push-out">` around a
 * `<div data-pushed-screen>`.
 */
export function PushedScreen({ children }: { children: React.ReactNode }) {
  return children;
}
