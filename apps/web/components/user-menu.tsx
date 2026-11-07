"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@receipt-ocr/ui/components/dropdown-menu";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronsUpDown, Cookie, LogOut, Settings, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { useRouter } from "next/navigation";
import { signOutAndClearHint } from "@/lib/auth-client";
import { openConsentSettingsFrom } from "@/lib/consent/store";

export type MenuUser = { name: string | null; email: string; image: string | null };

function Avatar({ user, className }: { user: MenuUser; className?: string }) {
  const initial = (user.name?.trim() || user.email || "?").charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/15 font-mono text-sm font-semibold text-primary",
        className,
      )}
    >
      {user.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="size-full object-cover" src={user.image} />
      ) : (
        initial
      )}
    </span>
  );
}

/**
 * Account menu. The server layout passes the user, so there's no loading flash.
 * `row` is the sidebar version (avatar, name and email); `avatar` is the compact
 * one in the phone header.
 */
export function UserMenu({
  user,
  showAdmin,
  variant = "avatar",
}: {
  user: MenuUser;
  showAdmin: boolean;
  variant?: "avatar" | "row";
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);

  async function handleSignOut() {
    await signOutAndClearHint();
    router.push("/");
    router.refresh();
  }

  return (
    <DropdownMenu>
      {variant === "row" ? (
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label="Account menu"
          className="flex min-h-12 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition outline-none hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-wash"
        >
          <Avatar className="size-8" user={user} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {user.name || "Your account"}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label="Account menu"
          className="flex size-11 items-center justify-center rounded-full border border-border transition outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar className="size-full" user={user} />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent
        align={variant === "row" ? "start" : "end"}
        className="w-60 max-w-[calc(100vw-2rem)]"
        side={variant === "row" ? "top" : "bottom"}
      >
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium">{user.name || "Your account"}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/app/settings" />}>
          <Settings aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        {showAdmin ? (
          <DropdownMenuItem render={<Link href="/admin" />}>
            <ShieldCheck aria-hidden="true" />
            Admin
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => openConsentSettingsFrom(triggerRef.current)}>
          <Cookie aria-hidden="true" />
          Cookie settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
