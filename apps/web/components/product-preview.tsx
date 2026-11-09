import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, ChevronLeft, ReceiptText } from "lucide-react";
import { previewTotals } from "@/lib/product-preview";

const items: Array<[name: string, qty: string, price: number]> = [
  ["Organic Bananas", "1.2 kg", 2.49],
  ["Almond Milk", "2", 9.98],
  ["Sourdough Loaf", "1", 5.49],
  ["Free-range Eggs", "1", 6.79],
  ["Cold Brew", "3", 11.97],
];

const totals = previewTotals(items.map(([, , price]) => price));
const usd = (value: number) => `$${value.toFixed(2)}`;

/**
 * Static, honest preview of the real extracted-data view, so visitors see the product before
 * signing up: the app on a phone below `sm`, a desktop window above.
 */
export function ProductPreview() {
  return (
    <>
      <PhonePreview />
      <DesktopPreview />
    </>
  );
}

function ConfidencePill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-2xs text-primary",
        className,
      )}
    >
      <Check aria-hidden className="size-3" /> 98% confidence
    </span>
  );
}

function Totals({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2 border-t border-border pt-4 text-sm", className)}>
      <div className="flex justify-between text-muted-foreground">
        <span>Subtotal</span>
        <span className="font-mono">{usd(totals.subtotal)}</span>
      </div>
      <div className="flex justify-between text-muted-foreground">
        <span>Tax</span>
        <span className="font-mono">{usd(totals.tax)}</span>
      </div>
      <div className="flex justify-between text-base font-semibold">
        <span>Total</span>
        <span className="font-mono text-primary">{usd(totals.total)}</span>
      </div>
    </div>
  );
}

/**
 * The receipt result screen on a phone, cut off below the totals. The right padding keeps it out
 * of the column of the support button, which is fixed to the bottom-right corner.
 */
function PhonePreview() {
  return (
    <div className="pr-10 sm:hidden" data-preview="phone">
      <div className="mx-auto w-full max-w-80 [mask-image:linear-gradient(to_bottom,black_calc(100%-3.5rem),transparent)]">
        <div className="rounded-t-[2.75rem] border border-b-0 border-foreground/15 bg-card p-2 pb-0 shadow-[0_32px_80px_-24px_rgb(0_0_0/0.8)] light:border-foreground/20 light:bg-muted light:shadow-[0_32px_64px_-24px_rgb(24_24_27/0.35)]">
          <div className="rounded-t-[2.25rem] bg-background">
            <div
              aria-hidden
              className="mx-auto h-4 w-16 translate-y-2.5 rounded-full bg-border light:bg-foreground/90"
            />
            <div className="px-5 pt-6 pb-16">
              <span className="inline-flex items-center gap-0.5 text-sm text-primary">
                <ChevronLeft aria-hidden className="size-4" /> History
              </span>
              <p className="mt-2 text-2xl font-bold tracking-tight">Whole Foods Market</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Mar 14, 2026</span>
                <ConfidencePill />
              </div>
              <div className="mt-5 flex flex-col gap-2.5 text-sm">
                {items.map(([name, qty, price]) => (
                  <div className="flex items-center justify-between gap-2" key={name}>
                    <span className="truncate">{name}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                      {qty}
                    </span>
                    <span className="w-14 shrink-0 text-right font-mono">{usd(price)}</span>
                  </div>
                ))}
              </div>
              <Totals className="mt-4" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopPreview() {
  return (
    <div className="card-sheen relative hidden overflow-hidden rounded-2xl border border-hairline bg-card/70 shadow-2xl shadow-black/50 light:shadow-float backdrop-blur-xl sm:block">
      {/* Window chrome, with the page's title rather than a made-up address. */}
      <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-3">
        <span className="size-2.5 rounded-full bg-destructive/70" />
        <span className="size-2.5 rounded-full bg-warning/70" />
        <span className="size-2.5 rounded-full bg-primary/70" />
        <span className="ml-3 text-xs text-muted-foreground">Whole Foods Market · ReceiptOCR</span>
      </div>

      <div className="grid gap-px bg-border md:grid-cols-2">
        {/* Receipt image side */}
        <div className="flex flex-col items-center justify-center gap-4 bg-card p-8">
          <div className="relative w-full max-w-[220px] overflow-hidden rounded-lg border border-dashed border-hairline bg-background/60 p-5 font-mono text-2xs text-muted-foreground">
            <div className="scan-line pointer-events-none absolute inset-x-0 top-0" aria-hidden />
            <div className="mb-3 text-center text-foreground">WHOLE FOODS MARKET</div>
            <div className="mb-3 text-center text-2xs text-muted-foreground">
              Mar 14, 2026 · 18:42
            </div>
            <div className="flex flex-col gap-1 border-y border-dashed border-hairline py-3">
              {items.map(([name, , price]) => (
                <div className="flex justify-between" key={name}>
                  <span className="truncate pr-2">{name}</span>
                  <span>{usd(price)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between font-semibold text-foreground">
              <span>TOTAL</span>
              <span>{usd(totals.total)}</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-mono text-2xs text-primary">
            <ReceiptText className="size-3" /> demo_receipt.jpg
          </span>
        </div>

        {/* Extracted data side */}
        <div className="bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <p className="text-sm font-medium">Extracted data</p>
            <ConfidencePill />
          </div>
          <div className="p-5">
            <div className="flex flex-col gap-2.5 text-sm">
              {items.map(([name, qty, price]) => (
                <div className="flex items-center justify-between gap-3" key={name}>
                  <span className="truncate text-foreground">{name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{qty}</span>
                  <span className="shrink-0 font-mono text-foreground">{usd(price)}</span>
                </div>
              ))}
            </div>
            <Totals className="mt-4" />
          </div>
        </div>
      </div>
    </div>
  );
}
