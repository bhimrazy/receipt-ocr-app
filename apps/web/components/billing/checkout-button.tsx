"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { startCheckoutAction } from "@/app/app/settings/billing/actions";
import { PRO_PRICE } from "@/lib/pricing";
import { IntervalToggle, type BillingInterval } from "./interval-toggle";

/** Paddle.js v2, the one script Paddle supports: always loaded from its CDN. */
export const PADDLE_JS_URL = "https://cdn.paddle.com/paddle/v2/paddle.js";

type PaddleEvent = { name?: string };
type PaddleGlobal = {
  Environment: { set: (environment: "sandbox") => void };
  Initialize: (options: { token: string; eventCallback: (event: PaddleEvent) => void }) => void;
  Checkout: {
    open: (options: { transactionId: string; settings?: Record<string, string | boolean> }) => void;
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
};

/** Paddle.Initialize may run once per page; later mounts reuse it and swap the listener. */
let initialized = false;
let onPaddleEvent: (event: PaddleEvent) => void = () => {};

/** How often, and how many times, the page refreshes after payment while it waits for the webhook. */
const POLL_MS = 3000;
const POLL_TRIES = 20;

type State = "idle" | "starting" | "paid" | "slow" | "error" | "unavailable";

/**
 * Upgrade to Pro: a monthly/yearly switch and Paddle's overlay checkout. The
 * server creates the transaction (price, workspace and buyer are its choice,
 * not the browser's) and Paddle.js opens it. After payment the page refreshes
 * until the webhook has turned Pro on, then says so if it is slow.
 */
export function CheckoutButton({
  settings,
  initialInterval,
  testMode,
}: {
  settings: CheckoutSettings;
  initialInterval: BillingInterval;
  /** Sandbox keys on the live site, shown to platform admins only. */
  testMode: boolean;
}) {
  const router = useRouter();
  const [interval, setInterval] = useState<BillingInterval>(initialInterval);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

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
      if (event.name === "checkout.error") {
        setError("The checkout hit a problem. Nothing was charged; try again.");
        setState("error");
      }
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
      if (tries >= POLL_TRIES) {
        window.clearInterval(timer);
        setState("slow");
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [state, router]);

  async function open() {
    setError(null);
    setState("starting");
    const result = await startCheckoutAction(interval);
    if (!result.ok) {
      setError(result.error);
      setState("error");
      return;
    }
    setState("idle");
    window.Paddle?.Checkout.open({
      transactionId: result.transactionId,
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
  if (state === "slow") {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Payment received, but Pro hasn&apos;t switched on yet. It usually takes under a minute.
        Reload in a few minutes; if it&apos;s still Free, use the support button and we&apos;ll fix
        it. You won&apos;t be charged twice.
      </p>
    );
  }
  if (state === "unavailable") {
    return (
      <p className="text-sm text-destructive" role="alert">
        Checkout couldn&apos;t load. Turn off content blockers for this page or try another browser.
      </p>
    );
  }

  const busy = !ready || state === "starting";
  return (
    <div className="flex flex-col gap-4">
      <Script
        onError={() => setState("unavailable")}
        onReady={initialize}
        src={PADDLE_JS_URL}
        strategy="afterInteractive"
      />
      {testMode ? (
        <Badge className="self-start" variant="warning">
          Test mode: no real charge
        </Badge>
      ) : null}
      <IntervalToggle className="self-start" onChange={setInterval} value={interval} />
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={open}>
          {busy ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : null}
          Upgrade to Pro, $
          {interval === "year" ? `${PRO_PRICE.year} a year` : `${PRO_PRICE.month} a month`}
        </Button>
        <p className="text-xs text-muted-foreground">
          Plus sales tax or VAT. Paddle handles the payment.
        </p>
      </div>
      {state === "error" && error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
