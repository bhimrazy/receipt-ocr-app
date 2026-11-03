import { Input } from "@receipt-ocr/ui/components/input";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleCheck } from "lucide-react";

/*
 * Ring, not border: the theme's global border-color currently overrides border utilities, which
 * hid the focus state. foreground/40 on the card is ~3.3:1, enough for WCAG 1.4.11.
 */
const inputClass = "h-11 ring-1 ring-inset ring-foreground/40 focus-visible:ring-2 focus-visible:ring-ring";

export const authCardClass =
  "w-full rounded-2xl bg-card/80 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl sm:p-8";

export function AuthField({
  id,
  label,
  hint,
  aside,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  aside?: React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-foreground" htmlFor={id}>
          {label}
        </label>
        {aside}
      </div>
      <Input aria-describedby={hintId} className={inputClass} id={id} {...props} />
      {hint && (
        <p className="text-xs text-muted-foreground" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-inset ring-red-500/30" role="alert">
      {children}
    </p>
  );
}

export function AuthNotice({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-5 flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2.5 text-sm text-primary ring-1 ring-inset ring-primary/30"
      role="status"
    >
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

export const authLinkClass = cn(
  "rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);
