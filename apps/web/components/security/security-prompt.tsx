"use client";

import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { dismissSecurityPromptAction } from "@/app/app/settings/security/actions";

/**
 * Shown once, server-decided, after a user's fifth scanned receipt while they have neither a
 * passkey nor an authenticator app. Dismissing hides it for good (lib/security-prompt.ts).
 */
export function SecurityPrompt() {
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || pathname.startsWith("/app/settings/security")) return null;

  function dismiss() {
    setDismissed(true);
    void dismissSecurityPromptAction();
  }

  return (
    <aside
      aria-label="Protect your receipts"
      className="mx-auto mb-6 flex max-w-5xl flex-col gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-sm sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="min-w-0">
          Protect your receipts: add a passkey (one tap) or an authenticator app.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pl-7 sm:pl-0">
        <Link
          className={buttonVariants({ size: "sm" })}
          href="/app/settings/security#passkeys-heading"
        >
          Add a passkey
        </Link>
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href="/app/settings/security#two-factor-heading"
        >
          Use an app
        </Link>
        <Button
          aria-label="Dismiss for good"
          className="ml-auto sm:ml-0"
          onClick={dismiss}
          size="icon-sm"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
    </aside>
  );
}
