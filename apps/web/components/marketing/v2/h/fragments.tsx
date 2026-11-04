import { cn } from "@receipt-ocr/ui/lib/utils";
import { AlertTriangle, Check, FileImage, FileSpreadsheet, Upload } from "lucide-react";
import { demoExport, demoReceipt } from "../../content";
import { uploadQueue } from "./copy";

/* Product fragments: drawn from the real screens, trimmed to the part each step is about. */

function PanelHeader({ title, meta }: { title: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-(--h-hairline) px-5 py-3.5">
      <p className="min-w-0 truncate text-sm font-medium">{title}</p>
      {meta && <p className="shrink-0 font-mono text-[11px] text-muted-foreground">{meta}</p>}
    </div>
  );
}

const statusLabel = { read: "Read", reading: "Reading", queued: "Queued" } as const;

export function UploadFragment() {
  const done = uploadQueue.filter((file) => file.status === "read").length;
  return (
    <div className="h-panel overflow-hidden">
      <PanelHeader meta={`${done} of ${uploadQueue.length} read`} title="Upload" />
      <ul className="divide-y divide-(--h-hairline)">
        {uploadQueue.map((file) => (
          <li className="flex items-center gap-3 px-5 py-3" key={file.name}>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.04] ring-1 ring-(--h-hairline)">
              <FileImage aria-hidden className="size-4 text-muted-foreground" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px]">{file.name}</span>
              <span className="block font-mono text-[11px] text-muted-foreground">{file.size}</span>
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-mono text-xs",
                file.status === "read" && "text-primary",
                file.status === "queued" && "text-muted-foreground",
              )}
            >
              {file.status === "read" && <Check aria-hidden className="size-3.5" />}
              {file.status === "reading" && (
                <span
                  aria-hidden
                  className="relative h-[3px] w-8 overflow-hidden rounded-full bg-white/10"
                >
                  <span className="absolute inset-y-0 left-0 w-3/5 rounded-full bg-primary" />
                </span>
              )}
              {statusLabel[file.status]}
            </span>
          </li>
        ))}
      </ul>
      <div className="m-3 flex items-center justify-center gap-2.5 rounded-lg border border-dashed border-white/10 px-4 py-5 text-center font-mono text-[11px] text-muted-foreground">
        <Upload aria-hidden className="size-3.5 shrink-0" />
        Drop receipts here · PNG, JPG, HEIC · 10 MB each
      </div>
    </div>
  );
}

export function CheckFragment() {
  return (
    <div className="h-panel overflow-hidden">
      <PanelHeader meta={`${demoReceipt.confidence}% confidence`} title={demoReceipt.merchant} />
      <table className="w-full text-[13px]">
        <caption className="sr-only">Line items with confidence scores</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Price</th>
            <th scope="col">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {demoReceipt.items.map((item) => {
            const low = item.confidence < 75;
            return (
              <tr
                className={cn(
                  "border-b border-(--h-hairline)",
                  low && "bg-warning/[0.07] shadow-[inset_2px_0_0_var(--warning)]",
                )}
                key={item.name}
              >
                <td className="py-2.5 pl-5 pr-2">
                  {item.name}
                  {low && (
                    <span className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-warning">
                      <AlertTriangle aria-hidden className="size-3" />
                      Low confidence, check this line
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right align-top font-mono tabular-nums">
                  {item.price}
                </td>
                <td className="py-2.5 pl-2 pr-5 text-right align-top">
                  <span
                    className={cn(
                      "inline-flex items-center gap-2 font-mono text-xs tabular-nums",
                      low ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    <span
                      aria-hidden
                      className="relative h-[3px] w-10 overflow-hidden rounded-full bg-white/10"
                    >
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full",
                          low ? "bg-warning" : "bg-white/40",
                        )}
                        style={{ width: `${item.confidence}%` }}
                      />
                    </span>
                    {item.confidence}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-3 p-5">
        {[
          ["Date", demoReceipt.date, false],
          ["Category", demoReceipt.category, false],
          ["Tax", demoReceipt.tax, false],
          ["Total", demoReceipt.total, true],
        ].map(([label, value, active]) => (
          <div key={String(label)}>
            <p className="font-mono text-[11px] text-muted-foreground">{label}</p>
            <p
              className={cn(
                "mt-1.5 flex h-10 items-center rounded-md bg-white/[0.03] px-3 text-sm ring-1 ring-white/10",
                active && "ring-2 ring-primary/80",
                (label === "Tax" || label === "Total") && "justify-end font-mono tabular-nums",
              )}
            >
              {value}
              {active && <span aria-hidden className="ml-px h-4 w-px bg-primary" />}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExportFragment() {
  return (
    <div className="h-panel overflow-hidden">
      <PanelHeader
        meta={`${demoExport.length} rows`}
        title={
          <span className="inline-flex items-center gap-2 font-mono text-[13px]">
            <FileSpreadsheet aria-hidden className="size-4 text-primary" />
            receipts.csv
          </span>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap font-mono text-[12.5px]">
          <caption className="sr-only">Exported receipts</caption>
          <thead>
            <tr className="border-b border-(--h-hairline) text-[11px] text-muted-foreground">
              <th className="py-2.5 pl-4 pr-2 sm:pl-5 sm:pr-3 text-left font-normal" scope="col">
                date
              </th>
              <th className="px-2 py-2.5 sm:px-3 text-left font-normal" scope="col">
                merchant
              </th>
              <th className="px-2 py-2.5 sm:px-3 text-left font-normal max-sm:hidden" scope="col">
                category
              </th>
              <th className="px-2 py-2.5 sm:px-3 text-right font-normal" scope="col">
                tax
              </th>
              <th className="py-2.5 pl-2 pr-4 sm:pl-3 sm:pr-5 text-right font-normal" scope="col">
                total
              </th>
            </tr>
          </thead>
          <tbody>
            {demoExport.map((row, i) => (
              <tr
                className={cn(i < demoExport.length - 1 && "border-b border-(--h-hairline)")}
                key={row.date}
              >
                <td className="py-2.5 pl-4 pr-2 sm:pl-5 sm:pr-3 text-muted-foreground">
                  {row.date}
                </td>
                <td className="px-2 py-2.5 sm:px-3">{row.merchant}</td>
                <td className="px-2 py-2.5 sm:px-3 text-muted-foreground max-sm:hidden">
                  {row.category}
                </td>
                <td className="px-2 py-2.5 sm:px-3 text-right tabular-nums">${row.tax}</td>
                <td className="py-2.5 pl-2 pr-4 sm:pl-3 sm:pr-5 text-right tabular-nums">
                  ${row.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
