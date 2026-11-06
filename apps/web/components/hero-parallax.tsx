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
    // The layer is display:none below xl; skip the listener there.
    if (getComputedStyle(layer).display === "none") return;

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

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div aria-hidden className={className} ref={layerRef}>
      {children}
    </div>
  );
}
