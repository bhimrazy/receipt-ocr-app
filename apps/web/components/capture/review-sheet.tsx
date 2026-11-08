"use client";

import { Alert } from "@receipt-ocr/ui/components/alert";
import { Button } from "@receipt-ocr/ui/components/button";
import { ConfirmDialog } from "@receipt-ocr/ui/components/confirm-dialog";
import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  ArrowLeft,
  ChevronDown,
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
  dropRenderCache,
  FULL_RENDER,
  loadImage,
  renderedSize,
  renderPreview,
  renderSmall,
  renderToJpeg,
  THUMB_RENDER,
  type RenderBudget,
} from "@/lib/capture/render";
import {
  planSize,
  predictEncode,
  prepareFile,
  shortEdge,
  SIZE_IDS,
  sizeOptions,
  START_QUALITY,
  type SizeId,
} from "@/lib/upload-prep";
import { CropEditor } from "./crop-editor";
import { FullScreen } from "./full-screen";
import { FullSizeView } from "./full-size-view";
import { ResultPreview } from "./result-preview";
import { formatSize, SizePicker, type SizedOption } from "./size-picker";

type Step = "adjust" | "preview";

export type ReviewImage = { id: string; blob: Blob; name: string };

const FILTER_KEY = "receipt-ocr.capture.filter";
const SIZE_KEY = "receipt-ocr.capture.size";

/** A choice saved earlier this session, if it is still one of `allowed`. */
function remembered<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const value = sessionStorage.getItem(key);
    return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : null;
  } catch {
    return null;
  }
}

// One setter per key, so the storage registry test can find each name.
function rememberFilter(filter: Filter) {
  try {
    sessionStorage.setItem(FILTER_KEY, filter);
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}

function rememberSize(size: SizeId) {
  try {
    sessionStorage.setItem(SIZE_KEY, size);
  } catch {
    // As above.
  }
}

const rememberedFilter = () => remembered(FILTER_KEY, FILTERS);

/** The starting edit: the detected outline when there is one, and the session's filter. */
function startingEdit(bitmap: ImageBitmap): EditState {
  const { quad } = detectOnBitmap(bitmap);
  return initialEdit(quad, defaultFilter(rememberedFilter(), quad !== null));
}

/** About 0.3 MP: a few milliseconds to render, where the full 16 MP render takes seconds. */
const ESTIMATE_RENDER: RenderBudget = { source: 1_200_000, output: 300_000 };

/**
 * The upload sizes, from a small render: its JPEG bytes per pixel at the upload quality, run
 * through the same loops `prepareFile` uses, for the automatic size and each choice the
 * rendered crop offers. A small copy packs more detail per pixel, so this leans high.
 */
async function estimateUpload(bitmap: ImageBitmap, edit: EditState) {
  const small = await renderSmall(bitmap, edit, ESTIMATE_RENDER, START_QUALITY);
  const bytesPerPixel = small.blob.size / (small.width * small.height);
  // The crop as `prepareFile` will decode it.
  const full = renderedSize(bitmap, edit, FULL_RENDER);
  const auto = await predictEncode(planSize(full.width, full.height), bytesPerPixel);
  const options: SizedOption[] = [];
  for (const option of sizeOptions(full, auto)) {
    if (option.id === "recommended") {
      options.push({ ...option, bytes: auto.bytes });
      continue;
    }
    const kept = await predictEncode(option, bytesPerPixel, { minShort: shortEdge(option) });
    options.push({ ...option, ...kept });
  }
  return { auto, options };
}

/** The cache key for a prepared upload: the edit and the size it was made at. */
const preparedKey = (edit: EditState, size: SizeId) => `${editKey(edit)}|${size}`;

const Mono = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono tabular-nums">{children}</span>
);

type Loaded = { id: string; bitmap: ImageBitmap };
type Estimate = {
  key: string;
  auto: { bytes: number; width: number; height: number };
  /** Empty when there is nothing to choose. */
  options: SizedOption[];
};
type Prepared = { key: string; file: File };

/**
 * Every photo is checked here before upload, in two steps like a document scanner: adjust the
 * corners (and turn), then preview the flattened page with a filter. The result goes through
 * the same `prepareFile` as any picked file. The layout never changes size between actions:
 * the stage is a fixed box, and every row around it reserves its space.
 */
export default function ReviewSheet({
  images: initial,
  onCancel,
  onUpload,
  alsoReading = [],
  preparing = false,
}: {
  images: ReviewImage[];
  onCancel: () => void;
  onUpload: (files: File[]) => void;
  /** Names of PDFs picked with these photos; they upload in the same batch. */
  alsoReading?: string[];
  /** A PDF is still being prepared, so the batch isn't complete yet. */
  preparing?: boolean;
}) {
  const [images, setImages] = useState(initial);
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<Step>("adjust");
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [estimates, setEstimates] = useState<Record<string, Estimate>>({});
  // Files made by an earlier Upload that stopped on a failed photo, reused when nothing changed.
  const [prepared, setPrepared] = useState<Record<string, Prepared>>({});
  // Photos whose edit couldn't be encoded; held back until the edit changes or Upload succeeds.
  const [editFailed, setEditFailed] = useState<Record<string, true>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Tagged with the photo and crop they show, so another photo's strip is never reused.
  const [thumbs, setThumbs] = useState<{
    key: string;
    urls: Partial<Record<Filter, string>>;
  } | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // One upload size for the batch, remembered for the session like the filter.
  const [size, setSize] = useState<SizeId>(() => remembered(SIZE_KEY, SIZE_IDS) ?? "recommended");
  const [sizeOpen, setSizeOpen] = useState(false);
  const [fullSize, setFullSize] = useState(false);
  // The real upload for the full-size view, tagged with the photo, edit and size it shows.
  const [actual, setActual] = useState<{ key: string; url: string | null } | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

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
      if (bmp) {
        dropRenderCache(bmp);
        bmp.close();
      }
    };
  }, [current]);

  // The upload size for this edit, estimated from a small render (preview step only).
  useEffect(() => {
    if (step !== "preview" || !bitmap || !edit || !current) return;
    const key = editKey(edit);
    if (estimates[current.id]?.key === key) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      estimateUpload(bitmap, edit)
        .then(({ auto, options }) => {
          if (!cancelled) {
            setEstimates((all) => ({ ...all, [current.id]: { key, auto, options } }));
          }
        })
        // No estimate this time; the upload still encodes for real.
        .catch(() => {});
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, bitmap, edit, current, estimates]);

  // Small previews of each filter on the flattened crop (preview step only).
  const shapeKey =
    edit && current ? `${current.id}:${editKey({ ...edit, filter: "original" })}` : "";
  useEffect(() => {
    if (step !== "preview" || !bitmap || !edit) return;
    const timer = window.setTimeout(() => {
      const next: Partial<Record<Filter, string>> = {};
      try {
        for (const filter of FILTERS) {
          next[filter] = renderPreview(bitmap, { ...edit, filter }, THUMB_RENDER);
        }
      } catch {
        // Out of canvas memory: the buttons still work without their previews.
      }
      setThumbs({ key: shapeKey, urls: next });
    }, 50);
    return () => window.clearTimeout(timer);
    // Filters only depend on the shape of the crop, not the chosen filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, bitmap, shapeKey]);

  // The full-size view shows the file that will upload, so it is kept for Upload too.
  const fullKey = current && edit ? `${current.id}|${editKey(edit)}|${size}` : "";
  useEffect(() => {
    if (!fullSize || step !== "preview" || !bitmap || !edit || !current) return;
    if (actual?.key === fullKey) return;
    let cancelled = false;
    let url: string | null = null;
    const timer = window.setTimeout(() => {
      renderToJpeg(bitmap, edit, current.name)
        .then((rendered) => prepareFile(rendered, size))
        .then((file) => {
          if (cancelled) return;
          url = URL.createObjectURL(file);
          setActual({ key: fullKey, url });
          setPrepared((all) => ({ ...all, [current.id]: { key: preparedKey(edit, size), file } }));
        })
        .catch(() => {
          if (!cancelled) setActual({ key: fullKey, url: null });
        });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `actual` is what this effect writes; it only needs to rerun when the view or its key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullSize, step, bitmap, fullKey]);

  // Frees the shown file's object URL once it is replaced or the sheet closes.
  useEffect(() => {
    const url = actual?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [actual]);

  function chooseSize(next: SizeId) {
    rememberSize(next);
    setSize(next);
  }

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

  /** Back one step, then close: the header arrow and Escape do the same. */
  function back() {
    if (fullSize) setFullSize(false);
    else if (step === "preview") setStep("adjust");
    else setConfirmClose(true);
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
        const key = saved ? preparedKey(saved, size) : "";
        const cached = prepared[image.id];
        if (saved && cached?.key === key) {
          files.push(cached.file);
          continue;
        }
        try {
          const file = await preparePhoto(image, saved, startingEdit, size);
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

  function send() {
    upload().catch(() => {
      setWorking(null);
      setUploadError("The photos couldn't be prepared. Nothing was uploaded. Try again.");
    });
  }

  function primary() {
    if (step === "adjust") setStep("preview");
    else send();
  }

  function adjust() {
    setFullSize(false);
    setStep("adjust");
  }

  const estimate = current && edit ? estimates[current.id] : undefined;
  const fresh = estimate && edit && estimate.key === editKey(edit);
  const count = images.length;
  const total = count + alsoReading.length;
  const heldBack = (id: string) => editFailed[id] === true;
  const position = Math.min(index, count - 1) + 1;
  const adjusting = step === "adjust";
  const options = fresh ? estimate.options : [];
  // The batch's choice where this photo offers it, else the automatic size.
  const shown = fresh
    ? (options.find((o) => o.id === size) ??
      options.find((o) => o.id === "recommended") ??
      estimate.auto)
    : null;
  const shownBytes = shown ? formatSize(shown.bytes) : null;
  const shownId = options.find((o) => o.id === size) ? size : "recommended";
  const stripThumbs = thumbs?.key === shapeKey ? thumbs.urls : {};

  const tool = "min-h-11 flex-1 px-1 text-xs md:justify-start md:px-3 md:text-sm";

  return (
    <FullScreen
      className="bg-background"
      initialFocus={primaryRef}
      onClose={back}
      open
      title="Review photos"
    >
      <p aria-live="polite" className="sr-only">
        {adjusting ? "Crop" : "Preview"}
      </p>
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-2 md:hidden">
        <Button
          aria-label={adjusting ? "Back without uploading" : "Back to adjust corners"}
          onClick={back}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <div className="min-w-0 text-center">
          <h2 className="text-sm font-medium">{adjusting ? "Adjust corners" : "Preview"}</h2>
          <p className="h-4 text-xs text-muted-foreground tabular-nums">
            {count > 1 ? `Photo ${position} of ${count}` : null}
          </p>
        </div>
        <Button
          aria-label="Delete this photo"
          onClick={() => setConfirmDelete(true)}
          size="icon"
          variant="ghost"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div
          className="relative h-[clamp(12rem,40dvh,34rem)] shrink-0 bg-muted/40 md:h-auto md:min-w-0 md:flex-1"
          data-testid="stage"
        >
          <div className="absolute inset-0 flex flex-col">
            {current && failed[current.id] ? (
              <p className="m-auto max-w-xs px-6 text-center text-sm text-muted-foreground">
                This photo can&apos;t be shown in this browser. It uploads as it is.
              </p>
            ) : bitmap && edit ? (
              adjusting ? (
                <CropEditor bitmap={bitmap} edit={edit} onChange={update} />
              ) : fullSize ? (
                <FullSizeView
                  failed={actual?.key === fullKey && actual.url === null}
                  label={
                    shown
                      ? `Receipt at full size, ${shown.width} × ${shown.height} px`
                      : "Receipt at full size"
                  }
                  onDone={() => setFullSize(false)}
                  url={actual?.key === fullKey ? actual.url : null}
                />
              ) : (
                <ResultPreview bitmap={bitmap} edit={edit} onInspect={() => setFullSize(true)} />
              )
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
        </div>

        <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col overflow-y-auto gap-3 px-3 pt-3 pb-3 md:max-w-none md:flex-none md:basis-88 md:border-l md:border-border md:p-5">
          <div className="hidden items-start gap-2 md:flex">
            <Button
              aria-label={adjusting ? "Back without uploading" : "Back to adjust corners"}
              className="-ml-2"
              onClick={back}
              size="icon"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-medium">{adjusting ? "Adjust corners" : "Preview"}</h2>
              <p className="h-4 text-xs text-muted-foreground tabular-nums">
                {count > 1 ? `Photo ${position} of ${count}` : null}
              </p>
            </div>
            <Button
              aria-label="Delete this photo"
              onClick={() => setConfirmDelete(true)}
              size="icon"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>

          {adjusting ? (
            <div className="grid grid-cols-3 gap-1 md:grid-cols-1" data-testid="controls">
              <Button
                className={tool}
                disabled={!edit}
                onClick={() => edit && update(rotateClockwise(edit))}
                variant="ghost"
              >
                <RotateCw aria-hidden="true" />
                Rotate
              </Button>
              <Button
                aria-label="Reset to detected"
                className={tool}
                disabled={!edit?.detected || isDetected(edit)}
                onClick={() => edit && update(resetToDetected(edit))}
                variant="ghost"
              >
                <ScanLine aria-hidden="true" />
                Reset
              </Button>
              <Button
                aria-label="Use full image"
                className={tool}
                disabled={!edit || isFullFrame(edit.quad)}
                onClick={() => edit && update(fullImage(edit))}
                variant="ghost"
              >
                <Maximize aria-hidden="true" />
                Full image
              </Button>
            </div>
          ) : (
            <div data-testid="controls">
              <div
                aria-label="Filter"
                className="grid grid-cols-4 gap-2 md:grid-cols-2"
                role="group"
              >
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
                        "block h-14 w-full overflow-hidden rounded-md border-2 bg-muted md:h-24",
                        edit?.filter === filter ? "border-primary" : "border-transparent",
                      )}
                    >
                      {stripThumbs[filter] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt="" className="size-full object-cover" src={stripThumbs[filter]} />
                      ) : null}
                    </span>
                    {FILTER_LABELS[filter]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {adjusting ? (
            <p className="min-h-8 text-center text-xs text-muted-foreground md:text-left">
              Drag a corner to the edge of the receipt, or select one and use the arrow keys.
            </p>
          ) : (
            <div className="text-center text-xs text-muted-foreground md:text-left">
              <div className="flex h-11 items-center justify-center md:h-8 md:justify-start">
                {shown && shownBytes && options.length > 0 ? (
                  <button
                    aria-controls="upload-size"
                    aria-expanded={sizeOpen}
                    className="-mx-2 inline-flex h-full items-center gap-1 rounded-md px-2 whitespace-nowrap outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setSizeOpen((open) => !open)}
                    type="button"
                  >
                    <span data-testid="resolution">
                      <Mono>{shown.width}</Mono> × <Mono>{shown.height}</Mono> px · ~
                      <Mono>{shownBytes.value}</Mono> {shownBytes.unit}
                    </span>
                    <span className="text-foreground">· Change</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 text-foreground transition-transform motion-reduce:transition-none",
                        sizeOpen && "rotate-180",
                      )}
                    />
                  </button>
                ) : (
                  <p className="whitespace-nowrap" data-testid="resolution">
                    {shown && shownBytes ? (
                      <>
                        <Mono>{shown.width}</Mono> × <Mono>{shown.height}</Mono> px · ~
                        <Mono>{shownBytes.value}</Mono> {shownBytes.unit}
                      </>
                    ) : edit ? (
                      "sizing…"
                    ) : null}
                  </p>
                )}
              </div>
              {sizeOpen && options.length > 0 ? (
                <div className="mt-1 mb-2 text-left">
                  <SizePicker
                    id="upload-size"
                    onChange={chooseSize}
                    options={options}
                    photos={count}
                    value={shownId}
                  />
                </div>
              ) : null}
              <p className="h-12">
                {fullSize
                  ? "Drag to look around. Done goes back to the whole receipt."
                  : "Tap the preview to see it at full size."}
                {edit?.filter === "bw"
                  ? shownId === "smaller"
                    ? " At 800 px, B&W can lose light print."
                    : " B&W suits faded receipts but can lose light print."
                  : null}
              </p>
            </div>
          )}

          {current && heldBack(current.id) ? (
            <Alert className="px-3 py-2 text-sm" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <p>
                This photo&apos;s crop, turn or filter couldn&apos;t be saved on this device, so it
                wasn&apos;t sent. Try Upload again, change the edit, or delete the photo.
              </p>
            </Alert>
          ) : null}
          {uploadError ? (
            <Alert className="px-3 py-2 text-sm" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <p>{uploadError}</p>
            </Alert>
          ) : null}

          <div className="mt-auto flex flex-col gap-2">
            {count > 1 ? (
              <ul
                aria-label="Photos to upload"
                className="flex justify-center gap-2 overflow-x-auto md:flex-wrap md:justify-start"
              >
                {images.map((image, i) => (
                  <li key={image.id}>
                    <button
                      aria-current={i === index ? "true" : undefined}
                      aria-label={
                        heldBack(image.id) ? `Photo ${i + 1}, not sent` : `Photo ${i + 1}`
                      }
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

            {alsoReading.length > 0 ? (
              <p className="text-center text-xs text-muted-foreground md:text-left">
                Also uploading, as picked:{" "}
                <span className="font-mono">{alsoReading.join(", ")}</span>
              </p>
            ) : null}

            <Button
              disabled={working !== null || (!adjusting && preparing)}
              onClick={primary}
              ref={primaryRef}
              size="lg"
            >
              {working ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : adjusting ? null : (
                <ScanText aria-hidden="true" />
              )}
              {working ??
                (adjusting
                  ? "Next"
                  : total === 1
                    ? "Upload"
                    : preparing
                      ? "Preparing…"
                      : `Upload ${total} receipts`)}
            </Button>
            <Button
              className={cn("min-h-11", adjusting && "invisible")}
              disabled={adjusting}
              onClick={adjust}
              tabIndex={adjusting ? -1 : undefined}
              variant="ghost"
            >
              Adjust corners
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        cancelLabel="Keep it"
        confirmLabel="Delete photo"
        description={
          count === 1
            ? "This was the only photo, so the review closes. Nothing has been uploaded."
            : "It won't be uploaded. Photos taken here aren't saved anywhere else."
        }
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
        onOpenChange={setConfirmDelete}
        open={confirmDelete}
        title={`Delete photo ${position}?`}
      />
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
