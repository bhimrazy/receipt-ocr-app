"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";

/**
 * The site's one bottom slot. The cookie banner outranks the install sheet, so the sheet waits
 * while the banner (or the open support panel) holds it. Whoever holds the slot with an element
 * writes its height to `--site-bottom-inset`, which lifts the support launcher above it.
 */
export type BottomOccupant = "cookie-banner" | "install-sheet" | "support";

const held = new Set<BottomOccupant>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const INSET = "--site-bottom-inset";

/** Holds the slot while `active`; with `ref`, also publishes the element's height as the inset. */
export function useHoldBottom(
  occupant: BottomOccupant,
  active: boolean,
  ref?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    held.add(occupant);
    notify();
    const element = ref?.current;
    const root = document.documentElement.style;
    const observer =
      element && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => root.setProperty(INSET, `${element.offsetHeight}px`))
        : null;
    if (element) {
      root.setProperty(INSET, `${element.offsetHeight}px`);
      observer?.observe(element);
    }
    return () => {
      observer?.disconnect();
      if (element) root.removeProperty(INSET);
      held.delete(occupant);
      notify();
    };
  }, [occupant, active, ref]);
}

/** True while `occupant` holds the slot. */
export function useBottomHeld(occupant: BottomOccupant): boolean {
  return useSyncExternalStore(
    subscribe,
    () => held.has(occupant),
    () => false,
  );
}
