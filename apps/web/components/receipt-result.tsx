import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@receipt-ocr/ui/components/table";
import type { ReceiptWithItems } from "@receipt-ocr/core";
import { ArrowLeft, Copy, Download, Loader2, ReceiptText, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { money, pct } from "@/lib/format";
import { ProcessingPoller } from "@/components/processing-poller";

export function ReceiptResult({ receipt }: { receipt: ReceiptWithItems }) {
  const json = JSON.stringify(receipt.rawJson ?? receipt, null, 2);
  const inFlight = receipt.status === "processing" || receipt.status === "uploaded";

  return (
    <div className="mx-auto max-w-6xl">
      <ProcessingPoller id={receipt.id} status={receipt.status} />
      <Button asChild className="mb-6" variant="ghost">
        <Link href="/app/history">
          <ArrowLeft className="size-4" />
          Back to history
        </Link>
      </Button>

      {inFlight && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm">
          <Loader2 className="size-4 animate-spin text-primary" />
          Extraction in progress — this page updates automatically when it finishes.
        </div>
      )}
      {receipt.status === "failed" && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <TriangleAlert className="size-4 shrink-0" />
          Extraction failed{receipt.errorMessage ? `: ${receipt.errorMessage}` : "."} Try
          re-uploading the receipt.
        </div>
      )}

      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{receipt.merchant ?? "Untitled receipt"}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">{receipt.receiptDate ?? "No date"}</span>
            <Badge>{receipt.category ?? "Other"}</Badge>
            <span className="font-mono text-xs text-primary">{pct(receipt.confidence)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Copy className="size-4" />
            Copy JSON
          </Button>
          <Button>
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
          {receipt.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Receipt preview" className="max-h-[520px] rounded-lg object-contain" src={receipt.imageUrl} />
          ) : (
            <>
              <ReceiptText className="mb-4 size-14 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Receipt image preview</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground/60">{receipt.imageObjectKey ?? "demo_receipt.jpg"}</p>
            </>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-medium">Extracted Data</h2>
            <span className="font-mono text-xs text-muted-foreground">{receipt.items.length} items</span>
          </div>
          <div className="p-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receipt.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.name}</TableCell>
                    <TableCell className="text-center font-mono text-muted-foreground">{item.quantity}</TableCell>
                    <TableCell className="text-right font-mono">{money(item.totalPrice, receipt.currency ?? "USD")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 border-t border-border pt-4">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Tax</span>
                <span className="font-mono">{money(receipt.tax, receipt.currency ?? "USD")}</span>
              </div>
              <div className="mt-2 flex justify-between text-lg font-semibold">
                <span>Total</span>
                <span className="font-mono text-primary">{money(receipt.total, receipt.currency ?? "USD")}</span>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="mt-5 max-h-72 overflow-auto bg-[#101012] p-5">
        <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-muted-foreground">{json}</pre>
      </Card>
    </div>
  );
}
