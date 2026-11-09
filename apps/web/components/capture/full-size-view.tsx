"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Loader2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { formatSize } from "./size-picker";

type Mode = "fitted" | "actual";

/** "JPEG" from "image/jpeg". */
const formatName = (type: string) => type.replace(/^image\//, "").toUpperCase() || "file";

/**
 * The file that will upload, as it is: fitted to show the whole receipt, or at actual pixels,
 * one image pixel per device pixel (CSS width = width / devicePixelRatio), so what is on screen
 * is exactly what the model receives. The caption is read from the file itself. At actual pixels
 * touch pans by native scrolling (and pinch zooms further), a mouse by dragging, the keyboard
 * with the arrow keys once the image has focus. It opens at the centre of the image.
 */
export function FullSizeView({
  file,
  url,
  failed,
  onDone,
}: {
  file: File | null;
  url: string | null;
  failed: boolean;
  onDone: () => void;
}) {
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [mode, setMode] = useState<Mode>("actual");
  const [natural, setNatural] = useState<{ url: string; width: number; height: number } | null>(
    null,
  );
  const size = natural && natural.url === url ? natural : null;
  const bytes = file ? formatSize(file.size) : null;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const actual = mode === "actual";
  const boxRef = useRef<HTMLDivElement>(null);

  // Opens actual pixels at the centre of the image, on load and on every switch to it.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !actual || !size) return;
    box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
    box.scrollTop = (box.scrollHeight - box.clientHeight) / 2;
  }, [actual, size]);

  return (
    <div className="absolute inset-0 flex flex-col bg-muted">
      {url && file ? (
        <div
          aria-label={
            size
              ? `The upload, ${actual ? "at actual pixels" : "fitted"}, ${size.width} × ${size.height} px`
              : "The upload"
          }
          className={cn(
            "min-h-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            actual
              ? "cursor-grab overflow-auto overscroll-contain active:cursor-grabbing"
              : "flex items-center justify-center overflow-hidden p-3",
          )}
          data-mode={mode}
          ref={boxRef}
          data-testid="full-size"
          onPointerDown={(event) => {
            if (!actual || event.pointerType !== "mouse") return;
            const el = event.currentTarget;
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              left: el.scrollLeft,
              top: el.scrollTop,
            };
            el.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start) return;
            event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
            event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          role="region"
          tabIndex={0}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className={cn(
              "select-none",
              actual ? "max-w-none" : "max-h-full max-w-full object-contain",
            )}
            draggable={false}
            onLoad={(event) => {
              const img = event.currentTarget;
              setNatural({ url: img.src, width: img.naturalWidth, height: img.naturalHeight });
            }}
            src={url}
            // Hidden until its pixel size is known, so it never shows a frame at the wrong scale.
            style={
              actual ? (size ? { width: size.width / dpr } : { visibility: "hidden" }) : undefined
            }
          />
        </div>
      ) : (
        <p className="flex min-h-0 flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          {failed ? (
            "This photo can't be shown at full size on this device. It still uploads."
          ) : (
            <>
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              Preparing the upload…
            </>
          )}
        </p>
      )}
      <div className="absolute top-2 right-2 left-2 flex items-start justify-between gap-2">
        <div
          aria-label="Zoom"
          className="flex rounded-lg border border-border bg-background/90 p-0.5 shadow-sm"
          role="group"
        >
          {(["fitted", "actual"] as const).map((m) => (
            <button
              aria-pressed={mode === m}
              className={cn(
                "min-h-9 rounded-md px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === m ? "bg-primary/15 text-foreground" : "text-muted-foreground",
              )}
              key={m}
              onClick={() => setMode(m)}
              type="button"
            >
              {m === "fitted" ? "Whole receipt" : "Actual pixels"}
            </button>
          ))}
        </div>
        <Button onClick={onDone} size="sm" variant="secondary">
          Done
        </Button>
      </div>
      <p
        className="h-8 shrink-0 border-t border-border bg-background/90 px-3 text-center text-xs leading-8 whitespace-nowrap text-muted-foreground"
        data-testid="upload-caption"
      >
        {size && bytes && file ? (
          <>
            Uploads exactly this: <span className="font-mono tabular-nums">{size.width}</span> ×{" "}
            <span className="font-mono tabular-nums">{size.height}</span> px ·{" "}
            <span className="font-mono tabular-nums">{bytes.value}</span> {bytes.unit}{" "}
            {formatName(file.type)}
          </>
        ) : null}
      </p>
    </div>
  );
}
