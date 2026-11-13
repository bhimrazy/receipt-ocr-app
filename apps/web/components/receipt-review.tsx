"use client";

import type { ReceiptWithItems } from "@receipt-ocr/core";
import { Button } from "@receipt-ocr/ui/components/button";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@receipt-ocr/ui/components/tooltip";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Check, CircleCheck, Pencil, TriangleAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { CheckedBadge, NeedsReviewBadge } from "@/components/receipt-status";
import { formatDate } from "@/lib/format";

type Review = { at: Date | string; name: string | null } | null;

/** What to tell someone whose review didn't save; `status` is null when the request never got a response. */
export function reviewFailure(status: number | null) {
  if (status === null) return "Check your connection and try again.";
  if (status === 404)
    return "This receipt was deleted, or you can no longer change it. Refresh the page to see it as it is now.";
  return "Try again.";
}

const fromReceipt = (receipt: ReceiptWithItems): Review =>
  receipt.reviewedAt ? { at: receipt.reviewedAt, name: receipt.reviewer?.name ?? null } : null;

type ReviewState = {
  review: Review;
  setReviewed: (reviewed: boolean) => Promise<void>;
  /** Where focus goes after the person's own review or undo. */
  undoRef: React.RefObject<HTMLButtonElement | null>;
  looksRightRef: React.RefObject<HTMLButtonElement | null>;
};

const ReviewContext = createContext<ReviewState | null>(null);

function useReview() {
  const value = useContext(ReviewContext);
  if (!value) throw new Error("useReview needs ReceiptReviewProvider");
  return value;
}

/**
 * Review state shared by the header badge and the checks card, which sit in
 * different parts of the page. Marking reviewed shows at once, rolls back if the
 * save fails, and refreshes the page once it succeeds.
 */
export function ReceiptReviewProvider({
  receipt,
  viewerName,
  children,
}: {
  receipt: ReceiptWithItems;
  /** Shown as the reviewer until the refresh brings the saved one. */
  viewerName: string;
  children: React.ReactNode;
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
  // Not `disabled` while saving: the control that just appeared must be able to take focus.
  const saving = useRef(false);
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
    if (saving.current) return;
    saving.current = true;
    const previous = review;
    focusAfter.current = true;
    setReview(reviewed ? { at: new Date(), name: viewerName } : null);
    const status = await fetch(`/api/receipts/${receipt.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewed }),
    })
      .then((res) => res.status)
      .catch(() => null);
    saving.current = false;
    if (status === null || status >= 400) {
      focusAfter.current = true;
      setReview(previous);
      toast.add({
        title: reviewed ? "Couldn't mark this receipt reviewed" : "Couldn't undo the review",
        description: reviewFailure(status),
        type: "error",
      });
      return;
    }
    router.refresh();
  }

  return (
    <ReviewContext.Provider value={{ review, setReviewed, undoRef, looksRightRef }}>
      {children}
    </ReviewContext.Provider>
  );
}

/** The header's badge: Checked once reviewed, Needs review while it has reasons, else nothing. */
export function ReviewStateBadge({ needsReview }: { needsReview: boolean }) {
  const { review } = useReview();
  if (review) return <CheckedBadge by={review.name} />;
  return needsReview ? <NeedsReviewBadge /> : null;
}

/**
 * The "check before you use this" card, or once someone has marked the receipt
 * reviewed, one line saying who and when. Editors can mark it reviewed and undo that.
 */
export function ReceiptChecks({
  checks,
  canEdit,
  onCorrect,
}: {
  checks: string[];
  canEdit: boolean;
  /** Opens the edit form; omitted while it is already open. */
  onCorrect?: () => void;
}) {
  const { review, setReviewed, undoRef, looksRightRef } = useReview();

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
              className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Mark as reviewed"
                className="absolute top-2 right-2"
                onClick={() => void setReviewed(true)}
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <X aria-hidden="true" />
          </TooltipTrigger>
          <TooltipContent side="left">Mark as reviewed</TooltipContent>
        </Tooltip>
      ) : null}
    </section>
  );
}
