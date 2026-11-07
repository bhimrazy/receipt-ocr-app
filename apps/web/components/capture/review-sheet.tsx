"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  ArrowLeft,
  CircleAlert,
  Loader2,
  Maximize,
  RotateCw,
  ScanLine,
  ScanText,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  editKey,
  initialEdit,
  isDetected,
  isFullFrame,
  resetToDetected,
  rotateClockwise,
  fullImage,
  type EditState,
} from "@/lib/capture/edit-state";
import { defaultFilter, FILTER_LABELS, FILTERS, type Filter } from "@/lib/capture/filters";
import { EditFailedError, preparePhoto } from "@/lib/capture/prepare-photo";
import {
  detectOnBitmap,
  FULL_RENDER,
  loadImage,
  renderedSize,
  renderPreview,
  renderSmall,
  THUMB_RENDER,
  type RenderBudget,
} from "@/lib/capture/render";
import { planSize, START_QUALITY, TARGET_BYTES } from "@/lib/upload-prep";
import { CropEditor } from "./crop-editor";
import { FullScreen } from "./full-screen";

export type ReviewImage = { id: string; blob: Blob; name: string };

const FILTER_KEY = "receipt-ocr.capture.filter";

function rememberedFilter(): Filter | null {
  try {
    const value = sessionStorage.getItem(FILTER_KEY);
    return (FILTERS as readonly string[]).includes(value ?? "") ? (value as Filter) : null;
  } catch {
    return null;
  }
}

function rememberFilter(filter: Filter) {
  try {
    sessionStorage.setItem(FILTER_KEY, filter);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

/** The starting edit: the detected outline when there is one, and the session's filter. */
function startingEdit(bitmap: ImageBitmap): EditState {
  const { quad } = detectOnBitmap(bitmap);
  return initialEdit(quad, defaultFilter(rememberedFilter(), quad !== null));
}

/** About 0.3 MP: a few milliseconds to render, where the full 16 MP render takes seconds. */
const ESTIMATE_RENDER: RenderBudget = { source: 1_200_000, output: 300_000 };

/**
 * The upload size, from a small render: its JPEG bytes per pixel at the upload quality, times
 * the pixels `prepareFile` will keep. A small copy packs more detail per pixel, so this leans
 * high; `prepareFile` then shrinks anything over TARGET_BYTES, so the estimate is capped there.
 */
async function estimateBytes(bitmap: ImageBitmap, edit: EditState) {
  const small = await renderSmall(bitmap, edit, ESTIMATE_RENDER, START_QUALITY);
  const full = renderedSize(bitmap, edit, FULL_RENDER);
  const planned = planSize(full.width, full.height);
  const bytes = (small.blob.size / (small.width * small.height)) * planned.width * planned.height;
  return Math.min(TARGET_BYTES, Math.round(bytes));
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Loaded = { id: string; bitmap: ImageBitmap };
type Estimate = { key: string; bytes: number };
type Prepared = { key: string; file: File };

/**
 * Every photo is checked here before upload: corners (detected when possible), rotation,
 * filter, delete. The result goes through the same `prepareFile` as any picked file.
 */
export default function ReviewSheet({
  images: initial,
  onCancel,
  onUpload,
}: {
  images: ReviewImage[];
  onCancel: () => void;
  onUpload: (files: File[]) => void;
}) {
  const [images, setImages] = useState(initial);
  const [index, setIndex] = useState(0);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [estimates, setEstimates] = useState<Record<string, Estimate>>({});
  // Files made by an earlier Read that stopped on a failed photo, reused when nothing changed.
  const [prepared, setPrepared] = useState<Record<string, Prepared>>({});
  // Photos whose edit couldn't be encoded; held back until the edit changes or Read succeeds.
  const [editFailed, setEditFailed] = useState<Record<string, true>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Partial<Record<Filter, string>>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const uploadRef = useRef<HTMLButtonElement>(null);

  const current = images[Math.min(index, images.length - 1)];
  const edit = current ? edits[current.id] : undefined;
  const bitmap = loaded && current && loaded.id === current.id ? loaded.bitmap : null;

  // Decode the current image (one at a time: ten 12 MP bitmaps would not fit on a phone).
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    let bmp: ImageBitmap | null = null;
    loadImage(current.blob)
      .then((decoded) => {
        if (cancelled) return decoded.close();
        bmp = decoded;
        setLoaded({ id: current.id, bitmap: decoded });
        setEdits((all) =>
          all[current.id] ? all : { ...all, [current.id]: startingEdit(decoded) },
        );
      })
      .catch(() => {
        if (!cancelled) setFailed((all) => ({ ...all, [current.id]: true }));
      });
    return () => {
      cancelled = true;
      bmp?.close();
    };
  }, [current]);

  // The upload size for this edit, estimated from a small render (debounced while dragging).
  useEffect(() => {
    if (!bitmap || !edit || !current) return;
    const key = editKey(edit);
    if (estimates[current.id]?.key === key) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      estimateBytes(bitmap, edit)
        .then((bytes) => {
          if (!cancelled) setEstimates((all) => ({ ...all, [current.id]: { key, bytes } }));
        })
        // No estimate this time; the upload still encodes for real.
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bitmap, edit, current, estimates]);

  // Small previews of each filter on the current crop.
  const shapeKey = edit ? editKey({ ...edit, filter: "original" }) : "";
  useEffect(() => {
    if (!bitmap || !edit) return;
    const timer = window.setTimeout(() => {
      const next: Partial<Record<Filter, string>> = {};
      try {
        for (const filter of FILTERS) {
          next[filter] = renderPreview(bitmap, { ...edit, filter }, THUMB_RENDER);
        }
      } catch {
        // Out of canvas memory: the buttons still work without their previews.
      }
      setThumbs(next);
    }, 150);
    return () => window.clearTimeout(timer);
    // Filters only depend on the shape of the crop, not the chosen filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bitmap, shapeKey]);

  function update(next: EditState) {
    if (!current) return;
    setEdits((all) => ({ ...all, [current.id]: next }));
    const id = current.id;
    setEditFailed((all) => {
      if (!all[id]) return all;
      const rest = { ...all };
      delete rest[id];
      return rest;
    });
  }

  function chooseFilter(filter: Filter) {
    if (!edit) return;
    rememberFilter(filter);
    update({ ...edit, filter });
  }

  function remove() {
    if (!current) return;
    const rest = images.filter((image) => image.id !== current.id);
    if (rest.length === 0) return onCancel();
    setImages(rest);
    setIndex((i) => Math.min(i, rest.length - 1));
  }

  /**
   * Encodes every photo. One whose edit can't be encoded is never swapped for the original:
   * the sheet stays open on it with an error, and nothing is sent until it is fixed or deleted.
   */
  async function upload() {
    const files: File[] = [];
    const done: Record<string, Prepared> = {};
    const failedNow: Record<string, true> = {};
    setUploadError(null);
    try {
      for (const [i, image] of images.entries()) {
        setWorking(`Preparing ${i + 1} of ${images.length}…`);
        const saved = edits[image.id];
        const key = saved ? editKey(saved) : "";
        const cached = prepared[image.id];
        if (saved && cached?.key === key) {
          files.push(cached.file);
          continue;
        }
        try {
          const file = await preparePhoto(image, saved, startingEdit);
          files.push(file);
          if (saved) done[image.id] = { key, file };
        } catch (error) {
          if (!(error instanceof EditFailedError)) throw error;
          failedNow[image.id] = true;
        }
      }
    } finally {
      setWorking(null);
    }
    const failedIds = images.filter((image) => image.id in failedNow).map((image) => image.id);
    if (failedIds.length > 0) {
      setPrepared((all) => ({ ...all, ...done }));
      setEditFailed(failedNow);
      setIndex(images.findIndex((image) => image.id === failedIds[0]));
      return;
    }
    onUpload(files);
  }

  function read() {
    upload().catch(() => {
      setWorking(null);
      setUploadError("The photos couldn't be prepared. Nothing was uploaded. Try again.");
    });
  }

  const estimate = current && edit ? estimates[current.id] : undefined;
  const fresh = estimate && edit && estimate.key === editKey(edit);
  const count = images.length;
  const heldBack = (id: string) => editFailed[id] === true;

  return (
    <FullScreen
      className="bg-background"
      initialFocus={uploadRef}
      onClose={() => setConfirmClose(true)}
      open
      title="Review photos"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2">
        <Button
          aria-label="Back without uploading"
          onClick={() => setConfirmClose(true)}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <h2 className="text-sm font-medium">
          {count > 1 ? (
            <>
              Photo{" "}
              <span className="font-mono tabular-nums">
                {Math.min(index, count - 1) + 1} of {count}
              </span>
            </>
          ) : (
            "Check the photo"
          )}
        </h2>
        <Button aria-label="Delete this photo" onClick={remove} size="icon" variant="ghost">
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-muted/40">
        {current && failed[current.id] ? (
          <p className="m-auto max-w-xs px-6 text-center text-sm text-muted-foreground">
            This photo can&apos;t be shown in this browser. It uploads as it is.
          </p>
        ) : bitmap && edit ? (
          <CropEditor bitmap={bitmap} edit={edit} onChange={update} />
        ) : (
          <p className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            Finding the receipt…
          </p>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-3 pt-3 pb-3">
        <div className="flex flex-wrap items-center justify-center gap-1">
          <Button
            disabled={!edit}
            onClick={() => edit && update(rotateClockwise(edit))}
            size="sm"
            variant="ghost"
          >
            <RotateCw aria-hidden="true" />
            Rotate
          </Button>
          {edit?.detected ? (
            <Button
              disabled={isDetected(edit)}
              onClick={() => update(resetToDetected(edit))}
              size="sm"
              variant="ghost"
            >
              <ScanLine aria-hidden="true" />
              Reset to detected
            </Button>
          ) : null}
          <Button
            disabled={!edit || isFullFrame(edit.quad)}
            onClick={() => edit && update(fullImage(edit))}
            size="sm"
            variant="ghost"
          >
            <Maximize aria-hidden="true" />
            Use full image
          </Button>
        </div>

        <div aria-label="Filter" className="grid grid-cols-4 gap-2" role="group">
          {FILTERS.map((filter) => (
            <button
              aria-pressed={edit?.filter === filter}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg p-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                edit?.filter === filter ? "text-foreground" : "text-muted-foreground",
              )}
              disabled={!edit}
              key={filter}
              onClick={() => chooseFilter(filter)}
              type="button"
            >
              <span
                className={cn(
                  "block h-14 w-full overflow-hidden rounded-md border-2 bg-muted",
                  edit?.filter === filter ? "border-primary" : "border-transparent",
                )}
              >
                {thumbs[filter] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className="size-full object-cover" src={thumbs[filter]} />
                ) : null}
              </span>
              {FILTER_LABELS[filter]}
            </button>
          ))}
        </div>

        {current && heldBack(current.id) ? (
          <Alert className="px-3 py-2 text-sm" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <p>
              This photo&apos;s crop, turn or filter couldn&apos;t be saved on this device, so it
              wasn&apos;t sent. Try Read again, change the edit, or delete the photo.
            </p>
          </Alert>
        ) : null}
        {uploadError ? (
          <Alert className="px-3 py-2 text-sm" variant="destructive">
            <CircleAlert aria-hidden="true" />
            <p>{uploadError}</p>
          </Alert>
        ) : null}

        <p aria-live="polite" className="min-h-4 text-center text-xs text-muted-foreground">
          {fresh ? (
            <>
              About <span className="font-mono tabular-nums">{formatSize(estimate.bytes)}</span> to
              upload.
              {edit?.filter === "grey" || edit?.filter === "bw"
                ? " Greyscale and B&W make the file smaller."
                : null}
            </>
          ) : edit ? (
            "Working out the upload size…"
          ) : null}
          {edit?.filter === "bw" ? " B&W suits faded receipts but can lose light print." : null}
        </p>

        {count > 1 ? (
          <ul aria-label="Photos to upload" className="flex justify-center gap-2 overflow-x-auto">
            {images.map((image, i) => (
              <li key={image.id}>
                <button
                  aria-current={i === index ? "true" : undefined}
                  aria-label={heldBack(image.id) ? `Photo ${i + 1}, not sent` : `Photo ${i + 1}`}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-md border-2 font-mono text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    i === index
                      ? "border-primary text-foreground"
                      : heldBack(image.id)
                        ? "border-destructive text-destructive"
                        : "border-border text-muted-foreground",
                  )}
                  onClick={() => setIndex(i)}
                  type="button"
                >
                  {i + 1}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <Button disabled={working !== null} onClick={read} ref={uploadRef} size="lg">
          {working ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <ScanText aria-hidden="true" />
          )}
          {working ?? (count === 1 ? "Read receipt" : `Read ${count} receipts`)}
        </Button>
      </div>

      <ConfirmDialog
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        description={
          count === 1
            ? "It hasn't been uploaded. A photo taken here isn't saved anywhere else."
            : "They haven't been uploaded. Photos taken here aren't saved anywhere else."
        }
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          onCancel();
        }}
        onOpenChange={setConfirmClose}
        open={confirmClose}
        title={count === 1 ? "Discard this photo?" : `Discard ${count} photos?`}
      />
    </FullScreen>
  );
}
