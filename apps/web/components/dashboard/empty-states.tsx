import { Card } from "@receipt-ocr/ui/components/card";
import { ChartNoAxesColumn } from "lucide-react";
import Link from "next/link";

const link =
  "rounded-md font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/** Receipts exist, but none has been read yet: say what's happening and what to do. */
export function NoReadReceipts({ inFlight, failed }: { inFlight: number; failed: number }) {
  return (
    <Card className="flex items-start gap-3 p-5">
      <ChartNoAxesColumn
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-muted-foreground"
      />
      <div className="text-sm">
        <p className="font-medium">Spending shows here once a receipt has been read.</p>
        <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
          {inFlight > 0 ? (
            <li>
              {inFlight} {inFlight === 1 ? "receipt is" : "receipts are"} being read now. No action
              needed.
            </li>
          ) : null}
          {failed > 0 ? (
            <li>
              {failed} {failed === 1 ? "receipt" : "receipts"} couldn&apos;t be read.{" "}
              <Link className={link} href="/app/history?status=failed">
                Try again
              </Link>
            </li>
          ) : null}
        </ul>
      </div>
    </Card>
  );
}

/** The selected range has no receipts in this currency; offer a longer one. */
export function NothingInRange({
  what,
  span,
  widerHref,
}: {
  /** "receipts" or "EUR receipts". */
  what: string;
  span: string;
  widerHref?: string;
}) {
  return (
    <Card className="p-5 text-sm">
      <p className="font-medium">
        No {what} dated {span}.
      </p>
      <p className="mt-1 text-muted-foreground">
        Totals use the date printed on each receipt.
        {widerHref ? (
          <>
            {" "}
            <Link className={link} href={widerHref} scroll={false}>
              Show the last 12 months
            </Link>
          </>
        ) : null}
      </p>
    </Card>
  );
}
