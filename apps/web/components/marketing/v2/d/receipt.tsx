import { cn } from "@receipt-ocr/ui/lib/utils";
import { demoReceipt } from "@/components/marketing/content";

const LOW = 80;
const plain = (amount: string) => amount.replace("$", "");

/** The paper receipt as it came out of the till. The faded line is the one the reader flags. */
export function ThermalReceipt({ className }: { className?: string }) {
  const r = demoReceipt;
  return (
    <div
      aria-label={`Photo of a paper receipt from ${r.merchant}, ${r.date}, total ${r.total}`}
      className={cn("d-lift", className)}
      role="img"
    >
      <div className="d-thermal d-mono px-5 pt-6 text-[0.72rem] leading-[1.65] text-[#2a2620] uppercase">
        <div className="text-center">
          <p className="text-[0.95rem] font-semibold tracking-[0.18em]">{r.shortMerchant}</p>
          <p className="tracking-[0.2em] opacity-75">Office supply</p>
          <p className="mt-2 opacity-75">
            {r.isoDate} &nbsp; {r.time}
          </p>
        </div>
        <div className="d-dashed my-3" />
        <ul>
          {r.items.map((item) => (
            <li
              className={cn(
                "flex justify-between gap-3",
                // A faded patch of thermal print, which is why the reader is unsure of it.
                item.confidence < LOW && "opacity-40 blur-[0.4px]",
              )}
              key={item.name}
            >
              <span className="truncate">
                {item.name}
                {item.qty !== "1" && ` ×${item.qty}`}
              </span>
              <span>{plain(item.price)}</span>
            </li>
          ))}
        </ul>
        <div className="d-dashed my-3" />
        <p className="flex justify-between">
          <span>Subtotal</span>
          <span>{plain(r.subtotal)}</span>
        </p>
        <p className="flex justify-between">
          <span>Tax</span>
          <span>{plain(r.tax)}</span>
        </p>
        <p className="mt-1 flex justify-between text-[0.9rem] font-semibold">
          <span>Total {r.currency}</span>
          <span>{plain(r.total)}</span>
        </p>
        <div className="d-barcode mx-auto mt-5 h-8 w-4/5 opacity-85" />
        <p className="mt-3 text-center text-[0.62rem] tracking-[0.14em] opacity-70">
          Keep for your records
        </p>
      </div>
    </div>
  );
}

/** What ReceiptOCR scanned off that receipt, as the results view shows it. */
export function ReadCard({ className }: { className?: string }) {
  const r = demoReceipt;
  const fields = [
    { label: "Merchant", value: r.merchant },
    { label: "Date", value: r.date },
    { label: "Category", value: r.category },
    { label: "Total", value: r.total },
  ];
  return (
    <figure className={cn("d-sheet rounded-xl p-5 sm:p-6", className)}>
      <figcaption className="flex items-start justify-between gap-3">
        <span>
          <span className="d-mono block text-[0.68rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            What ReceiptOCR scanned
          </span>
          <span className="d-display mt-1 block text-lg leading-tight font-medium">
            {r.merchant}
          </span>
        </span>
        <span className="d-mono shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[0.7rem] font-medium">
          {r.confidence}% sure
        </span>
      </figcaption>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-4">
        {fields.map((field) => (
          <div key={field.label}>
            <dt className="text-xs text-muted-foreground">{field.label}</dt>
            <dd
              className={cn(
                "mt-0.5 truncate text-sm font-medium",
                field.label === "Total" && "d-mono",
              )}
            >
              {field.value}
            </dd>
          </div>
        ))}
      </dl>

      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">Line items with the confidence for each</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="pb-1.5 text-left font-normal" scope="col">
              Item
            </th>
            <th className="pb-1.5 text-right font-normal" scope="col">
              Amount
            </th>
            <th className="w-14 pb-1.5 text-right font-normal" scope="col">
              Sure
            </th>
          </tr>
        </thead>
        <tbody>
          {r.items.map((item) => {
            const low = item.confidence < LOW;
            return (
              <tr key={item.name}>
                <td className="py-1 pr-2">
                  <span className={cn(low && "d-highlight -mx-1 px-1 font-medium")}>
                    {item.name}
                  </span>
                </td>
                <td className="d-mono py-1 text-right">{item.price}</td>
                <td
                  className={cn(
                    "d-mono py-1 text-right",
                    low ? "font-semibold text-[var(--d-accent)]" : "text-muted-foreground",
                  )}
                >
                  {item.confidence}%{low && <span className="sr-only"> (check this one)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm">
        <span className="text-muted-foreground">
          Tax <span className="d-mono text-foreground">{r.tax}</span>
        </span>
        <span className="font-medium">
          Total <span className="d-mono">{r.total}</span>
        </span>
      </div>
    </figure>
  );
}
