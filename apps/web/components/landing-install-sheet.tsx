"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { useEffect, useRef } from "react";
import { useHoldBottom } from "@/lib/bottom-slot";

/**
 * The home page's install sheet: non-modal and never takes focus, full width at the bottom like
 * the cookie banner. Loaded only when it shows.
 */
export default function LandingInstallSheet({
  onInstall,
  onDismiss,
}: {
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useHoldBottom("install-sheet", true, ref);
  // Escape means Not now, unless it's closing something else (a dialog, the open menu).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [aria-expanded="true"]')) return;
      onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);
  return (
    <aside
      aria-label="Install the app"
      className="fixed inset-x-0 bottom-0 z-30 max-h-[40dvh] overflow-y-auto border-t border-border bg-popover/95 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl supports-backdrop-filter:backdrop-blur-md md:hidden"
      ref={ref}
    >
      <h2 className="text-sm font-semibold">Install ReceiptOCR on your phone</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        It&apos;s a web app: no app store, and it opens from your home screen like any app.
        Photograph receipts and share photos straight into it.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={onInstall}>Install app</Button>
        <Button className="min-h-11" onClick={onDismiss} variant="ghost">
          Not now
        </Button>
      </div>
    </aside>
  );
}
