"use client";

import { authClient } from "@/lib/auth-client";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";

/**
 * Renders an "Admin" entry only for signed-in admins. Purely presentational —
 * the /admin routes are protected server-side by requireAdmin(); this just
 * hides the link from non-admins.
 */
export function AdminLink({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const { data: session } = authClient.useSession();
  if (session?.user?.role !== "admin") return null;

  return (
    <Link
      className={
        className ??
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground"
      }
      href="/admin"
      onClick={onNavigate}
      role="menuitem"
    >
      <ShieldCheck className="size-4" />
      Admin
    </Link>
  );
}
