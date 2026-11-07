"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  Camera,
  Check,
  CircleAlert,
  Clock,
  FileText,
  ImageUp,
  Loader2,
  RotateCcw,
  ScanText,
  Upload,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FREE_FAILED_ROUNDS } from "@receipt-ocr/core/plans";
import type { ReviewImage } from "@/components/capture/review-sheet";
import { formatTime } from "@/lib/format";
import { usageNote, type Usage } from "@/components/usage-meter";
import { fitBatch } from "@/lib/capture/batch-limit";
import { createBatchQueue, type QueueItem } from "@/lib/capture/batch-queue";
import { browserCameraSupport, hasCamera, type CameraSupport } from "@/lib/capture/camera";
import { postReceipt } from "@/lib/capture/upload-request";
import { ACCEPT, UPLOAD_LIMIT_BYTES, acceptedType, prepareFile } from "@/lib/upload-prep";

// Loaded on first use, so the camera and editor don't weigh on the upload page.
const loadCamera = () => import("@/components/capture/camera-sheet");
const CameraSheet = dynamic(loadCamera, { ssr: false });
const ReviewSheet = dynamic(() => import("@/components/capture/review-sheet"), { ssr: false });

const noSubscription = () => () => {};

/** A file ready to upload, carried by its queue item. */
type Queued = { file: File; preview: string };

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Rejects what the server would reject anyway, before spending a round trip on it. */
function typeRejection(file: File): string | null {
  return acceptedType(file) ? null : `${file.name} isn't a photo or PDF`;
}

/** Checked after preparation, since photos usually shrink well under the limit. */
function sizeRejection(file: File): string | null {
  if (file.size <= UPLOAD_LIMIT_BYTES) return null;
  const hint = acceptedType(file) === "application/pdf" ? " Try a smaller PDF or a photo." : "";
  return `${file.name} is ${formatSize(file.size)} (${formatSize(UPLOAD_LIMIT_BYTES)} max).${hint}`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Shown instead of the drop zone when the day's limit, or the service-wide cap, is reached. */
function LimitReached({ usage, resetsIn }: { usage: Usage; resetsIn: string }) {
  const reset = formatTime(usage.resetsAt);
  const global = usage.blocked === "global";
  return (
    <Card className="flex flex-col items-center gap-4 border-warning/30 px-6 py-10 text-center sm:py-14">
      <span className="flex size-12 items-center justify-center rounded-full border border-warning/30 bg-warning/10 text-warning">
        <Clock aria-hidden="true" className="size-5" />
      </span>
      <div className="max-w-md">
        <h2 className="text-lg font-semibold">
          {global ? "Receipt reading is paused for today" : "You've reached today's limit"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {global
            ? `The service has read as many receipts as it can today, for all accounts. This isn't a limit on your account. Uploads open again at ${reset}, ${resetsIn}.`
            : `Your plan reads ${plural(usage.limit, "receipt")} a day and you've used all of them. You can upload again at ${reset}, ${resetsIn}. Your first ${FREE_FAILED_ROUNDS} failed reads each day don't count.`}
        </p>
      </div>
      <Link
        className="text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-md:inline-flex max-md:min-h-11 max-md:items-center"
        href="/app/history"
      >
        Review the receipts you already have
      </Link>
    </Card>
  );
}

/** Seconds until `until`, ticking while it's set. */
function useCountdown(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

function ItemProgress({ item, onRetry }: { item: QueueItem; onRetry: () => void }) {
  if (item.status === "uploading") {
    const pct = Math.round(item.progress * 100);
    return (
      <>
        <Loader2
          aria-hidden="true"
          className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
        />
        <span>{pct < 100 ? "Uploading…" : "Saving…"}</span>
        <span
          aria-label="Upload progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={pct}
          className="h-1 w-16 overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <span
            className="block h-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </span>
      </>
    );
  }
  if (item.status === "done") {
    return (
      <>
        <Check aria-hidden="true" className="size-3 text-primary" />
        Uploaded
      </>
    );
  }
  return (
    <>
      <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{item.error ?? "Upload failed"}</span>
      <button
        className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
        onClick={onRetry}
        type="button"
      >
        <RotateCcw aria-hidden="true" className="size-3" />
        Retry
      </button>
    </>
  );
}

export function UploadPanel({
  usage,
  resetsIn,
  batchMax,
}: {
  usage: Usage | null;
  /** "in 6 hours", computed on the server so it matches what was rendered. */
  resetsIn: string;
  /** Images in one batch (camera plus picked files), from the plan. */
  batchMax: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [reviewing, setReviewingState] = useState<ReviewImage[]>([]);
  // Mirrors `reviewing` synchronously, with slots held by files still being prepared, so two
  // adds in quick succession both see the other and can't overfill the batch.
  const reviewingRef = useRef<ReviewImage[]>([]);
  const pendingRef = useRef(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFound, setCameraFound] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // The queue owns the list: each row's file, preview and upload state.
  const [queue] = useState(() =>
    createBatchQueue<Queued, "instant" | "queued">({
      mode: "queued",
      upload: (item, mode, onProgress) => postReceipt(item.file, mode, onProgress),
    }),
  );
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  useEffect(() => () => queue.dispose(), [queue]);
  const pausedFor = useCountdown(snapshot.pausedUntil);

  const support = useSyncExternalStore<CameraSupport>(
    noSubscription,
    browserCameraSupport,
    () => "unsupported",
  );
  useEffect(() => {
    if (support !== "ok") return;
    void hasCamera().then(setCameraFound);
  }, [support]);

  // `?capture=1` (the Scan tab and the home-screen shortcut) opens the camera on every visit.
  // The parameter is dropped once used, so the next tap on Scan is a change again, and Back
  // from an opened receipt returns to the plain page instead of reopening the camera.
  const captureRequested = useSearchParams().get("capture") === "1";
  useEffect(() => {
    if (!captureRequested) return;
    let cancelled = false;
    const url = new URL(window.location.href);
    url.searchParams.delete("capture");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (browserCameraSupport() !== "ok") return;
    void hasCamera().then((found) => {
      if (cancelled) return;
      setCameraFound(found);
      if (found) setCameraOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, [captureRequested]);

  // Object URLs for the thumbnails live until their row goes away.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const release = useCallback((gone: Queued[]) => {
    for (const { preview } of gone) {
      if (!preview) continue;
      URL.revokeObjectURL(preview);
      previews.current.delete(preview);
    }
  }, []);

  const items = snapshot.items;

  // When a run settles: a single instant upload opens its receipt; a batch clears what landed.
  useEffect(
    () =>
      queue.onSettle(() => {
        const done = queue.getSnapshot().items.filter((i) => i.status === "done");
        if (done.length === 0) return;
        if (queue.getMode() === "instant") {
          if (done[0]?.receiptId) router.push(`/app/receipts/${done[0].receiptId}`);
          return;
        }
        release(queue.clearDone().map((i) => i.payload));
        setSuccess(
          done.length === 1
            ? "1 receipt uploaded. It's being read now and shows up in Recent receipts below."
            : `${done.length} receipts uploaded. They're being read now and show up in Recent receipts below.`,
        );
        router.refresh();
      }),
    [queue, router, release],
  );

  if (usage?.blocked) return <LimitReached resetsIn={resetsIn} usage={usage} />;

  const busy = snapshot.running;
  const remaining = usage ? Math.max(0, usage.limit - usage.used) : null;
  const inBatch = items.length + reviewing.length;
  const room = Math.max(0, batchMax - inBatch);
  /** What the batch holds right now, including adds not yet rendered. */
  const inBatchNow = () =>
    queue.getSnapshot().items.length + reviewingRef.current.length + pendingRef.current;

  function setReviewing(next: (current: ReviewImage[]) => ReviewImage[]) {
    reviewingRef.current = next(reviewingRef.current);
    setReviewingState(reviewingRef.current);
  }

  /** Adds prepared files to the queue; returns how many were accepted. */
  function enqueue(files: File[], rejected: string[]) {
    const accepted: { id: string; payload: Queued }[] = [];
    for (const file of files) {
      const rejection = sizeRejection(file);
      if (rejection) {
        rejected.push(rejection);
        continue;
      }
      const preview = acceptedType(file) === "application/pdf" ? "" : URL.createObjectURL(file);
      if (preview) previews.current.add(preview);
      accepted.push({ id: crypto.randomUUID(), payload: { file, preview } });
    }
    queue.add(accepted);
    return accepted.length;
  }

  /** Photos go to review first; PDFs can't be edited, so they join the list directly. */
  async function addFiles(list: FileList | File[]) {
    const rejected: string[] = [];
    const candidates: File[] = [];
    for (const file of Array.from(list)) {
      const rejection = typeRejection(file);
      if (rejection) rejected.push(rejection);
      else candidates.push(file);
    }
    const fit = fitBatch(candidates, inBatchNow(), batchMax);
    setSuccess(null);
    const isPdf = (f: File) => acceptedType(f) === "application/pdf";
    const pdfs = fit.kept.filter(isPdf);
    const photos = fit.kept.filter((f) => !isPdf(f));
    if (photos.length > 0) {
      setReviewing((current) => [
        ...current,
        ...photos.map((file) => ({ id: crypto.randomUUID(), blob: file, name: file.name })),
      ]);
    }
    if (pdfs.length > 0) {
      pendingRef.current += pdfs.length;
      setPreparing(true);
      let ready: File[];
      try {
        ready = await Promise.all(pdfs.map(prepareFile));
      } finally {
        pendingRef.current -= pdfs.length;
        setPreparing(false);
      }
      enqueue(ready, rejected);
    }
    const parts = [rejected.length > 0 ? `Not added: ${rejected.join("; ")}.` : null, fit.notice];
    setNotice(parts.filter(Boolean).join(" ") || null);
  }

  function addShots(blobs: Blob[]) {
    setCameraOpen(false);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
    const fit = fitBatch(blobs, inBatchNow(), batchMax);
    setNotice(fit.notice);
    setSuccess(null);
    setReviewing((current) => [
      ...current,
      ...fit.kept.map((blob, i) => ({
        id: crypto.randomUUID(),
        blob,
        name: `photo-${stamp}-${current.length + i + 1}.jpg`,
      })),
    ]);
  }

  /** One file reads in the request and opens; more upload two at a time and read in the background. */
  function read() {
    setSuccess(null);
    queue.start(queue.getSnapshot().items.length === 1 ? "instant" : "queued");
  }

  function reviewed(files: File[]) {
    setReviewing(() => []);
    const rejected: string[] = [];
    const added = enqueue(files, rejected);
    setNotice(rejected.length > 0 ? `Not added: ${rejected.join("; ")}.` : null);
    if (added > 0) read();
  }

  function openCamera() {
    if (room === 0) {
      setNotice(fitBatch([null], inBatch, batchMax).notice);
      return;
    }
    if (support === "ok") setCameraOpen(true);
    else cameraRef.current?.click();
  }

  function remove(id: string) {
    release(items.filter((item) => item.id === id).map((i) => i.payload));
    queue.remove(id);
  }

  function clear() {
    release(items.map((i) => i.payload));
    for (const item of items) queue.remove(item.id);
    setNotice(null);
  }

  const locked = busy || preparing;
  const empty = items.length === 0;
  const count = snapshot.items.filter((i) => i.status === "waiting" || i.status === "error").length;
  const overLimit = remaining !== null && count > remaining;
  const single = items.length === 1;
  // Desktop offers the camera only when one exists; phones always get the button, falling
  // back to the camera app when the in-app camera can't run.
  const cameraOnDesktop = support === "ok" && cameraFound;
  const prefetchCamera = () => void loadCamera();

  return (
    <div className="flex flex-col gap-4">
      <Card
        aria-describedby="upload-hint"
        aria-label="Add receipt photos or PDFs"
        className={cn(
          "relative cursor-pointer border-2 border-dashed text-center transition outline-none focus-visible:ring-2 focus-visible:ring-ring",
          empty ? "px-5 py-8 sm:py-12" : "p-4",
          dragging
            ? "border-primary bg-primary/5"
            : "border-input/60 bg-card hover:border-primary/50",
        )}
        onClick={() => {
          if (!locked) inputRef.current?.click();
        }}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!locked) void addFiles(event.dataTransfer.files);
        }}
        onKeyDown={(event) => {
          if (!locked && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-disabled={locked}
        role="button"
        tabIndex={0}
      >
        <input
          accept={ACCEPT}
          className="hidden"
          disabled={locked}
          multiple
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = "";
          }}
          ref={inputRef}
          type="file"
        />
        {/* The phone's own camera app: the fallback when the in-app camera can't run. */}
        <input
          accept={ACCEPT}
          capture="environment"
          disabled={locked}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = "";
          }}
          ref={cameraRef}
          type="file"
        />
        <div className={cn("flex items-center", empty ? "flex-col" : "flex-row gap-3 text-left")}>
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary",
              empty ? "mb-4 size-14" : "size-10",
            )}
          >
            <Upload aria-hidden="true" className={empty ? "size-6" : "size-4"} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {empty ? (
                <>
                  <span className="max-md:hidden">
                    Drop receipt photos or PDFs here, or click to choose
                  </span>
                  <span className="md:hidden">Take photos or choose files</span>
                </>
              ) : (
                "Add more receipts"
              )}
            </p>
            <p className="mt-1 text-sm text-muted-foreground" id="upload-hint">
              Photos of any size, which you can crop before they are shrunk and uploaded, or PDFs up
              to {formatSize(UPLOAD_LIMIT_BYTES)}. Up to {batchMax} at a time.
            </p>
            <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
              {preparing ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2
                    aria-hidden="true"
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                  Preparing…
                </span>
              ) : null}
            </p>
          </div>
        </div>
      </Card>

      <div className={cn("flex w-full gap-2 max-md:flex-col", !cameraOnDesktop && "md:hidden")}>
        <Button
          disabled={locked}
          onClick={openCamera}
          onFocus={prefetchCamera}
          onPointerEnter={prefetchCamera}
          type="button"
        >
          <Camera aria-hidden="true" />
          Take photos
        </Button>
        <Button
          className="md:hidden"
          disabled={locked}
          onClick={() => inputRef.current?.click()}
          type="button"
          variant="outline"
        >
          <ImageUp aria-hidden="true" />
          Choose files
        </Button>
      </div>

      {notice ? (
        <Alert className="px-4 py-3" variant="warning">
          {notice}
        </Alert>
      ) : null}
      {snapshot.stopped ? (
        <Alert className="px-4 py-3" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <p>{snapshot.stopped} The rest are still here; read them when your limit resets.</p>
        </Alert>
      ) : null}
      {success ? (
        <Alert className="px-4 py-3" variant="success">
          <Check aria-hidden="true" />
          <p>{success}</p>
        </Alert>
      ) : null}

      {!empty ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border py-2 pr-2 pl-4">
            <h2 className="text-sm font-medium">
              Ready to read{" "}
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </h2>
            <Button disabled={busy} onClick={clear} size="sm" variant="ghost">
              Remove all
            </Button>
          </div>
          <ul aria-label="Receipts to read" className="divide-y divide-border">
            {items.map((item) => {
              return (
                <li className="flex items-center gap-3 py-2 pr-2 pl-4" key={item.id}>
                  {item.payload.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      alt=""
                      className="size-11 shrink-0 rounded-md border border-border bg-muted object-cover"
                      src={item.payload.preview}
                    />
                  ) : (
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                      <FileText aria-hidden="true" className="size-5" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{item.payload.file.name}</p>
                    <p
                      className={cn(
                        "mt-0.5 flex items-center gap-1.5 text-xs",
                        item.status === "error" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {item.status !== "waiting" ? (
                        <ItemProgress item={item} onRetry={() => queue.retry(item.id)} />
                      ) : (
                        <span className="font-mono tabular-nums">
                          {formatSize(item.payload.file.size)}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button
                    aria-label={`Remove ${item.payload.file.name}`}
                    disabled={item.status === "uploading"}
                    onClick={() => remove(item.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <X aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {snapshot.pausedUntil !== null
                ? `Paused for your plan's per-minute limit. Carrying on in ${pausedFor} s.`
                : busy
                  ? single
                    ? "Uploading and reading. This takes a few seconds."
                    : "Uploading two at a time. Keep this page open until every file is uploaded; reading carries on after that."
                  : overLimit
                    ? `You have ${plural(remaining, "receipt")} left today, so only the first ${remaining} will be read.`
                    : usage
                      ? usageNote(usage)
                      : null}
            </p>
            <Button className="max-sm:w-full" disabled={busy || count === 0} onClick={read}>
              {busy ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : (
                <ScanText aria-hidden="true" />
              )}
              {busy
                ? single
                  ? "Reading…"
                  : "Uploading…"
                : single
                  ? "Read receipt"
                  : `Read ${plural(count, "receipt")}`}
            </Button>
          </div>
        </Card>
      ) : null}

      {cameraOpen ? (
        <CameraSheet
          batchMax={batchMax}
          onClose={() => setCameraOpen(false)}
          onDone={addShots}
          onFallback={() => {
            setCameraOpen(false);
            cameraRef.current?.click();
          }}
          open
          room={room}
        />
      ) : null}
      {reviewing.length > 0 && !cameraOpen ? (
        <ReviewSheet
          images={reviewing}
          key={reviewing.map((r) => r.id).join()}
          onCancel={() => setReviewing(() => [])}
          onUpload={reviewed}
        />
      ) : null}
    </div>
  );
}
