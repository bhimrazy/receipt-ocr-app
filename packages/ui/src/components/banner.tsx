import * as React from "react";
import { cn } from "@receipt-ocr/ui/lib/utils";

const tones = {
  primary: { box: "border-primary/30 bg-primary/10", icon: "text-primary" },
  warning: { box: "border-warning/30 bg-warning/10", icon: "text-warning" },
} as const;

/**
 * A one-line notice at the top of a page, in the flow (never fixed). An `<aside>`, so name it
 * with `aria-label`; it is not a live region and isn't announced again on navigation. Actions
 * wrap onto their own row on narrow screens.
 */
function Banner({
  tone = "primary",
  icon: Icon,
  actions,
  className,
  children,
  ...props
}: React.ComponentProps<"aside"> & {
  tone?: keyof typeof tones;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  /** Buttons or links after the text. */
  actions?: React.ReactNode;
}) {
  return (
    <aside
      data-slot="banner"
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-lg border p-3 text-sm text-foreground sm:flex-nowrap sm:items-center",
        tones[tone].box,
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0 sm:mt-0", tones[tone].icon)} />
      <p className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-auto">{children}</p>
      {actions ? (
        <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:shrink-0">
          {actions}
        </div>
      ) : null}
    </aside>
  );
}

export { Banner };
