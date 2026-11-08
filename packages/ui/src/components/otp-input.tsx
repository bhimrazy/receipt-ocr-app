"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { OTP_LENGTH, applyInput, applyPaste, boxAt, overwriteDigit } from "../lib/otp";

export type OtpInputProps = {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Called once, with the code, when the last digit lands. Not called while `pending`. */
  onComplete?: (value: string) => void;
  /** Red ring, one shake, then focus returns to the field. Clear `value` yourself. */
  invalid?: boolean;
  /** Disables the field and shows a spinner while the code is checked. */
  pending?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-describedby"?: string;
  className?: string;
};

/**
 * Six digit boxes drawn over one real, transparent input, so SMS and email code suggestions,
 * password managers and paste behave as they do on a plain field, and a screen reader meets one field.
 */
export function OtpInput({
  id,
  value,
  onValueChange,
  onComplete,
  invalid,
  pending,
  disabled,
  autoFocus,
  "aria-describedby": describedBy,
  className,
}: OtpInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [focused, setFocused] = React.useState(false);
  const [selection, setSelection] = React.useState<[number, number]>([0, 0]);
  const blocked = Boolean(disabled || pending);

  const readSelection = () => {
    const input = inputRef.current;
    if (input) setSelection([input.selectionStart ?? 0, input.selectionEnd ?? 0]);
  };

  const place = (caret: number) => {
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(caret, caret);
      readSelection();
    });
  };

  React.useEffect(() => {
    if (!invalid) return;
    inputRef.current?.focus();
  }, [invalid]);

  const finish = (next: string, complete: boolean) => {
    onValueChange(next);
    if (complete && !blocked) onComplete?.(next);
  };

  const [start, end] = selection;
  const range = start !== end;

  return (
    <div className={cn("relative w-full max-w-72", className)} data-slot="otp-input">
      <div
        className={cn(
          "grid grid-cols-6 gap-1.5 transition-opacity sm:gap-2",
          invalid && "otp-shake",
          pending && "opacity-60",
        )}
        aria-hidden="true"
      >
        {Array.from({ length: OTP_LENGTH }, (_, i) => {
          const char = value[i];
          const active =
            focused &&
            !blocked &&
            (range ? i >= start && i < end : i === Math.min(start, OTP_LENGTH - 1));
          return (
            <div
              className={cn(
                "flex h-12 min-w-0 items-center justify-center rounded-lg border border-input bg-background/60 font-mono text-xl text-foreground transition",
                active && "border-primary ring-2 ring-ring/60",
                invalid && "border-destructive ring-2 ring-destructive/40",
                blocked && "cursor-not-allowed",
              )}
              data-active={active || undefined}
              key={i}
            >
              {char ?? (active && !range && start === i ? <span className="otp-caret" /> : null)}
            </div>
          );
        })}
      </div>
      {pending ? (
        <Loader2
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 m-auto size-5 animate-spin text-foreground motion-reduce:animate-none"
        />
      ) : null}
      <input
        aria-describedby={describedBy}
        aria-invalid={invalid ? true : undefined}
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        className="absolute inset-0 size-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none selection:bg-transparent disabled:cursor-not-allowed"
        disabled={blocked}
        id={id}
        inputMode="numeric"
        maxLength={OTP_LENGTH}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const { value: next, complete } = applyInput(value, event.target.value);
          finish(next, complete);
          readSelection();
        }}
        onFocus={() => {
          setFocused(true);
          readSelection();
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const input = event.currentTarget;
          const caret = input.selectionStart ?? 0;
          if (input.selectionEnd !== caret) return;
          const next = overwriteDigit(value, caret, event.key);
          if (!next) return;
          event.preventDefault();
          onValueChange(next.value);
          place(next.caret);
        }}
        onKeyUp={readSelection}
        onPaste={(event) => {
          event.preventDefault();
          const input = event.currentTarget;
          const result = applyPaste(
            value,
            input.selectionStart ?? value.length,
            input.selectionEnd ?? value.length,
            event.clipboardData.getData("text"),
          );
          finish(result.value, result.complete);
          place(result.caret);
        }}
        onPointerUp={(event) => {
          const input = event.currentTarget;
          const rect = input.getBoundingClientRect();
          const caret = boxAt(event.clientX - rect.left, rect.width, value.length);
          input.setSelectionRange(caret, caret);
          readSelection();
        }}
        onSelect={readSelection}
        pattern="[0-9]*"
        ref={inputRef}
        spellCheck={false}
        value={value}
      />
    </div>
  );
}
