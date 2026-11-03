"use client";

import { RECEIPT_CATEGORIES } from "@receipt-ocr/ai/categories";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@receipt-ocr/ui/components/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@receipt-ocr/ui/components/table";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronLeft, ChevronRight, Download, Search, Upload, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ReceiptSummary } from "@/app/app/_data/receipts-contract";
import { ListPoller } from "@/components/processing-poller";
import { ConfidenceBadge, StatusBadge, isInFlight } from "@/components/receipt-status";
import { RetryReceiptButton } from "@/components/retry-receipt-button";
import { formatDate, formatMoney } from "@/lib/format";

export type HistoryFilters = {
  q?: string;
  category?: string;
  status?: ReceiptSummary["status"] | "needs-review";
  from?: string;
  to?: string;
};

const STATUS_CHIPS = [
  { value: undefined, label: "All" },
  { value: "needs-review", label: "Needs review" },
  { value: "failed", label: "Couldn't read" },
] as const;

const CATEGORY_ITEMS = [
  { value: null, label: "All categories" },
  ...RECEIPT_CATEGORIES.map((category) => ({ value: category as string, label: category as string })),
];

const FILTER_KEYS = ["q", "category", "status", "from", "to"] as const;

function Missing() {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">Not available</span>
    </>
  );
}

function rowTitle(receipt: ReceiptSummary) {
  if (receipt.status === "completed") return { text: receipt.merchant ?? "Unnamed merchant", muted: !receipt.merchant };
  return { text: receipt.fileName ?? "Uploaded receipt", muted: true };
}

function Amount({ receipt }: { receipt: ReceiptSummary }) {
  const amount = receipt.status === "completed" ? formatMoney(receipt.total, receipt.currency) : null;
  return amount ? <span className="font-mono tabular-nums">{amount}</span> : <Missing />;
}

function DateText({ receipt }: { receipt: ReceiptSummary }) {
  const date = receipt.status === "completed" ? formatDate(receipt.receiptDate) : null;
  return date ? <span className="whitespace-nowrap">{date}</span> : <Missing />;
}

export function HistoryTable({
  receipts,
  total,
  page,
  pageSize,
  filters,
}: {
  receipts: ReceiptSummary[];
  total: number;
  page: number;
  pageSize: number;
  filters: HistoryFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(filters.q ?? "");

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = FILTER_KEYS.some((key) => filters[key]);
  const anyInFlight = receipts.some((receipt) => isInFlight(receipt.status));

  function hrefWith(patch: Record<string, string | undefined>, keepPage = false) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    if (!keepPage && !("page" in patch)) params.delete("page");
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function apply(patch: Record<string, string | undefined>) {
    startTransition(() => router.replace(hrefWith(patch), { scroll: false }));
  }

  // Debounced search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    if (query.trim() === (filters.q ?? "")) return;
    const timer = setTimeout(() => apply({ q: query.trim() || undefined }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const exportParams = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key]) exportParams.set(key, filters[key]!);
  const exportHref = `/api/receipts/export${exportParams.size ? `?${exportParams}` : ""}`;

  return (
    <div className="mx-auto max-w-6xl">
      <ListPoller active={anyInFlight} />
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">History</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {total} {total === 1 ? "receipt" : "receipts"} in this workspace
            {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
          </p>
        </div>
        <a className={cn(buttonVariants({ variant: "outline" }), "self-start sm:self-auto")} href={exportHref}>
          <Download aria-hidden="true" />
          {filtered ? "Export filtered CSV" : "Export CSV"}
        </a>
      </div>

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
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <div className="col-span-2 flex flex-col gap-1.5 sm:w-52">
            <Label className="text-xs text-muted-foreground" htmlFor="history-category">
              Category
            </Label>
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
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 sm:w-40">
            <Label className="text-xs text-muted-foreground" htmlFor="history-from">
              From
            </Label>
            <Input
              id="history-from"
              max={filters.to}
              onChange={(event) => apply({ from: event.target.value || undefined })}
              type="date"
              value={filters.from ?? ""}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5 sm:w-40">
            <Label className="text-xs text-muted-foreground" htmlFor="history-to">
              To
            </Label>
            <Input
              id="history-to"
              min={filters.from}
              onChange={(event) => apply({ to: event.target.value || undefined })}
              type="date"
              value={filters.to ?? ""}
            />
          </div>
          {filtered ? (
            <Link
              className={cn(buttonVariants({ variant: "ghost" }), "col-span-2 sm:col-span-1")}
              href={pathname}
              onClick={() => setQuery("")}
            >
              <X aria-hidden="true" />
              Clear filters
            </Link>
          ) : null}
        </div>
      </div>

      {receipts.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary/40 text-muted-foreground">
            {filtered ? <Search aria-hidden="true" className="size-5" /> : <Upload aria-hidden="true" className="size-5" />}
          </span>
          <div>
            <p className="text-sm font-medium">{filtered ? "No receipts match" : "No receipts yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered ? "Try a different search, category or date range." : "Upload your first receipt to start your history."}
            </p>
          </div>
          {filtered ? (
            <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1")} href={pathname}>
              Clear filters
            </Link>
          ) : (
            <Link className={cn(buttonVariants({ size: "sm" }), "mt-1")} href="/app/upload">
              <Upload aria-hidden="true" />
              Upload a receipt
            </Link>
          )}
        </Card>
      ) : (
        <>
          {/* Cards below lg: the table needs more width than the sidebar leaves. */}
          <ul className="flex flex-col gap-2 lg:hidden">
            {receipts.map((receipt) => {
              const title = rowTitle(receipt);
              return (
                <li
                  className="relative rounded-lg border border-border bg-card p-4 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40"
                  key={receipt.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      className={cn(
                        "min-w-0 truncate font-medium outline-none after:absolute after:inset-0 after:content-['']",
                        title.muted && "font-mono text-sm text-muted-foreground",
                      )}
                      href={`/app/receipts/${receipt.id}`}
                    >
                      {title.text}
                    </Link>
                    <span className="shrink-0 text-right">
                      <Amount receipt={receipt} />
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                    {receipt.status === "completed" ? (
                      <>
                        <DateText receipt={receipt} />
                        {receipt.category ? <span>{receipt.category}</span> : null}
                        <ConfidenceBadge value={receipt.confidence} />
                      </>
                    ) : (
                      <>
                        <StatusBadge status={receipt.status} />
                        {receipt.status === "failed" ? (
                          <RetryReceiptButton className="relative z-10 ml-auto" receiptId={receipt.id} size="sm" variant="outline" />
                        ) : null}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <Card className="hidden overflow-hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Merchant</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipts.map((receipt) => {
                  const title = rowTitle(receipt);
                  return (
                    <TableRow className="relative focus-within:bg-muted/40" key={receipt.id}>
                      <TableCell className="max-w-72">
                        <Link
                          className={cn(
                            "block truncate font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline",
                            title.muted && "font-mono text-xs text-muted-foreground",
                          )}
                          href={`/app/receipts/${receipt.id}`}
                        >
                          {title.text}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <DateText receipt={receipt} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {receipt.status === "completed" && receipt.category ? receipt.category : <Missing />}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={receipt.status} />
                          {receipt.status === "failed" ? (
                            <RetryReceiptButton className="relative z-10" receiptId={receipt.id} size="sm" variant="ghost" />
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {receipt.status === "completed" && receipt.confidence !== null ? (
                          <ConfidenceBadge value={receipt.confidence} />
                        ) : (
                          <Missing />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount receipt={receipt} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </>
      )}

      {totalPages > 1 ? (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={hrefWith({ page: page - 1 > 1 ? String(page - 1) : undefined })}>
                <ChevronLeft aria-hidden="true" />
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={hrefWith({ page: String(page + 1) })}>
                Next
                <ChevronRight aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
