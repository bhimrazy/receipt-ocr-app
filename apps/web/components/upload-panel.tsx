"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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
    </div>
  );
}
