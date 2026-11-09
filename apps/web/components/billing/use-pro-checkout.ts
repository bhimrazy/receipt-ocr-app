"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startCheckoutAction } from "@/app/app/settings/billing/actions";
import type { CheckoutVia } from "@/lib/upgrade-event";
import type { BillingInterval } from "./interval-toggle";

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

/**
 * Paddle.Initialize may run once per page. Every mounted checkout listens, but only the one
 * that opened the overlay (`owner`) reacts, so Billing's button and the upgrade modal can share
 * a page.
 */
let initialized = false;
const listeners = new Set<(event: PaddleEvent) => void>();
let owner: symbol | null = null;

/** How often, and how many times, the page refreshes after payment while it waits for the webhook. */
const POLL_MS = 3000;
const POLL_TRIES = 20;

/**
 * `paid`: refreshing until the plan flips. `slow`: it didn't within POLL_TRIES. `done`: the
 * caller saw Pro arrive. `unavailable`: Paddle.js didn't load (content blockers).
 */
export type CheckoutState = "idle" | "starting" | "paid" | "slow" | "done" | "error" | "unavailable";

const paddleTheme = () =>
  document.documentElement.classList.contains("light") ? "light" : "dark";

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
  load = true,
  done = false,
  onClosed,
}: {
  settings: CheckoutSettings | null;
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
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
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
    const paddle = window.Paddle;
    if (!paddle || !settings) return;
    if (!initialized) {
      if (settings.environment === "sandbox") paddle.Environment.set("sandbox");
      paddle.Initialize({
        token: settings.clientToken,
        eventCallback: (event) => {
          for (const listener of listeners) listener(event);
        },
      });
      initialized = true;
    }
    setReady(true);
  }

  /** The transaction id, or null with `error` set. */
  async function create(interval: BillingInterval, via: CheckoutVia): Promise<string | null> {
    setError(null);
    setState("starting");
    const result = await startCheckoutAction(interval, via);
    if (!result.ok) {
      setError(result.error);
      setState("error");
      return null;
    }
    setState("idle");
    return result.transactionId;
  }

  function open(transactionId: string) {
    owner = id;
    window.Paddle?.Checkout.open({
      transactionId,
      settings: { displayMode: "overlay", theme: paddleTheme(), allowLogout: false },
    });
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
    open,
  };
}
