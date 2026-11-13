"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type Ref } from "react";
import type { EditState } from "@/lib/capture/edit-state";
import { FILTER_LABELS, type Filter } from "@/lib/capture/filters";
import { PREVIEW_RENDER, renderPreview } from "@/lib/capture/render";

type Frame = { url: string; filter: Filter; source: "render" | "upload" };

/**
 * The receipt as it will upload: rotated, cropped to the corners, with the chosen filter. Once
 * the real upload for this edit is encoded (`upload`), that file is shown; until then, a quick
 * render of the edit. Each new frame is decoded off screen and then swapped in, so the image
 * never blanks or flashes between filters.
 */
export function ResultPreview({
  bitmap,
  edit,
  upload,
  onInspect,
  inspectRef,
}: {
  bitmap: ImageBitmap;
  edit: EditState;
  /** Object URL of the encoded upload for exactly this edit and size, once it exists. */
  upload: string | null;
  /** Opens the full-size view. */
  onInspect: () => void;
  inspectRef?: Ref<HTMLButtonElement>;
}) {
  const [frame, setFrame] = useState<Frame | null>(null);

  useEffect(() => {
    let cancelled = false;
    const filter = edit.filter;
    const show = (url: string, source: Frame["source"]) => {
      const img = new Image();
      img.src = url;
      img
        .decode()
        .catch(() => {})
        .then(() => {
          if (!cancelled) setFrame({ url, filter, source });
        });
    };
    if (upload) {
      show(upload, "upload");
      return () => {
        cancelled = true;
      };
    }
    // Let the pressed filter paint as selected before the render blocks the main thread.
    const timer = window.setTimeout(() => {
      try {
        // A data URL, so there is no object URL to revoke early.
        show(renderPreview(bitmap, edit, PREVIEW_RENDER, 0.85), "render");
      } catch {
        // Out of canvas memory: keep the last frame.
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bitmap, edit, upload]);

  if (!frame) {
    return (
      <p className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        Preparing the preview…
      </p>
    );
  }
  return (
    <div className="relative size-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob: URL */}
      <img
        alt={`Receipt preview, ${FILTER_LABELS[frame.filter]}`}
        className="absolute inset-0 size-full object-contain p-3"
        data-filter={frame.filter}
        data-source={frame.source}
        src={frame.url}
      />
      <button
        aria-label="See it at full size"
        className="absolute inset-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onInspect}
        ref={inspectRef}
        type="button"
      />
    </div>
  );
}
