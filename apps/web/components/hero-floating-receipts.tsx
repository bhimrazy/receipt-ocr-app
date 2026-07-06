"use client";

import { Check } from "lucide-react";
import { useEffect, useRef } from "react";

const receiptCards = [
  {
    merchant: "Whole Foods",
    total: "$67.43",
    lines: [
      ["Bananas", "$2.49"],
      ["Almond Milk", "$4.99"],
      ["Bread", "$5.49"],
    ],
    // position + per-card parallax travel (depth baked into the calc)
    wrapperClass:
      "left-[4%] top-[30%] translate-x-[calc(var(--mx)*26px)] translate-y-[calc(var(--my)*26px)]",
    cardClass: "[--r:-6deg]",
  },
  {
    merchant: "Starbucks",
    total: "$12.75",
    lines: [
      ["Oat Latte", "$6.25"],
      ["Muffin", "$3.95"],
      ["Water", "$2.55"],
    ],
    wrapperClass:
      "right-[5%] top-[24%] translate-x-[calc(var(--mx)*18px)] translate-y-[calc(var(--my)*18px)]",
    cardClass: "[--r:5deg] [animation-delay:1s]",
  },
  {
    merchant: "Shell Gas",
    total: "$52.18",
    lines: [
      ["Unleaded", "$48.36"],
      ["Car Wash", "$3.82"],
      ["Snack", "$1.00"],
    ],
    wrapperClass:
      "right-[9%] top-[66%] translate-x-[calc(var(--mx)*34px)] translate-y-[calc(var(--my)*34px)]",
    cardClass: "[--r:-3deg] [animation-delay:2s]",
  },
] as const;

export function HeroFloatingReceipts() {
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

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 hidden [--mx:0] [--my:0] xl:block"
      aria-hidden
    >
      {receiptCards.map((card) => (
        <div
          key={card.merchant}
          className={`absolute transition-transform duration-300 ease-out will-change-transform ${card.wrapperClass}`}
        >
          <div
            className={`floating-receipt flex h-[182px] w-[212px] flex-col rounded-xl border border-white/10 bg-card/80 p-4 font-mono text-[11px] opacity-90 shadow-2xl shadow-black/40 backdrop-blur-xl ${card.cardClass}`}
          >
            <div className="mb-3 flex items-center justify-between text-xs font-semibold text-foreground">
              <span>{card.merchant}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                <Check className="size-2.5" /> parsed
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1 text-muted-foreground">
              {card.lines.map(([name, price]) => (
                <div className="flex justify-between" key={name}>
                  <span>{name}</span>
                  <span>{price}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between border-t border-dashed border-white/10 pt-2 font-semibold text-primary">
              <span>Total</span>
              <span>{card.total}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
