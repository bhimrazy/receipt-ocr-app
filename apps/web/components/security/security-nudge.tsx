"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const KEY = "receiptocr:security-nudge-dismissed";
const QUIET_MS = 30 * 24 * 60 * 60 * 1000;

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(at) && Date.now() - at < QUIET_MS;
  } catch {
    return false;
  }
}

/**
 * For owners and admins of a shared workspace without two-step sign-in: one
 * quiet line, dismissible for 30 days. Hidden on the Security page itself.
 */
export function SecurityNudge() {
  const pathname = usePathname();
  // Rendered only after hydration, so a dismissed banner never flashes.
  const hidden = useSyncExternalStore(subscribe, dismissedRecently, () => true);
  if (hidden || pathname.startsWith("/app/settings/security")) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // Private mode: it just shows again next time.
    }
    for (const listener of listeners) listener();
  }

  return (
    <aside
      aria-label="Account security"
      className="mx-auto mb-6 flex max-w-5xl items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm sm:items-center"
    >
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary sm:mt-0" />
      <p className="min-w-0 flex-1">
        Other people rely on this workspace. Turn on two-step sign-in so a stolen password
        isn&apos;t enough to get in.
      </p>
      <Link
        className={buttonVariants({ size: "sm", className: "shrink-0" })}
        href="/app/settings/security"
      >
        Set up
      </Link>
      <Button
        aria-label="Dismiss for 30 days"
        className="shrink-0"
        onClick={dismiss}
        size="icon-sm"
        variant="ghost"
      >
        <X aria-hidden="true" />
      </Button>
    </aside>
  );
}
