"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { openBillingPortalAction, type PortalTarget } from "@/app/app/settings/billing/actions";

const ACTIONS: { target: PortalTarget; label: string; variant: "default" | "outline" | "ghost" }[] =
  [
    { target: "overview", label: "Invoices and billing", variant: "outline" },
    { target: "payment", label: "Update payment method", variant: "ghost" },
    { target: "cancel", label: "Cancel subscription", variant: "ghost" },
  ];

/** Opens Paddle's customer portal (invoices, card, cancel) with a link made for this click. */
export function PortalButtons({ canceling }: { canceling: boolean }) {
  const [pending, setPending] = useState<PortalTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(target: PortalTarget) {
    setPending(target);
    setError(null);
    const result = await openBillingPortalAction(target);
    if (!result.ok) {
      setPending(null);
      setError(result.error);
      return;
    }
    window.location.assign(result.url);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {ACTIONS.filter((a) => !(canceling && a.target === "cancel")).map((action) => (
          <Button
            disabled={pending !== null}
            key={action.target}
            onClick={() => go(action.target)}
            variant={action.variant}
          >
            {pending === action.target ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : (
              <ExternalLink aria-hidden="true" />
            )}
            {action.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Opens Paddle&apos;s customer portal.</p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
