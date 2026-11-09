"use client";

import { useSyncExternalStore } from "react";

const DESKTOP = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True from md up. On the server (nothing is open yet) it says desktop. */
export function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );
}
