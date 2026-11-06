import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReceiptSummary } from "@/app/app/_data/receipts-contract";
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

/**
 * Receipts as stacked rows, each one link. Used on Home and for History below
 * lg, where a table would need sideways scrolling. Confidence only shows when
 * there's something to check, so the rows that need attention stand out.
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
        const completed = receipt.status === "completed";
        const amount = completed ? formatMoney(receipt.total, receipt.currency) : null;
        const date = completed ? formatDate(receipt.receiptDate) : null;
        const level = completed ? confidenceLevel(receipt.confidence) : null;
        return (
          <li
            className="group relative flex items-center gap-3 px-4 py-3 transition-colors focus-within:bg-foreground/[0.04] hover:bg-foreground/[0.04]"
            key={receipt.id}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  className={cn(
                    "min-w-0 truncate text-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset",
                    title.isFile && "font-mono text-xs",
                  )}
                  href={`/app/receipts/${receipt.id}`}
                >
                  {title.text}
                </Link>
                {amount ? (
                  <span className="shrink-0 font-mono text-sm tabular-nums">{amount}</span>
                ) : null}
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
                        ? "Usually takes a few seconds"
                        : "Open it to see why"}
                    </span>
                    {receipt.status === "failed" ? (
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
