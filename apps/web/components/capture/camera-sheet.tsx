"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Camera, Check, Flashlight, FlashlightOff, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { batchFullMessage } from "@/lib/capture/batch-limit";
import {
  cameraProblem,
  cameraProblemMessage,
  grabFrame,
  isStandalone,
  openCamera,
  setTorch,
  stopStream,
  torchSupported,
  type CameraProblem,
} from "@/lib/capture/camera";
import { detectQuad, DETECT_EDGE } from "@/lib/capture/detect-quad";
import type { Quad } from "@/lib/capture/geometry";
import { FullScreen } from "./full-screen";

type Shot = { id: string; blob: Blob; url: string };

/** How often the viewfinder looks for the receipt's outline. */
const OUTLINE_INTERVAL_MS = 250;

/**
 * Full-screen camera: tap the shutter for each receipt, then Done. The stream stops when the
 * sheet closes, when the page is hidden and when the panel unmounts (leaving the page).
 */
export default function CameraSheet({
  open,
  room,
  batchMax,
  onDone,
  onClose,
  onFallback,
}: {
  open: boolean;
  /** Shots still allowed in this batch. */
  room: number;
  batchMax: number;
  onDone: (shots: Blob[]) => void;
  onClose: () => void;
  /** Opens the phone's own camera app (file input with `capture`). */
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runRef = useRef(0);
  const [status, setStatus] = useState<"starting" | "live" | "problem">("starting");
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [torch, setTorchState] = useState({ supported: false, on: false });
  const [outline, setOutline] = useState<{ quad: Quad; w: number; h: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /** Stops the camera; touches no React state, so effects and handlers can both call it. */
  const stop = useCallback(() => {
    runRef.current++;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(() => {
    stop();
    const run = runRef.current;
    const stale = () => run !== runRef.current;
    return openCamera()
      .then(async (stream) => {
        // Closed or hidden while the permission prompt was up.
        if (stale()) return stopStream(stream);
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // iOS needs muted + playsInline to play inline; play() can reject if interrupted.
          await video.play().catch(() => {});
        }
        // Closed, hidden or restarted while play() was pending; `stop` has the stream.
        if (stale()) return;
        // The camera can end on its own: unplugged, taken by another app, or revoked.
        const track = stream.getVideoTracks()[0];
        track?.addEventListener("ended", () => {
          if (stale()) return;
          stop();
          setOutline(null);
          setProblem("ended");
          setStatus("problem");
        });
        setTorchState({ supported: torchSupported(track), on: false });
        setProblem(null);
        setStatus("live");
      })
      .catch((error: unknown) => {
        if (stale()) return;
        setProblem(cameraProblem(error));
        setStatus("problem");
      });
  }, [stop]);

  function restart() {
    setStatus("starting");
    setOutline(null);
    void start();
  }

  useEffect(() => {
    if (!open) return;
    void start();
    // iOS (standalone apps especially) leaves a black stream after a switch away: reopen it.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        stop();
        setStatus("starting");
        setOutline(null);
      } else void start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [open, start, stop]);

  // Object URLs for the tray live until the sheet unmounts.
  const shotsRef = useRef(shots);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  // Live outline on a ~256 px copy of the frame, a few times a second.
  useEffect(() => {
    if (status !== "live") return;
    const canvas = document.createElement("canvas");
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || !video.videoWidth || document.visibilityState !== "visible") return;
      const scale = DETECT_EDGE / Math.max(video.videoWidth, video.videoHeight);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { quad } = detectQuad(ctx.getImageData(0, 0, canvas.width, canvas.height));
      setOutline(quad ? { quad, w: video.videoWidth, h: video.videoHeight } : null);
    }, OUTLINE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status]);

  const full = shots.length >= room;

  async function capture() {
    const video = videoRef.current;
    if (!video || full || capturing || status !== "live") return;
    setCapturing(true);
    try {
      const blob = await grabFrame(video);
      setShots((current) => [
        ...current,
        { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) },
      ]);
      setFlash(true);
      window.setTimeout(() => setFlash(false), 120);
    } catch {
      // The frame wasn't ready; the next tap works.
    } finally {
      setCapturing(false);
    }
  }

  function removeShot(id: string) {
    setShots((current) => {
      const shot = current.find((s) => s.id === id);
      if (shot) URL.revokeObjectURL(shot.url);
      return current.filter((s) => s.id !== id);
    });
  }

  function finish() {
    stop();
    onDone(shots.map((s) => s.blob));
  }

  function requestClose() {
    if (shots.length > 0) setConfirmDiscard(true);
    else {
      stop();
      onClose();
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    if (await setTorch(track, next)) setTorchState({ supported: true, on: next });
  }

  const standalone = isStandalone();

  return (
    <FullScreen
      className="bg-background text-foreground"
      initialFocus={shutterRef}
      onClose={requestClose}
      open={open}
      title="Camera"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <Button
          aria-label="Close camera"
          className="text-foreground hover:bg-wash hover:text-foreground"
          onClick={requestClose}
          size="icon"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
        <p aria-live="polite" className="font-mono text-sm tabular-nums">
          {shots.length} {shots.length === 1 ? "photo" : "photos"}
        </p>
        {torch.supported ? (
          <Button
            aria-label="Torch"
            aria-pressed={torch.on}
            className="text-foreground hover:bg-wash hover:text-foreground"
            onClick={toggleTorch}
            size="icon"
            variant="ghost"
          >
            {torch.on ? <Flashlight aria-hidden="true" /> : <FlashlightOff aria-hidden="true" />}
          </Button>
        ) : (
          <span className="size-11" />
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          aria-label="Camera preview"
          autoPlay
          className="absolute inset-0 size-full object-contain"
          muted
          playsInline
          ref={videoRef}
        />
        {outline ? (
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full"
            preserveAspectRatio="xMidYMid meet"
            viewBox={`0 0 ${outline.w} ${outline.h}`}
          >
            <polygon
              className="fill-primary/15 stroke-primary"
              points={outline.quad.map((p) => `${p.x * outline.w},${p.y * outline.h}`).join(" ")}
              strokeLinejoin="round"
              strokeWidth={Math.max(outline.w, outline.h) / 200}
            />
          </svg>
        ) : null}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 bg-foreground opacity-0 transition-opacity duration-100 motion-reduce:transition-none",
            flash && "opacity-60",
          )}
        />
        {status === "starting" ? (
          <p className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-foreground/80">
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            Starting the camera…
          </p>
        ) : null}
        {status === "problem" && problem ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center"
            role="alert"
          >
            <p className="max-w-sm text-sm text-foreground/90">
              {cameraProblemMessage(problem, standalone)}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              {problem !== "missing" && problem !== "insecure" && problem !== "unsupported" ? (
                <Button onClick={restart} variant="outline">
                  <RotateCcw aria-hidden="true" />
                  Try again
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  stop();
                  onFallback();
                }}
              >
                <Camera aria-hidden="true" />
                Use the camera app
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {shots.length > 0 ? (
        <ul
          aria-label="Photos taken"
          className="flex gap-2 overflow-x-auto px-3 pt-3 [scrollbar-width:none]"
        >
          {shots.map((shot, i) => (
            <li className="relative shrink-0" key={shot.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={`Photo ${i + 1}`}
                className="h-16 w-12 rounded-md border border-foreground/30 object-cover"
                src={shot.url}
              />
              <button
                aria-label={`Remove photo ${i + 1}`}
                className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-background/80 text-foreground ring-1 ring-foreground/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => removeShot(shot.id)}
                type="button"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {full ? (
        <p className="px-4 pt-2 text-center text-xs text-foreground/80" role="status">
          {batchFullMessage(batchMax)}
        </p>
      ) : null}

      <div className="grid grid-cols-3 items-center px-4 pt-3 pb-4">
        <span />
        <button
          aria-label="Take photo"
          className="mx-auto flex size-18 items-center justify-center rounded-full border-4 border-foreground/90 outline-none focus-visible:ring-4 focus-visible:ring-ring disabled:opacity-40"
          disabled={full || status !== "live" || capturing}
          onClick={() => void capture()}
          ref={shutterRef}
          type="button"
        >
          <span className="size-14 rounded-full bg-foreground transition-transform active:scale-90 motion-reduce:transition-none" />
        </button>
        <div className="flex justify-end">
          <Button disabled={shots.length === 0} onClick={finish}>
            <Check aria-hidden="true" />
            Done
            {shots.length > 0 ? (
              <span className="font-mono tabular-nums">({shots.length})</span>
            ) : null}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        cancelLabel="Keep them"
        confirmLabel="Discard"
        description={`The ${shots.length === 1 ? "photo you took isn't" : `${shots.length} photos you took aren't`} saved anywhere else.`}
        destructive
        onConfirm={() => {
          setConfirmDiscard(false);
          stop();
          onClose();
        }}
        onOpenChange={setConfirmDiscard}
        open={confirmDiscard}
        title={`Discard ${shots.length === 1 ? "this photo" : `${shots.length} photos`}?`}
      />
    </FullScreen>
  );
}
