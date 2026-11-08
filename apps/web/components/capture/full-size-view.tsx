"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Loader2 } from "lucide-react";
import { useRef } from "react";

/**
 * The upload at one image pixel per CSS pixel, to judge blur that the fitted preview hides.
 * Touch pans by native scrolling, a mouse by dragging, the keyboard with the arrow keys once
 * the image has focus. It opens at the centre of the image.
 */
export function FullSizeView({
  url,
  label,
  failed,
  onDone,
}: {
  url: string | null;
  label: string;
  failed: boolean;
  onDone: () => void;
}) {
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  return (
    <div className="absolute inset-0 bg-muted">
      {url ? (
        <div
          aria-label={label}
          className="size-full cursor-grab overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing"
          data-testid="full-size"
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse") return;
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
            className="max-w-none select-none"
            draggable={false}
            onLoad={(event) => {
              const box = event.currentTarget.parentElement;
              if (!box) return;
              box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
              box.scrollTop = (box.scrollHeight - box.clientHeight) / 2;
            }}
            src={url}
          />
        </div>
      ) : (
        <p className="flex size-full items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          {failed ? (
            "This photo can't be shown at full size on this device. It still uploads."
          ) : (
            <>
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              Preparing full size…
            </>
          )}
        </p>
      )}
      <Button className="absolute top-2 right-2" onClick={onDone} size="sm" variant="secondary">
        Done
      </Button>
    </div>
  );
}
