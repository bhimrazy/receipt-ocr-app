"use client";

import type { ReceiptWithItems } from "@receipt-ocr/core";
import { Button } from "@receipt-ocr/ui/components/button";
import { toast } from "@receipt-ocr/ui/components/toast";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, CircleCheck, Pencil, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";

type Review = { at: Date | string; name: string | null } | null;

const fromReceipt = (receipt: ReceiptWithItems): Review =>
  receipt.reviewedAt ? { at: receipt.reviewedAt, name: receipt.reviewer?.name ?? null } : null;

/**
 * The "check before you use this" card, or once someone has marked the receipt
 * reviewed, one line saying who and when. Editors can mark it reviewed and undo
 * that; the change shows at once and the page refreshes after.
 */
export function ReceiptChecks({
  receipt,
  checks,
  canEdit,
  viewerName,
  onCorrect,
}: {
  receipt: ReceiptWithItems;
  checks: string[];
  canEdit: boolean;
  viewerName: string;
  /** Opens the edit form; omitted while it is already open. */
  onCorrect?: () => void;
}) {
  const router = useRouter();
  const server = fromReceipt(receipt);
  const serverKey = `${server ? new Date(server.at).toISOString() : ""}|${server?.name ?? ""}`;
  const [review, setReview] = useState(server);
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    setReview(server);
  }
  const [saving, setSaving] = useState(false);
  // The control that replaces the one just used takes focus, so keyboard users aren't dropped to <body>.
  const focusAfter = useRef(false);
  const undoRef = useRef<HTMLButtonElement>(null);
  const looksRightRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusAfter.current) return;
    focusAfter.current = false;
    (review ? undoRef : looksRightRef).current?.focus();
  }, [review]);

  async function setReviewed(reviewed: boolean) {
    const previous = review;
    focusAfter.current = true;
    setReview(reviewed ? { at: new Date(), name: viewerName } : null);
    setSaving(true);
    const ok = await fetch(`/api/receipts/${receipt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed }),
    })
      .then((res) => res.ok)
      .catch(() => false);
    setSaving(false);
    if (!ok) {
      focusAfter.current = true;
      setReview(previous);
      toast.add({
        title: reviewed ? "Couldn't mark this receipt reviewed" : "Couldn't undo the review",
        description: "Try again.",
        type: "error",
      });
      return;
    }
    router.refresh();
  }

  if (review) {
    const date = formatDate(review.at);
    return (
      <p className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
        <span>{review.name ? `Reviewed by ${review.name}` : "Reviewed"}</span>
        {date ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{date}</span>
          </>
        ) : null}
        {canEdit ? (
          <>
            <span aria-hidden="true">·</span>
            <button
              aria-label="Undo review"
              className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-md:min-h-11"
              disabled={saving}
              onClick={() => void setReviewed(false)}
              ref={undoRef}
              type="button"
            >
              Undo
            </button>
          </>
        ) : null}
      </p>
    );
  }

  if (checks.length === 0) return null;

  return (
    <section
      aria-labelledby="checks-heading"
      className="relative mb-6 flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4"
    >
      <TriangleAlert
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-warning max-sm:hidden"
      />
      <div className="min-w-0 flex-1">
        <h2
          className={cn("text-sm font-medium text-warning", canEdit && "pr-8 max-md:pr-11")}
          id="checks-heading"
        >
          Check before you use this
        </h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground marker:text-warning">
          {checks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
        {canEdit ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={saving}
              onClick={() => void setReviewed(true)}
              ref={looksRightRef}
              size="sm"
              variant="outline"
            >
              <Check aria-hidden="true" />
              Looks right
            </Button>
            {onCorrect ? (
              <Button onClick={onCorrect} size="sm" variant="ghost">
                <Pencil aria-hidden="true" />
                Correct details
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <Button
          aria-label="Mark as reviewed"
          className="absolute top-2 right-2"
          disabled={saving}
          onClick={() => void setReviewed(true)}
          size="icon-sm"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      ) : null}
    </section>
  );
}
