import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

/** "1–25 of 140" with Previous / Next links that keep the other URL params. */
export function Pager({
  page,
  pageSize,
  total,
  params,
  noun,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | undefined>;
  noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) next.set(key, value);
    if (target > 1) next.set("page", String(target));
    else next.delete("page");
    const query = next.toString();
    return query ? `?${query}` : "?";
  };
  const link = (target: number, children: React.ReactNode, disabled: boolean) =>
    disabled ? (
      <span
        aria-disabled="true"
        className={cn(
          buttonVariants({ variant: "outline", size: "sm" }),
          "pointer-events-none opacity-50",
        )}
      >
        {children}
      </span>
    ) : (
      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={href(target)}>
        {children}
      </Link>
    );

  return (
    <nav
      aria-label="Pages"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
    >
      <p className="font-mono text-xs tabular-nums">
        {total === 0 ? `No ${noun}` : `${from}–${to} of ${total.toLocaleString("en-US")} ${noun}`}
      </p>
      {pages > 1 ? (
        <div className="flex gap-2">
          {link(
            page - 1,
            <>
              <ChevronLeft aria-hidden="true" />
              Previous
            </>,
            page <= 1,
          )}
          {link(
            page + 1,
            <>
              Next
              <ChevronRight aria-hidden="true" />
            </>,
            page >= pages,
          )}
        </div>
      ) : null}
    </nav>
  );
}
