"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone-cookie";

/**
 * Remembers the browser's time zone in a cookie so the server can pick "today"
 * for this viewer. The first visit renders in UTC; when the zone differs, the
 * page refreshes once. The cookie holds no personal data and is not sent
 * anywhere but this app.
 */
export function TimeZoneCookie({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    let zone: string;
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone || zone === current) return;
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [current, router]);
  return null;
}
