"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Loader2 } from "lucide-react";
import Script from "next/script";
import { useState } from "react";
import { PRO_PRICE } from "@/lib/pricing";
import { IntervalToggle, type BillingInterval } from "./interval-toggle";
import { CHECKOUT_BLOCKED, type CheckoutSettings } from "./paddle-js";
import { useProCheckout } from "./use-pro-checkout";

/**
 * Upgrade to Pro on the billing page: a monthly/yearly switch and Paddle's overlay checkout.
 * After payment the page refreshes until the webhook has turned Pro on (the page then renders
 * the subscription instead of this button), and says so if that is slow.
 */
export function CheckoutButton({
  settings,
  workspaceId,
  initialInterval,
  testMode,
}: {
  settings: CheckoutSettings;
  workspaceId: string;
  initialInterval: BillingInterval;
  /** Sandbox keys on the live site, shown to platform admins only. */
  testMode: boolean;
}) {
  const [interval, setInterval] = useState<BillingInterval>(initialInterval);
  const checkout = useProCheckout({ settings, workspaceId });

  async function open() {
    const transactionId = await checkout.create(interval, "billing");
    if (transactionId) checkout.open(transactionId);
  }

  if (checkout.state === "paid") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        Payment received. Turning on Pro for this workspace…
      </p>
    );
  }
  if (checkout.state === "slow") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        {SLOW_WEBHOOK}
      </p>
    );
  }
  if (checkout.state === "unavailable") {
    return (
      <p className="text-sm text-destructive" role="alert">
        {CHECKOUT_BLOCKED}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {checkout.scriptProps ? <Script {...checkout.scriptProps} /> : null}
      {testMode ? (
        <Badge className="self-start" variant="warning">
          Test mode: no real charge
        </Badge>
      ) : null}
      <IntervalToggle className="self-start" onChange={setInterval} value={interval} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={checkout.busy} onClick={open}>
          {checkout.busy ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : null}
          Upgrade to Pro, $
          {interval === "year" ? `${PRO_PRICE.year} a year` : `${PRO_PRICE.month} a month`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Plus sales tax or VAT. Paddle handles the payment.
        </p>
      </div>
      {checkout.state === "error" && checkout.error ? (
        <p className="text-sm text-destructive" role="alert">
          {checkout.error}
        </p>
      ) : null}
    </div>
  );
}

/** After payment, when Pro still isn't on once the refresh loop has run out. */
export const SLOW_WEBHOOK =
  "Payment received, but Pro hasn't switched on yet. It usually takes under a minute. Reload in a few minutes; if it's still Free, use the support button and we'll fix it. You won't be charged twice.";
