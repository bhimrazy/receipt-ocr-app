"use client";

/** Paddle.js v2, the one script Paddle supports: always loaded from its CDN. */
export const PADDLE_JS_URL = "https://cdn.paddle.com/paddle/v2/paddle.js";

/** Paddle.js didn't load. */
export const CHECKOUT_BLOCKED =
  "Checkout couldn't load. Turn off content blockers for this page or try another browser.";

export type PaddleEvent = { name?: string };
type CheckoutSettingsValue = Record<string, string | boolean>;
type PaddleGlobal = {
  Environment: { set: (environment: "sandbox") => void };
  Initialize: (options: {
    token: string;
    checkout?: { settings: CheckoutSettingsValue };
    eventCallback: (event: PaddleEvent) => void;
  }) => void;
  Checkout: {
    open: (options: { transactionId: string; settings?: CheckoutSettingsValue }) => void;
  };
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

/** Public values only, passed down from the server. */
export type CheckoutSettings = {
  environment: "sandbox" | "production";
  clientToken: string;
};

const paddleTheme = () => (document.documentElement.classList.contains("light") ? "light" : "dark");

/** How every checkout of ours opens: Paddle's overlay, in the page's theme, for the buyer we chose. */
export const overlaySettings = (): CheckoutSettingsValue => ({
  displayMode: "overlay",
  theme: paddleTheme(),
  allowLogout: false,
});

/**
 * `Paddle.Initialize` may run only once per page, and window.Paddle outlives client navigations,
 * so every checkout on the site shares this one initialization and its event fan-out.
 */
let initialized = false;
const listeners = new Set<(event: PaddleEvent) => void>();

/** Initializes Paddle.js once; false while the script hasn't loaded. */
export function initializePaddle(settings: CheckoutSettings): boolean {
  const paddle = window.Paddle;
  if (!paddle) return false;
  if (!initialized) {
    if (settings.environment === "sandbox") paddle.Environment.set("sandbox");
    paddle.Initialize({
      token: settings.clientToken,
      // Defaults for a checkout Paddle.js opens by itself (a `_ptxn` link).
      checkout: { settings: overlaySettings() },
      eventCallback: (event) => {
        for (const listener of listeners) listener(event);
      },
    });
    initialized = true;
  }
  return true;
}

/** Listens to every Paddle.js event; returns the unsubscribe. */
export function onPaddleEvent(listener: (event: PaddleEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openPaddleCheckout(transactionId: string) {
  window.Paddle?.Checkout.open({ transactionId, settings: overlaySettings() });
}
