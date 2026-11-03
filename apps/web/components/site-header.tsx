"use client";

import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { authClient } from "@/lib/auth-client";

export type NavLink = { href: string; label: string };

const defaultLinks: NavLink[] = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function SiteHeader({ links = defaultLinks }: { links?: NavLink[] }) {
  const { data: session, isPending } = authClient.useSession();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen, closeMenu]);

  const solid = scrolled || menuOpen;

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 md:px-6 md:pt-4">
      {menuOpen && (
        <div
          aria-hidden
          className="fixed inset-0 -z-10 bg-background/70 backdrop-blur-sm lg:hidden"
          onClick={() => closeMenu(false)}
        />
      )}
      <div
        className={cn(
          "mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 rounded-full px-2 pl-4 transition-[background-color,box-shadow] duration-300 sm:pl-5",
          solid ? "bg-background/85 shadow-lg shadow-black/40 ring-1 ring-border backdrop-blur-xl" : "bg-transparent",
        )}
      >
        <Link aria-label="receiptOCR home" className={cn("inline-flex min-h-11 items-center rounded-lg", focusRing)} href="/">
          <Brand />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <a
              className={cn(
                "rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
                focusRing,
              )}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          {isPending ? (
            <span aria-hidden className="h-11 w-28 animate-pulse rounded-full bg-foreground/[0.06] lg:h-10" />
          ) : session ? (
            <Link className={cn(buttonVariants(), "h-11 lg:h-10")} href="/app/upload">
              Open the app <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <>
              <Link
                className={cn(buttonVariants({ variant: "ghost" }), "hidden h-11 sm:inline-flex lg:h-10")}
                href="/sign-in"
              >
                Sign in
              </Link>
              <Link className={cn(buttonVariants(), "h-11 lg:h-10")} href="/sign-up">
                Get started free
              </Link>
            </>
          )}
          <button
            ref={toggleRef}
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="site-menu"
            onClick={() => (menuOpen ? closeMenu(true) : setMenuOpen(true))}
            className={cn(
              "flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground lg:hidden",
              focusRing,
            )}
          >
            {menuOpen ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          aria-label="Main"
          className="mx-auto mt-2 max-w-6xl rounded-3xl bg-background/95 p-2 shadow-lg shadow-black/40 ring-1 ring-border backdrop-blur-xl lg:hidden"
          id="site-menu"
        >
          <ul className="flex flex-col">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  className={cn(
                    "flex min-h-12 items-center rounded-2xl px-4 text-base text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
                    focusRing,
                  )}
                  href={link.href}
                  onClick={() => closeMenu(false)}
                >
                  {link.label}
                </a>
              </li>
            ))}
            {!session && (
              <li className="mt-1 border-t border-border pt-1 sm:hidden">
                <Link
                  className={cn(
                    "flex min-h-12 items-center rounded-2xl px-4 text-base text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
                    focusRing,
                  )}
                  href="/sign-in"
                  onClick={() => closeMenu(false)}
                >
                  Sign in
                </Link>
              </li>
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}
