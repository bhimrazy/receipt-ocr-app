import { ChevronDown, Download, Pencil } from "lucide-react";
import { receipt } from "./data";
import { Confidence } from "./parts";

const BAR: Record<number, string> = { 1: "w-px", 2: "w-0.5", 3: "w-[3px]" };

/** The drawn thermal receipt: the "before". */
function Paper() {
  return (
    <div
      aria-hidden="true"
      className="g-paper g-mono relative w-full px-4 pb-6 pt-5 text-[10.5px] leading-[1.55] shadow-[0_1px_0_var(--border),0_10px_24px_-14px_rgb(11_18_32/0.35)]"
    >
      <p className="text-center text-[12px] font-semibold tracking-[0.08em]">
        {receipt.shortMerchant}
      </p>
      <p className="text-center opacity-70">214 MARKET ST</p>
      <p className="mt-2 flex justify-between opacity-70">
        <span>{receipt.isoDate}</span>
        <span>{receipt.time}</span>
      </p>
      <div className="my-2 border-t border-dashed border-current opacity-40" />
      <ul className="space-y-0.5">
        {receipt.items.map((item) => (
          <li className="flex justify-between gap-2" key={item.name}>
            <span className="truncate">
              {item.qty !== "1" ? `${item.qty}× ` : ""}
              {item.name.toUpperCase()}
            </span>
            <span>{item.price.replace("$", "")}</span>
          </li>
        ))}
      </ul>
      <div className="my-2 border-t border-dashed border-current opacity-40" />
      <p className="flex justify-between">
        <span>SUBTOTAL</span>
        <span>{receipt.subtotal.replace("$", "")}</span>
      </p>
      <p className="flex justify-between">
        <span>TAX 8.875%</span>
        <span>{receipt.tax.replace("$", "")}</span>
      </p>
      <p className="mt-1 flex justify-between text-[12px] font-semibold">
        <span>TOTAL</span>
        <span>{receipt.total}</span>
      </p>
      <p className="mt-3 hidden text-center opacity-70 sm:block">VISA •••• 4417 · APPROVED</p>
      {/* Barcode, drawn from bars of varying width. */}
      <div className="mt-3 hidden h-7 items-stretch sm:flex justify-center gap-[2px] opacity-80">
        {[2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 2, 3, 1].map((w, i) => (
          <span className={`bg-current ${BAR[w]}`} key={i} />
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  select = false,
  empty,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  select?: boolean;
  empty?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{label}</p>
      <div className="flex h-8 items-center justify-between gap-2 rounded-md border border-(--g-rule-strong) bg-card px-2.5 text-[13px]">
        {value ? (
          <span className={mono ? "g-mono ml-auto" : "truncate"}>{value}</span>
        ) : (
          <span className="text-muted-foreground">{empty}</span>
        )}
        {select ? (
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
      </div>
    </div>
  );
}

/** The extracted, editable record: the "after". Fields mirror components/receipt-editor.tsx. */
function Record() {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Pencil aria-hidden="true" className="size-3.5 text-primary" />
          Extracted record
        </p>
        <Confidence score={receipt.confidence} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        <div className="col-span-2">
          <Field label="Merchant" value={receipt.merchant} />
        </div>
        <Field label="Date" value={receipt.date} />
        <Field label="Category" select value={receipt.category} />
        <Field label="Subtotal" mono value={receipt.subtotal} />
        <Field label="Tax" mono value={receipt.tax} />
        <Field empty="Not on receipt" label="Tip" />
        <Field label="Total" mono value={receipt.total} />
      </div>

      <table className="mt-4 w-full text-[12.5px]">
        <caption className="sr-only">Line items with a confidence score for each</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
            <th className="pb-1.5 font-medium" scope="col">
              Item
            </th>
            <th className="pb-1.5 text-right font-medium" scope="col">
              Qty
            </th>
            <th className="pb-1.5 text-right font-medium" scope="col">
              Price
            </th>
            <th className="pb-1.5 pl-3 text-right font-medium" scope="col">
              <span className="sr-only">Confidence</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((item) => {
            const low = item.confidence < 75;
            return (
              <tr
                className={
                  low
                    ? "border-b border-border bg-(--g-crit-tint)"
                    : "border-b border-border last:border-0"
                }
                key={item.name}
              >
                <td className="py-1.5 pr-2">
                  <span className={low ? "font-medium" : undefined}>{item.name}</span>
                </td>
                <td className="g-mono py-1.5 text-right">{item.qty}</td>
                <td className="g-mono py-1.5 pl-3 text-right">{item.price}</td>
                <td className="py-1.5 pl-3 text-right">
                  <Confidence compact score={item.confidence} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Fig. 1: one receipt beside the record extracted from it, in a quiet app frame. Purely
 * illustrative, so the frame is aria-hidden except for the record's text content.
 */
export function ProductComposition() {
  return (
    <figure className="relative">
      <div className="overflow-hidden rounded-xl border border-(--g-rule-strong) bg-card shadow-(--g-shadow)">
        <div className="flex h-10 items-center justify-between gap-3 border-b border-border px-4 text-xs">
          <p className="min-w-0 truncate text-muted-foreground">
            History <span aria-hidden="true">/</span>{" "}
            <span className="text-foreground">{receipt.merchant}</span>
          </p>
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium"
          >
            <Download className="size-3" />
            CSV
          </span>
        </div>
        <div className="grid gap-4 bg-muted p-4 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)] sm:gap-0 sm:p-0">
          <div className="mx-auto w-full max-w-[220px] sm:max-w-none sm:bg-muted sm:p-5">
            <Paper />
          </div>
          <div className="rounded-lg bg-card p-4 sm:rounded-none sm:p-5">
            <Record />
          </div>
        </div>
      </div>
    </figure>
  );
}
