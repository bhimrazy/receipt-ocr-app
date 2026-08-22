"use client";

import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AdminLink } from "@/components/admin-link";
import { authClient } from "@/lib/auth-client";

export function UserMenu() {
  const { data: session, isPending } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (isPending) {
    return <span className="size-9 animate-pulse rounded-full border border-border bg-card" />;
  }

  if (!session) {
    return (
      <Link
        className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        href="/sign-in"
      >
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
    <div className="relative" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Open user menu"
        className="flex size-9 items-center justify-center rounded-full border border-border bg-primary/15 font-mono text-sm font-semibold text-primary transition hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="size-full rounded-full object-cover" src={user.image} />
        ) : (
          initial
        )}
      </button>
      {open ? (
        <div
          className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-border bg-card p-1.5 shadow-2xl"
          role="menu"
        >
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-sm font-medium">{user.name || "Account"}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <Link
            className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground"
            href="/app/settings"
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <Settings className="size-4" />
            Settings
          </Link>
          <AdminLink className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground" onNavigate={() => setOpen(false)} />
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition hover:bg-foreground/[0.06] hover:text-foreground"
            onClick={handleSignOut}
            role="menuitem"
            type="button"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
