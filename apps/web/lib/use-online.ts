"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * Whether following this link loads another page of the site, which offline would fail and fall
 * back to offline.html. Same-page `#` links, other sites, downloads and new windows don't.
 */
export function loadsAnotherPage(
  href: string,
  current: string,
  link: { target?: string; download?: boolean } = {},
): boolean {
  if (link.download || (link.target && link.target !== "_self")) return false;
  const from = new URL(current);
  const to = new URL(href, from);
  if (to.origin !== from.origin) return false;
  return to.pathname !== from.pathname || to.search !== from.search;
}

/**
 * The browser's online flag. `false` means certainly offline; `true` only means a network is
 * there, so requests can still fail. The server render assumes online.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
