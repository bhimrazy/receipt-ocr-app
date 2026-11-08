import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ReceiptText, TriangleAlert } from "lucide-react";
import { ConfidenceBadge } from "@/components/receipt-status";
import { exampleCsv } from "@/lib/content/example-csv";
import type { ContentExample } from "@/lib/content/types";
import { confidenceLevel, formatConfidence, formatDate, formatMoney } from "@/lib/format";

function Field({ label, mono, children }: { label: string; mono?: boolean; children: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 break-words", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}

/** The receipt page's confidence checks (`checksFor` in receipt-result.tsx), one item each. */
function checksFor(receipt: ContentExample["extraction"], noun: string): string[] {
  const checks: string[] = [];
  const level = confidenceLevel(receipt.confidence);
  if (level === "review" || level === "check") {
    checks.push(
      `Overall confidence is ${formatConfidence(receipt.confidence)}. Compare the merchant, date and total with the ${noun}.`,
    );
  }
  const low = receipt.items.filter((item) => confidenceLevel(item.confidence) === "review").length;
  if (low > 0) {
    checks.push(
      low === 1
        ? "1 line was hard to read. It's marked in Line items."
        : `${low} lines were hard to read. They're marked in Line items.`,
    );
  }
  return checks;
}

/** A sample receipt laid out like the receipt page: checks, Details, Line items, then an export. */
export function ContentExampleView({ example }: { example: ContentExample }) {
  const receipt = example.extraction;
  const money = (n: number | null) =>
    n === null ? "—" : (formatMoney(n, receipt.currency) ?? "—");
  const noun = example.fileName.toLowerCase().endsWith(".pdf") ? "PDF" : "photo";
  const checks = checksFor(receipt, noun);
  const exportLabel = example.exportView === "json" ? "Copy JSON" : "History CSV export";
  const exportText =
    example.exportView === "json" ? JSON.stringify(receipt, null, 2) : exampleCsv(example);

  return (
    <figure className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-mono text-2xs text-primary">
          <ReceiptText aria-hidden className="size-3" /> {example.fileName}
        </span>
        <ConfidenceBadge value={receipt.confidence} />
      </div>

      {checks.length > 0 ? (
        <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <TriangleAlert aria-hidden className="size-5 shrink-0 text-warning max-sm:hidden" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-warning">
              Check this receipt before you export it
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground marker:text-warning">
              {checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <div className="border-b border-border px-5 py-4">
            <p className="text-sm font-medium">Details</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These are the values that go in the CSV.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 text-sm">
            <div className="col-span-2">
              <Field label="Merchant">{receipt.merchant}</Field>
            </div>
            <Field label="Date">{formatDate(receipt.receiptDate) ?? "Not found"}</Field>
            <Field label="Category">{receipt.category}</Field>
            <Field label="Currency" mono>
              {receipt.currency}
            </Field>
            <Field label="Subtotal" mono>
              {money(receipt.subtotal)}
            </Field>
            <Field label="Tax" mono>
              {money(receipt.tax)}
            </Field>
            <Field label="Tip" mono>
              {money(receipt.tip)}
            </Field>
          </dl>
          <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-border px-5 py-4">
            <span className="text-sm font-medium">Total</span>
            <span className="font-mono text-xl font-semibold text-primary tabular-nums">
              {money(receipt.total)}
            </span>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-4">
            <p className="text-sm font-medium">Line items</p>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {receipt.items.length} {receipt.items.length === 1 ? "line" : "lines"}
            </span>
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">Line items with quantity, price and confidence</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Quantity</th>
                <th scope="col">Price</th>
                <th scope="col">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {receipt.items.map((item) => {
                const low = confidenceLevel(item.confidence) === "review";
                return (
                  <tr
                    className={cn(low && "bg-warning/5 shadow-[inset_3px_0_0_var(--warning)]")}
                    key={item.name}
                  >
                    <td className="py-3 pr-3 pl-5 align-top">
                      <span className="block break-words">{item.name}</span>
                      {low ? (
                        <span className="mt-1 flex items-center gap-1 text-xs text-warning">
                          <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                          Check this line against the {noun}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-right align-top font-mono whitespace-nowrap text-muted-foreground tabular-nums">
                      × {item.quantity}
                    </td>
                    <td className="py-3 pl-3 text-right align-top font-mono whitespace-nowrap tabular-nums">
                      {money(item.totalPrice)}
                    </td>
                    <td className="py-3 pr-5 pl-3 text-right align-top font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatConfidence(item.confidence)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <p className="border-b border-border px-5 py-3 font-mono text-xs text-muted-foreground">
          {exportLabel}
        </p>
        {/* Scrolls inside the card so long CSV rows never widen the page. */}
        <pre
          aria-label={exportLabel}
          className="max-h-80 overflow-auto p-5 font-mono text-xs leading-6 text-foreground/85"
          tabIndex={0}
        >
          {exportText}
        </pre>
      </Card>

      <figcaption className="text-sm leading-6 text-muted-foreground">{example.caption}</figcaption>
    </figure>
  );
}
