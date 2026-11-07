"use client";

import { withStepUp } from "@/components/step-up/step-up";
import { Button } from "@receipt-ocr/ui/components/button";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Ban, Pause, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { ReasonDialog } from "@/components/admin/reason-dialog";
import {
  cancelJobAction,
  rerunJobAction,
  setQueueControlAction,
  type ActionResult,
} from "./actions";

async function settle(call: () => Promise<ActionResult>, success: string): Promise<string | void> {
  const result = await withStepUp(call);
  if (!result.ok) return result.error;
  toast.add({ title: success, type: "success" });
}

/** Re-run (dead or cancelled) or cancel (queued) one job, each with a reason for the audit log. */
export function JobActions({ jobId, state }: { jobId: string; state: string }) {
  const [open, setOpen] = useState<"rerun" | "cancel" | null>(null);
  const canRerun = state === "dead" || state === "cancelled";
  const canCancel = state === "queued";
  if (!canRerun && !canCancel) return null;
  return (
    <>
      {canRerun ? (
        <Button onClick={() => setOpen("rerun")} variant="outline">
          <RotateCcw aria-hidden="true" />
          Re-run job
        </Button>
      ) : null}
      {canCancel ? (
        <Button onClick={() => setOpen("cancel")} variant="outline">
          <Ban aria-hidden="true" />
          Cancel job
        </Button>
      ) : null}
      <ReasonDialog
        confirmLabel="Re-run job"
        description="It goes back in the queue under the same round, so the user isn't charged another read. The service-wide daily cap still applies. The reason goes in the audit log."
        minLength={3}
        onOpenChange={(next) => setOpen(next ? "rerun" : null)}
        onSubmit={(reason) => settle(() => rerunJobAction({ jobId, reason }), "Job queued again")}
        open={open === "rerun"}
        reasonHint="For example, the provider outage that killed it."
        reasonLabel="Reason"
        title="Re-run this job?"
      />
      <ReasonDialog
        confirmLabel="Cancel job"
        description="It won't run. Its receipt shows as failed, and the user can try again."
        destructive
        minLength={3}
        onOpenChange={(next) => setOpen(next ? "cancel" : null)}
        onSubmit={(reason) => settle(() => cancelJobAction({ jobId, reason }), "Job cancelled")}
        open={open === "cancel"}
        reasonHint="Why it shouldn't run."
        reasonLabel="Reason"
        title="Cancel this job?"
      />
    </>
  );
}

/** Pause or resume a scope (`queue`, `kind:<kind>`), or clear a provider cooldown. */
export function ControlButton({
  scope,
  label,
  paused,
  cooldown = false,
}: {
  scope: string;
  label: string;
  paused: boolean;
  cooldown?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const action = cooldown ? "Clear cooldown" : paused ? "Resume" : "Pause";
  return (
    <>
      <Button
        aria-label={`${action}: ${label}`}
        onClick={() => setOpen(true)}
        size="sm"
        variant={paused || cooldown ? "default" : "outline"}
      >
        {paused || cooldown ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        {action}
      </Button>
      <ReasonDialog
        confirmLabel={action}
        description={
          paused || cooldown
            ? "Jobs start being claimed again on the next queue run."
            : "Nothing in it is claimed until you resume it. Running jobs finish. Uploads still queue, and their receipts wait."
        }
        destructive={!paused && !cooldown}
        minLength={3}
        onOpenChange={setOpen}
        onSubmit={(reason) =>
          settle(
            () => setQueueControlAction({ scope, paused: !paused && !cooldown, reason }),
            `${label}: ${paused || cooldown ? "resumed" : "paused"}`,
          )
        }
        open={open}
        reasonHint="Goes in the audit log."
        reasonLabel="Reason"
        title={`${action}: ${label}?`}
      />
    </>
  );
}
