"use client";

import { useEffect, useRef } from "react";

/** Sets --mx/--my (-1..1) on its element from the pointer position, for CSS parallax. */
export function HeroParallax({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nx = (event.clientX / window.innerWidth - 0.5) * 2;
        const ny = (event.clientY / window.innerHeight - 0.5) * 2;
        layer.style.setProperty("--mx", nx.toFixed(3));
        layer.style.setProperty("--my", ny.toFixed(3));
      });
    };

    // The layer is display:none below xl; listen only while it shows, and follow resizes.
    const xl = window.matchMedia("(min-width: 80rem)");
    const sync = () => {
      window.removeEventListener("mousemove", onMove);
      if (xl.matches) window.addEventListener("mousemove", onMove, { passive: true });
    };
    sync();
    xl.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(frame);
      xl.removeEventListener("change", sync);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div aria-hidden className={className} ref={layerRef}>
      {children}
    </div>
  );
}
