"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

export const REFRESH_MS = 30_000;

/**
 * Re-renders the page's server data every 30 s while the tab is visible.
 * A hidden tab doesn't poll; on becoming visible it refreshes at once if the
 * data is older than the interval, like `lib/backoff-poll`.
 */
export function AutoRefresh({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Set by the first effect below, before the timer effect reads it.
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
  }, [generatedAt]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      last.current = Date.now();
      startTransition(() => router.refresh());
    };
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const wait = Math.max(0, REFRESH_MS - (Date.now() - last.current));
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, wait);
    };
    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  }).format(new Date(generatedAt));

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-live="polite" role="status">
        {pending ? "Refreshing…" : `Updated ${time} UTC · every 30 s while open`}
      </span>
      <Button
        aria-label="Refresh now"
        disabled={pending}
        onClick={() => {
          last.current = Date.now();
          startTransition(() => router.refresh());
        }}
        size="icon-sm"
        variant="ghost"
      >
        <RefreshCw
          aria-hidden="true"
          className={pending ? "animate-spin motion-reduce:animate-none" : ""}
        />
      </Button>
    </div>
  );
}
