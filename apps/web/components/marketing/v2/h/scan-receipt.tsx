import { cn } from "@receipt-ocr/ui/lib/utils";
import { demoReceipt } from "../../content";

/*
 * One receipt drawn twice: printed paper underneath, extracted data on top. The data layer is
 * clipped to the scan line, so every printed row turns into its field exactly where the line
 * has passed. Both layers share one row list, which keeps their heights identical.
 */

type Row = {
  h: "head" | "line" | "rule" | "total" | "foot";
  paper: React.ReactNode;
  data: React.ReactNode;
};

const heights: Record<Row["h"], string> = {
  head: "h-11",
  line: "h-[26px]",
  rule: "h-4",
  total: "h-8",
  foot: "h-11",
};

function Field({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex w-full items-baseline justify-between gap-4">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("truncate text-right", strong && "text-[15px] font-semibold")}>
        {children}
      </span>
    </div>
  );
}

function Score({ value }: { value: number }) {
  const low = value < 75;
  return (
    <span
      className={cn(
        "inline-flex w-[52px] shrink-0 items-center justify-end gap-1.5 text-[11px] tabular-nums",
        low ? "text-warning" : "text-muted-foreground",
      )}
    >
      <span className="relative h-[3px] w-4 overflow-hidden rounded-full bg-white/10">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            low ? "bg-warning" : "bg-white/45",
          )}
          style={{ width: `${value}%` }}
        />
      </span>
      {value}
    </span>
  );
}

const items = demoReceipt.items;
const amount = (price: string) => price.replace("$", "");

const rows: Row[] = [
  {
    h: "head",
    paper: (
      <p className="w-full text-center text-[17px] font-bold tracking-[0.18em]">
        {demoReceipt.shortMerchant}
      </p>
    ),
    data: <Field label="merchant">{demoReceipt.merchant}</Field>,
  },
  {
    h: "line",
    paper: (
      <p className="w-full text-center text-[10.5px] tracking-[0.12em] text-(--h-paper-muted)">
        OFFICE SUPPLY · 214 MAIN ST
      </p>
    ),
    data: <Field label="category">{demoReceipt.category}</Field>,
  },
  {
    h: "line",
    paper: (
      <p className="flex w-full justify-between">
        <span>10/28/2026</span>
        <span>{demoReceipt.time}</span>
      </p>
    ),
    data: (
      <Field label="date">
        {demoReceipt.isoDate} <span className="text-muted-foreground">{demoReceipt.time}</span>
      </Field>
    ),
  },
  {
    h: "rule",
    paper: <span className="h-px w-full border-t border-dashed border-(--h-paper-muted)/50" />,
    data: <span className="h-px w-full bg-white/[0.07]" />,
  },
  ...items.map<Row>((item) => ({
    h: "line",
    paper: (
      <p className="flex w-full justify-between gap-3">
        <span className="truncate">
          {item.qty} {item.name.toUpperCase()}
        </span>
        <span>{amount(item.price)}</span>
      </p>
    ),
    data: (
      <div className={cn("flex w-full items-center gap-3", item.confidence < 75 && "h-row-flag")}>
        <span className="min-w-0 flex-1 truncate">
          {item.name}
          {item.qty !== "1" && <span className="text-muted-foreground"> ×{item.qty}</span>}
        </span>
        <span className="tabular-nums">{item.price}</span>
        <Score value={item.confidence} />
      </div>
    ),
  })),
  {
    h: "rule",
    paper: <span className="h-px w-full border-t border-dashed border-(--h-paper-muted)/50" />,
    data: <span className="h-px w-full bg-white/[0.07]" />,
  },
  {
    h: "line",
    paper: (
      <p className="flex w-full justify-between">
        <span>SUBTOTAL</span>
        <span>{amount(demoReceipt.subtotal)}</span>
      </p>
    ),
    data: <Field label="subtotal">{demoReceipt.subtotal}</Field>,
  },
  {
    h: "line",
    paper: (
      <p className="flex w-full justify-between">
        <span>TAX</span>
        <span>{amount(demoReceipt.tax)}</span>
      </p>
    ),
    data: <Field label="tax">{demoReceipt.tax}</Field>,
  },
  {
    h: "total",
    paper: (
      <p className="flex w-full justify-between text-[15px] font-bold">
        <span>TOTAL</span>
        <span>{amount(demoReceipt.total)}</span>
      </p>
    ),
    data: (
      <Field label="total" strong>
        {demoReceipt.total}{" "}
        <span className="text-[11px] font-normal text-muted-foreground">
          {demoReceipt.currency}
        </span>
      </Field>
    ),
  },
  {
    h: "foot",
    paper: (
      <div className="flex w-full flex-col items-center gap-1.5">
        <span className="h-receipt-barcode h-5 w-44" />
        <span className="text-[10px] tracking-[0.2em] text-(--h-paper-muted)">THANK YOU</span>
      </div>
    ),
    data: (
      <div className="flex w-full items-center justify-between text-[11px]">
        <span className="text-muted-foreground">receipt confidence {demoReceipt.confidence}%</span>
        <span className="text-primary">ready to export</span>
      </div>
    ),
  },
];

function Layer({ kind }: { kind: "paper" | "data" }) {
  return (
    <div className={cn("h-receipt-layer", kind === "paper" ? "h-paper" : "h-data")}>
      {rows.map((row, i) => (
        <div className={cn("flex items-center", heights[row.h])} key={i}>
          {row[kind]}
        </div>
      ))}
    </div>
  );
}

export function ScanReceipt({ className }: { className?: string }) {
  return (
    <figure className={cn("relative", className)}>
      <div
        aria-label={`A receipt from ${demoReceipt.merchant} turning into data: ${items.length} line items, tax ${demoReceipt.tax}, total ${demoReceipt.total}. One line item is flagged for review.`}
        className="h-receipt-stage"
        role="img"
      >
        <div aria-hidden className="h-receipt">
          <Layer kind="paper" />
          <Layer kind="data" />
        </div>
        <div aria-hidden className="h-scan" />
      </div>
      <figcaption className="mt-6 flex items-baseline gap-3 font-mono text-[11px] text-muted-foreground">
        <span className="shrink-0 text-foreground">Fig. 0</span>
        <span>One receipt. Below the line is the paper; above it is what you get back.</span>
      </figcaption>
    </figure>
  );
}
