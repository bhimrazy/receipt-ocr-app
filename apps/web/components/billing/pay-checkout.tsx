"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert, CircleCheck, CreditCard } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { AuthMessage } from "@/components/auth/auth-field";
import {
  CHECKOUT_BLOCKED,
  initializePaddle,
  onPaddleEvent,
  openPaddleCheckout,
  PADDLE_JS_URL,
  type CheckoutSettings,
} from "./paddle-js";

/** `loading`: Paddle.js isn't ready yet. `unavailable`: it didn't load (content blockers). */
type PayState = "loading" | "open" | "closed" | "paid" | "error" | "unavailable";

/**
 * Opens Paddle's overlay checkout for a payment link's transaction once Paddle.js is ready, and
 * says what happened when it closes. Access comes from the webhook, never from these events.
 */
export function PayCheckout({
  settings,
  transactionId,
  testMode,
}: {
  settings: CheckoutSettings;
  transactionId: string;
  /** Sandbox keys on the live site. */
  testMode: boolean;
}) {
  const [state, setState] = useState<PayState>("loading");
  const opened = useRef(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      onPaddleEvent((event) => {
        // Paddle shows its own success screen; closing it afterwards keeps the thank-you.
        if (event.name === "checkout.completed") setState("paid");
        if (event.name === "checkout.error") setState((s) => (s === "paid" ? s : "error"));
        if (event.name === "checkout.closed") setState((s) => (s === "paid" ? s : "closed"));
      }),
    [],
  );

  // Moves focus to the new heading, which also announces it; otherwise focus is lost to the body
  // when Paddle's overlay goes away.
  useEffect(() => {
    if (state !== "loading" && state !== "open") panel.current?.querySelector("h1")?.focus();
  }, [state]);

  function open() {
    openPaddleCheckout(transactionId);
    setState("open");
  }

  function ready() {
    if (!initializePaddle(settings) || opened.current) return;
    opened.current = true;
    // Opening it ourselves takes priority over Paddle.js's own `_ptxn` handling, so there is
    // one overlay (https://developer.paddle.com/build/transactions/default-payment-link).
    open();
  }

  const openButton = (
    <Button className="h-11 w-full" disabled={state === "loading"} onClick={open}>
      {state === "closed" ? "Open the checkout again" : "Open the checkout"}
    </Button>
  );
  const pricing = (
    <Link className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full")} href="/pricing">
      See plans and pricing
    </Link>
  );

  let message: React.ReactNode;
  switch (state) {
    case "loading":
    case "open":
      message = (
        <AuthMessage actions={openButton} icon={CreditCard} title="Opening the checkout">
          <p>
            Paddle, our reseller and merchant of record, runs the checkout in a window over this
            page. If it doesn&apos;t appear, open it with the button.
          </p>
        </AuthMessage>
      );
      break;
    case "closed":
      message = (
        <AuthMessage
          actions={
            <>
              {openButton}
              {pricing}
            </>
          }
          icon={CreditCard}
          title="Checkout closed"
        >
          <p>Nothing was charged. Open it again when you&apos;re ready.</p>
        </AuthMessage>
      );
      break;
    case "paid":
      message = (
        <AuthMessage
          actions={
            <Link className={cn(buttonVariants(), "h-11 w-full")} href="/app">
              Open ReceiptOCR
            </Link>
          }
          icon={CircleCheck}
          title="Thanks, that's done"
        >
          <p>
            Paddle emails a confirmation. If this was an upgrade, Pro turns on in its workspace
            within a minute.
          </p>
        </AuthMessage>
      );
      break;
    case "error":
      message = (
        <AuthMessage
          actions={pricing}
          icon={CircleAlert}
          title="The checkout couldn't open"
          tone="destructive"
        >
          <p>
            The link may have expired or already been paid. Nothing was charged. Open the latest
            link from Paddle&apos;s email, or use the support button.
          </p>
        </AuthMessage>
      );
      break;
    case "unavailable":
      message = (
        <AuthMessage
          actions={pricing}
          icon={CircleAlert}
          title="Checkout couldn't load"
          tone="destructive"
        >
          <p>{CHECKOUT_BLOCKED}</p>
        </AuthMessage>
      );
      break;
  }

  return (
    <div className="flex flex-col gap-4" ref={panel}>
      <Script
        onError={() => setState("unavailable")}
        // Also fires on later mounts once the script is in the page.
        onReady={ready}
        src={PADDLE_JS_URL}
        strategy="afterInteractive"
      />
      {testMode ? (
        <Badge className="self-center" variant="warning">
          Test mode: no real charge
        </Badge>
      ) : null}
      {message}
    </div>
  );
}
