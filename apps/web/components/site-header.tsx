"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { ArrowRight, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/brand";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

type Bubble = { left: number; width: number; opacity: number };

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bubble, setBubble] = useState<Bubble>({ left: 0, width: 0, opacity: 0 });
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  const moveBubbleTo = (el: HTMLElement) => {
    setBubble({ left: el.offsetLeft, width: el.offsetWidth, opacity: 1 });
  };

  const hideBubble = () => setBubble((b) => ({ ...b, opacity: 0 }));

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-3 md:px-6 md:pt-4">
      <div
        className={`mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full border px-3 pl-5 transition-all duration-300 ${
          scrolled || menuOpen
            ? "border-border bg-background/80 shadow-lg shadow-black/40 backdrop-blur-xl"
            : "border-transparent bg-transparent"
        }`}
      >
        <Link href="/" aria-label="receiptOCR home">
          <Brand />
        </Link>

        <nav
          ref={navRef}
          onMouseLeave={hideBubble}
          className="absolute left-1/2 hidden -translate-x-1/2 items-center md:flex"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 rounded-full bg-foreground/[0.07] transition-[left,width,opacity] duration-300 ease-out"
            style={{ left: bubble.left, width: bubble.width, opacity: bubble.opacity }}
          />
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onMouseEnter={(e) => moveBubbleTo(e.currentTarget)}
              onFocus={(e) => moveBubbleTo(e.currentTarget)}
              className="relative z-10 rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/sign-in">
              Get started
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground md:hidden"
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="mx-auto mt-2 max-w-6xl rounded-2xl border border-border bg-background/90 p-3 shadow-lg shadow-black/40 backdrop-blur-xl md:hidden">
          <ul className="flex flex-col">
            {navLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setMenuOpen(false)}
                  className="block rounded-xl px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li className="mt-2 border-t border-border pt-3 sm:hidden">
              <Link
                href="/sign-in"
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
              >
                Sign in
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
