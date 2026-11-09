"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";
import {
  arrowDelta,
  dragCorner,
  moveEdge,
  nudgeCorner,
  nudgeEdge,
  rotatedSize,
  type EditState,
} from "@/lib/capture/edit-state";
import {
  CORNER_NAMES,
  EDGE_NAMES,
  edgeAngle,
  edgeLength,
  edgeMidpoint,
  nearestOnEdge,
  type Point,
  type Quad,
} from "@/lib/capture/geometry";
import {
  clipLoupe,
  LOUPE,
  loupePlacement,
  loupePosition,
  type LoupePlacement,
} from "@/lib/capture/loupe";
import { releaseCanvas, rotatedCanvas } from "@/lib/capture/render";

/** Preview resolution: sharp enough on a phone, cheap to redraw on rotate. */
const PREVIEW_PIXELS = 2_000_000;
const LOUPE_ZOOM = 2.8;
/** Half a handle target, so a handle on the photo's border is not clipped by the stage. */
const PAD = 22;
/** Two 22 px corner targets plus a margin: shorter edges hide their pill and pointer target. */
const MIN_EDGE_HANDLE = 96;

type Handle = { kind: "corner" | "edge"; index: number };
type Drag = Handle & { pointerId: number; start: Point; quad: Quad; target: HTMLElement };
type Active = Handle & { finger: Point; placement: LoupePlacement };

/** A resize cursor for an edge at `angle` degrees: its normal, to the nearest 45 degrees. */
function resizeCursor(angle: number) {
  const sector = Math.round((((angle + 90) % 180) + 180) / 45) % 4;
  return (["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const)[sector];
}

/**
 * The image as it will be turned, with four draggable corners and four draggable sides. Pointer
 * events cover touch, pen and mouse; each handle is a button that arrow keys move (Shift for
 * bigger steps), and Escape cancels a drag.
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
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const loupeDrawn = useRef(false);
  const drag = useRef<Drag | null>(null);
  const cornerHint = useId();
  const rowHint = useId();
  const columnHint = useId();
  const [stage, setStage] = useState({ width: 0, height: 0 });
  // The handle being dragged; drives the loupe and the lit edge.
  const [active, setActive] = useState<Active | null>(null);
  // The edge selected from the keyboard, lit like a dragged one.
  const [keyEdge, setKeyEdge] = useState<number | null>(null);

  // Measured before the first paint, so the handles never show at the stage's centre first.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = (width: number, height: number) =>
      setStage((s) => (s.width === width && s.height === height ? s : { width, height }));
    const rect = el.getBoundingClientRect();
    measure(rect.width, rect.height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Drawn before paint, so a turn never shows the old picture stretched into the new box. The
  // turned copy is only a step to the visible canvas; it is released once drawn.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let preview: HTMLCanvasElement | null = null;
    try {
      preview = rotatedCanvas(bitmap, edit.rotation, PREVIEW_PIXELS);
      canvas.width = preview.width;
      canvas.height = preview.height;
      canvas.getContext("2d")?.drawImage(preview, 0, 0);
    } catch {
      // Out of canvas memory: the handles still work over an empty stage.
    } finally {
      if (preview) releaseCanvas(preview);
    }
  }, [bitmap, edit.rotation]);

  const shown = rotatedSize(bitmap.width, bitmap.height, edit.rotation);
  const aspect = shown.width / shown.height;
  // Fit inside the stage, leaving room for the handles at the edges.
  const scale = Math.min(
    (stage.width - PAD * 2) / shown.width,
    (stage.height - PAD * 2) / shown.height,
  );
  const box = {
    width: Math.max(0, Math.floor(shown.width * scale)),
    height: Math.max(0, Math.floor(shown.height * scale)),
  };
  const measured = box.width > 0 && box.height > 0;
  const offset = { x: (stage.width - box.width) / 2, y: (stage.height - box.height) / 2 };

  /** The point the loupe magnifies: the corner, or the dragged edge's point nearest the finger. */
  const focusOf = (handle: Handle, quad: Quad, finger: Point) =>
    handle.kind === "corner"
      ? quad[handle.index]!
      : nearestOnEdge(quad, handle.index, finger, aspect);

  const placeLoupe = (focus: Point, previous: LoupePlacement | null) =>
    loupePlacement(
      offset.x + focus.x * box.width,
      offset.y + focus.y * box.height,
      stage.width,
      previous,
    );

  const focus = active ? focusOf(active, edit.quad, active.finger) : null;
  const focusX = focus?.x;
  const focusY = focus?.y;
  // An edge drag shows a line along the edge instead of the crosshair.
  const reticle =
    active?.kind === "edge" ? edgeAngle(edit.quad, active.index, box.width, box.height) : null;

  // Magnifies the area under the focus from the canvas already on screen: no decode. The first
  // frame is drawn before paint, so the loupe never shows empty; later ones at most once a frame.
  useLayoutEffect(() => {
    if (focusX === undefined || focusY === undefined) {
      loupeDrawn.current = false;
      return;
    }
    const draw = () => {
      const source = canvasRef.current;
      const loupe = loupeRef.current;
      const ctx = loupe?.getContext("2d");
      if (!source || !loupe || !ctx || source.width === 0) return;
      const px = loupe.width;
      // Source pixels covered by the loupe: its CSS size over the zoom, in canvas pixels.
      const span = (LOUPE / LOUPE_ZOOM) * (source.width / source.clientWidth);
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, px, px);
      const r = clipLoupe(
        focusX * source.width,
        focusY * source.height,
        span,
        source.width,
        source.height,
        px,
      );
      if (r) ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
      ctx.strokeStyle = "#34d399";
      ctx.lineWidth = Math.max(1, px / LOUPE);
      ctx.beginPath();
      if (reticle === null) {
        ctx.moveTo(px / 2, px / 2 - px * 0.16);
        ctx.lineTo(px / 2, px / 2 + px * 0.16);
        ctx.moveTo(px / 2 - px * 0.16, px / 2);
        ctx.lineTo(px / 2 + px * 0.16, px / 2);
      } else {
        const a = (reticle * Math.PI) / 180;
        const reach = px * 0.4;
        ctx.moveTo(px / 2 - Math.cos(a) * reach, px / 2 - Math.sin(a) * reach);
        ctx.lineTo(px / 2 + Math.cos(a) * reach, px / 2 + Math.sin(a) * reach);
      }
      ctx.stroke();
    };
    if (!loupeDrawn.current) {
      loupeDrawn.current = true;
      draw();
      return;
    }
    const frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [focusX, focusY, reticle]);

  function pointFrom(event: React.PointerEvent) {
    const rect = boxRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  function startDrag(event: React.PointerEvent<HTMLButtonElement>, handle: Handle) {
    event.preventDefault();
    // One drag at a time: a second finger does not take over.
    if (drag.current) return;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    target.focus();
    const start = pointFrom(event);
    drag.current = { ...handle, pointerId: event.pointerId, start, quad: edit.quad, target };
    setActive({
      ...handle,
      finger: start,
      placement: placeLoupe(focusOf(handle, edit.quad, start), null),
    });
  }

  function moveDrag(event: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const finger = pointFrom(event);
    // The drag-start quad plus the whole delta: a grab off-centre never jumps, and nothing drifts.
    const delta = { x: finger.x - d.start.x, y: finger.y - d.start.y };
    const next =
      d.kind === "corner"
        ? dragCorner(edit, d.index, d.quad, delta)
        : moveEdge(edit, d.index, d.quad, delta, aspect);
    const placement = placeLoupe(focusOf(d, next.quad, finger), active?.placement ?? null);
    setActive({ kind: d.kind, index: d.index, finger, placement });
    if (next !== edit) onChange(next);
  }

  function endDrag(event: React.PointerEvent) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setActive(null);
  }

  function onKey(event: React.KeyboardEvent, handle: Handle) {
    const d = drag.current;
    if (event.key === "Escape" && d) {
      // Cancels the drag only; the sheet's Escape (back) must not fire too.
      event.preventDefault();
      event.stopPropagation();
      drag.current = null;
      if (d.target.hasPointerCapture(d.pointerId)) d.target.releasePointerCapture(d.pointerId);
      setActive(null);
      onChange({ ...edit, quad: d.quad });
      return;
    }
    const step = arrowDelta(event.key, event.shiftKey);
    if (!step) return;
    event.preventDefault();
    onChange(
      handle.kind === "corner"
        ? nudgeCorner(edit, handle.index, step.dx, step.dy)
        : nudgeEdge(edit, handle.index, step.dx, step.dy, aspect),
    );
  }

  const pointerHandlers = {
    onLostPointerCapture: endDrag,
    onPointerCancel: endDrag,
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
  };

  let loupeStyle: React.CSSProperties | undefined;
  if (active && focus) {
    loupeStyle = loupePosition(
      offset.x + focus.x * box.width,
      offset.y + focus.y * box.height,
      active.placement,
      stage,
    );
  }

  const px = (p: Point) => ({ x: p.x * box.width, y: p.y * box.height });
  const polygon = edit.quad.map((p) => `${p.x * box.width},${p.y * box.height}`).join(" ");
  const litEdge = active?.kind === "edge" ? active.index : keyEdge;
  const lit =
    litEdge === null ? null : [px(edit.quad[litEdge]!), px(edit.quad[(litEdge + 1) % 4]!)];

  // Pinned dark in either theme, so the handles and dimming match the canvas loupe literals.
  return (
    <div
      className="dark relative flex size-full items-center justify-center overflow-hidden"
      ref={stageRef}
    >
      <p className="sr-only" id={cornerHint}>
        Drag a corner to the edge of the receipt, or use the arrow keys. Hold Shift for bigger
        steps.
      </p>
      <p className="sr-only" id={rowHint}>
        Drag to move this whole side, or use the Up and Down arrow keys. Hold Shift for bigger
        steps.
      </p>
      <p className="sr-only" id={columnHint}>
        Drag to move this whole side, or use the Left and Right arrow keys. Hold Shift for bigger
        steps.
      </p>
      <div className="relative" ref={boxRef} style={{ width: box.width, height: box.height }}>
        <canvas
          aria-label="Receipt photo"
          className="block size-full select-none"
          ref={canvasRef}
          role="img"
        />
        {measured ? (
          <>
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
              {/* A dark band under the emerald line keeps it visible on white paper. */}
              <polygon
                className="fill-none stroke-background/80"
                points={polygon}
                strokeLinejoin="round"
                strokeWidth={4}
              />
              <polygon
                className="fill-none stroke-primary"
                points={polygon}
                strokeLinejoin="round"
                strokeWidth={2}
              />
              {lit ? (
                <>
                  <line
                    className="stroke-background/80"
                    strokeLinecap="round"
                    strokeWidth={5}
                    x1={lit[0]!.x}
                    x2={lit[1]!.x}
                    y1={lit[0]!.y}
                    y2={lit[1]!.y}
                  />
                  <line
                    className="stroke-primary"
                    strokeLinecap="round"
                    strokeWidth={3}
                    x1={lit[0]!.x}
                    x2={lit[1]!.x}
                    y1={lit[0]!.y}
                    y2={lit[1]!.y}
                  />
                </>
              ) : null}
            </svg>
            {/* Perimeter order for Tab: each corner, then the side that follows it. Corners
                stack above sides, so a corner always wins where their targets overlap. */}
            {edit.quad.map((p, i) => {
              const mid = edgeMidpoint(edit.quad, i);
              const angle = edgeAngle(edit.quad, i, box.width, box.height);
              const dragged = active?.kind === "edge" && active.index === i;
              const reachable =
                dragged || edgeLength(edit.quad, i, box.width, box.height) >= MIN_EDGE_HANDLE;
              const selected = dragged || keyEdge === i;
              const row = i % 2 === 0;
              return (
                <Fragment key={CORNER_NAMES[i]}>
                  <button
                    aria-describedby={cornerHint}
                    aria-label={`${CORNER_NAMES[i]} corner, ${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down`}
                    className={cn(
                      "absolute z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full outline-none",
                      "cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    )}
                    onKeyDown={(event) => onKey(event, { kind: "corner", index: i })}
                    onPointerDown={(event) => startDrag(event, { kind: "corner", index: i })}
                    style={{ left: p.x * box.width, top: p.y * box.height }}
                    type="button"
                    {...pointerHandlers}
                  >
                    <span className="size-5 rounded-full border-2 border-primary bg-background/80 shadow" />
                  </button>
                  <button
                    aria-describedby={row ? rowHint : columnHint}
                    aria-label={
                      row
                        ? `${EDGE_NAMES[i]} edge, ${Math.round(mid.y * 100)}% down`
                        : `${EDGE_NAMES[i]} edge, ${Math.round(mid.x * 100)}% across`
                    }
                    className={cn(
                      "group absolute flex size-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full outline-none",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      !reachable && "pointer-events-none",
                    )}
                    onBlur={() => setKeyEdge((k) => (k === i ? null : k))}
                    onFocus={(event) => {
                      if (event.currentTarget.matches(":focus-visible")) setKeyEdge(i);
                    }}
                    onKeyDown={(event) => onKey(event, { kind: "edge", index: i })}
                    onPointerDown={(event) => startDrag(event, { kind: "edge", index: i })}
                    style={{
                      left: mid.x * box.width,
                      top: mid.y * box.height,
                      cursor: resizeCursor(angle),
                    }}
                    type="button"
                    {...pointerHandlers}
                  >
                    {/* Only the pill turns with the edge, so the focus ring stays round. */}
                    <span
                      className={cn(
                        "h-2 rounded-full border-2 shadow",
                        selected
                          ? "w-9 border-background/80 bg-primary"
                          : "w-7 border-primary bg-background/80 group-hover:bg-primary/30",
                        !reachable && "opacity-0 group-focus-visible:opacity-100",
                      )}
                      style={{ rotate: `${angle}deg` }}
                    />
                  </button>
                </Fragment>
              );
            })}
          </>
        ) : null}
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
