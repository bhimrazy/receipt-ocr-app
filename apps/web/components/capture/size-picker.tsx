"use client";

import type { SizeId, SizeOption } from "@/lib/upload-prep";

export const SIZE_LABELS: Record<SizeId, string> = {
  smaller: "Compact",
  recommended: "Standard",
  larger: "Sharpest",
};

/** An option with the bytes of its real encode, once that is done. */
export type SizedOption = SizeOption & { bytes?: number };

/**
 * Number and unit apart, so only the number is set in the mono face (its wide space gaps "500 KB").
 * MB from 1,000 KB, so the number is never more than three characters ("999", "1.0").
 */
export function formatSize(bytes: number) {
  return bytes < 999.5 * 1024
    ? { value: `${Math.max(1, Math.round(bytes / 1024))}`, unit: "KB" }
    : { value: (bytes / (1024 * 1024)).toFixed(1), unit: "MB" };
}

/**
 * A number in a fixed-width mono slot, right-aligned, so a value changing from "800" to "1200",
 * or "…" to "471", never moves what follows it. Pixel sizes stay under 2,576, so four characters.
 */
export function Slot({ children, chars = 4 }: { children: React.ReactNode; chars?: 3 | 4 }) {
  return (
    <span
      className={`inline-block text-right font-mono tabular-nums ${chars === 3 ? "min-w-[3ch]" : "min-w-[4ch]"}`}
    >
      {children}
    </span>
  );
}

/**
 * "471 KB" from a real encode, in the same width as its placeholders: "…" while it is being
 * made (undefined), "–" when it couldn't be made (null).
 */
export function Bytes({ bytes }: { bytes: number | null | undefined }) {
  const size = typeof bytes === "number" ? formatSize(bytes) : null;
  return (
    <>
      <Slot chars={3}>{size ? size.value : bytes === null ? "–" : "…"}</Slot>{" "}
      {size ? size.unit : "KB"}
    </>
  );
}

/**
 * The upload size choice: a native radio group, so arrow keys and screen readers work as usual.
 * Equal segments on a phone (the numbers wrap under the label), a list in the desktop side panel.
 */
export function SizePicker({
  id,
  options,
  value,
  onChange,
  photos,
}: {
  id: string;
  options: SizedOption[];
  value: SizeId;
  onChange: (value: SizeId) => void;
  /** Photos in the batch; the choice applies to all of them. */
  photos: number;
}) {
  return (
    <div className="flex flex-col gap-2" id={id}>
      <fieldset className="flex gap-1 rounded-lg border border-border bg-card p-1 md:flex-col">
        <legend className="sr-only">Upload size</legend>
        {options.map((option) => (
          <label
            className="relative flex min-h-11 min-w-0 flex-1 basis-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-xs text-muted-foreground transition-colors has-checked:bg-primary/10 has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring md:flex-row md:justify-start md:gap-2 md:px-2 md:py-0"
            key={option.id}
          >
            <input
              checked={value === option.id}
              className="peer sr-only"
              name="upload-size"
              onChange={() => onChange(option.id)}
              type="radio"
              value={option.id}
            />
            <span
              aria-hidden="true"
              className="hidden size-3.5 shrink-0 rounded-full border border-muted-foreground peer-checked:border-4 peer-checked:border-primary md:inline-block"
            />
            {/* The spaces between flex items don't render; they keep the radio's name readable. */}
            <span className="font-medium whitespace-nowrap">{SIZE_LABELS[option.id]}</span>{" "}
            <span className="flex flex-col items-center whitespace-nowrap md:ml-auto md:flex-row md:gap-1">
              <span>
                <span className="font-mono tabular-nums">{option.width}</span> ×{" "}
                <span className="font-mono tabular-nums">{option.height}</span>
              </span>{" "}
              <span>
                <span aria-hidden="true" className="hidden md:inline">
                  ·{" "}
                </span>
                <Bytes bytes={option.bytes} />
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="text-center text-xs text-muted-foreground md:text-left">
        Blurry text or lost detail? Pick Sharpest.
        {photos > 1 ? ` Applies to all ${photos} photos.` : null}
      </p>
    </div>
  );
}
