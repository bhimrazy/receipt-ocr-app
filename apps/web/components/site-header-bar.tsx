"use client";

import { ArrowRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Brand } from "@/components/brand";
import { useSiteInstall } from "@/components/landing-install";
import { StandaloneBack } from "@/components/standalone";
import type { NavLink } from "@/components/site-header";
import { hasSignedInHint } from "@/lib/signed-in-hint";

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const noopSubscribe = () => () => {};

const join = (...classes: string[]) => classes.join(" ");

/**
 * The interactive part of SiteHeader. Button classes arrive precomputed from the server so this
 * island doesn't ship cva and tailwind-merge; plain template strings join the rest.
 */
export function SiteHeaderBar({
  links,
  primaryClass,
  ghostClass,
}: {
  links: NavLink[];
  primaryClass: string;
  ghostClass: string;
}) {
  // Server and first client render show the signed-out buttons; a cookie hint then swaps the CTA.
  const session = useSyncExternalStore(noopSubscribe, hasSignedInHint, () => false);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const install = useSiteInstall();

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
    <header className="fixed inset-x-0 top-0 z-50 px-2 pt-3 sm:px-3 md:px-6 md:pt-4">
      {menuOpen && (
        <div
          aria-hidden
          className="fixed inset-0 -z-10 bg-background/70 backdrop-blur-sm lg:hidden"
          onClick={() => closeMenu(false)}
        />
      )}
      <div
        className={join(
          "mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 rounded-full px-1.5 pl-3 transition-[background-color,box-shadow] duration-300 sm:gap-3 sm:px-2 sm:pl-5",
          solid
            ? "bg-background/85 shadow-lg shadow-black/40 light:shadow-float ring-1 ring-border backdrop-blur-xl"
            : "bg-transparent",
        )}
      >
        <Link
          aria-label="ReceiptOCR home"
          className={join(
            "inline-flex min-h-11 items-center rounded-lg standalone:hidden",
            focusRing,
          )}
          href="/"
        >
          {/* Below 375px only the mark fits beside Sign in, Start free and the menu. */}
          <Brand wordmarkClassName="max-[374px]:hidden" />
        </Link>
        <div className="hidden min-h-11 items-center standalone:flex">
          <Brand />
        </div>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex standalone:hidden!">
          {links.map((link) => (
            <a
              className={join(
                "rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-wash hover:text-foreground",
                focusRing,
              )}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <StandaloneBack
          className={join(
            "hidden min-h-11 items-center gap-1.5 rounded-full px-4 text-sm text-muted-foreground transition-colors hover:text-foreground standalone:inline-flex",
            focusRing,
          )}
        />
        {/* The installed app has its own way in; it offers Back instead (above). */}
        <div className="flex items-center gap-1 sm:gap-1.5 standalone:hidden">
          {session ? (
            <Link className={primaryClass} href="/app">
              Open the app <ArrowRight aria-hidden className="size-4" />
            </Link>
          ) : (
            <>
              <Link className={ghostClass} href="/sign-in">
                Sign in
              </Link>
              <Link className={primaryClass} href="/sign-up">
                Start free
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
            className={join(
              "flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground lg:hidden",
              focusRing,
            )}
          >
            {menuOpen ? (
              <X aria-hidden className="size-5" />
            ) : (
              <Menu aria-hidden className="size-5" />
            )}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          aria-label="Main"
          className="mx-auto mt-2 max-w-6xl rounded-3xl bg-background/95 p-2 shadow-lg shadow-black/40 light:shadow-float ring-1 ring-border backdrop-blur-xl lg:hidden"
          id="site-menu"
        >
          <ul className="flex flex-col">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  className={join(
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
            {install.available && (
              <li className="mt-1 border-t border-border pt-1">
                <button
                  className={join(
                    "flex min-h-12 w-full items-center rounded-2xl px-4 text-left text-base text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
                    focusRing,
                  )}
                  onClick={() => {
                    closeMenu(false);
                    void install.start();
                  }}
                  type="button"
                >
                  Get the app
                </button>
              </li>
            )}
          </ul>
        </nav>
      )}
      {install.guide}
    </header>
  );
}
