"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
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
      onClick={() => (window.history.length > 1 ? router.back() : router.replace(fallback))}
      type="button"
    >
      <ArrowLeft aria-hidden className="size-4" /> Back
    </button>
  );
}
