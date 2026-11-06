"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

export type OutputTab = { id: string; label: string; panel: ReactNode };

/** WAI-ARIA tabs with automatic activation and arrow/Home/End keys. */
export function OutputTabs({ tabs, className }: { tabs: OutputTab[]; className?: string }) {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const base = useId();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = tabs.length - 1;
    const next =
      event.key === "ArrowRight"
        ? active === last
          ? 0
          : active + 1
        : event.key === "ArrowLeft"
          ? active === 0
            ? last
            : active - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  };

  return (
    <div className={className}>
      <div
        aria-label="Receipt output"
        className="flex gap-1 rounded-full bg-secondary/70 p-1 ring-1 ring-border"
        onKeyDown={onKeyDown}
        role="tablist"
      >
        {tabs.map((tab, i) => (
          <button
            aria-controls={`${base}-panel-${tab.id}`}
            aria-selected={i === active}
            className={cn(
              "min-h-11 flex-1 rounded-full px-3 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              i === active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            id={`${base}-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActive(i)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            tabIndex={i === active ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          aria-labelledby={`${base}-tab-${tab.id}`}
          className="mt-4 min-h-[27rem]"
          hidden={i !== active}
          id={`${base}-panel-${tab.id}`}
          key={tab.id}
          role="tabpanel"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
