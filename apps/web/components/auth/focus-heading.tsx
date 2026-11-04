"use client";

import { useEffect, useRef } from "react";

/**
 * Moves focus to the card's heading when a form is replaced by a message (check your email,
 * link expired). Otherwise focus falls back to <body> and screen readers announce nothing.
 */
export function FocusHeading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("h1")?.focus();
  }, []);
  return (
    <div className="w-full" ref={ref}>
      {children}
    </div>
  );
}
