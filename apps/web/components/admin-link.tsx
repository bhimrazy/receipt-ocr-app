"use client";

import { DropdownMenuItem } from "@receipt-ocr/ui/components/dropdown-menu";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

/**
 * "Admin" menu item, shown only to admins. Presentational: /admin is guarded
 * server-side by requireAdmin(). Must render inside a DropdownMenu.
 */
export function AdminMenuItem() {
  const { data: session } = authClient.useSession();
  if (session?.user?.role !== "admin") return null;

  return (
    <DropdownMenuItem render={<Link href="/admin" />}>
      <ShieldCheck aria-hidden="true" />
      Admin
    </DropdownMenuItem>
  );
}
