"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Camera, FileJson, Layers, ScanLine, Shield, Sparkles, Upload, X, Zap } from "lucide-react";
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

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState<"instant" | "queued" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addFiles(nextFiles: FileList | File[]) {
    setFiles((current) => [...current, ...Array.from(nextFiles)].slice(0, 20));
  }

  async function processInstantly() {
    const file = files[0];
    if (!file) return;
    setProcessing("instant");
    setError(null);

    const result = await postReceipt(file, "instant");
    if (result.error || !result.receiptId) {
      setError(result.error ?? "Failed to process receipt");
      setProcessing(null);
      return;
    }
    router.push(`/app/receipts/${result.receiptId}`);
  }

  async function queueAll() {
    if (files.length === 0) return;
    setProcessing("queued");
    setError(null);

    const results = await Promise.all(files.map((file) => postReceipt(file, "queued")));
    const failures = results.filter((result) => result.error);
    if (failures.length > 0) {
      setError(
        failures.length === files.length
          ? (failures[0]?.error ?? "Failed to queue receipts")
          : `${failures.length} of ${files.length} uploads failed — the rest are processing.`,
      );
      setProcessing(null);
      return;
    }

    const queued = results[0];
    if (files.length === 1 && queued?.receiptId) {
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
        className={`cursor-pointer border-2 border-dashed p-8 text-center transition md:p-16 ${
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
            {files.map((file, index) => (
              <span
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground"
                key={`${file.name}-${index}`}
              >
                {file.name.length > 24 ? `${file.name.slice(0, 24)}...` : file.name}
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
                  }}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </Card>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
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
          <Button disabled={processing !== null} onClick={() => setFiles([])} variant="outline">
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
