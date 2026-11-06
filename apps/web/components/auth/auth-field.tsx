import { Input } from "@receipt-ocr/ui/components/input";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert, CircleCheck, Info } from "lucide-react";

// Server-safe on purpose: AuthLayout and the server pages import these constants and components.

export const authCardClass =
  "w-full min-w-0 rounded-2xl bg-card/85 p-6 shadow-2xl shadow-black/40 ring-1 ring-border backdrop-blur-xl sm:p-8";

export const authLinkClass =
  "rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AuthHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children ? (
        <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">{children}</p>
      ) : null}
    </div>
  );
}

export type AuthFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: React.ReactNode;
  aside?: React.ReactNode;
};

export function FieldShell({
  id,
  label,
  hint,
  aside,
  children,
}: Pick<AuthFieldProps, "id" | "label" | "hint" | "aside"> & { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-foreground" htmlFor={id}>
          {label}
        </label>
        {aside}
      </div>
      {children}
      {hint ? (
        <div className="text-xs leading-5 text-muted-foreground" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function AuthField({ id, label, hint, aside, className, ...props }: AuthFieldProps) {
  return (
    <FieldShell aside={aside} hint={hint} id={id} label={label}>
      <Input
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn("h-11", className)}
        id={id}
        {...props}
      />
    </FieldShell>
  );
}

/** Email input with the attributes phones and password managers need. */
export function EmailField(props: Omit<AuthFieldProps, "type">) {
  return (
    <AuthField
      autoCapitalize="none"
      autoComplete="email"
      inputMode="email"
      spellCheck={false}
      type="email"
      {...props}
    />
  );
}

export function AuthError({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-left text-sm leading-6 text-destructive ring-1 ring-inset ring-destructive/30",
        className,
      )}
      role="alert"
    >
      <CircleAlert aria-hidden className="mt-1 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** `success` confirms something that just happened; `info` explains what this page is for. */
export function AuthNotice({
  children,
  className,
  kind = "success",
}: {
  children: React.ReactNode;
  className?: string;
  kind?: "success" | "info";
}) {
  const Icon = kind === "success" ? CircleCheck : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm leading-6 ring-1 ring-inset",
        kind === "success"
          ? "bg-primary/10 text-primary ring-primary/30"
          : "bg-secondary text-foreground ring-border [&>svg]:text-primary",
        className,
      )}
      role="status"
    >
      <Icon aria-hidden className="mt-1 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** "or" rule between the provider buttons and the email form. */
export function AuthDivider({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
      <span aria-hidden className="h-px flex-1 bg-border" />
      {children}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Card for a single message with one or two actions: check your email, link expired, invite
 * cannot be used. `tone` picks the icon badge colour.
 */
export function AuthMessage({
  icon: Icon,
  tone = "primary",
  title,
  children,
  actions,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  tone?: "primary" | "warning" | "destructive";
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className={authCardClass}>
      <span
        className={cn(
          "mb-5 flex size-11 items-center justify-center rounded-xl ring-1 ring-inset",
          tone === "primary" && "bg-primary/10 text-primary ring-primary/25",
          tone === "warning" && "bg-warning/10 text-warning ring-warning/25",
          tone === "destructive" && "bg-destructive/10 text-destructive ring-destructive/25",
        )}
      >
        <Icon aria-hidden className="size-5" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight focus:outline-none" tabIndex={-1}>
        {title}
      </h1>
      <div className="mt-3 flex flex-col gap-3 text-pretty text-sm leading-6 text-muted-foreground">
        {children}
      </div>
      {actions ? <div className="mt-6 flex flex-col gap-2.5">{actions}</div> : null}
    </div>
  );
}
