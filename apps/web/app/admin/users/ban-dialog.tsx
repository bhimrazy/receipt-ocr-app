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
import { Input } from "@receipt-ocr/ui/components/input";
import { Label } from "@receipt-ocr/ui/components/label";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

const DURATIONS: { label: string; seconds?: number }[] = [
  { label: "Permanent", seconds: undefined },
  { label: "1 day", seconds: 60 * 60 * 24 },
  { label: "7 days", seconds: 60 * 60 * 24 * 7 },
  { label: "30 days", seconds: 60 * 60 * 24 * 30 },
];

export function BanDialog({
  open,
  userEmail,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  userEmail: string;
  onOpenChange: (open: boolean) => void;
  /** Return an error message to keep the dialog open. */
  onSubmit: (
    reason: string | undefined,
    expiresInSeconds: number | undefined,
  ) => Promise<string | void>;
}) {
  const [reason, setReason] = useState("");
  const [durationIndex, setDurationIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReason("");
      setDurationIndex(0);
      setError(null);
      setPending(false);
    }
  }, [open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const message = await onSubmit(reason.trim() || undefined, DURATIONS[durationIndex].seconds);
    setPending(false);
    if (message) {
      setError(message);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={(next) => !pending && onOpenChange(next)} open={open}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Ban {userEmail}?</DialogTitle>
            <DialogDescription>
              This ends their sessions and stops them signing in until the ban ends or you lift it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ban-reason">Reason (optional)</Label>
            <Input
              autoComplete="off"
              id="ban-reason"
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Spam uploads"
              value={reason}
            />
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Duration</legend>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((duration, index) => (
                <Button
                  aria-pressed={durationIndex === index}
                  key={duration.label}
                  onClick={() => setDurationIndex(index)}
                  size="sm"
                  type="button"
                  variant={durationIndex === index ? "secondary" : "outline"}
                  className={durationIndex === index ? "border-primary/50 text-primary" : undefined}
                >
                  {duration.label}
                </Button>
              ))}
            </div>
          </fieldset>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={pending} type="submit" variant="destructive">
              {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              Ban user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
