"use client";

import { shortEdge, type SizeId, type SizeOption } from "@/lib/upload-prep";

export const SIZE_LABELS: Record<SizeId, string> = {
  smaller: "Smaller",
  recommended: "Recommended",
  larger: "Larger",
};

export type SizedOption = SizeOption & { bytes: number };

/** Number and unit apart, so only the number is set in the mono face (its wide space gaps "500 KB"). */
export function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? { value: `${Math.max(1, Math.round(bytes / 1024))}`, unit: "KB" }
    : { value: (bytes / (1024 * 1024)).toFixed(1), unit: "MB" };
}

/**
 * The upload size choice: a native radio group, so arrow keys and screen readers work as usual.
 * Segments on a phone, a list in the desktop side panel.
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
        {options.map((option) => {
          const size = formatSize(option.bytes);
          return (
            <label
              className="relative flex min-h-11 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-md px-1 text-xs text-muted-foreground transition-colors has-checked:bg-primary/10 has-checked:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring md:flex-row md:justify-start md:gap-2 md:px-2"
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
              <span className="font-medium">{SIZE_LABELS[option.id]}</span>
              <span className="whitespace-nowrap md:ml-auto">
                <span className="font-mono tabular-nums">{shortEdge(option)}</span> px · ~
                <span className="font-mono tabular-nums">{size.value}</span> {size.unit}
              </span>
            </label>
          );
        })}
      </fieldset>
      <p className="text-center text-xs text-muted-foreground md:text-left">
        Blurry text or lost detail? Pick a larger size.
        {photos > 1 ? ` Applies to all ${photos} photos.` : null}
      </p>
    </div>
  );
}
