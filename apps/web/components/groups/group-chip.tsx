import type { GroupColor } from "@receipt-ocr/core/group-rules";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { X } from "lucide-react";
import Link from "next/link";
import { GROUP_DOT_CLASS } from "./group-colors";

export function GroupDot({ color, className }: { color: GroupColor; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("size-2.5 shrink-0 rounded-full", GROUP_DOT_CLASS[color], className)}
    />
  );
}

const CHIP =
  "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-secondary/60 text-xs font-medium text-foreground";

/**
 * A group's name with its colour. Links to History filtered by the group when
 * `href` is set; shows a remove button when `onRemove` is.
 */
export function GroupChip({
  group,
  href,
  onRemove,
  removing,
}: {
  group: { name: string; color: GroupColor };
  href?: string;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const label = (
    <>
      <GroupDot color={group.color} />
      <span className="truncate">{group.name}</span>
    </>
  );
  return (
    <span className={cn(CHIP, onRemove ? "pr-0.5 pl-2.5" : "px-2.5")}>
      {href ? (
        <Link
          className="inline-flex min-h-7 min-w-0 items-center gap-1.5 rounded-full outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-9"
          href={href}
        >
          {label}
        </Link>
      ) : (
        <span className="inline-flex min-h-7 min-w-0 items-center gap-1.5 max-md:min-h-9">
          {label}
        </span>
      )}
      {onRemove ? (
        <button
          aria-label={`Remove from ${group.name}`}
          className="ml-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-wash hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-md:size-9"
          disabled={removing}
          onClick={onRemove}
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}
