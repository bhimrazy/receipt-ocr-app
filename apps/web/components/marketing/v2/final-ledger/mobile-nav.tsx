"use client";

import { Menu, X } from "lucide-react";
import { useRef } from "react";

/** A <details> menu below md; tapping a link closes it, since <details> stays open on its own. */
export function MobileNav({ links }: { links: Array<{ href: string; label: string }> }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details className="group relative md:hidden" ref={ref}>
      <summary
        aria-label="Menu"
        className="flex size-11 cursor-pointer list-none items-center justify-center rounded-md text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <Menu aria-hidden="true" className="size-5 group-open:hidden" />
        <X aria-hidden="true" className="hidden size-5 group-open:block" />
      </summary>
      <nav
        aria-label="Sections"
        className="absolute right-0 top-[calc(100%+8px)] z-40 w-56 rounded-lg border border-(--fl-rule-strong) bg-card p-1.5 shadow-(--fl-shadow)"
      >
        {links.map((link) => (
          <a
            className="flex min-h-11 items-center rounded-md px-3 text-[15px] text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            href={link.href}
            key={link.href}
            onClick={() => ref.current?.removeAttribute("open")}
          >
            {link.label}
          </a>
        ))}
        <a
          className="mt-1 flex min-h-11 items-center rounded-md border-t border-border px-3 text-[15px] text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          href="/sign-in"
        >
          Sign in
        </a>
      </nav>
    </details>
  );
}
