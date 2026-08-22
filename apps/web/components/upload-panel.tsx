"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import {
  Camera,
  Check,
  FileJson,
  Layers,
  Loader2,
  ScanLine,
  Shield,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const pipeline = [
  {
    icon: ScanLine,
    title: "Extracted",
    desc: "Merchant, items, tax & totals — each with a confidence score.",
  },
  {
    icon: FileJson,
    title: "Structured",
    desc: "Clean fields stored in your searchable history.",
  },
  {
    icon: Shield,
    title: "Private",
    desc: "Uploads are server-side; your keys never touch the browser.",
  },
];

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

export function UploadPanel() {
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
          Drop images, browse, or snap a photo. Process one instantly, or queue a batch and keep
          working while extraction runs in the background.
        </p>
      </div>

      <Card
        aria-label="Add receipt images"
        className={`cursor-pointer border-2 border-dashed p-8 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-16 ${
          dragging ? "border-primary bg-primary/5" : "border-border bg-card"
        }`}
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
            <Upload className="mb-4 size-10 text-muted-foreground" />
            <p className="font-medium">Drop receipt images here</p>
            <p className="mt-2 text-sm text-muted-foreground">PNG, JPG, HEIC up to 10MB</p>
            <Button
              className="mt-5 md:hidden"
              onClick={(event) => {
                event.stopPropagation();
                cameraRef.current?.click();
              }}
              variant="outline"
            >
              <Camera className="size-4" />
              Take a photo
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {queue.map((item, index) => (
              <span
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-xs ${
                  item.state === "error"
                    ? "border-red-500/40 bg-red-500/10 text-red-300"
                    : item.state === "done"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground"
                }`}
                key={`${item.file.name}-${index}`}
              >
                {item.state === "uploading" ? <Loader2 className="size-3 animate-spin" /> : null}
                {item.state === "done" ? <Check className="size-3" /> : null}
                {item.file.name.length > 24 ? `${item.file.name.slice(0, 24)}...` : item.file.name}
                <span className="text-muted-foreground/70">{formatSize(item.file.size)}</span>
                {processing === null ? (
                  <button
                    aria-label={`Remove ${item.file.name}`}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      setQueue((current) => current.filter((_, fileIndex) => fileIndex !== index));
                    }}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </Card>

      {notice && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {notice}
        </div>
      )}

      {error && (
        <div
          className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {files.length === 1 && (
            <Button disabled={processing !== null} onClick={processInstantly}>
              <Zap className="size-4" />
              {processing === "instant" ? "Processing..." : "Process now"}
            </Button>
          )}
          <Button
            disabled={processing !== null}
            onClick={queueAll}
            variant={files.length === 1 ? "outline" : "default"}
          >
            <Layers className="size-4" />
            {processing === "queued"
              ? "Queueing..."
              : files.length === 1
                ? "Queue in background"
                : `Queue ${files.length} receipts`}
          </Button>
          <Button disabled={processing !== null} onClick={() => setQueue([])} variant="outline">
            Clear
          </Button>
          {processing === "instant" && (
            <span className="font-mono text-xs text-muted-foreground">
              Uploading, storing, and extracting...
            </span>
          )}
          {processing === "queued" && (
            <span className="font-mono text-xs text-muted-foreground">
              Uploading — extraction continues in the background.
            </span>
          )}
        </div>
      )}

      {/* What happens after upload */}
      <div className="mt-10 grid gap-4 sm:grid-cols-3">
        {pipeline.map((step) => {
          const Icon = step.icon;
          return (
            <Card className="p-5" key={step.title}>
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
                <Icon className="size-4" />
              </div>
              <h3 className="text-sm font-semibold">{step.title}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.desc}</p>
            </Card>
          );
        })}
      </div>

      {/* Tips for best results */}
      <Card className="mt-4 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Tips for the cleanest extraction
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
