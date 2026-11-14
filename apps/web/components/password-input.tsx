"use client";

import { Input } from "@receipt-ocr/ui/components/input";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type"> & { id: string };

/** A password input with a show/hide toggle; the toggle never submits the surrounding form. */
export function PasswordInput({ id, className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        autoCapitalize="none"
        className={cn("pr-12", className)}
        id={id}
        spellCheck={false}
        type={visible ? "text" : "password"}
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
  );
}
