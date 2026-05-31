"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "./brand";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#how", label: "How it works" },
  { href: "#pricing", label: "Pricing" },
];

type Bubble = { left: number; width: number; opacity: number };

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [bubble, setBubble] = useState<Bubble>({ left: 0, width: 0, opacity: 0 });
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const moveBubbleTo = (el: HTMLElement) => {
    setBubble({ left: el.offsetLeft, width: el.offsetWidth, opacity: 1 });
  };

  const hideBubble = () => setBubble((b) => ({ ...b, opacity: 0 }));

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-4 pt-3 md:px-6 md:pt-4">
      <div
        className={`mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full border px-3 pl-5 transition-all duration-300 ${
          scrolled
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
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="hidden rounded-full sm:inline-flex"
          >
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild size="sm" className="rounded-full">
            <Link href="/sign-in">
              Get started
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
