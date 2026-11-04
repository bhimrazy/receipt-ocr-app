"use client";

import { Input } from "@receipt-ocr/ui/components/input";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleCheck, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { type AuthFieldProps, FieldShell } from "./auth-field";

/**
 * Password input with a show/hide toggle. With `minLength`, the rule is visible before the first
 * submit and turns green once met, so nobody learns it from an error.
 */
export function PasswordField({
  id,
  label,
  aside,
  minLength,
  value,
  ...props
}: Omit<AuthFieldProps, "type" | "hint" | "value"> & { value: string }) {
  const [visible, setVisible] = useState(false);
  const met = minLength !== undefined && value.length >= minLength;
  const hint =
    minLength === undefined ? undefined : (
      <span className={cn("inline-flex items-center gap-1.5", met && "text-primary")}>
        {met ? (
          <CircleCheck aria-hidden className="size-3.5" />
        ) : (
          <span aria-hidden className="size-3 rounded-full ring-1 ring-inset ring-current" />
        )}
        At least {minLength} characters
      </span>
    );

  return (
    <FieldShell aside={aside} hint={hint} id={id} label={label}>
      <div className="relative">
        <Input
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="h-11 pr-12"
          id={id}
          minLength={minLength}
          type={visible ? "text" : "password"}
          value={value}
          {...props}
        />
        <button
          aria-controls={id}
          aria-label="Show password"
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => setVisible((v) => !v)}
          type="button"
        >
          {visible ? (
            <EyeOff aria-hidden className="size-4" />
          ) : (
            <Eye aria-hidden className="size-4" />
          )}
        </button>
      </div>
    </FieldShell>
  );
}
