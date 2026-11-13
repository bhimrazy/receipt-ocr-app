"use client";

import {
  Drawer,
  DrawerAction,
  DrawerContent,
  DrawerDescription,
  DrawerGroup,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@receipt-ocr/ui/components/drawer";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  ChartNoAxesColumn,
  ChevronLeft,
  Ellipsis,
  House,
  Loader2,
  Plus,
  ReceiptText,
  ScanLine,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { backWithTransition } from "@/lib/back-transition";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };

export const APP_NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: House, exact: true },
  { href: "/app/receipts", label: "Receipts", icon: ReceiptText },
  { href: "/app/spending", label: "Spending", icon: ChartNoAxesColumn },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export const ADMIN_NAV_ITEM: NavItem = { href: "/admin", label: "Admin", icon: ShieldCheck };

/** Opens the camera; depends on `/app/upload` handling `capture=1` (PR #47). */
export const SCAN_HREF = "/app/upload?capture=1";

const ADD_HREF = "/app/upload";

const SCAN_ITEM: NavItem = { href: ADD_HREF, label: "Scan", icon: ScanLine };

/**
 * The tab's icon, swapped for a spinner from the click until the next page is ready, so a
 * tab responds at once even when its page takes a moment. Must sit inside the <Link>.
 */
function NavIcon({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <Loader2
      aria-hidden="true"
      className={cn(className, "animate-spin motion-reduce:animate-none")}
    />
  ) : (
    <Icon aria-hidden="true" className={className} />
  );
}

export function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Desktop sidebar links with aria-current on the active page. */
export function SidebarNav({ items, label = "Main" }: { items: NavItem[]; label?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition outline-none select-none active:bg-wash focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-wash hover:text-foreground",
            )}
            href={item.href}
            key={item.href}
          >
            <NavIcon className="size-4" icon={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Fixed bottom tab bar below md, above the home indicator. `center` adds a raised primary
 * action in the middle slot. Pages pad themselves by `--app-bottom-inset` (styles.css).
 * Hidden while `<html data-selecting>`: a page's selection bar takes its place and height.
 */
export function BottomTabBar({
  items,
  label = "Main",
  center,
  more,
}: {
  items: NavItem[];
  label?: string;
  center?: NavItem;
  /** Sections that don't fit the bar (at most 5 slots at 390px); opened from a "More" tab. */
  more?: NavItem[];
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = more?.some((item) => isActive(pathname, item)) ?? false;
  const half = Math.ceil(items.length / 2);
  const slots: (NavItem | null)[] = center
    ? [...items.slice(0, half), null, ...items.slice(half)]
    : items;
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur md:hidden [:root[data-selecting]_&]:hidden"
      data-slot="tab-bar"
    >
      <ul className="grid h-[var(--tabbar-h,4rem)] auto-cols-fr grid-flow-col">
        {slots.map((item) => {
          if (!item) {
            const active = isActive(pathname, center!);
            return (
              <li className="flex min-h-0 justify-center" key="center">
                <Link
                  aria-current={active ? "page" : undefined}
                  className="group flex h-full min-w-16 flex-col items-center justify-end gap-1 pb-3 text-2xs font-medium text-foreground outline-none select-none"
                  href={SCAN_HREF}
                >
                  {/* Labels share a baseline with the other tabs; the button rises above the bar. */}
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_24px_color-mix(in_oklab,var(--primary)_35%,transparent)] ring-4 ring-background transition group-focus-visible:outline-2 group-focus-visible:outline-offset-4 group-focus-visible:outline-ring group-active:scale-95 motion-reduce:transition-none">
                    <NavIcon className="size-6" icon={center!.icon} />
                  </span>
                  {center!.label}
                </Link>
              </li>
            );
          }
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors outline-none select-none focus-visible:bg-wash focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-wash",
                  active ? "text-primary" : "text-muted-foreground",
                )}
                href={item.href}
              >
                <NavIcon className="size-5" icon={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
        {more?.length ? (
          <li>
            <Drawer onOpenChange={setMoreOpen} open={moreOpen}>
              <DrawerTrigger
                aria-current={moreActive ? "true" : undefined}
                className={cn(
                  "flex h-full w-full flex-col items-center justify-center gap-1 text-2xs font-medium transition-colors outline-none select-none focus-visible:bg-wash focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-wash",
                  moreActive ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Ellipsis aria-hidden="true" className="size-5" />
                More
              </DrawerTrigger>
              <DrawerContent>
                <DrawerHeader>
                  <DrawerTitle>More</DrawerTitle>
                  <DrawerDescription className="sr-only">Other {label} sections</DrawerDescription>
                </DrawerHeader>
                <DrawerGroup>
                  {more.map((item) => {
                    const Icon = item.icon;
                    return (
                      <DrawerAction
                        aria-current={isActive(pathname, item) ? "page" : undefined}
                        key={item.href}
                        onClick={() => setMoreOpen(false)}
                        render={<Link href={item.href} />}
                      >
                        <Icon aria-hidden="true" />
                        {item.label}
                      </DrawerAction>
                    );
                  })}
                </DrawerGroup>
              </DrawerContent>
            </Drawer>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

/** Desktop's way into `/app/upload`; phones have the Scan tab. Kept outside the nav so its list stays navigation. */
export function AddReceiptsLink() {
  const pathname = usePathname();
  return (
    <Link
      aria-current={pathname === ADD_HREF ? "page" : undefined}
      className={cn(
        buttonVariants({ variant: "default" }),
        "h-10 w-full justify-center gap-2 focus-visible:ring-2 focus-visible:ring-ring",
      )}
      href={ADD_HREF}
    >
      <Plus aria-hidden="true" className="size-4" />
      Add receipts
    </Link>
  );
}

export function AppSidebarNav({ showAdmin }: { showAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <AddReceiptsLink />
      <SidebarNav items={APP_NAV} />
      {/* Platform tools sit apart, so a customer's own pages read as one group. */}
      {showAdmin ? (
        <div className="flex flex-col gap-1.5">
          <p className="px-3 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            Platform
          </p>
          <SidebarNav items={[ADMIN_NAV_ITEM]} label="Platform" />
        </div>
      ) : null}
    </div>
  );
}

/** Admin is in the account sheet: few people use it, and rarely. */
export function AppTabBar() {
  return <BottomTabBar center={SCAN_ITEM} items={APP_NAV} />;
}

const APP_BAR_ACTIONS_ID = "app-bar-actions";
const noSubscription = () => () => {};

/** Puts a page's own actions (a "More" button) in the phone app bar, beside the account. */
export function AppBarActions({ children }: { children: React.ReactNode }) {
  // The slot is server-rendered with the layout, so it exists once the page hydrates.
  const target = useSyncExternalStore(
    noSubscription,
    () => document.getElementById(APP_BAR_ACTIONS_ID),
    () => null,
  );
  return target ? createPortal(children, target) : null;
}

type Back = { href: string; label: string };

/** Where Back goes from a detail page; null on a top-level page. */
export function backFor(pathname: string): Back | null {
  if (pathname.startsWith("/app/receipts/")) return { href: "/app/receipts", label: "Receipts" };
  if (pathname.startsWith("/app/settings/")) return { href: "/app/settings", label: "Settings" };
  if (/^\/admin\/users\/[^/]+/.test(pathname)) return { href: "/admin/users", label: "Users" };
  if (pathname === "/admin/jobs") return { href: "/admin/operations", label: "Operations" };
  if (/^\/admin\/jobs\/[^/]+/.test(pathname)) return { href: "/admin/jobs", label: "Jobs" };
  if (/^\/admin\/workspaces\/[^/]+/.test(pathname)) {
    return { href: "/admin/workspaces", label: "Workspaces" };
  }
  return null;
}

/** Names a page a person can come back to; null for anything else. */
function labelFor(pathname: string): string | null {
  const known: Record<string, string> = {
    "/app": "Home",
    "/app/receipts": "Receipts",
    "/app/receipts/groups": "Groups",
    "/app/spending": "Spending",
    "/app/settings": "Settings",
    "/admin/jobs": "Jobs",
    "/admin/operations": "Operations",
    "/admin/users": "Users",
    "/admin/workspaces": "Workspaces",
  };
  return known[pathname] ?? null;
}

/**
 * The page h1's text once it has scrolled under the bar, else null: the large-title pattern,
 * so the bar doesn't repeat a title that's still on screen.
 */
function useScrolledTitle(pathname: string) {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (!main) return;
    let heading: HTMLHeadingElement | null = null;
    let hidden = false;
    let observer: IntersectionObserver | null = null;
    const sync = () => setTitle(hidden && heading ? heading.textContent : null);
    const watch = () => {
      const next = main.querySelector("h1");
      if (next === heading) return sync();
      observer?.disconnect();
      heading = next;
      hidden = false;
      sync();
      if (!next) return;
      observer = new IntersectionObserver(
        ([entry]) => {
          hidden = entry ? !entry.isIntersecting : false;
          sync();
        },
        // Taller than the 3.5rem bar: a title tucked under it counts as gone.
        { rootMargin: "-64px 0px 0px 0px" },
      );
      observer.observe(next);
    };
    watch();
    // Pages stream in and a refresh can rename the receipt, so look again when main changes.
    const mutations = new MutationObserver(watch);
    mutations.observe(main, { childList: true, subtree: true, characterData: true });
    return () => {
      mutations.disconnect();
      observer?.disconnect();
    };
  }, [pathname]);
  return title;
}

/**
 * The phone app bar: Back on detail pages (the brand mark on top-level ones), the page title
 * once it has scrolled away, and the account sheet. Sticky, and clear of the status bar when
 * installed.
 */
export function MobileTopBar({
  context,
  home,
  leading,
  trailing,
}: {
  /** Shown in the title slot on top-level pages until a title scrolls in (the workspace). */
  context?: React.ReactNode;
  home: string;
  leading: React.ReactNode;
  trailing: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const parent = backFor(pathname);
  const title = useScrolledTitle(pathname);
  // The page before this one, kept in state (adjusted during render) so Back can name it and
  // return to it with its filters and scroll position rather than open a fresh list.
  const [visit, setVisit] = useState<{ path: string; previous: string | null }>({
    path: pathname,
    previous: null,
  });
  if (visit.path !== pathname) setVisit({ path: pathname, previous: visit.path });
  const previousLabel = visit.previous ? labelFor(visit.previous) : null;
  const cameFrom =
    visit.previous && previousLabel ? { href: visit.previous, label: previousLabel } : null;

  const back = parent && cameFrom && cameFrom.href !== pathname ? cameFrom : parent;

  return (
    <header
      className="sticky top-[var(--banner-h,0px)] z-30 border-b border-border bg-background/95 pt-[var(--top-inset,env(safe-area-inset-top))] backdrop-blur md:hidden"
      data-slot="app-bar"
    >
      <div className="flex h-14 items-center gap-1 pr-3 pl-1">
        {back ? (
          <Link
            aria-label={`Back to ${back.label}`}
            className="flex min-h-11 min-w-11 shrink-0 items-center gap-0.5 rounded-full pr-3 pl-1 text-sm font-medium text-primary outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:bg-wash"
            href={back.href}
            onClick={(event) => {
              if (visit.previous !== back.href) return;
              event.preventDefault();
              backWithTransition(() => router.back());
            }}
          >
            <ChevronLeft aria-hidden="true" className="size-6" />
            {/* Once the title shows in the bar, the chevron alone leaves it room. */}
            <span className={cn(title && "sr-only")}>{back.label}</span>
          </Link>
        ) : (
          <Link
            aria-label="Home"
            className="ml-2 flex min-h-11 min-w-11 shrink-0 items-center rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
            href={home}
          >
            {leading}
          </Link>
        )}
        <div className="relative min-w-0 flex-1 px-1">
          <p
            aria-hidden="true"
            className={cn(
              "truncate text-base font-semibold transition-opacity duration-200 motion-reduce:transition-none",
              title ? "opacity-100" : "opacity-0",
            )}
          >
            {title}
          </p>
          {context && !back ? (
            <div
              // invisible, not just transparent: the context may be a button, so it must leave
              // the tab order and stop taking taps while the page title is in its place.
              className={cn(
                "absolute inset-x-1 top-1/2 -translate-y-1/2 truncate text-sm text-muted-foreground transition-[opacity,visibility] duration-200 motion-reduce:transition-none",
                title ? "invisible opacity-0" : "visible opacity-100",
              )}
            >
              {context}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="contents" id={APP_BAR_ACTIONS_ID} />
          {trailing}
        </div>
      </div>
    </header>
  );
}
