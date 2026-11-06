import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@receipt-ocr/ui/components/table";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronLeft, ChevronRight, Search, Upload } from "lucide-react";
import Link from "next/link";
import { historyHref, isFiltered } from "@/components/history/history-href";
import { ReceiptList, receiptTitle } from "@/components/receipt-list";
import { ConfidenceBadge, StatusBadge } from "@/components/receipt-status";
import { RetryReceiptButton } from "@/components/retry-receipt-button";
import { formatDate, formatMoney } from "@/lib/format";
import type { HistoryFilters, ReceiptSummary } from "@/lib/receipts";

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

function Amount({ receipt }: { receipt: ReceiptSummary }) {
  const amount =
    receipt.status === "completed" ? formatMoney(receipt.total, receipt.currency) : null;
  return amount ? <span className="font-mono tabular-nums">{amount}</span> : <Missing />;
}

function DateText({ receipt }: { receipt: ReceiptSummary }) {
  const date = receipt.status === "completed" ? formatDate(receipt.receiptDate) : null;
  return date ? <span className="whitespace-nowrap">{date}</span> : <Missing />;
}

/** One page of History: a table from lg, stacked rows below, an empty state and pagination. */
export function HistoryResults({
  receipts,
  filters,
  page,
  totalPages,
}: {
  receipts: ReceiptSummary[];
  filters: HistoryFilters;
  page: number;
  totalPages: number;
}) {
  const filtered = isFiltered(filters);
  return (
    <>
      {receipts.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary/40 text-muted-foreground">
            {filtered ? (
              <Search aria-hidden="true" className="size-5" />
            ) : (
              <Upload aria-hidden="true" className="size-5" />
            )}
          </span>
          <div>
            <p className="text-sm font-medium">
              {filtered ? "No receipts match" : "No receipts yet"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered
                ? "Try a different search, category or date range."
                : "Receipts uploaded to this workspace appear here, newest first."}
            </p>
          </div>
          {filtered ? (
            <Link
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1")}
              href="/app/history"
            >
              Clear filters
            </Link>
          ) : (
            <Link className={cn(buttonVariants({ size: "sm" }), "mt-1")} href="/app">
              <Upload aria-hidden="true" />
              Upload a receipt
            </Link>
          )}
        </Card>
      ) : (
        <>
          {/* Stacked rows below lg: the table needs more width than the sidebar leaves. */}
          <Card className="overflow-hidden lg:hidden">
            <ReceiptList receipts={receipts} />
          </Card>

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
                  const title = receiptTitle(receipt);
                  return (
                    <TableRow className="relative focus-within:bg-muted/40" key={receipt.id}>
                      <TableCell className="max-w-72">
                        <Link
                          className={cn(
                            "block truncate font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline",
                            title.isFile && "font-mono text-xs text-muted-foreground",
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
                        {receipt.status === "completed" && receipt.category ? (
                          receipt.category
                        ) : (
                          <Missing />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={receipt.status} />
                          {receipt.status === "failed" ? (
                            <RetryReceiptButton
                              className="relative z-10"
                              receiptId={receipt.id}
                              size="sm"
                              variant="ghost"
                            />
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
        <nav
          aria-label="Pagination"
          className="mt-4 flex items-center justify-between text-sm text-muted-foreground"
        >
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                className={buttonVariants({ size: "sm", variant: "outline" })}
                href={historyHref(filters, page - 1)}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                className={buttonVariants({ size: "sm", variant: "outline" })}
                href={historyHref(filters, page + 1)}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}
