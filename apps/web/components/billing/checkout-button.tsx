"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { PRO_PRICE } from "@/lib/pricing";
import { IntervalToggle, type BillingInterval } from "./interval-toggle";

/** Paddle.js v2, the one script Paddle supports: always loaded from its CDN. */
export const PADDLE_JS_URL = "https://cdn.paddle.com/paddle/v2/paddle.js";

type PaddleEvent = { name?: string };
type PaddleGlobal = {
  Environment: { set: (environment: "sandbox") => void };
  Initialize: (options: { token: string; eventCallback: (event: PaddleEvent) => void }) => void;
  Checkout: {
    open: (options: {
      items: { priceId: string; quantity: number }[];
      customer?: { email: string };
      customData?: Record<string, string>;
      settings?: Record<string, string | boolean>;
    }) => void;
  };
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

export type CheckoutSettings = {
  environment: "sandbox" | "production";
  clientToken: string;
  prices: { month: string; year: string };
};

/** Paddle.Initialize may run once per page; later mounts reuse it and swap the listener. */
let initialized = false;
let onPaddleEvent: (event: PaddleEvent) => void = () => {};

/**
 * Upgrade to Pro: a monthly/yearly switch and Paddle's overlay checkout, with
 * the owner's email filled in and the workspace id in custom data (the
 * webhook links the subscription to it). After payment the page refreshes
 * until the webhook has turned Pro on.
 */
export function CheckoutButton({
  settings,
  workspaceId,
  userId,
  email,
  initialInterval,
}: {
  settings: CheckoutSettings;
  workspaceId: string;
  userId: string;
  email: string;
  initialInterval: BillingInterval;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>(initialInterval);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<"idle" | "paid" | "error">("idle");

  function initialize() {
    const paddle = window.Paddle;
    if (!paddle) return;
    if (!initialized) {
      if (settings.environment === "sandbox") paddle.Environment.set("sandbox");
      paddle.Initialize({ token: settings.clientToken, eventCallback: (e) => onPaddleEvent(e) });
      initialized = true;
    }
    setReady(true);
  }

  useEffect(() => {
    onPaddleEvent = (event) => {
      if (event.name === "checkout.completed") setState("paid");
      if (event.name === "checkout.error") setState("error");
    };
    // Paddle.Initialize runs from <Script onReady>, which also fires on every later mount.
    return () => {
      onPaddleEvent = () => {};
    };
  }, []);

  // The webhook usually lands within seconds; refresh until the page shows Pro.
  useEffect(() => {
    if (state !== "paid") return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      router.refresh();
      if (tries >= 20) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [state, router]);

  function open() {
    window.Paddle?.Checkout.open({
      items: [{ priceId: settings.prices[interval], quantity: 1 }],
      customer: { email },
      customData: { workspaceId, userId },
      settings: { displayMode: "overlay", theme: "dark", allowLogout: false },
    });
  }

  if (state === "paid") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        Payment received. Turning on Pro for this workspace…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Script onReady={initialize} src={PADDLE_JS_URL} strategy="afterInteractive" />
      <IntervalToggle className="self-start" onChange={setInterval} value={interval} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!ready} onClick={open}>
          {ready ? null : (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          )}
          Upgrade to Pro, $
          {interval === "year" ? `${PRO_PRICE.year} a year` : `${PRO_PRICE.month} a month`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Plus sales tax or VAT. Paddle handles the payment.
        </p>
      </div>
      {state === "error" ? (
        <p className="text-sm text-destructive" role="alert">
          The checkout hit a problem. Nothing was charged; try again.
        </p>
      ) : null}
    </div>
  );
}
