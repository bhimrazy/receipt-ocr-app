"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { useState } from "react";

const DURATIONS: { label: string; seconds?: number }[] = [
  { label: "Permanent", seconds: undefined },
  { label: "1 day", seconds: 60 * 60 * 24 },
  { label: "7 days", seconds: 60 * 60 * 24 * 7 },
  { label: "30 days", seconds: 60 * 60 * 24 * 30 },
];

export function BanDialog({
  open,
  userEmail,
  onClose,
  onSubmit,
}: {
  open: boolean;
  userEmail: string;
  onClose: () => void;
  onSubmit: (reason: string | undefined, expiresInSeconds: number | undefined) => void;
}) {
  const [reason, setReason] = useState("");
  const [durationIndex, setDurationIndex] = useState(0);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-left shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h2 className="text-lg font-semibold">Ban user</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Banning <span className="font-medium text-foreground">{userEmail}</span> ends their
          sessions and blocks sign-in.
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="ban-reason">
          Reason
        </label>
        <Input
          className="mt-1.5"
          id="ban-reason"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason for the ban (optional)"
          value={reason}
        />

        <p className="mt-4 text-sm font-medium">Duration</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {DURATIONS.map((duration, index) => (
            <Button
              key={duration.label}
              onClick={() => setDurationIndex(index)}
              size="sm"
              type="button"
              variant={durationIndex === index ? "default" : "outline"}
            >
              {duration.label}
            </Button>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSubmit(reason.trim() || undefined, DURATIONS[durationIndex].seconds);
              onClose();
            }}
            size="sm"
            type="button"
          >
            Ban user
          </Button>
        </div>
      </div>
    </div>
  );
}
