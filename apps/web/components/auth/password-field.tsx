"use client";

import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleCheck } from "lucide-react";
import { PasswordInput } from "@/components/password-input";
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
      <PasswordInput
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="h-11"
        id={id}
        minLength={minLength}
        value={value}
        {...props}
      />
    </FieldShell>
  );
}
