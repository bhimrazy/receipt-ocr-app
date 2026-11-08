"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";

export type BillingInterval = "month" | "year";

const OPTIONS: { value: BillingInterval; label: string; note?: string }[] = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly", note: "2 months free" },
];

/** Monthly / yearly switch: a native radio group, so arrow keys and screen readers work as usual. */
export function IntervalToggle({
  value,
  onChange,
  name = "billing-interval",
  className,
}: {
  value: BillingInterval;
  onChange: (value: BillingInterval) => void;
  name?: string;
  className?: string;
}) {
  return (
    <fieldset
      className={cn("inline-flex rounded-lg border border-border bg-card p-1 text-sm", className)}
    >
      <legend className="sr-only">Billing period</legend>
      {OPTIONS.map((option) => (
        <label
          className="relative flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-4 font-medium text-muted-foreground transition-colors has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:ring-2 has-focus-visible:ring-ring"
          key={option.value}
        >
          <input
            checked={value === option.value}
            className="sr-only"
            name={name}
            onChange={() => onChange(option.value)}
            type="radio"
            value={option.value}
          />
          {option.label}
          {option.note ? <span className="font-mono text-xs">{option.note}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}
