"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { useEffect, useId, useRef, useState } from "react";
import {
  arrowDelta,
  moveCorner,
  nudgeCorner,
  rotatedSize,
  type EditState,
} from "@/lib/capture/edit-state";
import { CORNER_NAMES } from "@/lib/capture/geometry";
import { clipLoupe } from "@/lib/capture/loupe";
import { releaseCanvas, rotatedCanvas } from "@/lib/capture/render";

/** Preview resolution: sharp enough on a phone, cheap to redraw on rotate. */
const PREVIEW_PIXELS = 2_000_000;
/** The loupe: diameter in CSS px, magnification, and the gap between the corner and its edge. */
const LOUPE = 104;
const LOUPE_ZOOM = 2.8;
const LOUPE_GAP = 40;

/**
 * The image as it will be turned, with four draggable corners. Pointer events cover touch,
 * pen and mouse; each corner is a button that arrow keys move (Shift for bigger steps).
 */
export function CropEditor({
  bitmap,
  edit,
  onChange,
}: {
  bitmap: ImageBitmap;
  edit: EditState;
  onChange: (edit: EditState) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const hintId = useId();
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  // The corner being dragged; the loupe shows while it is set.
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStage({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The turned copy is only a step to the visible canvas; it is released once drawn.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let preview: HTMLCanvasElement | null = null;
    try {
      preview = rotatedCanvas(bitmap, edit.rotation, PREVIEW_PIXELS);
      canvas.width = preview.width;
      canvas.height = preview.height;
      canvas.getContext("2d")?.drawImage(preview, 0, 0);
    } catch {
      // Out of canvas memory: the corners still work over an empty stage.
    } finally {
      if (preview) releaseCanvas(preview);
    }
  }, [bitmap, edit.rotation]);

  // Magnifies the area under the dragged corner from the canvas already on screen: no decode,
  // and at most one draw per frame however fast the pointer moves.
  const dragged = dragIndex === null ? null : edit.quad[dragIndex]!;
  const dragX = dragged?.x;
  const dragY = dragged?.y;
  useEffect(() => {
    if (dragX === undefined || dragY === undefined) return;
    const frame = requestAnimationFrame(() => {
      const source = canvasRef.current;
      const loupe = loupeRef.current;
      const ctx = loupe?.getContext("2d");
      if (!source || !loupe || !ctx || source.width === 0) return;
      const px = loupe.width;
      // Source pixels covered by the loupe: its CSS size over the zoom, in canvas pixels.
      const span = (LOUPE / LOUPE_ZOOM) * (source.width / source.clientWidth);
      const cx = dragX * source.width;
      const cy = dragY * source.height;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, px, px);
      const r = clipLoupe(cx, cy, span, source.width, source.height, px);
      if (r) ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = Math.max(1, px / LOUPE);
      ctx.beginPath();
      ctx.moveTo(px / 2, px / 2 - px * 0.16);
      ctx.lineTo(px / 2, px / 2 + px * 0.16);
      ctx.moveTo(px / 2 - px * 0.16, px / 2);
      ctx.lineTo(px / 2 + px * 0.16, px / 2);
      ctx.stroke();
    });
    return () => cancelAnimationFrame(frame);
  }, [dragX, dragY]);

  const shown = rotatedSize(bitmap.width, bitmap.height, edit.rotation);
  // Fit inside the stage, leaving room for the handles at the edges.
  const pad = 20;
  const scale = Math.min(
    (stage.width - pad * 2) / shown.width,
    (stage.height - pad * 2) / shown.height,
  );
  const box = {
    width: Math.max(0, Math.floor(shown.width * scale)),
    height: Math.max(0, Math.floor(shown.height * scale)),
  };

  function pointFrom(event: React.PointerEvent) {
    const rect = boxRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  // Above the finger; near the top edge it moves to the side, since below is where the hand is.
  let loupeStyle: React.CSSProperties | undefined;
  if (dragged) {
    const offset = { x: (stage.width - box.width) / 2, y: (stage.height - box.height) / 2 };
    const x = offset.x + dragged.x * box.width;
    const y = offset.y + dragged.y * box.height;
    let left = x - LOUPE / 2;
    let top = y - LOUPE_GAP - LOUPE;
    if (top < 4) {
      top = Math.max(4, y - LOUPE / 2);
      left = x < stage.width / 2 ? x + LOUPE_GAP : x - LOUPE_GAP - LOUPE;
    }
    loupeStyle = {
      left: Math.min(Math.max(4, left), Math.max(4, stage.width - LOUPE - 4)),
      top: Math.min(top, Math.max(4, stage.height - LOUPE - 4)),
    };
  }

  const polygon = edit.quad.map((p) => `${p.x * box.width},${p.y * box.height}`).join(" ");

  return (
    <div
      className="relative flex size-full items-center justify-center overflow-hidden"
      ref={stageRef}
    >
      <p className="sr-only" id={hintId}>
        Drag a corner to the edge of the receipt, or use the arrow keys. Hold Shift for bigger
        steps.
      </p>
      <div className="relative" ref={boxRef} style={{ width: box.width, height: box.height }}>
        <canvas
          aria-label="Receipt photo"
          className="block size-full select-none"
          ref={canvasRef}
          role="img"
        />
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
          viewBox={`0 0 ${box.width} ${box.height}`}
        >
          <path
            className="fill-background/65"
            d={`M0 0H${box.width}V${box.height}H0Z M${polygon.replaceAll(" ", " L")}Z`}
            fillRule="evenodd"
          />
          <polygon
            className="fill-none stroke-primary"
            points={polygon}
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
        {edit.quad.map((p, i) => (
          <button
            aria-describedby={hintId}
            aria-label={`${CORNER_NAMES[i]} corner, ${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down`}
            className={cn(
              "absolute flex size-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full outline-none",
              "cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring",
            )}
            key={CORNER_NAMES[i]}
            onKeyDown={(event) => {
              const delta = arrowDelta(event.key, event.shiftKey);
              if (!delta) return;
              event.preventDefault();
              onChange(nudgeCorner(edit, i, delta.dx, delta.dy));
            }}
            onLostPointerCapture={() => {
              dragging.current = null;
              setDragIndex(null);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.focus();
              dragging.current = i;
              setDragIndex(i);
            }}
            onPointerMove={(event) => {
              if (dragging.current !== i) return;
              onChange(moveCorner(edit, i, pointFrom(event)));
            }}
            onPointerCancel={() => {
              dragging.current = null;
              setDragIndex(null);
            }}
            onPointerUp={() => {
              dragging.current = null;
              setDragIndex(null);
            }}
            style={{ left: p.x * box.width, top: p.y * box.height }}
            type="button"
          >
            <span className="size-5 rounded-full border-2 border-primary bg-background/80 shadow" />
          </button>
        ))}
      </div>
      {loupeStyle ? (
        <canvas
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full border-2 border-primary bg-background shadow-lg"
          data-testid="loupe"
          height={LOUPE * 2}
          ref={loupeRef}
          style={{ ...loupeStyle, width: LOUPE, height: LOUPE }}
          width={LOUPE * 2}
        />
      ) : null}
    </div>
  );
}
