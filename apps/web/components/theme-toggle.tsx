"use client";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@receipt-ocr/ui/components/dropdown-menu";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useRef, useSyncExternalStore } from "react";
import {
  readThemePreference,
  setThemePreference,
  subscribeThemePreference,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** The stored choice; null while server rendering, when it can't be known. */
function useThemePreference() {
  return useSyncExternalStore(subscribeThemePreference, readThemePreference, () => null);
}

const groupClass = "inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5";

// The selected segment is told apart by its fill and edge, not by colour alone. The edge is an
// inset ring so it stacks with the focus ring instead of replacing it.
const segmentClass =
  "inline-flex items-center justify-center gap-1.5 rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-background aria-checked:text-foreground aria-checked:inset-ring aria-checked:inset-ring-border aria-checked:[&_svg]:text-primary [&_svg]:size-4 [&_svg]:shrink-0";

/**
 * System · Light · Dark as a radio group: arrow keys move and select, Tab leaves. `labels` shows
 * the words (Settings); without them the segments are icon-only with an accessible name. Each
 * segment is at least 44px on phones.
 */
export function ThemeToggle({
  labels = false,
  className,
  "aria-labelledby": labelledBy,
}: {
  labels?: boolean;
  className?: string;
  "aria-labelledby"?: string;
}) {
  const preference = useThemePreference();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = OPTIONS.findIndex((o) => o.value === preference);

  function choose(index: number) {
    const option = OPTIONS[(index + OPTIONS.length) % OPTIONS.length]!;
    setThemePreference(option.value);
    refs.current[OPTIONS.indexOf(option)]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const next = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: OPTIONS.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choose(next);
  }

  return (
    <div
      aria-label={labelledBy ? undefined : "Theme"}
      aria-labelledby={labelledBy}
      className={cn(groupClass, className)}
      role="radiogroup"
    >
      {OPTIONS.map(({ value, label, Icon }, index) => (
        <button
          aria-checked={preference === value}
          aria-label={labels ? undefined : label}
          className={cn(
            segmentClass,
            labels ? "min-h-11 flex-1 px-3 text-sm md:min-h-9" : "size-11 md:size-8",
          )}
          key={value}
          onClick={() => choose(index)}
          onKeyDown={(event) => onKeyDown(event, index)}
          ref={(node) => {
            refs.current[index] = node;
          }}
          role="radio"
          tabIndex={index === (selected === -1 ? 0 : selected) ? 0 : -1}
          title={labels ? undefined : label}
          type="button"
        >
          <Icon aria-hidden="true" />
          {labels ? label : null}
        </button>
      ))}
    </div>
  );
}

/** The chosen theme's name, for a row's value; empty while server rendering. */
export function ThemeChoiceLabel() {
  const preference = useThemePreference();
  return preference ? OPTIONS.find((o) => o.value === preference)!.label : null;
}

/**
 * The Theme row of the desktop account menu. Menu radio items, so the menu's own arrow-key
 * navigation reaches them; choosing one keeps the menu open.
 */
export function ThemeMenuRow() {
  const preference = useThemePreference();
  return (
    <div className="flex items-center gap-2 py-1 pr-1 pl-2.5">
      <span aria-hidden="true" className="flex-1 text-sm">
        Theme
      </span>
      <DropdownMenuRadioGroup
        aria-label="Theme"
        className={groupClass}
        onValueChange={(value) => setThemePreference(value as ThemePreference)}
        value={preference ?? "system"}
      >
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuRadioItem
            aria-label={label}
            className="size-8 min-h-0 justify-center rounded-md p-0 pr-0 text-muted-foreground data-checked:bg-background data-checked:text-foreground data-checked:inset-ring data-checked:inset-ring-border data-checked:[&_svg]:text-primary max-md:min-h-0 [&_[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
            key={value}
            title={label}
            value={value}
          >
            <Icon aria-hidden="true" />
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </div>
  );
}
