"use client";

import { WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { loadsAnotherPage, useOnline } from "@/lib/use-online";

/**
 * A slim bar under the app bar while the device is offline. The screen stays as it is: a tap on
 * a link to another page is held here with a note, instead of Next falling back to a full page
 * load that the service worker can only answer with offline.html.
 */
export function OfflineBar() {
  const online = useOnline();
  const pathname = usePathname();
  // The page a held tap was on, so the note goes away once the user is somewhere else.
  const [heldOn, setHeldOn] = useState<string | null>(null);

  useEffect(() => {
    if (online) return;
    const hold = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      if (
        !loadsAnotherPage(link.href, window.location.href, {
          target: link.target,
          download: link.hasAttribute("download"),
        })
      )
        return;
      // Capture phase, before React: next/link skips clicks that are already default-prevented.
      event.preventDefault();
      setHeldOn(window.location.pathname);
    };
    document.addEventListener("click", hold, true);
    return () => document.removeEventListener("click", hold, true);
  }, [online]);

  const held = !online && heldOn === pathname;

  return (
    <div
      aria-live="polite"
      // Sticks below the phone app bar (its status-bar inset, 3.5rem and border), at the top on desktop.
      className="sticky top-[calc(var(--banner-h,0px)+var(--top-inset,env(safe-area-inset-top))+3.5rem+1px)] z-20 empty:hidden md:top-[var(--banner-h,0px)]"
      data-slot="offline-bar"
      role="status"
    >
      {online ? null : (
        <p className="flex items-center justify-center gap-2 border-b border-border bg-muted px-4 py-2 text-center text-xs text-foreground">
          <WifiOff aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
          {held
            ? "You're offline, so that page can't open. Try again once you're connected."
            : "You're offline. Opening pages and saving changes need a connection."}
        </p>
      )}
    </div>
  );
}
