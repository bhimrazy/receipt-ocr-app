"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Download, Share, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { installDismissed, isAppPath, isIosSafari, rememberInstallDismissed } from "@/lib/pwa";

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Listening at module load, not in an effect, catches an event that fires before hydration.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Outside the app, leave Chrome's own install UI alone.
    if (!isAppPath(location.pathname)) return;
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    rememberInstallDismissed();
    notify();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

type Offer = "prompt" | "ios" | null;

function currentOffer(): Offer {
  if (isStandalone() || installDismissed()) return null;
  if (deferredPrompt) return "prompt";
  return isIosSafari(navigator.userAgent, navigator.maxTouchPoints) ? "ios" : null;
}

/**
 * Registers the service worker (production builds only) and offers to install the app. Rendered by
 * the root layout, but active only under /app, so the landing and lab pages never register it. Once installed, the worker (scope "/") sees every
 * same-origin navigation, but passes all but the offline fallback and the share target through.
 */
export function Pwa() {
  const inApp = isAppPath(usePathname());
  useEffect(() => {
    if (!inApp || process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => console.warn("Service worker registration failed", error));
  }, [inApp]);
  return inApp ? <InstallPrompt /> : null;
}

function InstallPrompt() {
  const offer = useSyncExternalStore(subscribe, currentOffer, () => null);
  const [closed, setClosed] = useState(false);
  if (!offer || closed) return null;

  function dismiss() {
    rememberInstallDismissed();
    setClosed(true);
  }

  async function install() {
    const prompt = deferredPrompt;
    if (!prompt) return;
    deferredPrompt = null;
    await prompt.prompt();
    // Either answer ends the offer: Chrome won't prompt again in this page anyway.
    await prompt.userChoice.catch(() => null);
    dismiss();
  }

  return (
    // --app-bottom-inset is the mobile tab bar's height plus the home indicator (set by the app shell).
    <aside
      aria-label="Install the app"
      className="fixed inset-x-4 bottom-[calc(var(--app-bottom-inset,0px)+0.5rem)] z-50 md:inset-x-auto md:right-6 md:bottom-6 md:w-80"
    >
      <Card className="flex items-start gap-3 p-4 shadow-lg">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
          <Download aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Install receiptOCR</p>
          {offer === "ios" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Tap the Share button{" "}
              <Share aria-hidden="true" className="inline size-3.5 align-text-bottom" />, then Add
              to Home Screen.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                Open it in its own window, straight from your home screen or desktop.
              </p>
              <Button className="mt-3" onClick={install} size="sm">
                Install app
              </Button>
            </>
          )}
        </div>
        <Button aria-label="Dismiss" onClick={dismiss} size="icon-sm" variant="ghost">
          <X aria-hidden="true" />
        </Button>
      </Card>
    </aside>
  );
}
