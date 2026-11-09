"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isStandaloneDisplay } from "@/lib/display-mode";
import { watchReturn } from "@/lib/return-watch";

/**
 * In the installed app, which has no reload button, refetches the current screen's server data
 * when the app comes back after more than a minute in the background, as native apps do.
 * router.refresh() merges the new payload in place: typed input, open sheets and scroll stay.
 */
export function RefreshOnReturn() {
  const router = useRouter();
  useEffect(() => {
    if (!isStandaloneDisplay()) return;
    return watchReturn({
      isHidden: () => document.hidden,
      now: () => Date.now(),
      onReturn: () => {
        // Offline the refetch fails and Next falls back to a full load: offline.html.
        if (navigator.onLine) router.refresh();
      },
      onVisibilityChange: (listener) => {
        document.addEventListener("visibilitychange", listener);
        return () => document.removeEventListener("visibilitychange", listener);
      },
    });
  }, [router]);
  return null;
}
