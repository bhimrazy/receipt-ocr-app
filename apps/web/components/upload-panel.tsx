"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { FileJson, ScanLine, Shield, Sparkles, Upload, X } from "lucide-react";
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

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(nextFiles: FileList | File[]) {
    setFiles((current) => [...current, ...Array.from(nextFiles)].slice(0, 20));
  }

  async function processFirstReceipt() {
    const file = files[0];
    if (!file) return;
    setProcessing(true);
    setError(null);

    const form = new FormData();
    form.set("file", file);

    const res = await fetch("/api/receipts", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Failed to process receipt");
      setProcessing(false);
      return;
    }

    const body = (await res.json()) as { receiptId: string };
    router.push(`/app/receipts/${body.receiptId}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Upload receipts</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Drop images or click to browse. The MVP processes the first receipt synchronously.
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
        {files.length === 0 ? (
          <div className="flex flex-col items-center">
            <Upload className="mb-4 size-10 text-muted-foreground" />
            <p className="font-medium">Drop receipt images here</p>
            <p className="mt-2 text-sm text-muted-foreground">PNG, JPG, HEIC up to 10MB</p>
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
          <Button disabled={processing} onClick={processFirstReceipt}>
            {processing ? "Processing..." : `Process ${files.length} receipt${files.length > 1 ? "s" : ""}`}
          </Button>
          <Button disabled={processing} onClick={() => setFiles([])} variant="outline">
            Clear
          </Button>
          {processing && (
            <span className="font-mono text-xs text-muted-foreground">
              Uploading, storing, and extracting with Gemini...
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
