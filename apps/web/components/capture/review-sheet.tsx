"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ArrowLeft, Loader2, Maximize, RotateCw, ScanLine, ScanText, Trash2 } from "lucide-react";
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
import {
  canvasToJpeg,
  detectOnBitmap,
  FULL_RENDER,
  jpegName,
  loadImage,
  renderEdit,
  THUMB_RENDER,
} from "@/lib/capture/render";
import { prepareFile } from "@/lib/upload-prep";
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

async function encode(bitmap: ImageBitmap, edit: EditState, name: string) {
  const jpeg = await canvasToJpeg(renderEdit(bitmap, edit, FULL_RENDER), jpegName(name));
  return prepareFile(jpeg);
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Loaded = { id: string; bitmap: ImageBitmap };
type Encoded = { key: string; file: File };

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
  const [encoded, setEncoded] = useState<Record<string, Encoded>>({});
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

  // The upload size for this edit, by encoding it for real (debounced while dragging).
  useEffect(() => {
    if (!bitmap || !edit || !current) return;
    const key = editKey(edit);
    if (encoded[current.id]?.key === key) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      encode(bitmap, edit, current.name)
        .then((file) => {
          if (!cancelled) setEncoded((all) => ({ ...all, [current.id]: { key, file } }));
        })
        // No estimate this time; the upload encodes again.
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bitmap, edit, current, encoded]);

  // Small previews of each filter on the current crop.
  const shapeKey = edit ? editKey({ ...edit, filter: "original" }) : "";
  useEffect(() => {
    if (!bitmap || !edit) return;
    const timer = window.setTimeout(() => {
      const next: Partial<Record<Filter, string>> = {};
      for (const filter of FILTERS) {
        next[filter] = renderEdit(bitmap, { ...edit, filter }, THUMB_RENDER).toDataURL(
          "image/jpeg",
          0.8,
        );
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

  async function upload() {
    const files: File[] = [];
    try {
      for (const [i, image] of images.entries()) {
        setWorking(`Preparing ${i + 1} of ${images.length}…`);
        const saved = edits[image.id];
        const cached = encoded[image.id];
        if (saved && cached?.key === editKey(saved)) {
          files.push(cached.file);
          continue;
        }
        let bmp: ImageBitmap | null = null;
        try {
          bmp = await loadImage(image.blob);
          files.push(await encode(bmp, saved ?? startingEdit(bmp), image.name));
        } catch {
          // Undecodable here: send the original and let the server judge it, like any upload.
          files.push(
            await prepareFile(new File([image.blob], image.name, { type: image.blob.type })),
          );
        } finally {
          bmp?.close();
        }
      }
    } finally {
      setWorking(null);
    }
    onUpload(files);
  }

  const estimate = current && edit ? encoded[current.id] : undefined;
  const fresh = estimate && edit && estimate.key === editKey(edit);
  const count = images.length;

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

        <p aria-live="polite" className="min-h-4 text-center text-xs text-muted-foreground">
          {fresh ? (
            <>
              About <span className="font-mono tabular-nums">{formatSize(estimate.file.size)}</span>{" "}
              to upload.
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
                  aria-label={`Photo ${i + 1}`}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-md border-2 font-mono text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    i === index
                      ? "border-primary text-foreground"
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

        <Button disabled={working !== null} onClick={() => void upload()} ref={uploadRef} size="lg">
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
