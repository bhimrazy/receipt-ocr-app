"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { isStandaloneDisplay, standaloneHome } from "@/lib/display-mode";
import { hasSignedInHint } from "@/lib/signed-in-hint";

/**
 * On the landing page: sends the installed app on to /app or /sign-in after a client-side
 * navigation to `/`. A full load never gets here (DISPLAY_MODE_SCRIPT redirects first), and the
 * page carries `standalone:invisible`, so it doesn't show while this runs.
 */
export function StandaloneHome() {
  const router = useRouter();
  useEffect(() => {
    if (isStandaloneDisplay()) router.replace(standaloneHome(hasSignedInHint()));
  }, [router]);
  return null;
}

/** Set once this tab has moved between pages of the app; per tab, so a new window starts without it. */
const NAVIGATED_KEY = "receiptocr.navigated";

function hasNavigated(): boolean {
  try {
    return sessionStorage.getItem(NAVIGATED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Records that this tab navigated within the app, so StandaloneBack knows there is an app page
 * to go back to. `history.length` can't tell: a window opened on a page already counts it.
 */
export function NavigationTracker() {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    if (pathname === first.current) return;
    try {
      sessionStorage.setItem(NAVIGATED_KEY, "1");
    } catch {
      // Storage blocked: Back falls back to `fallback`.
    }
  }, [pathname]);
  return null;
}

/**
 * "Back" for pages the installed app opens without its tab bar (legal pages, pricing): the
 * previous screen, or `fallback` when the page was opened first. Render it `standalone:` only;
 * a browser tab has its own Back button.
 */
export function StandaloneBack({
  fallback = "/app/settings",
  className,
}: {
  fallback?: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      className={className}
      onClick={() => (hasNavigated() ? router.back() : router.replace(fallback))}
      type="button"
    >
      <ArrowLeft aria-hidden className="size-4" /> Back
    </button>
  );
}
