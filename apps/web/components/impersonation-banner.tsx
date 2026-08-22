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
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2 text-sm text-amber-200">
      <div className="flex items-center gap-2">
        <UserCog className="size-4 shrink-0" />
        <span>
          Impersonating <span className="font-medium">{session?.user?.email}</span>. Actions run as
          this user.
        </span>
      </div>
      <Button disabled={pending} onClick={stop} size="sm" variant="outline">
        {pending ? "Stopping…" : "Stop impersonating"}
      </Button>
    </div>
  );
}
