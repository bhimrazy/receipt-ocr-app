import { Badge } from "@receipt-ocr/ui/components/badge";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert, CircleCheck, Copy, Eye, Loader2, TriangleAlert } from "lucide-react";
import { confidenceLevel, formatConfidence, type ConfidenceLevel } from "@/lib/format";
import type { ReceiptStatus } from "@/lib/receipts";

const STATUS = {
  completed: { label: "Done", variant: "success", icon: CircleCheck },
  processing: { label: "Scanning", variant: "secondary", icon: Loader2 },
  uploaded: { label: "Scanning", variant: "secondary", icon: Loader2 },
  failed: { label: "Couldn't scan", variant: "destructive", icon: CircleAlert },
} as const;

export function isInFlight(status: ReceiptStatus) {
  return status === "processing" || status === "uploaded";
}

/** Status with an icon and a plain-words label, never colour alone. */
export function StatusBadge({ status, className }: { status: ReceiptStatus; className?: string }) {
  const { label, variant, icon: Icon } = STATUS[status] ?? STATUS.processing;
  return (
    <Badge className={className} variant={variant}>
      <Icon
        aria-hidden="true"
        className={cn(isInFlight(status) && "animate-spin motion-reduce:animate-none")}
      />
      {label}
    </Badge>
  );
}

export const CONFIDENCE = {
  high: { label: "High", variant: "success", icon: CircleCheck, hint: "High confidence" },
  check: {
    label: "Check",
    variant: "warning",
    icon: Eye,
    hint: "Medium confidence, worth a quick check",
  },
  review: {
    label: "Review",
    variant: "destructive",
    icon: TriangleAlert,
    hint: "Low confidence, please verify",
  },
} as const satisfies Record<ConfidenceLevel, unknown>;

export type ReviewState = "needs-review" | "not-reviewed" | "reviewed";

/**
 * A completed receipt's review state, as the list filter and Home count it: Reviewed once someone
 * vouched for it, Needs review while a check failed, else Not reviewed. Never blank.
 */
export function reviewState(receipt: {
  reviewReasons: readonly string[];
  reviewedAt: Date | string | null;
}): ReviewState {
  if (receipt.reviewedAt) return "reviewed";
  return receipt.reviewReasons.length > 0 ? "needs-review" : "not-reviewed";
}

/**
 * The review state as shown everywhere. Colour is kept for Needs review, the state that needs the
 * person; Reviewed and Not reviewed are muted text.
 */
export function ReviewStatus({
  state,
  by,
  className,
}: {
  state: ReviewState;
  /** The reviewer's name, for Reviewed. */
  by?: string | null;
  className?: string;
}) {
  if (state === "needs-review") {
    return (
      <Badge className={className} variant="warning">
        <TriangleAlert aria-hidden="true" />
        Needs review
      </Badge>
    );
  }
  if (state === "reviewed") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground",
          className,
        )}
        title={by ? `Reviewed by ${by}` : undefined}
      >
        <CircleCheck aria-hidden="true" className="size-3.5 text-primary" />
        <span aria-hidden={by ? true : undefined}>Reviewed</span>
        {by ? <span className="sr-only">Reviewed by {by}</span> : null}
      </span>
    );
  }
  return (
    <span className={cn("shrink-0 text-xs whitespace-nowrap text-muted-foreground", className)}>
      Not reviewed
    </span>
  );
}

/** Shown beside the review state while another receipt looks like the same bill. */
export function DuplicateBadge({ className }: { className?: string }) {
  return (
    <Badge className={className} variant="warning">
      <Copy aria-hidden="true" />
      Possible duplicate
    </Badge>
  );
}

/** Confidence tier (High / Check / Review) with icon, label and score. */
export function ConfidenceBadge({
  value,
  className,
  showScore = true,
}: {
  value: string | number | null | undefined;
  className?: string;
  showScore?: boolean;
}) {
  const level = confidenceLevel(value);
  if (!level) return null;
  const { label, variant, icon: Icon, hint } = CONFIDENCE[level];
  const score = formatConfidence(value);
  return (
    <Badge
      className={cn("font-mono tabular-nums", className)}
      title={`${hint} (${score})`}
      variant={variant}
    >
      <Icon aria-hidden="true" />
      <span className="font-sans">{label}</span>
      {showScore ? <span>{score}</span> : <span className="sr-only">{score}</span>}
    </Badge>
  );
}
