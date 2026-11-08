"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { rememberStandalone } from "@/lib/display-mode";
import { isAppPath } from "@/lib/pwa";
// Imported for its module-load listener: it holds Chrome's install prompt for the install offer.
import "@/lib/use-install-offer";

/**
 * Registers the service worker (production builds only) under /app, so the landing page never
 * registers it. Once installed, the worker (scope "/") sees every same-origin navigation, but
 * passes all but the offline fallback and the share target through. The install offer itself
 * renders where it's placed (`components/install-offer.tsx`), not here.
 */
export function Pwa() {
  const inApp = isAppPath(usePathname());
  useEffect(rememberStandalone, []);
  useEffect(() => {
    if (!inApp || process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => console.warn("Service worker registration failed", error));
  }, [inApp]);
  return null;
}
