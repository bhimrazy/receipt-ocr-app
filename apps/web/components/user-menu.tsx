"use client";

import { buttonVariants } from "@receipt-ocr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@receipt-ocr/ui/components/dropdown-menu";
import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminMenuItem } from "@/components/admin-link";
import { authClient } from "@/lib/auth-client";

export function UserMenu() {
  const { data: session, isPending } = authClient.useSession();
  const router = useRouter();

  if (isPending) {
    return (
      <span
        aria-hidden="true"
        className="block size-9 animate-pulse rounded-full border border-border bg-card max-md:size-11"
      />
    );
  }

  if (!session) {
    return (
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/sign-in">
        Sign in
      </Link>
    );
  }

  const { user } = session;
  const initial = (user.name?.trim() || user.email || "?").charAt(0).toUpperCase();

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex size-9 items-center justify-center overflow-hidden rounded-full border border-border bg-primary/15 font-mono text-sm font-semibold text-primary transition outline-none hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background max-md:size-11"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="size-full object-cover" src={user.image} />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60 max-w-[calc(100vw-2rem)]">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium">{user.name || "Your account"}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/app/settings" />}>
          <Settings aria-hidden="true" />
          Settings
        </DropdownMenuItem>
        <AdminMenuItem />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
