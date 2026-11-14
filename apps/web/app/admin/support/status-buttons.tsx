"use client";

import { withStepUp } from "@/components/step-up/step-up";
import { Button } from "@receipt-ocr/ui/components/button";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Check, Inbox, RotateCcw } from "lucide-react";
import { useTransition } from "react";
import { setSupportStatusAction } from "../actions";

type Status = "new" | "open" | "closed";
type Move = { to: Status; label: string; done: string; icon: typeof Check };

const close: Move = { to: "closed", label: "Close", done: "Closed", icon: Check };
const MOVES: Record<Status, Move[]> = {
  new: [{ to: "open", label: "Mark open", done: "Marked open", icon: Inbox }, close],
  open: [close],
  closed: [{ to: "open", label: "Reopen", done: "Reopened", icon: RotateCcw }],
};

/** The status changes a message in `status` can make; each is audited. */
export function StatusButtons({
  messageId,
  status,
  sender,
  openHintId,
}: {
  messageId: string;
  status: Status;
  sender: string;
  openHintId?: string;
}) {
  const [pending, startTransition] = useTransition();
  return MOVES[status].map(({ to, label, done, icon: Icon }) => (
    <Button
      aria-describedby={to === "open" ? openHintId : undefined}
      aria-label={`${label}: message from ${sender}`}
      disabled={pending}
      key={to}
      onClick={() =>
        startTransition(async () => {
          const result = await withStepUp(() => setSupportStatusAction({ messageId, status: to }));
          if (result.ok) toast.add({ title: done, type: "success" });
          else toast.add({ title: result.error, type: "error" });
        })
      }
      size="sm"
      variant={to === "closed" ? "default" : "outline"}
    >
      <Icon aria-hidden="true" />
      {label}
    </Button>
  ));
}
