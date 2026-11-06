import type { CurrencySpend, RangePreset, SpendRange, SpendSearch } from "@receipt-ocr/core";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";
import { cn } from "@receipt-ocr/ui/lib/utils";
import Form from "next/form";
import Link from "next/link";
import type { ReactNode } from "react";
import { homeHref } from "./links";

const PRESETS: { id: Exclude<RangePreset, "custom">; label: string }[] = [
  { id: "30d", label: "30 days" },
  { id: "3m", label: "3 months" },
  { id: "12m", label: "12 months" },
  { id: "ytd", label: "Year to date" },
];

const chip =
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm outline-none transition hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11";
const chipOn = "border-primary/40 bg-primary/10 text-foreground";
const chipOff = "border-border text-muted-foreground";

/**
 * One filter row above everything it scopes: range, comparison and currency.
 * Every control is a link (or a GET form), so a view can be shared and
 * reloaded. `group` is the slot for the receipt-group filter once groups ship.
 */
export function DashboardControls({
  search,
  range,
  currencies,
  selected,
  convertedTo,
  group,
}: {
  search: SpendSearch;
  range: SpendRange;
  currencies: CurrencySpend[];
  selected: string | null;
  /** "All, in <currency>" once FX conversion ships; hidden until then. */
  convertedTo?: string;
  group?: ReactNode;
}) {
  // Changing the range keeps the currency, and the other way round.
  const base: SpendSearch = { compare: search.compare, currency: search.currency };
  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Date range" className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Link
              aria-current={range.preset === preset.id ? "true" : undefined}
              className={cn(chip, range.preset === preset.id ? chipOn : chipOff)}
              href={homeHref(base, { range: preset.id })}
              key={preset.id}
              scroll={false}
            >
              {preset.label}
            </Link>
          ))}
        </nav>
        <CustomRange base={base} range={range} />
        <Link
          className={cn(chip, chipOff)}
          href={homeHref(search, { compare: range.compare ? "0" : undefined })}
          scroll={false}
        >
          {range.compare ? "Hide comparison" : "Compare with previous period"}
        </Link>
        {group}
      </div>
      {currencies.length > 1 || convertedTo ? (
        <nav aria-label="Currency" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {convertedTo ? <span className={cn(chip, chipOff)}>All, in {convertedTo}</span> : null}
          {currencies.map((c) => (
            <Link
              aria-current={c.currency === selected ? "true" : undefined}
              className={cn(chip, c.currency === selected ? chipOn : chipOff)}
              href={homeHref(search, { currency: c.currency })}
              key={c.currency}
              scroll={false}
            >
              <span className="font-mono">{c.currency}</span>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {c.count}
                <span className="sr-only"> {c.count === 1 ? "receipt" : "receipts"}</span>
              </span>
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function CustomRange({ base, range }: { base: SpendSearch; range: SpendRange }) {
  const active = range.preset === "custom";
  return (
    <details className="group" open={active}>
      <summary
        aria-current={active ? "true" : undefined}
        className={cn(
          chip,
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          active ? chipOn : chipOff,
        )}
      >
        Custom dates
      </summary>
      <Form
        action="/app"
        className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
        scroll={false}
      >
        <input name="range" type="hidden" value="custom" />
        {base.currency ? <input name="currency" type="hidden" value={base.currency} /> : null}
        {base.compare ? <input name="compare" type="hidden" value={base.compare} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="spend-from">From</Label>
          <Input
            className="w-40"
            defaultValue={active ? range.from : undefined}
            id="spend-from"
            name="from"
            required
            type="date"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="spend-to">To</Label>
          <Input
            className="w-40"
            defaultValue={active ? range.to : undefined}
            id="spend-to"
            name="to"
            required
            type="date"
          />
        </div>
        <button className={buttonVariants({ variant: "outline" })} type="submit">
          Show
        </button>
      </Form>
    </details>
  );
}
