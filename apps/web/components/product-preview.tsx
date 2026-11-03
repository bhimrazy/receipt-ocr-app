import { Check, ReceiptText } from "lucide-react";

const items: Array<[string, string, string]> = [
  ["Organic Bananas", "1.2 kg", "$2.49"],
  ["Almond Milk", "2", "$9.98"],
  ["Sourdough Loaf", "1", "$5.49"],
  ["Free-range Eggs", "1", "$6.79"],
  ["Cold Brew", "3", "$11.97"],
];

/**
 * Static, honest preview of the real extracted-data view rendered on the
 * landing page so visitors see the actual product before signing up.
 */
export function ProductPreview() {
  return (
    <div className="card-sheen relative overflow-hidden rounded-2xl border border-white/10 bg-card/70 shadow-2xl shadow-black/50 backdrop-blur-xl">
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-border bg-secondary/40 px-4 py-3">
        <span className="size-2.5 rounded-full bg-red-400/70" />
        <span className="size-2.5 rounded-full bg-yellow-300/70" />
        <span className="size-2.5 rounded-full bg-primary/70" />
        <span className="ml-3 font-mono text-xs text-muted-foreground">
          receiptocr.app/app/receipts/whole-foods
        </span>
      </div>

      <div className="grid gap-px bg-border md:grid-cols-2">
        {/* Receipt image side */}
        <div className="flex flex-col items-center justify-center gap-4 bg-card p-8">
          <div className="relative w-full max-w-[220px] overflow-hidden rounded-lg border border-dashed border-white/10 bg-background/60 p-5 font-mono text-[11px] text-muted-foreground">
            <div className="scan-line pointer-events-none absolute inset-x-0 top-0" aria-hidden />
            <div className="mb-3 text-center text-foreground">WHOLE FOODS MARKET</div>
            <div className="mb-3 text-center text-[11px] text-muted-foreground">
              Mar 14, 2026 · 18:42
            </div>
            <div className="flex flex-col gap-1 border-y border-dashed border-white/10 py-3">
              {items.map(([name, , price]) => (
                <div className="flex justify-between" key={name}>
                  <span className="truncate pr-2">{name}</span>
                  <span>{price}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-between font-semibold text-foreground">
              <span>TOTAL</span>
              <span>$67.43</span>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-mono text-[11px] text-primary">
            <ReceiptText className="size-3" /> demo_receipt.jpg
          </span>
        </div>

        {/* Extracted data side */}
        <div className="bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h3 className="text-sm font-medium">Extracted data</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[11px] text-primary">
              <Check className="size-3" /> 98% confidence
            </span>
          </div>
          <div className="p-5">
            <div className="flex flex-col gap-2.5 text-sm">
              {items.map(([name, qty, price]) => (
                <div className="flex items-center justify-between gap-3" key={name}>
                  <span className="truncate text-foreground">{name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{qty}</span>
                  <span className="shrink-0 font-mono text-foreground">{price}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="font-mono">$61.84</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Tax</span>
                <span className="font-mono">$5.59</span>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <span>Total</span>
                <span className="font-mono text-primary">$67.43</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
