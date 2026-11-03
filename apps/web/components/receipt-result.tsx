import { Badge } from "@receipt-ocr/ui/components/badge";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@receipt-ocr/ui/components/table";
import { cn } from "@receipt-ocr/ui/lib/utils";
import type { ReceiptWithItems } from "@receipt-ocr/core";
import { ArrowLeft, ChevronRight, CircleAlert, Loader2, ReceiptText, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { confidenceLevel, formatDate, formatMoney } from "@/lib/format";
import { ProcessingPoller } from "@/components/processing-poller";
import { ReceiptActions, ReceiptWorkspace } from "@/components/receipt-actions";
import { ConfidenceBadge, isInFlight } from "@/components/receipt-status";
import { RetryReceiptButton } from "@/components/retry-receipt-button";

const FAILED_FALLBACK =
  "The photo may be blurry, cropped or too dark. Retake it in good light with the whole receipt in frame.";

function toNumber(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Items (or subtotal) + tax + tip vs total; null when there's nothing to compare. */
function totalsMismatch(receipt: ReceiptWithItems) {
  const total = toNumber(receipt.total);
  if (total === null) return null;
  const itemsSum = receipt.items.length
    ? receipt.items.reduce((sum, item) => sum + (toNumber(item.totalPrice) ?? 0), 0)
    : null;
  const base = toNumber(receipt.subtotal) ?? itemsSum;
  if (base === null) return null;
  const expected = base + (toNumber(receipt.tax) ?? 0) + (toNumber(receipt.tip) ?? 0);
  return Math.abs(expected - total) > 0.01 ? expected : null;
}

function fileNameOf(receipt: ReceiptWithItems) {
  return (receipt.rawJson as { fileName?: string } | null)?.fileName ?? null;
}

export function ReceiptResult({ receipt }: { receipt: ReceiptWithItems }) {
  const json = JSON.stringify(receipt.rawJson ?? receipt, null, 2);
  const inFlight = isInFlight(receipt.status);
  const completed = receipt.status === "completed";
  const currency = receipt.currency ?? "USD";
  const fileName = fileNameOf(receipt);
  const title = completed ? (receipt.merchant ?? "Unnamed merchant") : (fileName ?? "Uploaded receipt");
  const expected = completed ? totalsMismatch(receipt) : null;
  const date = formatDate(receipt.receiptDate);

  const header = (
    <div className="min-w-0">
      <h1 className={cn("text-3xl font-semibold tracking-tight wrap-break-word", !completed && "font-mono text-2xl")}>{title}</h1>
      {completed ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">{date ?? "No date found"}</span>
          {receipt.category ? <Badge variant="secondary">{receipt.category}</Badge> : null}
          <ConfidenceBadge value={receipt.confidence} />
        </div>
      ) : null}
    </div>
  );

  const image = (
    <Card className="flex min-h-80 flex-col items-center justify-center p-6 text-center lg:min-h-105">
      {receipt.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={`Receipt from ${title}`} className="max-h-130 rounded-lg object-contain" src={receipt.imageUrl} />
      ) : (
        <>
          <ReceiptText aria-hidden="true" className="mb-4 size-14 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No image preview available</p>
          {fileName ? <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{fileName}</p> : null}
        </>
      )}
    </Card>
  );

  const money = (value: string | null) => formatMoney(value, currency);

  const extracted = completed ? (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-sm font-medium">Extracted data</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {receipt.items.length} {receipt.items.length === 1 ? "item" : "items"}
        </span>
      </div>
      <div className="p-2 sm:p-4">
        {receipt.items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead>
                <TableHead className="text-center">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipt.items.map((item) => {
                const low = confidenceLevel(item.confidence) === "review";
                return (
                  <TableRow
                    aria-describedby={low ? "low-confidence-hint" : undefined}
                    className={cn(low && "bg-warning/5 shadow-[inset_3px_0_0_var(--warning)]")}
                    key={item.id}
                  >
                    <TableCell>
                      <span className="flex items-start gap-2">
                        {low ? <TriangleAlert aria-label="Low confidence" className="mt-0.5 size-3.5 shrink-0 text-warning" /> : null}
                        {item.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-center font-mono text-muted-foreground tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap tabular-nums">
                      {money(item.totalPrice) ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No line items were found on this receipt.</p>
        )}
        <span className="sr-only" id="low-confidence-hint">
          Low confidence, please verify
        </span>
        {receipt.items.some((item) => confidenceLevel(item.confidence) === "review") ? (
          <p className="mx-3 mt-3 flex items-center gap-2 text-xs text-warning">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            Highlighted items were hard to read. Check them against the photo.
          </p>
        ) : null}
        <dl className="mx-3 mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
          {(
            [
              ["Subtotal", receipt.subtotal],
              ["Tax", receipt.tax],
              ["Tip", receipt.tip],
            ] as const
          ).map(([label, value]) =>
            money(value) ? (
              <div className="flex justify-between text-muted-foreground" key={label}>
                <dt>{label}</dt>
                <dd className="font-mono tabular-nums">{money(value)}</dd>
              </div>
            ) : null,
          )}
          <div className="flex justify-between text-lg font-semibold">
            <dt>Total</dt>
            <dd className="font-mono text-primary tabular-nums">{money(receipt.total) ?? "Not found"}</dd>
          </div>
        </dl>
        {expected !== null ? (
          <p className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning" role="note">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            The amounts add up to {money(String(expected))}, but the total says {money(receipt.total)}. Check for a
            discount or a misread number.
          </p>
        ) : null}
      </div>
    </Card>
  ) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <ProcessingPoller id={receipt.id} status={receipt.status} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <Link className={cn(buttonVariants({ variant: "ghost" }), "-ml-3")} href="/app/history">
          <ArrowLeft aria-hidden="true" />
          Back to history
        </Link>
        <Link className={buttonVariants({ variant: "outline" })} href="/app/upload">
          <Upload aria-hidden="true" />
          Upload another
        </Link>
      </div>

      {inFlight ? (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm" role="status">
          <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none" />
          Reading this receipt. The page updates when it&apos;s done.
        </div>
      ) : null}
      {receipt.status === "failed" ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm sm:flex-row sm:items-center" role="alert">
          <CircleAlert aria-hidden="true" className="hidden size-5 shrink-0 text-destructive sm:block" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-destructive">We couldn&apos;t read this receipt</p>
            <p className="mt-1 text-muted-foreground">{receipt.errorMessage || FAILED_FALLBACK}</p>
          </div>
          <RetryReceiptButton className="shrink-0" receiptId={receipt.id} />
        </div>
      ) : null}

      {completed ? (
        <ReceiptWorkspace extracted={extracted} header={header} image={image} receipt={receipt} />
      ) : (
        <>
          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
            {header}
            <ReceiptActions receipt={receipt} />
          </div>
          <div className="max-w-xl">{image}</div>
        </>
      )}

      {completed ? (
        <details className="group mt-5 rounded-lg border border-border bg-card">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
            Raw extraction (JSON)
          </summary>
          <pre className="max-h-72 overflow-auto border-t border-border px-5 py-4 font-mono text-xs leading-6 whitespace-pre-wrap text-muted-foreground">
            {json}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
