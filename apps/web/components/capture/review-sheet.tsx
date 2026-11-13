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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  editFromDetection,
  editKey,
  isDetected,
  isFullFrame,
  resetToDetected,
  rotateClockwise,
  fullImage,
  type EditState,
} from "@/lib/capture/edit-state";
import { FILTER_LABELS, FILTERS, type Filter } from "@/lib/capture/filters";
import type { CropSource } from "@/lib/capture/crop-outcome";
import { EditFailedError, encodeOptions, preparePhoto } from "@/lib/capture/prepare-photo";
import {
  detectOnBitmap,
  dropRenderCache,
  FULL_RENDER,
  loadImage,
  releaseCanvas,
  renderedSize,
  renderEdit,
  renderPreview,
  THUMB_RENDER,
} from "@/lib/capture/render";
import { ENCODING, TooLargeError } from "@/lib/upload-encoding";
import {
  chosenOption,
  encodeUpload,
  SIZE_IDS,
  uploadInfo,
  uploadPlan,
  type SizeId,
  type UploadPlan,
} from "@/lib/upload-prep";
import { CropEditor } from "./crop-editor";
import { FullScreen } from "./full-screen";
import { FullSizeView } from "./full-size-view";
import { ResultPreview } from "./result-preview";
import { Bytes, formatSize, SIZE_LABELS, SizePicker, Slot } from "./size-picker";

type Step = "adjust" | "preview";

export type ReviewImage = { id: string; blob: Blob; name: string; source?: CropSource };

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

function startingEdit(bitmap: ImageBitmap): EditState {
  return editFromDetection(detectOnBitmap(bitmap), rememberedFilter());
}

/** Wait after the last edit before the full-size render, which blocks the main thread. */
const ENCODE_DELAY_MS = 400;
const CAP_LABEL = (() => {
  const { value, unit } = formatSize(ENCODING.hardCapBytes);
  return `${value} ${unit}`;
})();

type EncodeFailure = "too-large" | "failed";
/**
 * The real uploads of one photo's edit, one per size option, made from a single full-size
 * render. They are what the preview, the size line and the full-size view show, and what
 * Upload sends.
 */
type Encodes = {
  key: string;
  plan: UploadPlan;
  files: Partial<Record<SizeId, File>>;
  failed: Partial<Record<SizeId, EncodeFailure>>;
};

/** An object URL for `blob` while it is shown, revoked once it is replaced or unmounted. */
function useObjectUrl(blob: Blob | null) {
  const [made, setMade] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // A URL needs revoking, so it is made here rather than during render (Strict Mode safe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMade({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return made && made.blob === blob ? made.url : null;
}

type Loaded = { id: string; bitmap: ImageBitmap };
type HeldBack = "edit" | "too-large";

/**
 * Every photo is checked here before upload, in two steps like a document scanner: adjust the
 * corners (and turn), then preview the flattened page with a filter. The preview step encodes the
 * real upload, so the picture, the size and the full-size view all show the file that will be
 * sent. The layout never changes size between actions: the stage is a fixed box, and every row
 * around it reserves its space.
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
  // Kept after an edit until the new encode lands, so the size line shows the last values dimmed.
  const [encodes, setEncodes] = useState<Record<string, Encodes>>({});
  // Photos that couldn't be sent; held back until the edit changes or Upload succeeds.
  const [heldBack, setHeldBack] = useState<Record<string, HeldBack>>({});
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
  const inspectRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const job = useRef<{ token: string; cancel: () => void } | null>(null);

  const current = images[Math.min(index, images.length - 1)];
  const edit = current ? edits[current.id] : undefined;
  const bitmap = loaded && current && loaded.id === current.id ? loaded.bitmap : null;
  // The upload sizes, from the shape of the crop alone: known at once, before any encode.
  const plan = useMemo(
    () => (bitmap && edit ? uploadPlan(renderedSize(bitmap, edit, FULL_RENDER)) : null),
    [bitmap, edit],
  );
  const chosen = plan ? chosenOption(plan, size) : null;

  // After the viewer closes, once the preview is no longer inert: focus can't land before that.
  useEffect(() => {
    if (fullSize || !returnFocus.current) return;
    returnFocus.current = false;
    inspectRef.current?.focus();
  }, [fullSize]);

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

  // Encodes the real uploads for this edit (preview step only): the chosen size first, then the
  // other options from the same render, so the picker shows real bytes. A new edit, photo or
  // choice cancels the run and starts one for what is missing. Upload encodes what it needs
  // itself, so no run competes with it for the main thread.
  useEffect(() => {
    if (step !== "preview" || !bitmap || !edit || !current || !chosen || working !== null) {
      job.current?.cancel();
      job.current = null;
      return;
    }
    const key = editKey(edit);
    const token = `${current.id}|${key}|${chosen.id}`;
    if (job.current?.token === token) return;
    const entry = encodes[current.id]?.key === key ? encodes[current.id] : undefined;
    const missing = [chosen.id, ...plan!.options.map((o) => o.id)].filter(
      (id, i, all) => all.indexOf(id) === i && !entry?.files[id] && !entry?.failed[id],
    );
    job.current?.cancel();
    job.current = null;
    if (missing.length === 0) return;
    const id = current.id;
    const name = current.name;
    const source = current.source;
    let cancelled = false;
    const record = (sizeId: SizeId, result: File | EncodeFailure, made: UploadPlan) =>
      setEncodes((all) => {
        const prev = all[id]?.key === key ? all[id]! : { key, plan: made, files: {}, failed: {} };
        return {
          ...all,
          [id]:
            typeof result === "string"
              ? { ...prev, failed: { ...prev.failed, [sizeId]: result } }
              : { ...prev, files: { ...prev.files, [sizeId]: result } },
        };
      });
    const timer = window.setTimeout(async () => {
      let canvas: HTMLCanvasElement | undefined;
      try {
        canvas = renderEdit(bitmap, edit, FULL_RENDER);
        const made = uploadPlan(canvas);
        for (const sizeId of missing) {
          if (cancelled) return;
          try {
            const file = await encodeUpload(
              canvas,
              name,
              encodeOptions(edit, sizeId, { seen: true, source }),
            );
            if (!cancelled) record(sizeId, file, made);
          } catch (error) {
            if (!cancelled)
              record(sizeId, error instanceof TooLargeError ? "too-large" : "failed", made);
          }
        }
      } catch {
        // Out of canvas memory: Upload tries again, one photo at a time.
        if (!cancelled && plan) for (const sizeId of missing) record(sizeId, "failed", plan);
      } finally {
        if (canvas) releaseCanvas(canvas);
      }
    }, ENCODE_DELAY_MS);
    job.current = {
      token,
      cancel: () => {
        cancelled = true;
        window.clearTimeout(timer);
      },
    };
  }, [step, bitmap, edit, current, chosen, plan, encodes, working]);

  // Stops a run when the sheet closes.
  useEffect(() => () => job.current?.cancel(), []);

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

  const entry = current ? encodes[current.id] : undefined;
  const fresh = entry && edit && entry.key === editKey(edit) ? entry : undefined;
  const chosenFile = fresh && chosen ? (fresh.files[chosen.id] ?? null) : null;
  const chosenFailure = fresh && chosen ? fresh.failed[chosen.id] : undefined;
  const uploadUrl = useObjectUrl(chosenFile);

  // Brings the picker into view on a short phone, where it would open below the fold.
  useEffect(() => {
    if (sizeOpen) pickerRef.current?.scrollIntoView({ block: "nearest" });
  }, [sizeOpen]);

  function chooseSize(next: SizeId) {
    rememberSize(next);
    setSize(next);
  }

  function update(next: EditState) {
    if (!current) return;
    setEdits((all) => ({ ...all, [current.id]: next }));
    const id = current.id;
    setHeldBack((all) => {
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

  function closeFullSize() {
    setFullSize(false);
    returnFocus.current = true;
  }

  /** Back one step, then close: the header arrow and Escape do the same. */
  function back() {
    if (fullSize) closeFullSize();
    else if (step === "preview") setStep("adjust");
    else setConfirmClose(true);
  }

  /**
   * Encodes every photo, reusing the preview's encode where nothing changed. A photo whose edit
   * can't be encoded is never swapped for the original, and one still over the hard cap is never
   * sent: the sheet stays open on it with an error, and nothing is sent until it is fixed or
   * deleted.
   */
  async function upload() {
    const files: File[] = [];
    const held: Record<string, HeldBack> = {};
    job.current?.cancel();
    job.current = null;
    setUploadError(null);
    try {
      for (const [i, image] of images.entries()) {
        setWorking(`Preparing ${i + 1} of ${images.length}…`);
        const saved = edits[image.id];
        const ready = encodes[image.id];
        if (saved && ready?.key === editKey(saved)) {
          const file = ready.files[chosenOption(ready.plan, size).id];
          if (file) {
            files.push(file);
            continue;
          }
        }
        try {
          files.push(await preparePhoto(image, saved, startingEdit, size));
        } catch (error) {
          if (error instanceof TooLargeError) held[image.id] = "too-large";
          else if (error instanceof EditFailedError) held[image.id] = "edit";
          else throw error;
        }
      }
    } finally {
      setWorking(null);
    }
    const heldIds = images.filter((image) => image.id in held).map((image) => image.id);
    if (heldIds.length > 0) {
      setHeldBack(held);
      setIndex(images.findIndex((image) => image.id === heldIds[0]));
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

  const count = images.length;
  const total = count + alsoReading.length;
  const position = Math.min(index, count - 1) + 1;
  const adjusting = step === "adjust";
  const held = current ? heldBack[current.id] : undefined;
  // Same photo, new crop: the old strip stays until the new one is drawn.
  const stripThumbs = current && thumbs?.key.startsWith(`${current.id}:`) ? thumbs.urls : {};
  const choosable = plan !== null && plan.options.length > 1;
  // The last real file for this photo at this choice, shown dimmed while a new one is encoded.
  const staleFile = !fresh && entry && chosen ? entry.files[chosen.id] : undefined;
  const shownFile = chosenFile ?? staleFile ?? null;
  const info = chosenFile ? uploadInfo(chosenFile) : undefined;
  const shownSize = info ?? chosen;
  const busy = plan !== null && !chosenFile && !chosenFailure;
  const pickerOptions = plan
    ? plan.options.map((option) => ({ ...option, bytes: fresh?.files[option.id]?.size }))
    : [];

  const tool = "min-h-11 flex-1 px-1 text-xs md:justify-start md:px-3 md:text-sm";

  const sizeText = shownSize ? (
    <span data-testid="resolution">
      <Slot>{shownSize.width}</Slot> × <Slot>{shownSize.height}</Slot> px ·{" "}
      {chosenFailure === "too-large" ? (
        `over ${CAP_LABEL}`
      ) : (
        <Bytes bytes={chosenFailure ? null : shownFile?.size} />
      )}
    </span>
  ) : null;

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
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b border-border px-2 py-2 md:hidden",
          fullSize && "hidden",
        )}
      >
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
          className={cn(
            "relative shrink-0 bg-muted/40 md:h-auto md:min-w-0 md:flex-1",
            // On a phone the full-size view takes the whole screen; on desktop the stage.
            fullSize ? "max-md:flex-1" : "h-[clamp(12rem,40svh,34rem)]",
          )}
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
              ) : (
                <>
                  <div className="size-full" inert={fullSize}>
                    <ResultPreview
                      bitmap={bitmap}
                      edit={edit}
                      inspectRef={inspectRef}
                      onInspect={() => setFullSize(true)}
                      upload={uploadUrl}
                    />
                  </div>
                  {fullSize ? (
                    <FullSizeView
                      failed={chosenFailure !== undefined}
                      file={chosenFile}
                      onDone={closeFullSize}
                      url={uploadUrl}
                    />
                  ) : null}
                </>
              )
            ) : (
              <p className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
                {/* One line per step, so switching photos doesn't show two in a row. */}
                {adjusting ? "Finding the receipt…" : "Preparing the preview…"}
              </p>
            )}
          </div>
        </div>

        <div
          className={cn(
            "mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col overflow-y-auto gap-3 px-3 pt-3 pb-3 md:max-w-none md:flex-none md:basis-88 md:border-l md:border-border md:p-5",
            fullSize && "max-md:hidden",
          )}
        >
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

          {/* The same height in both steps, so nothing below it moves when the step changes. */}
          <div className="h-[5.5rem] shrink-0 md:h-64" data-testid="controls">
            {adjusting ? (
              <div className="grid grid-cols-3 gap-1 md:grid-cols-1">
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
                        // eslint-disable-next-line @next/next/no-img-element -- a local blob: URL
                        <img alt="" className="size-full object-cover" src={stripThumbs[filter]} />
                      ) : null}
                    </span>
                    {FILTER_LABELS[filter]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* The size line and hint: a fixed block in both steps; only the open picker adds to it. */}
          <div
            className="min-h-[5.75rem] shrink-0 text-center text-xs text-muted-foreground md:min-h-20 md:text-left"
            data-testid="hint"
          >
            {adjusting ? (
              <p className="pt-1">
                Drag a corner or the middle of a side to the edge of the receipt. You can also
                select one and use the arrow keys.
              </p>
            ) : (
              <>
                <div
                  aria-busy={busy}
                  className={cn(
                    "flex h-11 items-center justify-center whitespace-nowrap transition-opacity motion-reduce:transition-none md:h-8 md:justify-start",
                    busy && shownFile && "opacity-60",
                  )}
                >
                  {choosable ? (
                    <button
                      aria-controls="upload-size"
                      aria-expanded={sizeOpen}
                      className="-mx-2 inline-flex h-full items-center gap-1 rounded-md px-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid="size-change"
                      onClick={() => setSizeOpen((open) => !open)}
                      type="button"
                    >
                      {sizeText}
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
                    <p>{sizeText}</p>
                  )}
                </div>
                {sizeOpen && choosable ? (
                  <div className="mt-1 mb-2 text-left" ref={pickerRef}>
                    <SizePicker
                      id="upload-size"
                      onChange={chooseSize}
                      options={pickerOptions}
                      photos={count}
                      value={chosen!.id}
                    />
                  </div>
                ) : null}
                <p className="h-12">
                  {plan?.long ? "Long receipt: sent at the highest size the model reads. " : null}
                  {fullSize ? null : "Tap the preview to see exactly what uploads."}
                  {edit?.filter === "bw"
                    ? chosen?.id === "compact" || chosen?.id === "smaller"
                      ? ` At ${SIZE_LABELS[chosen.id]}, B&W can lose light print.`
                      : " B&W suits faded receipts but can lose light print."
                    : null}
                </p>
              </>
            )}
          </div>

          {held === "edit" ? (
            <Alert className="px-3 py-2 text-sm" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <p>
                This photo&apos;s crop, turn or filter couldn&apos;t be saved on this device, so it
                wasn&apos;t sent. Try Upload again, change the edit, or delete the photo.
              </p>
            </Alert>
          ) : held === "too-large" ? (
            <Alert className="px-3 py-2 text-sm" variant="destructive">
              <CircleAlert aria-hidden="true" />
              <p>
                This photo is still over {CAP_LABEL} after compressing, so it wasn&apos;t sent. Crop
                closer to the receipt, or delete the photo.
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
                        heldBack[image.id] ? `Photo ${i + 1}, not sent` : `Photo ${i + 1}`
                      }
                      className={cn(
                        "flex size-11 items-center justify-center rounded-md border-2 font-mono text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        i === index
                          ? "border-primary text-foreground"
                          : heldBack[image.id]
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
              data-testid="primary"
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
