"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { focusRing } from "./primitives";

/** A <details> menu below lg: works without JS; JS only closes it after a link is tapped. */
export function MobileMenu({ links }: { links: Array<{ href: string; label: string }> }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");
  return (
    <details className="group lg:hidden" ref={ref}>
      <summary
        aria-label="Menu"
        className={cn(
          "flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-secondary",
          focusRing,
        )}
      >
        <Menu aria-hidden className="size-5 group-open:hidden" />
        <X aria-hidden className="hidden size-5 group-open:block" />
      </summary>
      <nav
        aria-label="Sections"
        className="absolute inset-x-0 top-16 border-b border-border bg-background px-4 pt-2 pb-4 shadow-[0_18px_30px_-20px_rgb(31_27_22/0.4)] sm:px-6"
      >
        <ul className="mx-auto max-w-6xl">
          {links.map((link) => (
            <li className="border-b border-border/70" key={link.href}>
              <a
                className={cn("flex min-h-12 items-center rounded-md text-base", focusRing)}
                href={link.href}
                onClick={close}
              >
                {link.label}
              </a>
            </li>
          ))}
          <li className="sm:hidden">
            <Link
              className={cn(
                "flex min-h-12 items-center rounded-md text-base font-medium",
                focusRing,
              )}
              href="/sign-in"
              onClick={close}
            >
              Sign in
            </Link>
          </li>
        </ul>
      </nav>
    </details>
  );
}
