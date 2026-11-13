import { receiptDateParts } from "@/lib/format";

/** A receipt's date in the calendar it printed: "9 Shrawan 2080 · 25 Jul 2023" with the AD day muted, or the AD day. */
export function ReceiptDate({
  date,
  calendar,
  fallback,
  stacked,
}: {
  date: string | null;
  calendar: string | null;
  fallback: React.ReactNode;
  /** The AD day on its own line, for a narrow field. */
  stacked?: boolean;
}) {
  const parts = receiptDateParts(date, calendar);
  if (!parts) return <>{fallback}</>;
  if (!parts.bs) return <>{parts.ad}</>;
  return stacked ? (
    <>
      <span className="block">{parts.bs}</span>
      <span className="block text-muted-foreground">{parts.ad}</span>
    </>
  ) : (
    <>
      {parts.bs}
      <span className="text-muted-foreground"> · {parts.ad}</span>
    </>
  );
}
