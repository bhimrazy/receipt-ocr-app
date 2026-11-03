import { Plus } from "lucide-react";
import { cn } from "../lib/utils";

/**
 * Dependency-free disclosure built on native <details>/<summary>.
 * Keyboard- and screen-reader-accessible out of the box; no client JS needed,
 * so it can render inside server components.
 */
export function Accordion({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("divide-y divide-border rounded-xl border border-border", className)}
      {...props}
    />
  );
}

export function AccordionItem({
  question,
  children,
  className,
  ...props
}: { question: string } & Omit<React.HTMLAttributes<HTMLDetailsElement>, "title">) {
  return (
    <details
      className={cn("group px-5 [&_summary::-webkit-details-marker]:hidden", className)}
      {...props}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-sm font-medium text-foreground transition-colors hover:text-primary">
        {question}
        <Plus className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45 group-open:text-primary" />
      </summary>
      <div className="pb-5 text-sm leading-7 text-muted-foreground">{children}</div>
    </details>
  );
}
