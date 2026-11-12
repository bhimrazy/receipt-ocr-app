import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ReceiptSummary } from "@/lib/receipts";
import { ConfidenceBadge, StatusBadge, isInFlight } from "@/components/receipt-status";
import { RetryReceiptButton } from "@/components/retry-receipt-button";
import { confidenceLevel, formatDate, formatMoney } from "@/lib/format";

/** What a row is called: the merchant once read, the uploaded file name until then. */
export function receiptTitle(receipt: Pick<ReceiptSummary, "status" | "merchant" | "fileName">) {
  if (receipt.status === "completed") {
    return { text: receipt.merchant ?? "Merchant not found", isFile: false };
  }
  return { text: receipt.fileName ?? "Uploaded photo", isFile: true };
}

/** The row's title as a link that covers the whole row. */
export const ROW_LINK =
  "min-w-0 truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset";

/**
 * A row's text: `title` (a link, or plain text while selecting), the amount, and a line with
 * the date and category, or the status and what to do next. `retry` adds Try again to a failed
 * row; leave it out where the row itself is a control.
 */
export function ReceiptRowContent({
  receipt,
  title,
  retry = true,
}: {
  receipt: ReceiptSummary;
  title: ReactNode;
  retry?: boolean;
}) {
  const completed = receipt.status === "completed";
  const amount = completed ? formatMoney(receipt.total, receipt.currency) : null;
  const date = completed ? formatDate(receipt.receiptDate) : null;
  const level = completed ? confidenceLevel(receipt.confidence) : null;
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        {title}
        {amount ? <span className="shrink-0 font-mono text-sm tabular-nums">{amount}</span> : null}
      </div>
      <div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted-foreground">
        {completed ? (
          <>
            <span>{date ?? "No date"}</span>
            {receipt.category ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{receipt.category}</span>
              </>
            ) : null}
            {level && level !== "high" ? (
              <ConfidenceBadge className="ml-auto" value={receipt.confidence} />
            ) : null}
          </>
        ) : (
          <>
            <StatusBadge status={receipt.status} />
            <span className="min-w-0 truncate">
              {isInFlight(receipt.status)
                ? receipt.retryAt
                  ? "Waiting to retry"
                  : "Usually takes a few seconds"
                : "Open it to see why"}
            </span>
            {retry && receipt.status === "failed" ? (
              <RetryReceiptButton
                className="relative z-10 ml-auto"
                receiptId={receipt.id}
                size="sm"
                variant="outline"
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Receipts as stacked rows, each one link. Used on Home. Confidence only shows when there's
 * something to check, so the rows that need attention stand out.
 */
export function ReceiptList({
  receipts,
  className,
}: {
  receipts: ReceiptSummary[];
  className?: string;
}) {
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {receipts.map((receipt) => {
        const title = receiptTitle(receipt);
        return (
          <li
            className="group relative flex items-center gap-3 px-4 py-3 transition-colors focus-within:bg-wash-subtle hover:bg-wash-subtle active:bg-wash"
            key={receipt.id}
          >
            <ReceiptRowContent
              receipt={receipt}
              title={
                <Link
                  className={cn(ROW_LINK, title.isFile && "font-mono text-xs")}
                  data-touch-row=""
                  href={`/app/receipts/${receipt.id}`}
                >
                  {title.text}
                </Link>
              }
            />
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 max-sm:hidden"
            />
          </li>
        );
      })}
    </ul>
  );
}
