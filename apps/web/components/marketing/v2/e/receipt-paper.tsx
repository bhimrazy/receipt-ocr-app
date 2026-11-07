import { cn } from "@receipt-ocr/ui/lib/utils";
import type { Sample } from "./fixtures";

const amount = (value: number) => value.toFixed(2);

function Line({
  id,
  active,
  className,
  children,
}: {
  id: string;
  active: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("e-line flex justify-between gap-3", active === id && "e-hl", className)}>
      {children}
    </div>
  );
}

/** A thermal-paper receipt drawn in HTML. `active` outlines the line being scanned. */
export function ReceiptPaper({
  sample,
  active = null,
  scanKey = null,
  className,
}: {
  sample: Sample;
  active?: string | null;
  /** While set, a scan pass runs; a new value restarts it. */
  scanKey?: number | null;
  className?: string;
}) {
  const [y, m, d] = sample.receiptDate.split("-");
  return (
    <div className={cn("e-paper-shadow", className)}>
      <div
        aria-hidden="true"
        className="e-paper relative overflow-hidden px-4 pt-5 pb-7 text-[10.5px] leading-[1.55]"
      >
        {scanKey !== null ? <div className="e-scanbar" key={scanKey} /> : null}
        <Line active={active} className="justify-center" id="merchant">
          <span className="text-[12.5px] font-bold tracking-wide uppercase">{sample.merchant}</span>
        </Line>
        {sample.address.map((line) => (
          <p className="text-center opacity-70" key={line}>
            {line}
          </p>
        ))}
        <Line active={active} className="mt-2" id="date">
          <span>
            {m}/{d}/{y}
          </span>
          <span>{sample.time}</span>
        </Line>
        <div className="e-rule my-2" />
        {sample.items.map((item, i) => (
          <Line
            active={active}
            className={cn(item.confidence < 0.75 && "e-faded")}
            id={`item-${i}`}
            key={item.name}
          >
            <span className="truncate">{item.printed}</span>
            <span>{amount(item.totalPrice)}</span>
          </Line>
        ))}
        <div className="e-rule my-2" />
        <Line active={active} id="subtotal">
          <span>SUBTOTAL</span>
          <span>{amount(sample.subtotal)}</span>
        </Line>
        <Line active={active} id="tax">
          <span>TAX</span>
          <span>{amount(sample.tax)}</span>
        </Line>
        {sample.tip !== null ? (
          <Line active={active} id="tip">
            <span>TIP</span>
            <span className={cn(sample.handwrittenTip && "e-ink")}>{amount(sample.tip)}</span>
          </Line>
        ) : null}
        <Line active={active} className="mt-1 text-[12px] font-bold" id="total">
          <span>TOTAL</span>
          <span className={cn(sample.handwrittenTip && "e-ink")}>{amount(sample.total)}</span>
        </Line>
        <p className="mt-3 text-center text-[9.5px] opacity-70">{sample.footer}</p>
        <div className="e-barcode mx-auto mt-2 h-6 w-3/4" />
      </div>
    </div>
  );
}
