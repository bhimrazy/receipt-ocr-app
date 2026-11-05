import { cn } from "@receipt-ocr/ui/lib/utils";

/** Title block at the top of a signed-in page: content on the left, actions beside it from sm up. */
export function PageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
      data-slot="page-header"
      {...props}
    />
  );
}

/** Breadcrumb, title and description. */
export function PageHeaderContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0", className)} {...props} />;
}

export function PageHeaderTitle({ className, ...props }: React.ComponentProps<"h1">) {
  return (
    <h1
      className={cn("text-2xl font-semibold tracking-tight wrap-break-word md:text-3xl", className)}
      {...props}
    />
  );
}

/** A div, so it can hold badges and inline metadata as well as text. */
export function PageHeaderDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("mt-2 max-w-2xl text-sm text-muted-foreground", className)} {...props} />
  );
}

export function PageHeaderActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 flex-wrap gap-2", className)} {...props} />;
}
