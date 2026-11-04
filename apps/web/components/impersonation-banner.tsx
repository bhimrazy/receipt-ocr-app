"use client";

import { authClient } from "@/lib/auth-client";
import { Button } from "@receipt-ocr/ui/components/button";
import { UserCog } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Persistent banner shown while an admin is impersonating another user
 * (session.impersonatedBy is set). "Stop" restores the admin's own session via
 * the admin plugin, then returns to the admin panel.
 */
export function ImpersonationBanner() {
  const { data: session } = authClient.useSession();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const impersonatedBy = session?.session?.impersonatedBy;
  if (!impersonatedBy) return null;

  async function stop() {
    setPending(true);
    try {
      await authClient.admin.stopImpersonating();
      router.push("/admin/users");
      router.refresh();
    } finally {
      setPending(false);
    }
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
            Signed in as <span className="font-medium break-all">{session?.user?.email}</span>.
            Everything you do runs as this user.
          </span>
        </div>
        <Button disabled={pending} onClick={stop} size="sm" variant="outline">
          {pending ? "Stopping…" : "Stop impersonating"}
        </Button>
      </div>
    </div>
  );
}
