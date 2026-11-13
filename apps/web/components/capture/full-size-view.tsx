"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Loader2, Minus, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  canPan,
  clampView,
  defaultView,
  fitView,
  isFit,
  isLong,
  panBy,
  pinchView,
  rubberBand,
  scaleLimits,
  toggleScale,
  verticalPosition,
  wheelFactor,
  ZOOM_STEP,
  zoomAt,
  zoomPercent,
  type Point,
  type Size,
  type View,
} from "@/lib/capture/zoom";
import { formatSize } from "./size-picker";

/** "JPEG" from "image/jpeg". */
const formatName = (type: string) => type.replace(/^image\//, "").toUpperCase() || "file";

const HINT_KEY = "receipt-ocr.capture.zoom-hint";
/** A pointer that moves further than this is dragging, not clicking. */
const CLICK_SLOP = 4;
const TAP_SLOP = 10;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE = 30;

type Shown = Size & { url: string };
type Gesture =
  | { kind: "pan"; pointerType: string; origin: Point; start: View; moved: boolean }
  | { kind: "pinch"; start: View; mid: Point; distance: number };

const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function initialHint() {
  try {
    if (sessionStorage.getItem(HINT_KEY) === "1") return null;
  } catch {
    // Storage blocked: show the hint, it just can't be remembered.
  }
  return window.matchMedia("(pointer: coarse)").matches
    ? "Double-tap or pinch to zoom."
    : "Click to zoom. Drag to move.";
}

/**
 * The file that will upload, as it is, with free zoom from Fit to 400% (100% is one image pixel
 * per CSS pixel). It opens at Fit, or a long receipt at its width from the top. Pinch, Ctrl/Cmd +
 * wheel, click or double-tap, the pill and the keyboard zoom; drag, wheel and arrows pan. The
 * caption is read from the file itself.
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
  const areaRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [area, setArea] = useState<Size | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [animate, setAnimate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [moving, setMoving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [hint] = useState(initialHint);
  const [hintUsed, setHintUsed] = useState(false);

  const latest = useRef<{ image: Size | null; area: Size | null; view: View | null }>({
    image: null,
    area: null,
    view: null,
  });
  // Set by the user's first zoom or pan; until then a resize re-applies the opening view.
  const touched = useRef(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const lastPointer = useRef<{ type: string; moved: boolean }>({ type: "mouse", moved: false });
  const lastTap = useRef<{ time: number; at: Point } | null>(null);
  const movingTimer = useRef<number | undefined>(undefined);

  const apply = useCallback((next: View, animated = false) => {
    latest.current.view = next;
    setView(next);
    setAnimate(animated);
  }, []);

  const showPosition = useCallback(() => {
    setMoving(true);
    window.clearTimeout(movingTimer.current);
    movingTimer.current = window.setTimeout(() => setMoving(false), 800);
  }, []);

  const used = useCallback(() => {
    touched.current = true;
    setHintUsed(true);
    try {
      sessionStorage.setItem(HINT_KEY, "1");
    } catch {
      // Storage blocked: the hint shows again next time.
    }
  }, []);

  useEffect(() => () => window.clearTimeout(movingTimer.current), []);

  // Each new file is decoded off screen and swapped in with its opening view, so the frame never
  // blanks or shows the new image at the old scale.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.src = url;
    img
      .decode()
      .catch(() => {})
      .then(() => {
        if (cancelled || !img.naturalWidth) return;
        const image = { width: img.naturalWidth, height: img.naturalHeight };
        latest.current.image = image;
        touched.current = false;
        setShown({ url, ...image });
        const size = latest.current.area;
        if (size) apply(defaultView(image, size));
      });
    return () => {
      cancelled = true;
    };
  }, [url, apply]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const size = { width: el.clientWidth, height: el.clientHeight };
      if (size.width === 0 || size.height === 0) return;
      latest.current.area = size;
      setArea(size);
      const { image, view: current } = latest.current;
      if (!image) return;
      apply(
        touched.current && current ? clampView(current, image, size) : defaultView(image, size),
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [apply]);

  const local = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const ready = Boolean(shown && view && area);
  // A new size is still encoding or decoding: the last image stays, dimmed, rather than a blank frame.
  const pending = !url || shown?.url !== url;

  // Wheel and Safari's trackpad gesture events need non-passive listeners to stop page zoom.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !ready) return;
    const onWheel = (event: WheelEvent) => {
      const { image, area: size, view: current } = latest.current;
      if (!image || !size || !current) return;
      event.preventDefault();
      used();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      if (event.ctrlKey || event.metaKey) {
        const factor = wheelFactor(event.deltaY * unit);
        apply(zoomAt(current, current.scale * factor, local(event), image, size));
      } else {
        apply(panBy(current, -event.deltaX * unit, -event.deltaY * unit, image, size));
      }
      showPosition();
    };
    let gestureStart: View | null = null;
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (event: Event) => {
      event.preventDefault();
      gestureStart = latest.current.view;
    };
    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const { image, area: size } = latest.current;
      // On touch screens the pointer handlers already pinch; this is for trackpads.
      if (!gestureStart || !image || !size || pointers.current.size > 0) return;
      const e = event as GestureEvent;
      used();
      apply(zoomAt(gestureStart, gestureStart.scale * e.scale, local(e), image, size));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [ready, apply, local, used, showPosition]);

  useEffect(() => {
    viewportRef.current?.focus({ preventScroll: true });
  }, [ready]);

  const image = shown;
  const bytes = file ? formatSize(file.size) : null;
  const limits = image && area ? scaleLimits(image, area) : null;
  const atMin = Boolean(view && limits && view.scale <= limits.min + 1e-6);
  const atMax = Boolean(view && limits && view.scale >= limits.max - 1e-6);
  const fit = Boolean(view && image && area && isFit(view.scale, image, area));
  const pannable = Boolean(view && image && area && canPan(view, image, area));
  const position = view && image && area ? verticalPosition(view, image, area) : null;
  const toggleTarget = view && image && area ? toggleScale(view.scale, image, area) : 1;

  function say(next: View) {
    if (!image || !area) return;
    setAnnouncement(isFit(next.scale, image, area) ? "Fit" : `Zoom ${zoomPercent(next.scale)}%`);
  }

  /** Zoom from a button or key: animated and announced. */
  function zoomTo(scale: number, at?: Point) {
    if (!view || !image || !area) return;
    used();
    const centre = at ?? { x: area.width / 2, y: area.height / 2 };
    const next = zoomAt(view, scale, centre, image, area);
    apply(next, true);
    say(next);
  }

  function settle() {
    const { image: img, area: size, view: current } = latest.current;
    if (!img || !size || !current) return;
    const clamped = clampView(current, img, size);
    if (clamped.x !== current.x || clamped.y !== current.y || clamped.scale !== current.scale) {
      apply(clamped, true);
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const current = latest.current.view;
    if (!current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    lastPointer.current = { type: event.pointerType, moved: false };
    used();
    if (pointers.current.size === 1) {
      gesture.current = {
        kind: "pan",
        pointerType: event.pointerType,
        origin: at,
        start: current,
        moved: false,
      };
      setDragging(true);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      gesture.current = {
        kind: "pinch",
        start: current,
        mid: midpoint(a, b),
        distance: distance(a, b),
      };
      lastTap.current = null;
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const { image: img, area: size } = latest.current;
    const g = gesture.current;
    if (!img || !size || !g) return;
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [Point, Point];
      const next = pinchView(g.start, g.mid, g.distance, midpoint(a, b), distance(a, b), img, size);
      apply(rubberBand(next, img, size));
      showPosition();
      return;
    }
    if (g.kind !== "pan") return;
    const dx = at.x - g.origin.x;
    const dy = at.y - g.origin.y;
    const slop = g.pointerType === "touch" ? TAP_SLOP : CLICK_SLOP;
    if (!g.moved && Math.hypot(dx, dy) > slop) {
      g.moved = true;
      lastPointer.current.moved = true;
    }
    if (!g.moved || !canPan(g.start, img, size)) return;
    const next = { ...g.start, x: g.start.x + dx, y: g.start.y + dy };
    apply(g.pointerType === "touch" ? rubberBand(next, img, size) : clampView(next, img, size));
    showPosition();
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    const g = gesture.current;
    if (g?.kind === "pinch") {
      lastPointer.current.moved = true;
      const rest = [...pointers.current.values()];
      if (rest.length === 1) {
        gesture.current = {
          kind: "pan",
          pointerType: "touch",
          origin: rest[0]!,
          start: latest.current.view!,
          moved: true,
        };
      } else if (rest.length === 0) {
        gesture.current = null;
        setDragging(false);
        settle();
      }
      return;
    }
    if (pointers.current.size > 0) return;
    gesture.current = null;
    setDragging(false);
    if (g?.kind !== "pan" || g.pointerType !== "touch") return;
    if (g.moved || event.type !== "pointerup") {
      settle();
      return;
    }
    const at = local(event);
    const now = event.timeStamp;
    const tap = lastTap.current;
    if (tap && now - tap.time < DOUBLE_TAP_MS && distance(tap.at, at) < DOUBLE_TAP_DISTANCE) {
      lastTap.current = null;
      zoomTo(toggleTarget, at);
    } else {
      lastTap.current = { time: now, at };
    }
  }

  function onClick(event: MouseEvent<HTMLDivElement>) {
    // Touch toggles on double-tap; the second click of a double-click is the same intent.
    if (lastPointer.current.type === "touch" || lastPointer.current.moved || event.detail > 1) {
      return;
    }
    zoomTo(toggleTarget, local(event));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!view || !image || !area || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = (event.shiftKey ? 0.5 : 0.1) * Math.min(area.width, area.height);
    const pan = (dx: number, dy: number) => {
      used();
      apply(panBy(view, dx, dy, image, area), true);
      showPosition();
    };
    switch (event.key) {
      case "+":
      case "=":
        zoomTo(view.scale * ZOOM_STEP);
        break;
      case "-":
      case "_":
        zoomTo(view.scale / ZOOM_STEP);
        break;
      case "0": {
        used();
        const next = fitView(image, area);
        apply(next, true);
        say(next);
        break;
      }
      case "1":
        zoomTo(1);
        break;
      case "ArrowLeft":
        pan(step, 0);
        break;
      case "ArrowRight":
        pan(-step, 0);
        break;
      case "ArrowUp":
        pan(0, step);
        break;
      case "ArrowDown":
        pan(0, -step);
        break;
      case "Home":
        pan(0, Infinity);
        break;
      case "End":
        pan(0, -Infinity);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const label = image
    ? `Upload preview, ${image.width} × ${image.height} px${isLong(image) ? ", long receipt" : ""}`
    : "Upload preview";

  return (
    <div className="absolute inset-0 flex touch-none flex-col bg-background">
      <div
        className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-3"
        data-testid="full-size-bar"
      >
        <p className="text-sm font-medium">Full size</p>
        <Button className="h-11 min-w-11" onClick={onDone} variant="secondary">
          Done
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/40" ref={areaRef}>
        {(url && file) || shown ? (
          <>
            <div
              aria-label={label}
              className={cn(
                "absolute inset-0 overflow-hidden outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                pannable ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
              )}
              data-scale={view ? view.scale.toFixed(4) : undefined}
              data-testid="full-size"
              onClick={onClick}
              onKeyDown={onKeyDown}
              onLostPointerCapture={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              ref={viewportRef}
              role="region"
              tabIndex={0}
            >
              {image && view ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className={cn(
                    "pointer-events-none absolute top-0 left-0 max-w-none origin-top-left",
                    pending && "opacity-50",
                    animate &&
                      "transition-transform duration-200 ease-out motion-reduce:transition-none",
                  )}
                  draggable={false}
                  src={image.url}
                  style={{
                    width: image.width,
                    height: image.height,
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
                  }}
                />
              ) : (
                <Loader2
                  aria-hidden="true"
                  className="absolute inset-0 m-auto size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
                />
              )}
            </div>
            {position ? (
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-2 right-1 w-1 transition-opacity duration-300 motion-reduce:transition-none",
                  moving ? "opacity-100" : "opacity-0",
                )}
                data-testid="position"
              >
                <div
                  className="absolute w-full rounded-full bg-foreground/40"
                  style={{
                    top: `${position.start * 100}%`,
                    height: `${Math.max(position.size * 100, 4)}%`,
                  }}
                />
              </div>
            ) : null}
            {hint ? (
              <p
                aria-hidden={hintUsed}
                className={cn(
                  "pointer-events-none absolute bottom-17 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs whitespace-nowrap text-foreground shadow-sm transition-opacity duration-500 motion-reduce:transition-none",
                  hintUsed && "opacity-0",
                )}
              >
                {hint}
              </p>
            ) : null}
            <div
              aria-label="Zoom"
              className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center rounded-full border border-border bg-background/95 shadow-md"
              role="group"
            >
              <PillButton
                disabled={!ready || atMin}
                label="Zoom out"
                onPress={() => view && zoomTo(view.scale / ZOOM_STEP)}
              >
                <Minus aria-hidden="true" className="size-4" />
              </PillButton>
              <PillButton
                className="min-w-16 px-2 font-mono text-sm tabular-nums"
                disabled={!ready}
                label={
                  fit
                    ? `Fit. Zoom to ${zoomPercent(toggleTarget)}%`
                    : `Zoom ${view ? zoomPercent(view.scale) : 100}%. Fit to screen`
                }
                onPress={() => zoomTo(toggleTarget)}
                testId="zoom-readout"
              >
                {fit ? "Fit" : `${view ? zoomPercent(view.scale) : 100}%`}
              </PillButton>
              <PillButton
                disabled={!ready || atMax}
                label="Zoom in"
                onPress={() => view && zoomTo(view.scale * ZOOM_STEP)}
              >
                <Plus aria-hidden="true" className="size-4" />
              </PillButton>
            </div>
            {pending && shown ? (
              <p className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/95 w-max max-w-[calc(100%-2rem)] px-3 py-1.5 text-center text-xs text-foreground shadow-sm">
                {failed ? null : (
                  <Loader2
                    aria-hidden="true"
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                )}
                {failed
                  ? "This size can't be shown on this device. It still uploads."
                  : "Preparing the upload…"}
              </p>
            ) : null}
            <p aria-live="polite" className="sr-only">
              {announcement}
            </p>
          </>
        ) : (
          <p className="flex h-full items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
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
      </div>
      <p
        className="h-8 shrink-0 border-t border-border px-3 text-center text-xs leading-8 whitespace-nowrap text-muted-foreground"
        data-testid="upload-caption"
      >
        {shown && shown.url === url && bytes && file ? (
          <>
            Uploads as <span className="font-mono tabular-nums">{shown.width}</span> ×{" "}
            <span className="font-mono tabular-nums">{shown.height}</span> px ·{" "}
            <span className="font-mono tabular-nums">{bytes.value}</span> {bytes.unit}{" "}
            {formatName(file.type)}
          </>
        ) : null}
      </p>
    </div>
  );
}

/** A pill segment: 44 px, and still focusable and announced when it can't act. */
function PillButton({
  label,
  disabled,
  onPress,
  className,
  testId,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <button
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-foreground outline-none hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-disabled:cursor-default aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent",
        className,
      )}
      data-testid={testId}
      onClick={() => !disabled && onPress()}
      type="button"
    >
      {children}
    </button>
  );
}
