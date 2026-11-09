import { ViewTransition } from "react";

/**
 * A screen pushed on top of a tab (a receipt, a Settings page) slides in from the right when it
 * opens and out again when the user leaves by a link. Used as the route's own layout, so it mounts
 * and unmounts with the route and also covers its loading.tsx. A history step (the app bar's Back)
 * commits without a view transition, so `backWithTransition` slides out the element marked here.
 * The animations are in globals.css and are off under prefers-reduced-motion. To switch screen
 * transitions off, return `children` alone.
 */
export function PushedScreen({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition default="none" enter="push-in" exit="push-out">
      <div data-pushed-screen="">{children}</div>
    </ViewTransition>
  );
}
