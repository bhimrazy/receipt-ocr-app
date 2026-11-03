"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Camera, Check, ImageUp, Layers, Loader2, Sparkles, Upload, X, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const tips = [
  "Flat, well-lit photos read best — avoid glare and folds.",
  "Long receipts are fine; just keep the whole thing in frame.",
  "PNG, JPG, or HEIC up to 10MB per image.",
];

type UploadResponse = { receiptId?: string; error?: string };

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 20;

/** Per-file state so a partly-failed batch says exactly which files failed. */
type Queued = {
  file: File;
  state: "pending" | "uploading" | "done" | "error";
  error?: string;
};

async function postReceipt(file: File, mode: "instant" | "queued"): Promise<UploadResponse> {
  const form = new FormData();
  form.set("file", file);
  form.set("mode", mode);
  const res = await fetch("/api/receipts", { method: "POST", body: form });
  const body = (await res.json().catch(() => null)) as UploadResponse | null;
  if (!res.ok) {
    return { error: body?.error ?? "Failed to process receipt" };
  }
  return body ?? {};
}

function formatSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Rejects what the server would reject anyway, but before spending a 10MB
 * round trip on it.
 */
function rejectionFor(file: File): string | null {
  if (!file.type.startsWith("image/")) return `${file.name} isn't an image`;
  if (file.size > MAX_FILE_SIZE) return `${file.name} is ${formatSize(file.size)} (10MB max)`;
  return null;
}

export function UploadPanel({
  remaining,
  limit,
}: {
  remaining: number | null;
  limit: number | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState<"instant" | "queued" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const files = queue.map((item) => item.file);

  function addFiles(nextFiles: FileList | File[]) {
    const incoming = Array.from(nextFiles);
    const rejected: string[] = [];
    const accepted: Queued[] = [];

    for (const file of incoming) {
      const rejection = rejectionFor(file);
      if (rejection) rejected.push(rejection);
      else accepted.push({ file, state: "pending" });
    }

    setQueue((current) => {
      const room = MAX_FILES - current.length;
      if (accepted.length > room) {
        rejected.push(`only ${MAX_FILES} receipts can be queued at once`);
      }
      return [...current, ...accepted.slice(0, Math.max(0, room))];
    });
    // Silent truncation used to drop files with no explanation at all.
    setNotice(rejected.length > 0 ? `Skipped: ${rejected.join("; ")}.` : null);
  }

  function markFile(index: number, patch: Partial<Queued>) {
    setQueue((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function processInstantly() {
    const file = files[0];
    if (!file) return;
    setProcessing("instant");
    setError(null);
    markFile(0, { state: "uploading" });

    const result = await postReceipt(file, "instant");
    if (result.error || !result.receiptId) {
      setError(result.error ?? "Failed to process receipt");
      markFile(0, { state: "error", error: result.error });
      setProcessing(null);
      return;
    }
    router.push(`/app/receipts/${result.receiptId}`);
  }

  async function queueAll() {
    if (queue.length === 0) return;
    setProcessing("queued");
    setError(null);

    // Sequential, not Promise.all: firing 20 uploads at once trips the burst
    // quota and gives the user no idea which ones landed.
    const outcomes: UploadResponse[] = [];
    for (let index = 0; index < queue.length; index += 1) {
      markFile(index, { state: "uploading" });
      const result = await postReceipt(queue[index]!.file, "queued");
      outcomes.push(result);
      markFile(index, {
        state: result.error ? "error" : "done",
        error: result.error,
      });
      if (result.error) break; // usually a quota stop; keep the rest queued
    }

    const failures = outcomes.filter((result) => result.error);
    if (failures.length > 0) {
      const succeeded = outcomes.length - failures.length;
      setError(
        succeeded === 0
          ? (failures[0]?.error ?? "Failed to queue receipts")
          : `${failures[0]?.error ?? "An upload failed"} ${succeeded} receipt${succeeded === 1 ? "" : "s"} already queued.`,
      );
      setProcessing(null);
      return;
    }

    const queued = outcomes[0];
    if (queue.length === 1 && queued?.receiptId) {
      router.push(`/app/receipts/${queued.receiptId}`);
      return;
    }
    router.push("/app/history");
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Upload receipts</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add a photo of a receipt and we&apos;ll read the merchant, date, items and total. Adding
          several? They&apos;re read in the background while you keep working.
        </p>
      </div>

      <Card
        aria-label="Add receipt images"
        className={cn(
          "cursor-pointer border-2 border-dashed p-6 text-center transition outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-8 md:p-16",
          dragging ? "border-primary bg-primary/5" : "border-input bg-card",
        )}
        onClick={() => inputRef.current?.click()}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
        // The dropzone was a plain div: unreachable by keyboard and invisible
        // to assistive tech. Enter/Space now open the same file picker.
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => event.target.files && addFiles(event.target.files)}
        />
        <input
          ref={cameraRef}
          className="hidden"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => event.target.files && addFiles(event.target.files)}
        />
        {files.length === 0 ? (
          <div className="flex flex-col items-center">
            <Upload aria-hidden="true" className="mb-4 size-10 text-muted-foreground" />
            <p className="font-medium">
              <span className="max-md:hidden">Drop receipt images here, or click to browse</span>
              <span className="md:hidden">Take a photo or choose images</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">PNG, JPG or HEIC, up to 10MB each</p>
            <div className="mt-5 flex w-full flex-col gap-2 sm:w-auto sm:flex-row md:hidden">
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  cameraRef.current?.click();
                }}
              >
                <Camera aria-hidden="true" />
                Take a photo
              </Button>
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  inputRef.current?.click();
                }}
                variant="outline"
              >
                <ImageUp aria-hidden="true" />
                Choose images
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {queue.map((item, index) => (
              <span
                className={cn(
                  "inline-flex max-w-full items-center gap-2 rounded-lg border py-1 pr-1 pl-3 font-mono text-xs",
                  item.state === "error"
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : item.state === "done"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground",
                )}
                key={`${item.file.name}-${index}`}
              >
                {item.state === "uploading" ? <Loader2 className="size-3 animate-spin" /> : null}
                {item.state === "done" ? <Check className="size-3" /> : null}
                <span className="min-w-0 truncate">{item.file.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatSize(item.file.size)}</span>
                {processing === null ? (
                  <button
                    aria-label={`Remove ${item.file.name}`}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:size-11"
                    onClick={(event) => {
                      event.stopPropagation();
                      setQueue((current) => current.filter((_, fileIndex) => fileIndex !== index));
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </Card>

      {notice && (
        <div
          className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
          role="status"
        >
          {notice}
        </div>
      )}

      {error && (
        <div
          className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {/* One file is read right away; a mode choice only appears for a batch. */}
          {files.length === 1 ? (
            <Button disabled={processing !== null} onClick={processInstantly}>
              {processing ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Zap aria-hidden="true" />
              )}
              {processing === "instant" ? "Reading…" : "Read receipt"}
            </Button>
          ) : (
            <Button disabled={processing !== null} onClick={queueAll}>
              {processing ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : (
                <Layers aria-hidden="true" />
              )}
              {processing === "queued" ? "Uploading…" : `Read ${files.length} receipts`}
            </Button>
          )}
          <Button disabled={processing !== null} onClick={() => setQueue([])} variant="outline">
            Clear
          </Button>
          <span aria-live="polite" className="font-mono text-xs text-muted-foreground">
            {processing === "instant"
              ? "Uploading and reading. This takes a few seconds."
              : processing === "queued"
                ? "Uploading. Reading continues in the background."
                : remaining !== null && limit !== null
                  ? `${remaining} of ${limit} left today`
                  : null}
          </span>
        </div>
      )}

      {files.length === 0 && remaining !== null && limit !== null ? (
        <p className="mt-3 text-right font-mono text-xs text-muted-foreground">
          {remaining} of {limit} receipts left today
        </p>
      ) : null}

      {/* Tips for best results */}
      <Card className="mt-8 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles aria-hidden="true" className="size-4 text-primary" />
          Tips for a clean read
        </div>
        <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
          {tips.map((tip) => (
            <li className="flex items-start gap-2.5" key={tip}>
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
              {tip}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
