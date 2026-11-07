"use client";

import { stopImpersonatingAction } from "@/lib/impersonation-actions";
import { Button } from "@receipt-ocr/ui/components/button";
import { UserCog } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Persistent banner shown while an admin is impersonating another user
 * (the layout renders it only when session.impersonatedBy is set). "Stop" restores the admin's own session and
 * returns to that user's admin page.
 */
export function ImpersonationBanner({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The phone app bar sticks below this banner: publish its height (styles.css reads it too).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => root.style.setProperty("--banner-h", `${el.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--banner-h");
    };
  }, []);

  // Server action: it writes the audit row, then redirects to the user's admin page.
  async function stop() {
    setPending(true);
    const result = await stopImpersonatingAction();
    if (result && !result.ok) setPending(false);
  }

  return (
    // Opaque outer layer so the tinted banner stays readable while content scrolls under it.
    <div
      className="sticky top-0 z-50 bg-background pt-[env(safe-area-inset-top)]"
      data-slot="impersonation-banner"
      ref={ref}
    >
      <div
        className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-1.5 sm:flex-wrap sm:gap-y-2 sm:py-2 text-sm text-warning md:px-5"
        role="status"
      >
        <div className="flex min-w-0 items-center gap-2 sm:items-start">
          <UserCog aria-hidden="true" className="size-4 shrink-0 sm:mt-0.5" />
          <span className="min-w-0 truncate sm:break-words sm:whitespace-normal">
            Signed in as <span className="font-medium sm:break-all">{email}</span>
            <span className="max-sm:hidden">. Everything you do runs as this user.</span>
          </span>
        </div>
        <Button className="shrink-0" disabled={pending} onClick={stop} size="sm" variant="outline">
          {pending ? (
            "Stopping…"
          ) : (
            <>
              Stop<span className="max-sm:sr-only"> impersonating</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
