"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@receipt-ocr/ui/components/alert-dialog";
import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Name the target and the consequence. */
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  confirmText?: string;
  /**
   * Gets the text typed for `confirmText` (empty without it), so the server can
   * check it too. Rejecting (or returning an error string) keeps the dialog open.
   */
  onConfirm: (typed: string) => Promise<string | void> | string | void;
};

/**
 * Confirmation for destructive or privileged actions. Focus starts on Cancel
 * so Enter never confirms by accident; Escape and focus return come from
 * the Base UI AlertDialog.
 */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  confirmText,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const inputId = React.useId();
  const [typed, setTyped] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setTyped("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(typed);
      if (typeof result === "string") {
        setError(result);
        setPending(false);
        return;
      }
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
      setPending(false);
    }
  }

  const blocked = confirmText !== undefined && typed.trim() !== confirmText;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent initialFocus={confirmText !== undefined ? inputRef : cancelRef}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmText !== undefined ? (
          <div className="flex flex-col gap-2">
            <Label className="block text-xs leading-5 text-muted-foreground" htmlFor={inputId}>
              Type <span className="font-mono break-all text-foreground">{confirmText}</span> to
              confirm
            </Label>
            <Input
              autoComplete="off"
              id={inputId}
              onChange={(event) => setTyped(event.target.value)}
              ref={inputRef}
              value={typed}
            />
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} ref={cancelRef}>
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            disabled={pending || blocked}
            onClick={confirm}
            variant={destructive ? "destructive" : "default"}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export { ConfirmDialog, type ConfirmDialogProps };
