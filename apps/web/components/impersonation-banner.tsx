"use client";

import { stopImpersonatingAction } from "@/lib/impersonation-actions";
import { clearSharedFiles } from "@/lib/share-target";
import { Button } from "@receipt-ocr/ui/components/button";
import { UserCog } from "lucide-react";
import { useState } from "react";

/**
 * Persistent banner shown while an admin is impersonating another user
 * (the layout renders it only when session.impersonatedBy is set). "Stop" restores the admin's own session and
 * returns to that user's admin page.
 */
export function ImpersonationBanner({ email }: { email: string }) {
  const [pending, setPending] = useState(false);

  // Server action: it writes the audit row, then redirects to the user's admin page.
  async function stop() {
    setPending(true);
    await clearSharedFiles();
    const result = await stopImpersonatingAction();
    if (result && !result.ok) setPending(false);
  }

  return (
    // Opaque outer layer so the tinted banner stays readable while content scrolls under it.
    <div className="sticky top-0 z-50 bg-background">
      <div
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning md:px-5"
        role="status"
      >
        <div className="flex min-w-0 items-start gap-2">
          <UserCog aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 break-words">
            Signed in as <span className="font-medium break-all">{email}</span>. Everything you do
            runs as this user.
          </span>
        </div>
        <Button disabled={pending} onClick={stop} size="sm" variant="outline">
          {pending ? "Stopping…" : "Stop impersonating"}
        </Button>
      </div>
    </div>
  );
}
