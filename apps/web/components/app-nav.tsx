"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { History, House, Settings, ShieldCheck, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

export const APP_NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: House, exact: true },
  { href: "/app/history", label: "History", icon: History },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export const ADMIN_NAV_ITEM: NavItem = { href: "/admin", label: "Admin", icon: ShieldCheck };

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  // A receipt detail page belongs to History.
  if (item.href === "/app/history" && pathname.startsWith("/app/receipts")) return true;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Desktop sidebar links with aria-current on the active page. */
export function SidebarNav({ items, label = "Main" }: { items: NavItem[]; label?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
            )}
            href={item.href}
            key={item.href}
          >
            <Icon aria-hidden="true" className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Fixed bottom tab bar below md. Pair with `pb-20` on the scrolling main. */
export function BottomTabBar({ items, label = "Main" }: { items: NavItem[]; label?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid auto-cols-fr grid-flow-col">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 text-[11px] font-medium transition outline-none focus-visible:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                href={item.href}
              >
                <Icon aria-hidden="true" className="size-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// Nav items hold icon components, which can't cross the server/client
// boundary, so the server layout passes only whether to show Admin.
function appItems(showAdmin: boolean) {
  return showAdmin ? [...APP_NAV, ADMIN_NAV_ITEM] : APP_NAV;
}

export function AppSidebarNav({ showAdmin }: { showAdmin: boolean }) {
  return <SidebarNav items={appItems(showAdmin)} />;
}

export function AppTabBar({ showAdmin }: { showAdmin: boolean }) {
  return <BottomTabBar items={appItems(showAdmin)} />;
}
