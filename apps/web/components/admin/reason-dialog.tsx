"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@receipt-ocr/ui/components/dialog";
import { Label } from "@receipt-ocr/ui/components/label";
import { Textarea } from "@receipt-ocr/ui/components/textarea";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";

/**
 * A confirmation that needs a written reason, which goes into the audit log.
 * `children` adds extra fields (e.g. the ban length) above the reason.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  reasonLabel,
  reasonHint,
  minLength,
  confirmLabel,
  destructive = false,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  reasonLabel: string;
  reasonHint: string;
  minLength: number;
  confirmLabel: string;
  destructive?: boolean;
  /** Return an error message to keep the dialog open. */
  onSubmit: (reason: string) => Promise<string | void>;
  children?: React.ReactNode;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on close, so the next open starts empty.
  function setOpen(next: boolean) {
    if (!next) {
      setReason("");
      setError(null);
      setPending(false);
    }
    onOpenChange(next);
  }

  const tooShort = reason.trim().length < minLength;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tooShort) {
      setError(`Write at least ${minLength} characters.`);
      return;
    }
    setPending(true);
    setError(null);
    const message = await onSubmit(reason.trim());
    if (message) {
      setError(message);
      setPending(false);
      return;
    }
    setOpen(false);
  }

  return (
    <Dialog onOpenChange={(next) => !pending && setOpen(next)} open={open}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" noValidate onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-reason`}>{reasonLabel}</Label>
            <Textarea
              aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              id={`${id}-reason`}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              required
              rows={3}
              value={reason}
            />
            <p className="text-xs text-muted-foreground" id={`${id}-hint`}>
              {reasonHint}
            </p>
          </div>
          {error ? (
            <p className="text-sm text-destructive" id={`${id}-error`} role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button disabled={pending} onClick={() => setOpen(false)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={pending}
              type="submit"
              variant={destructive ? "destructive" : "default"}
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
