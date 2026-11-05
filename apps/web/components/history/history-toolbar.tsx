"use client";

import { RECEIPT_CATEGORIES } from "@receipt-ocr/ai/categories";
import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { Field, FieldLabel } from "@receipt-ocr/ui/components/field";
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { isFiltered } from "@/components/history/history-href";
import type { HistoryFilters } from "@/lib/receipts";

const STATUS_CHIPS = [
  { value: undefined, label: "All" },
  { value: "needs-review", label: "Needs review" },
  { value: "failed", label: "Couldn't read" },
  { value: "processing", label: "Reading" },
] as const;

const CATEGORY_ITEMS = [
  { value: null, label: "All categories" },
  ...RECEIPT_CATEGORIES.map((category) => ({
    value: category as string,
    label: category as string,
  })),
];

/** Search box, status chips and the category/date filters; every change updates the URL. */
export function HistoryToolbar({ filters }: { filters: HistoryFilters }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q ?? "");
  // Keep the box in step with the URL (back/forward, Clear links): adjust state during render
  // rather than in an effect.
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    setQuery(filters.q ?? "");
  }
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const filtered = isFiltered(filters);
  const extraFilters = [filters.category, filters.from, filters.to].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(extraFilters > 0);

  function apply(patch: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  // Debounced search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (query.trim() === (filters.q ?? "")) return;
    // Fires after any navigation in between (e.g. Clear), so build from the URL at fire time.
    searchTimer.current = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const q = query.trim();
      if (q) params.set("q", q);
      else params.delete("q");
      params.delete("page");
      const qs = params.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    }, 350);
    return () => clearTimeout(searchTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function clearFilters() {
    clearTimeout(searchTimer.current);
    setQuery("");
  }

  return (
    <div aria-busy={pending} className="mb-5 flex flex-col gap-3" role="search">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-72">
          <Label className="sr-only" htmlFor="history-search">
            Search receipts
          </Label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-9"
            id="history-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search merchants or files"
            type="search"
            value={query}
          />
        </div>
        <div aria-label="Status" className="flex gap-2 overflow-x-auto" role="group">
          {STATUS_CHIPS.map((chip) => {
            const active = filters.status === chip.value;
            return (
              <button
                aria-pressed={active}
                className={cn(
                  buttonVariants({ size: "sm", variant: active ? "secondary" : "ghost" }),
                  active && "border-primary/40 text-primary",
                )}
                key={chip.label}
                onClick={() => apply({ status: chip.value })}
                type="button"
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>
      <Button
        aria-controls="history-more-filters"
        aria-expanded={filtersOpen}
        className="self-start lg:hidden"
        onClick={() => setFiltersOpen((open) => !open)}
        size="sm"
        variant="outline"
      >
        <SlidersHorizontal aria-hidden="true" />
        {extraFilters > 0 ? `Category and dates (${extraFilters})` : "Category and dates"}
      </Button>
      <div
        className={cn(
          "grid-cols-2 gap-3 sm:flex-wrap sm:items-end lg:flex",
          filtersOpen ? "grid sm:flex" : "hidden",
        )}
        id="history-more-filters"
      >
        <Field className="col-span-2 sm:w-52">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="history-category">
            Category
          </FieldLabel>
          <Select
            items={CATEGORY_ITEMS}
            onValueChange={(value) => apply({ category: (value as string | null) ?? undefined })}
            value={filters.category ?? null}
          >
            <SelectTrigger className="w-full" id="history-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {CATEGORY_ITEMS.map((item) => (
                <SelectItem key={item.label} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field className="min-w-0 sm:w-40">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="history-from">
            From
          </FieldLabel>
          <Input
            id="history-from"
            max={filters.to}
            onChange={(event) => apply({ from: event.target.value || undefined })}
            type="date"
            value={filters.from ?? ""}
          />
        </Field>
        <Field className="min-w-0 sm:w-40">
          <FieldLabel className="text-xs text-muted-foreground" htmlFor="history-to">
            To
          </FieldLabel>
          <Input
            id="history-to"
            min={filters.from}
            onChange={(event) => apply({ to: event.target.value || undefined })}
            type="date"
            value={filters.to ?? ""}
          />
        </Field>
        {filtered ? (
          <Link
            className={cn(buttonVariants({ variant: "ghost" }), "col-span-2 sm:col-span-1")}
            href={pathname}
            onClick={clearFilters}
          >
            <X aria-hidden="true" />
            Clear filters
          </Link>
        ) : null}
      </div>
    </div>
  );
}
