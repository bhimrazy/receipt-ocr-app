import { useSyncExternalStore } from "react";

type VisualViewportLike = Pick<VisualViewport, "height" | "offsetTop" | "scale">;

/**
 * How many CSS pixels of the layout viewport's bottom are hidden, in practice by the on-screen
 * keyboard: iOS (and Android's default `resizes-visual`) shrink only the visual viewport when it
 * opens, so `position: fixed; bottom: 0` ends up under it. 0 while pinch-zoomed, which also
 * shrinks the visual viewport.
 */
export function keyboardInset(layoutHeight: number, viewport: VisualViewportLike): number {
  if (viewport.scale > 1) return 0;
  const hidden = layoutHeight - viewport.height - viewport.offsetTop;
  return hidden >= 1 ? Math.round(hidden) : 0;
}

function subscribe(onChange: () => void) {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  return () => {
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
  };
}

function snapshot() {
  const viewport = window.visualViewport;
  return viewport ? keyboardInset(document.documentElement.clientHeight, viewport) : 0;
}

/** The current keyboardInset in px, kept live while the calling component is mounted. */
export function useKeyboardInset(): number {
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}
