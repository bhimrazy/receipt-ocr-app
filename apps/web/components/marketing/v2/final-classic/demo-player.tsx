"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { focusRing } from "./primitives";

export type DemoSample = {
  id: string;
  label: string;
  slug: string;
  /** Fields revealed one after another once the scan ends. */
  steps: number;
  announcement: string;
};

type State = "scanning" | "filling" | "done";

const SCAN_MS = 1200;
const STEP_MS = 240;
// classic.css reads the same timings, so the CSS stagger and these timers agree.
const timing = { "--scan": `${SCAN_MS}ms`, "--step": `${STEP_MS}ms` } as React.CSSProperties;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Plays the server-rendered sample panels. The first paint, no-JS and reduced motion all show the
 * finished read; a play restarts the panel's CSS animations by remounting it.
 */
export function DemoPlayer({
  samples,
  panels,
}: {
  samples: DemoSample[];
  panels: Record<string, React.ReactNode>;
}) {
  const [current, setCurrent] = useState(samples[0]);
  const [state, setState] = useState<State>("done");
  const [run, setRun] = useState(0);
  // Fade out values already on screen instead of blanking them.
  const [fade, setFade] = useState(false);
  const [announce, setAnnounce] = useState("");
  const timers = useRef<number[]>([]);
  const touched = useRef(false);
  const figure = useRef<HTMLElement>(null);

  const play = useCallback((next: DemoSample, by: "user" | "auto", fadeOut: boolean) => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current.length = 0;
    const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    // Only runs a person started are announced; the automatic first play stays silent.
    const finish = () => {
      setState("done");
      if (by === "user") setAnnounce(next.announcement);
    };
    setCurrent(next);
    setAnnounce("");
    setRun((r) => r + 1);
    if (reducedMotion()) {
      setFade(false);
      setState("done");
      later(50, finish);
      return;
    }
    setFade(fadeOut);
    setState("scanning");
    later(SCAN_MS, () => setState("filling"));
    later(SCAN_MS + (next.steps + 1) * STEP_MS, finish);
  }, []);

  // One automatic play, the first time at least 40% of the demo is on screen.
  useEffect(() => {
    const pending = timers.current;
    const el = figure.current;
    if (!el || reducedMotion()) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        if (!touched.current) play(samples[0], "auto", true);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      for (const t of pending) window.clearTimeout(t);
    };
  }, [play, samples]);

  const start = (next: DemoSample) => {
    touched.current = true;
    play(next, "user", next.id === current.id);
  };

  return (
    <>
      <figure
        aria-label="Sample: a receipt scanned by ReceiptOCR"
        className="card-sheen relative overflow-hidden rounded-2xl border border-white/10 bg-card/85 shadow-2xl shadow-black/60 backdrop-blur-xl"
        ref={figure}
      >
        {/* Window chrome */}
        <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-foreground/15" />
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-foreground/15" />
          <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-foreground/15" />
          <span className="ml-2 min-w-0 truncate font-mono text-xs text-muted-foreground">
            receipts.local/receipts/{current.slug}
          </span>
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">Sample</span>
        </div>

        {/* Sample picker */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5 sm:px-3">
          <div aria-label="Sample receipts" className="flex gap-1" role="group">
            {samples.map((s) => (
              <button
                aria-pressed={s.id === current.id}
                className={cn(
                  "h-11 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors",
                  s.id === current.id
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                  focusRing,
                )}
                key={s.id}
                onClick={() => start(s)}
                type="button"
              >
                {s.label}
              </button>
            ))}
          </div>
          <button
            className={cn(
              "inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground max-sm:px-0",
              focusRing,
            )}
            onClick={() => start(current)}
            type="button"
          >
            <RotateCcw aria-hidden className="size-4" />
            <span className="max-sm:sr-only">Replay</span>
          </button>
        </div>

        <div
          className="fc-demo"
          data-fade={fade ? "" : undefined}
          data-played={run > 0 ? "" : undefined}
          data-state={state}
          key={run}
          style={timing}
        >
          {panels[current.id]}
        </div>
      </figure>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </>
  );
}
