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
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=2592000; samesite=lax${secure}`;
    // Cookies can be blocked; refreshing then would only repeat on every visit.
    const stuck = document.cookie
      .split("; ")
      .includes(`${TIME_ZONE_COOKIE}=${encodeURIComponent(zone)}`);
    if (stuck) router.refresh();
  }, [current, router]);
  return null;
}
