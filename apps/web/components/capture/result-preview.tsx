"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { EditState } from "@/lib/capture/edit-state";
import { FILTER_LABELS, type Filter } from "@/lib/capture/filters";
import { PREVIEW_RENDER, renderPreview } from "@/lib/capture/render";

/**
 * The receipt as it will upload: rotated, cropped to the corners, with the chosen filter.
 * A new frame is rendered and decoded off screen, then swapped in, so the shown image never
 * blanks or flashes between filters. Data URLs mean there is no object URL to revoke early.
 */
export function ResultPreview({
  bitmap,
  edit,
  onInspect,
}: {
  bitmap: ImageBitmap;
  edit: EditState;
  /** Opens the full-size view. */
  onInspect: () => void;
}) {
  const [frame, setFrame] = useState<{ url: string; filter: Filter } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Let the pressed filter paint as selected before the render blocks the main thread.
    const timer = window.setTimeout(() => {
      const filter = edit.filter;
      let url: string;
      try {
        url = renderPreview(bitmap, edit, PREVIEW_RENDER, 0.85);
      } catch {
        // Out of canvas memory: keep the last frame.
        return;
      }
      const img = new Image();
      img.src = url;
      img
        .decode()
        .catch(() => {})
        .then(() => {
          if (!cancelled) setFrame({ url, filter });
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bitmap, edit]);

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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={`Receipt preview, ${FILTER_LABELS[frame.filter]}`}
        className="absolute inset-0 size-full object-contain p-3"
        data-filter={frame.filter}
        src={frame.url}
      />
      <button
        aria-label="See it at full size"
        className="absolute inset-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onInspect}
        type="button"
      />
    </div>
  );
}
