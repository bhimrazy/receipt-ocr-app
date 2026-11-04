"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { useEffect, useState } from "react";
import { focusRing } from "./primitives";

/** The id of the section crossing a thin band just above the middle of the viewport, if any. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join(" ");
  useEffect(() => {
    const order = key.split(" ");
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        setActive(order.find((id) => visible.has(id)) ?? null);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const id of order) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }
    return () => observer.disconnect();
  }, [key]);
  return active;
}

/** Desktop section links, marking the section in view. */
export function SectionNav({ links }: { links: Array<{ href: string; label: string }> }) {
  const active = useActiveSection(links.map((link) => link.href.slice(1)));
  return (
    <ul className="flex items-center gap-1">
      {links.map((link) => (
        <li key={link.href}>
          <a
            aria-current={active === link.href.slice(1) ? "location" : undefined}
            className={cn(
              "relative inline-flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=location]:text-foreground",
              "after:absolute after:inset-x-3 after:bottom-1.5 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity aria-[current=location]:after:opacity-100",
              focusRing,
            )}
            href={link.href}
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
}
