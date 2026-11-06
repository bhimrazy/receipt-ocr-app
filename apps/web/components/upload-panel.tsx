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
  ScanText,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FREE_FAILED_ROUNDS } from "@receipt-ocr/core/plans";
import { formatTime } from "@/lib/format";
import { usageNote, type Usage } from "@/components/usage-meter";
import { ACCEPT, UPLOAD_LIMIT_BYTES, acceptedType, prepareFile } from "@/lib/upload-prep";
import { useSharedFiles } from "@/lib/use-shared-files";

type UploadResponse = { receiptId?: string; error?: string };

const MAX_FILES = 20;

/** Per-file state so a partly failed batch says exactly which files failed. */
type Queued = {
  id: string;
  file: File;
  preview: string;
  state: "waiting" | "uploading" | "done" | "error";
  error?: string;
};

async function postReceipt(file: File, mode: "instant" | "queued"): Promise<UploadResponse> {
  const form = new FormData();
  form.set("file", file);
  form.set("mode", mode);
  try {
    const res = await fetch("/api/receipts", { method: "POST", body: form });
    const body = (await res.json().catch(() => null)) as UploadResponse | null;
    if (!res.ok) return { error: body?.error ?? "The upload failed. Try again." };
    return body ?? {};
  } catch {
    return { error: "The upload didn't reach the server. Check your connection and try again." };
  }
}

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

export function UploadPanel({
  usage,
  resetsIn,
}: {
  usage: Usage | null;
  /** "in 6 hours", computed on the server so it matches what was rendered. */
  resetsIn: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const queueRef = useRef<Queued[]>([]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Object URLs for the thumbnails live until their row goes away.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function release(items: Queued[]) {
    for (const item of items) {
      if (!item.preview) continue;
      URL.revokeObjectURL(item.preview);
      previews.current.delete(item.preview);
    }
  }

  // Files shared from another app (Android share sheet) arrive through the file input.
  useSharedFiles(inputRef);

  if (usage?.blocked) return <LimitReached resetsIn={resetsIn} usage={usage} />;

  const remaining = usage ? Math.max(0, usage.limit - usage.used) : null;
  const waiting = queue.filter((item) => item.state === "waiting" || item.state === "error");

  async function addFiles(list: FileList | File[]) {
    const rejected: string[] = [];
    const candidates: File[] = [];
    for (const file of Array.from(list)) {
      const rejection = typeRejection(file);
      if (rejection) rejected.push(rejection);
      else candidates.push(file);
    }
    const initialRoom = Math.max(0, MAX_FILES - queue.length);
    if (candidates.length > initialRoom)
      rejected.push(`you can add ${MAX_FILES} receipts at a time`);
    setNotice(null);
    setSuccess(null);
    setError(null);
    setPreparing(true);
    const accepted: Queued[] = [];
    for (const original of candidates.slice(0, initialRoom)) {
      const file = await prepareFile(original);
      const rejection = sizeRejection(file);
      if (rejection) {
        rejected.push(rejection);
        continue;
      }
      const preview = acceptedType(file) === "application/pdf" ? "" : URL.createObjectURL(file);
      if (preview) previews.current.add(preview);
      accepted.push({ id: crypto.randomUUID(), file, preview, state: "waiting" });
    }
    setPreparing(false);
    const room = Math.max(0, MAX_FILES - queueRef.current.length);
    release(accepted.slice(room));
    if (accepted.length > room && !rejected.some((r) => r.startsWith("you can add"))) {
      rejected.push(`you can add ${MAX_FILES} receipts at a time`);
    }
    setQueue((current) => [
      ...current,
      ...accepted.slice(0, Math.max(0, MAX_FILES - current.length)),
    ]);
    setNotice(rejected.length > 0 ? `Not added: ${rejected.join("; ")}.` : null);
  }

  function remove(id: string) {
    release(queue.filter((item) => item.id === id));
    setQueue((current) => current.filter((item) => item.id !== id));
  }

  function clear() {
    release(queue);
    setQueue([]);
    setNotice(null);
    setError(null);
  }

  function mark(id: string, patch: Partial<Queued>) {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function readOne(item: Queued) {
    setBusy(true);
    setError(null);
    mark(item.id, { state: "uploading", error: undefined });
    const result = await postReceipt(item.file, "instant");
    if (result.error || !result.receiptId) {
      const message = result.error ?? "The upload failed. Try again.";
      mark(item.id, { state: "error", error: message });
      setError(message);
      setBusy(false);
      return;
    }
    router.push(`/app/receipts/${result.receiptId}`);
  }

  async function readAll() {
    setBusy(true);
    setError(null);
    let uploaded = 0;
    // One at a time: firing 20 uploads at once trips the burst limit and hides which ones landed.
    for (const item of waiting) {
      mark(item.id, { state: "uploading", error: undefined });
      const result = await postReceipt(item.file, "queued");
      if (result.error) {
        mark(item.id, { state: "error", error: result.error });
        setError(
          uploaded > 0
            ? `${result.error} ${plural(uploaded, "receipt")} uploaded before this one stopped.`
            : result.error,
        );
        break; // usually the quota; keep the rest waiting
      }
      uploaded += 1;
      mark(item.id, { state: "done" });
    }
    setBusy(false);
    if (uploaded > 0) {
      setQueue((current) => {
        release(current.filter((item) => item.state === "done"));
        return current.filter((item) => item.state !== "done");
      });
      setSuccess(
        uploaded === 1
          ? "1 receipt uploaded. It's being read now and shows up in Recent receipts below."
          : `${uploaded} receipts uploaded. They're being read now and show up in Recent receipts below.`,
      );
      router.refresh();
    }
  }

  const locked = busy || preparing;
  const empty = queue.length === 0;
  const count = waiting.length;
  const overLimit = remaining !== null && count > remaining;
  const single = queue.length === 1 && count === 1;

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
                  <span className="md:hidden">Take a photo or choose a file</span>
                </>
              ) : (
                "Add more receipts"
              )}
            </p>
            <p className="mt-1 text-sm text-muted-foreground" id="upload-hint">
              JPEG, PNG, WebP or HEIC photos of any size, which are shrunk before they upload, or
              PDFs up to {formatSize(UPLOAD_LIMIT_BYTES)}.
              {empty ? ` Up to ${MAX_FILES} at a time.` : null}
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
      {empty ? (
        <div className="flex w-full flex-col gap-2 md:hidden">
          <Button disabled={locked} onClick={() => cameraRef.current?.click()} type="button">
            <Camera aria-hidden="true" />
            Take a photo
          </Button>
          <Button
            disabled={locked}
            onClick={() => inputRef.current?.click()}
            type="button"
            variant="outline"
          >
            <ImageUp aria-hidden="true" />
            Choose files
          </Button>
        </div>
      ) : null}

      {notice ? (
        <Alert className="px-4 py-3" variant="warning">
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert className="px-4 py-3" variant="destructive">
          <CircleAlert aria-hidden="true" />
          <p>{error}</p>
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
                {queue.length}
              </span>
            </h2>
            <Button disabled={busy} onClick={clear} size="sm" variant="ghost">
              Remove all
            </Button>
          </div>
          <ul aria-label="Receipts to read" className="divide-y divide-border">
            {queue.map((item) => (
              <li className="flex items-center gap-3 py-2 pr-2 pl-4" key={item.id}>
                {item.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    className="size-11 shrink-0 rounded-md border border-border bg-muted object-cover"
                    src={item.preview}
                  />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                    <FileText aria-hidden="true" className="size-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs">{item.file.name}</p>
                  <p
                    className={cn(
                      "mt-0.5 flex items-center gap-1.5 text-xs",
                      item.state === "error" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {item.state === "uploading" ? (
                      <>
                        <Loader2
                          aria-hidden="true"
                          className="size-3 animate-spin motion-reduce:animate-none"
                        />
                        Uploading…
                      </>
                    ) : item.state === "done" ? (
                      <>
                        <Check aria-hidden="true" className="size-3 text-primary" />
                        Uploaded
                      </>
                    ) : item.state === "error" ? (
                      <>
                        <CircleAlert aria-hidden="true" className="size-3 shrink-0" />
                        <span className="min-w-0 truncate">{item.error ?? "Upload failed"}</span>
                      </>
                    ) : (
                      <span className="font-mono tabular-nums">{formatSize(item.file.size)}</span>
                    )}
                  </p>
                </div>
                <Button
                  aria-label={`Remove ${item.file.name}`}
                  disabled={busy}
                  onClick={() => remove(item.id)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {busy
                ? single
                  ? "Uploading and reading. This takes a few seconds."
                  : "Uploading one at a time. Keep this page open until every file is uploaded; reading carries on after that."
                : overLimit
                  ? `You have ${plural(remaining, "receipt")} left today, so only the first ${remaining} will be read.`
                  : usage
                    ? usageNote(usage)
                    : null}
            </p>
            <Button
              className="max-sm:w-full"
              disabled={busy || count === 0}
              onClick={() => (single ? readOne(waiting[0]!) : readAll())}
            >
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
    </div>
  );
}
