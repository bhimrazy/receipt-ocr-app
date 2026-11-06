import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import {
  EXTRACTION_FAILED_MESSAGE,
  FREE_FAILED_ROUNDS,
  MAX_EXTRACTION_ATTEMPTS,
  type ReceiptWithItems,
} from "@receipt-ocr/core";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@receipt-ocr/ui/components/alert";
import { Card } from "@receipt-ocr/ui/components/card";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { cn } from "@receipt-ocr/ui/lib/utils";
import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Loader2,
  FileText,
  ReceiptText,
  TriangleAlert,
  Upload,
} from "lucide-react";
import Link from "next/link";
import {
  confidenceLevel,
  formatConfidence,
  formatDate,
  formatDateTime,
  formatMoney,
} from "@/lib/format";
import { ProcessingPoller } from "@/components/processing-poller";
import {
  ReceiptActions,
  ReceiptEditingProvider,
  ReceiptWorkspace,
} from "@/components/receipt-actions";
import { receiptTitle } from "@/components/receipt-list";
import { ConfidenceBadge, StatusBadge, isInFlight } from "@/components/receipt-status";
import { RetryReceiptButton } from "@/components/retry-receipt-button";

const FAILED_FALLBACK = {
  photo: "The photo may be blurry, cropped or too dark. Try again, or upload a clearer photo.",
  pdf: "The PDF may be a blurry scan or have no receipt in it. Try again, or upload a clearer copy.",
};

/** "photo" or "PDF", so failure and review copy names what the person actually uploaded. */
function fileNoun(receipt: { imageObjectKey: string | null }) {
  return receipt.imageObjectKey?.endsWith(".pdf") ? "PDF" : "photo";
}

function toNumber(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Items (or subtotal) + tax + tip vs total; null when there's nothing to compare. */
function totalsMismatch(receipt: ReceiptWithItems) {
  const total = toNumber(receipt.total);
  if (total === null) return null;
  const itemsSum = receipt.items.length
    ? receipt.items.reduce((sum, item) => sum + (toNumber(item.totalPrice) ?? 0), 0)
    : null;
  const base = toNumber(receipt.subtotal) ?? itemsSum;
  if (base === null) return null;
  const expected = base + (toNumber(receipt.tax) ?? 0) + (toNumber(receipt.tip) ?? 0);
  return Math.abs(expected - total) > 0.01 ? expected : null;
}

/** Everything a person should look at before trusting this receipt, in plain words. */
function checksFor(receipt: ReceiptWithItems, money: (value: string | null) => string | null) {
  const checks: string[] = [];
  const level = confidenceLevel(receipt.confidence);
  if (level === "review" || level === "check") {
    checks.push(
      `Overall confidence is ${formatConfidence(receipt.confidence)}. Compare the merchant, date and total with the ${fileNoun(receipt)}.`,
    );
  }
  const lowLines = receipt.items.filter((item) => confidenceLevel(item.confidence) === "review");
  if (lowLines.length > 0) {
    checks.push(
      lowLines.length === 1
        ? "1 line was hard to read. It's marked in Line items."
        : `${lowLines.length} lines were hard to read. They're marked in Line items.`,
    );
  }
  const expected = totalsMismatch(receipt);
  if (expected !== null) {
    checks.push(
      `The amounts add up to ${money(String(expected))}, but the total says ${money(receipt.total)}. Check for a discount or a misread number.`,
    );
  }
  if (!receipt.merchant) checks.push("No merchant name was found.");
  if (!receipt.receiptDate) checks.push("No date was found.");
  if (toNumber(receipt.total) === null) checks.push("No total was found.");
  return checks;
}

function NotFound() {
  return <span className="text-muted-foreground">Not found</span>;
}

/** Subtotal, tax and tip are often absent from a receipt; a dash, not a warning. */
function None() {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">None</span>
    </>
  );
}

function Field({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-sm break-words", mono && "font-mono tabular-nums")}>
        {children}
      </dd>
    </div>
  );
}

export function ReceiptResult({
  receipt,
  canEdit,
}: {
  receipt: ReceiptWithItems;
  /** False for members viewing someone else's receipt: no edit or delete controls. */
  canEdit: boolean;
}) {
  const inFlight = isInFlight(receipt.status);
  const completed = receipt.status === "completed";
  const failed = receipt.status === "failed";
  const currency = receipt.currency ?? "USD";
  const title = receiptTitle(receipt);
  const money = (value: string | null) => formatMoney(value, currency);
  const triesLeft = Math.max(0, MAX_EXTRACTION_ATTEMPTS - receipt.attempts);

  const header = (
    <PageHeader className="sm:flex-col sm:items-stretch md:flex-row md:items-start">
      <PageHeaderContent>
        <PageHeaderTitle className={cn(title.isFile && "font-mono text-xl md:text-2xl")}>
          {title.text}
        </PageHeaderTitle>
        <PageHeaderDescription className="mt-2.5 flex max-w-none flex-wrap items-center gap-x-3 gap-y-2">
          {completed ? (
            <>
              <span>{formatDate(receipt.receiptDate) ?? "No date found"}</span>
              {receipt.category ? <Badge variant="secondary">{receipt.category}</Badge> : null}
              <ConfidenceBadge value={receipt.confidence} />
            </>
          ) : (
            <>
              <StatusBadge status={receipt.status} />
              <span>Uploaded {formatDateTime(receipt.createdAt)}</span>
            </>
          )}
        </PageHeaderDescription>
      </PageHeaderContent>
      <ReceiptActions canEdit={canEdit} canRetry={failed && triesLeft > 0} receipt={receipt} />
    </PageHeader>
  );

  const noun = fileNoun(receipt);
  const isPdf = noun === "PDF";

  const image = (
    <Card className="flex flex-col overflow-hidden lg:sticky lg:top-6">
      <div
        className={cn(
          "flex flex-1 items-center justify-center bg-background/40 p-4",
          receipt.imageUrl ? "min-h-72 lg:min-h-96" : "min-h-40",
        )}
      >
        {receipt.imageUrl && isPdf ? (
          <div className="flex flex-col items-center text-center">
            <FileText aria-hidden="true" className="mb-3 size-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">This receipt is a PDF.</p>
          </div>
        ) : receipt.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`Photo of the receipt${completed && receipt.merchant ? ` from ${receipt.merchant}` : ""}`}
            // On phones only the top of a long receipt shows (merchant and date); "Open full size" has the rest.
            className="max-h-80 w-full rounded-md object-cover object-top sm:w-auto sm:object-contain lg:max-h-[70vh]"
            src={receipt.imageUrl}
          />
        ) : (
          <div className="flex flex-col items-center text-center">
            <ReceiptText aria-hidden="true" className="mb-3 size-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">The file isn&apos;t available.</p>
          </div>
        )}
      </div>
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate font-mono">
          {receipt.fileName ?? (isPdf ? "PDF" : "Photo")}
        </span>
        {receipt.imageUrl ? (
          <a
            className="inline-flex shrink-0 items-center gap-1 rounded-md font-medium text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
            href={receipt.imageUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {isPdf ? "Open PDF" : "Open full size"}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        ) : null}
      </div>
    </Card>
  );

  // Phones get Back from the top bar and Scan from the tab bar.
  const back = (
    <div className="mb-4 flex items-center justify-between gap-2 max-md:hidden">
      <Link
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-3")}
        href="/app/history"
      >
        <ArrowLeft aria-hidden="true" />
        History
      </Link>
      <Link className={buttonVariants({ variant: "ghost", size: "sm" })} href="/app">
        <Upload aria-hidden="true" />
        Upload another
      </Link>
    </div>
  );

  if (!completed) {
    return (
      <div className="mx-auto max-w-6xl">
        <ProcessingPoller id={receipt.id} status={receipt.status} />
        {back}
        {header}
        {inFlight ? (
          <div
            className="mb-6 flex items-start gap-3 rounded-lg border border-primary/25 bg-primary/10 p-4 text-sm"
            role="status"
          >
            <Loader2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none"
            />
            <div>
              <p className="font-medium">Reading this receipt</p>
              <p className="mt-1 text-muted-foreground">
                This usually takes a few seconds and the page updates by itself. You can leave; the
                result is saved to History.
              </p>
            </div>
          </div>
        ) : null}
        {failed ? (
          <Alert
            className="mb-6 flex flex-col gap-4 p-4 has-[>svg]:gap-x-4 sm:flex-row sm:items-start"
            variant="destructive"
          >
            <CircleAlert aria-hidden="true" className="size-5 shrink-0 max-sm:hidden" />
            <div className="min-w-0 flex-1">
              <AlertTitle>This receipt couldn&apos;t be read</AlertTitle>
              <AlertDescription className="mt-1">
                {/* The generic message repeats the heading, so say only the useful part. */}
                {!receipt.errorMessage || receipt.errorMessage === EXTRACTION_FAILED_MESSAGE
                  ? FAILED_FALLBACK[isPdf ? "pdf" : "photo"]
                  : receipt.errorMessage}
              </AlertDescription>
              <p className="mt-2 text-xs text-muted-foreground">
                {triesLeft > 0
                  ? `${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left for this ${noun}. Your first ${FREE_FAILED_ROUNDS} failed reads each day don't count toward your daily limit.`
                  : `This ${noun} was tried ${MAX_EXTRACTION_ATTEMPTS} times. Upload a clearer one instead.`}
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              {triesLeft > 0 ? <RetryReceiptButton receiptId={receipt.id} /> : null}
              <Link
                className={buttonVariants({ variant: triesLeft > 0 ? "outline" : "default" })}
                href="/app"
              >
                <Upload aria-hidden="true" />
                Upload a new {noun}
              </Link>
            </div>
          </Alert>
        ) : null}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {image}
          {failed ? (
            <Card className="p-5">
              <h2 className="text-sm font-medium">For a clearer {noun}</h2>
              <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-4 text-sm text-muted-foreground marker:text-primary">
                {isPdf ? (
                  <>
                    <li>Check the PDF opens and shows the receipt, not a cover page.</li>
                    <li>If it is a scan, scan again at a higher resolution.</li>
                    <li>Or take a photo of the paper receipt instead.</li>
                  </>
                ) : (
                  <>
                    <li>Lay the receipt flat, without folds.</li>
                    <li>Use even light and avoid glare and shadows.</li>
                    <li>Keep the whole receipt in the frame, including the total.</li>
                    <li>Hold the phone still so the text is sharp.</li>
                  </>
                )}
              </ul>
            </Card>
          ) : null}
          {inFlight ? (
            <Card aria-hidden="true" className="p-5">
              <p className="mb-4 text-sm text-muted-foreground">
                The merchant, date, line items and totals appear here.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {Array.from({ length: 6 }, (_, i) => (
                  <div className="space-y-2" key={i}>
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    );
  }

  const lowLines = receipt.items.filter((item) => confidenceLevel(item.confidence) === "review");

  const details = (
    <Card>
      <div className="border-b border-border py-4 pr-28 pl-5">
        <h2 className="text-sm font-medium">Details</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          These are the values that go in the CSV.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 sm:grid-cols-4">
        <div className="col-span-2">
          <Field label="Merchant">{receipt.merchant ?? <NotFound />}</Field>
        </div>
        <Field label="Date">{formatDate(receipt.receiptDate) ?? <NotFound />}</Field>
        <Field label="Category">{receipt.category ?? <NotFound />}</Field>
        <Field label="Currency" mono>
          {currency}
        </Field>
        <Field label="Subtotal" mono>
          {money(receipt.subtotal) ?? <None />}
        </Field>
        <Field label="Tax" mono>
          {money(receipt.tax) ?? <None />}
        </Field>
        <Field label="Tip" mono>
          {money(receipt.tip) ?? <None />}
        </Field>
      </dl>
      <div className="flex items-baseline justify-between gap-3 border-t border-border px-5 py-4">
        <span className="text-sm font-medium">Total</span>
        <span className="font-mono text-xl font-semibold text-primary tabular-nums">
          {money(receipt.total) ?? <NotFound />}
        </span>
      </div>
    </Card>
  );

  const items = (
    <Card className="overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-sm font-medium">Line items</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {receipt.items.length} {receipt.items.length === 1 ? "line" : "lines"}
        </span>
      </div>
      {receipt.items.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Quantity</th>
              <th scope="col">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {receipt.items.map((item) => {
              const low = confidenceLevel(item.confidence) === "review";
              return (
                <tr
                  className={cn(low && "bg-warning/5 shadow-[inset_3px_0_0_var(--warning)]")}
                  key={item.id}
                >
                  <td className="py-3 pr-3 pl-5 align-top">
                    <span className="block break-words">{item.name}</span>
                    {low ? (
                      <span className="mt-1 flex items-center gap-1 text-xs text-warning">
                        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
                        Check this line against the {noun}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right align-top font-mono whitespace-nowrap text-muted-foreground tabular-nums">
                    × {item.quantity}
                  </td>
                  <td className="py-3 pr-5 pl-3 text-right align-top font-mono whitespace-nowrap tabular-nums">
                    {money(item.totalPrice) ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No line items were found on this receipt. The totals above can still be corrected.
        </p>
      )}
      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        {lowLines.length > 0 ? "Marked lines were hard to read. " : null}
        Line items can&apos;t be edited yet.
      </p>
    </Card>
  );

  const json = JSON.stringify(receipt.rawJson ?? receipt, null, 2);
  const footer = (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90"
        />
        Raw extraction (JSON)
      </summary>
      <pre className="max-h-72 overflow-auto border-t border-border px-5 py-4 font-mono text-xs leading-6 whitespace-pre-wrap text-muted-foreground">
        {json}
      </pre>
    </details>
  );

  return (
    <ReceiptEditingProvider>
      <div className="mx-auto max-w-6xl">
        {back}
        {header}
        <ReceiptWorkspace
          canEdit={canEdit}
          checks={checksFor(receipt, money)}
          details={details}
          footer={footer}
          image={image}
          items={items}
          receipt={receipt}
        />
      </div>
    </ReceiptEditingProvider>
  );
}
