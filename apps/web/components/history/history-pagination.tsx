"use client";

import { buttonVariants } from "@receipt-ocr/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useTransition } from "react";
import type { HistoryFilters } from "@/lib/receipts";
import { historyHref } from "./history-href";
import { PAGE_SIZES, rangeText, type ListView } from "./list-view";

const SIZE_ITEMS = PAGE_SIZES.map((size) => ({ value: size, label: String(size) }));

/** "26–50 of 312", rows per page and Previous/Next. */
export function HistoryPagination({
  filters,
  view,
  page,
  total,
}: {
  filters: HistoryFilters;
  view: ListView;
  page: number;
  total: number;
}) {
  const router = useRouter();
  const sizeId = useId();
  const [pending, startTransition] = useTransition();
  const totalPages = Math.max(1, Math.ceil(total / view.size));
  if (total === 0) return null;

  return (
    <nav
      aria-busy={pending}
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-sm text-muted-foreground"
    >
      <p aria-live="polite" className="font-mono tabular-nums">
        {rangeText(page, view.size, total)}
      </p>
      <div className="flex items-center gap-2 max-sm:order-last max-sm:w-full">
        {total > PAGE_SIZES[0] ? (
          <>
            <label htmlFor={sizeId}>Rows per page</label>
            <Select
              items={SIZE_ITEMS}
              onValueChange={(value) =>
                startTransition(() =>
                  router.push(historyHref(filters, 1, { ...view, size: Number(value) }), {
                    scroll: false,
                  }),
                )
              }
              value={view.size}
            >
              <SelectTrigger className="w-20" id={sizeId} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {SIZE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
      </div>
      {totalPages > 1 ? (
        <div className="flex gap-2">
          {page > 1 ? (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={historyHref(filters, page - 1, view)}
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Link>
          ) : null}
          {page < totalPages ? (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={historyHref(filters, page + 1, view)}
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
