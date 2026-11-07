"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check } from "lucide-react";
import { useId } from "react";
import { GROUP_COLOR_LABEL, GROUP_COLORS, GROUP_DOT_CLASS, type GroupColor } from "./group-colors";

/** The palette as a radio group: arrow keys move between colours. */
export function ColorField({
  value,
  onChange,
  disabled,
}: {
  value: GroupColor;
  onChange: (color: GroupColor) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-xs text-muted-foreground">Colour</legend>
      <div className="flex flex-wrap gap-1">
        {GROUP_COLORS.map((color) => (
          <label
            className="relative flex size-9 cursor-pointer items-center justify-center rounded-full has-focus-visible:ring-2 has-focus-visible:ring-ring max-md:size-11"
            key={color}
          >
            <input
              checked={value === color}
              className="sr-only"
              name={name}
              onChange={() => onChange(color)}
              type="radio"
              value={color}
            />
            <span
              aria-hidden="true"
              className={cn(
                "flex size-6 items-center justify-center rounded-full ring-offset-2 ring-offset-popover",
                GROUP_DOT_CLASS[color],
                value === color && "ring-2 ring-foreground",
              )}
            >
              {value === color ? <Check className="size-3.5 text-background" /> : null}
            </span>
            <span className="sr-only">{GROUP_COLOR_LABEL[color]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
