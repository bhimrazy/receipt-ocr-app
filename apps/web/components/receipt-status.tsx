import { Badge } from "@receipt-ocr/ui/components/badge";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert, CircleCheck, Eye, Loader2, TriangleAlert } from "lucide-react";
import { confidenceLevel, formatConfidence, type ConfidenceLevel } from "@/lib/format";
import type { ReceiptStatus } from "@/lib/receipts";

const STATUS = {
  completed: { label: "Done", variant: "success", icon: CircleCheck },
  processing: { label: "Scanning…", variant: "secondary", icon: Loader2 },
  uploaded: { label: "Scanning…", variant: "secondary", icon: Loader2 },
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

/**
 * Shown in place of the confidence badge once someone marked the receipt
 * reviewed: the score no longer says whether to trust it.
 */
export function CheckedBadge({ by, className }: { by?: string | null; className?: string }) {
  return (
    <Badge className={className} title={by ? `Checked by ${by}` : undefined} variant="success">
      <CircleCheck aria-hidden="true" />
      <span aria-hidden={by ? true : undefined}>Checked</span>
      {by ? <span className="sr-only">Checked by {by}</span> : null}
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
