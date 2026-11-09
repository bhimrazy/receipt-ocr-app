"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startCheckoutAction } from "@/app/app/settings/billing/actions";
import type { CheckoutVia } from "@/lib/upgrade-event";
import type { BillingInterval } from "./interval-toggle";
import {
  initializePaddle,
  onPaddleEvent,
  openPaddleCheckout,
  PADDLE_JS_URL,
  type CheckoutSettings,
  type PaddleEvent,
} from "./paddle-js";

/**
 * Every mounted checkout listens to Paddle.js, but only the one that opened the overlay (`owner`)
 * reacts, so Billing's button and the upgrade modal can share a page.
 */
let owner: symbol | null = null;

/** How often, and how many times, the page refreshes after payment while it waits for the webhook. */
const POLL_MS = 3000;
const POLL_TRIES = 20;

/**
 * `paid`: refreshing until the plan flips. `slow`: it didn't within POLL_TRIES. `done`: the
 * caller saw Pro arrive. `unavailable`: Paddle.js didn't load (content blockers).
 */
export type CheckoutState =
  "idle" | "starting" | "paid" | "slow" | "done" | "error" | "unavailable";

/**
 * Paddle's overlay checkout for the active workspace. `create` asks the server for the
 * transaction (price, workspace and buyer are its choice, not the browser's); `open` shows it.
 * They are separate so the upgrade modal can close before Paddle's overlay opens. After
 * payment the page refreshes until `done` turns true or the tries run out.
 *
 * Render `<Script {...scriptProps} />` while `scriptProps` is set; `load: false` keeps
 * Paddle.js off the page until it is needed.
 */
export function useProCheckout({
  settings,
  workspaceId,
  load = true,
  done = false,
  onClosed,
}: {
  settings: CheckoutSettings | null;
  /** The workspace the page names; the server refuses if the active one has changed since. */
  workspaceId: string;
  load?: boolean;
  /** True once the plan the page shows is Pro: stops the refresh loop. */
  done?: boolean;
  /** Paddle's overlay closed, paid or not. */
  onClosed?: () => void;
}) {
  const router = useRouter();
  const [id] = useState(() => Symbol("checkout"));
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<CheckoutState>("idle");
  const [error, setError] = useState<string | null>(null);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  useEffect(() => {
    const listener = (event: PaddleEvent) => {
      if (owner !== id) return;
      if (event.name === "checkout.completed") setState("paid");
      if (event.name === "checkout.error") {
        setError("The checkout hit a problem. Nothing was charged; try again.");
        setState("error");
      }
      if (event.name === "checkout.closed") {
        owner = null;
        onClosedRef.current?.();
      }
    };
    const unsubscribe = onPaddleEvent(listener);
    return () => {
      unsubscribe();
      if (owner === id) owner = null;
    };
  }, [id]);

  // The webhook usually lands within seconds; refresh until the page shows Pro.
  useEffect(() => {
    if (state !== "paid" || done) return;
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
  }, [state, done, router]);

  function initialize() {
    if (settings && initializePaddle(settings)) setReady(true);
  }

  /** The transaction id, or null with `error` set. */
  async function create(interval: BillingInterval, via: CheckoutVia): Promise<string | null> {
    setError(null);
    setState("starting");
    const result = await startCheckoutAction(interval, via, workspaceId);
    if (!result.ok) {
      setError(result.error);
      setState("error");
      return null;
    }
    setState("idle");
    return result.transactionId;
  }

  /** Clears a shown error, e.g. when the modal opens again. */
  function reset() {
    setError(null);
    setState((current) => (current === "error" ? "idle" : current));
  }

  function open(transactionId: string) {
    owner = id;
    openPaddleCheckout(transactionId);
  }

  return {
    scriptProps:
      load && settings
        ? {
            src: PADDLE_JS_URL,
            strategy: "afterInteractive" as const,
            // Also fires on later mounts once the script is in the page.
            onReady: initialize,
            onError: () => setState("unavailable"),
          }
        : null,
    ready,
    busy: !ready || state === "starting",
    state: done && (state === "paid" || state === "slow") ? ("done" as const) : state,
    error,
    create,
    reset,
    open,
  };
}
