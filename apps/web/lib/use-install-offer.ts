"use client";

import { useSyncExternalStore } from "react";
import { isStandaloneDisplay } from "./display-mode";
import { recordInstallOffer } from "./install-offer-actions";
import type { InstallOfferEvent } from "./install-offer-event";
import {
  canOffer,
  dismissed,
  iosBrowser,
  isAppPath,
  isIpad,
  loadInstallState,
  markInstalled,
  saveInstallState,
  shown,
  type InstallState,
  type OfferPlacement,
} from "./pwa";

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** How this browser can install the app: Chrome's prompt, or our Add to Home Screen guide. */
export type InstallPath =
  { kind: "prompt" } | { kind: "guide"; browser: "safari" | "chrome" | "other"; ipad: boolean };

/** Where an install starts. The site surfaces (signed out) aren't measured yet. */
export type InstallSurface =
  Exclude<InstallOfferEvent["surface"], "browser"> | "landing_sheet" | "site_entry";

type Snapshot = { path: InstallPath | null; state: InstallState };

let deferredPrompt: BeforeInstallPromptEvent | null = null;
// The surface that last opened Chrome's prompt, so `appinstalled` is credited to it.
let promptedFrom: InstallSurface | null = null;
let snapshot: Snapshot | null = null;
const listeners = new Set<() => void>();

function notify() {
  snapshot = null;
  listeners.forEach((listener) => listener());
}

// At module load, not in an effect, so an event that fires before hydration isn't missed. Taken
// on every path: our offer replaces Chrome's mini-infobar, so Android shows one prompt, not two.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    saveInstallState(markInstalled(loadInstallState()));
    report("installed", promptedFrom ?? "browser", "chromium");
    notify();
  });
}

function currentPath(state: InstallState): InstallPath | null {
  if (state.installed || isStandaloneDisplay()) return null;
  if (deferredPrompt) return { kind: "prompt" };
  const browser = iosBrowser(navigator.userAgent, navigator.maxTouchPoints);
  return browser
    ? { kind: "guide", browser, ipad: isIpad(navigator.userAgent, navigator.maxTouchPoints) }
    : null;
}

function getSnapshot(): Snapshot {
  if (!snapshot) {
    const state = loadInstallState();
    snapshot = { path: currentPath(state), state };
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function platformOf(path: InstallPath): InstallOfferEvent["platform"] {
  return path.kind === "prompt" ? "chromium" : `ios_${path.browser}`;
}

/**
 * Sends one `install_offer` event from the signed-in app. Product events need a user id, so the
 * site's surfaces send nothing. Analytics never gets in the way of the offer.
 */
export function report(
  action: InstallOfferEvent["action"],
  surface: InstallSurface | "browser",
  platform: InstallOfferEvent["platform"],
) {
  if (surface === "landing_sheet" || surface === "site_entry") return;
  if (!isAppPath(location.pathname)) return;
  recordInstallOffer({ action, surface, platform }).catch(() => {});
}

function update(change: (state: InstallState) => InstallState) {
  saveInstallState(change(loadInstallState()));
  notify();
}

/**
 * Opens Chrome's install prompt. Declining it counts as a dismissal at `placement` (or, from a
 * menu row, starts the shared cooldown). Resolves "unavailable" when there is no prompt left:
 * Chrome gives one per page load.
 */
async function promptInstall(
  surface: InstallSurface,
  placement: OfferPlacement | null,
): Promise<"accepted" | "dismissed" | "unavailable"> {
  const prompt = deferredPrompt;
  if (!prompt) return "unavailable";
  deferredPrompt = null;
  promptedFrom = surface;
  report("opened", surface, "chromium");
  let outcome: "accepted" | "dismissed" = "dismissed";
  try {
    await prompt.prompt();
    outcome = (await prompt.userChoice).outcome;
  } catch {
    // Treated as declined.
  }
  report(outcome, surface, "chromium");
  if (outcome === "dismissed") update((state) => dismissed(state, placement, new Date()));
  else notify();
  return outcome;
}

const serverSnapshot = (): Snapshot | null => null;

/**
 * The install offer for this browser. `path` is null on the server, when running installed
 * (standalone, or after `appinstalled`), and when the browser has no install path we can offer.
 * `canOffer(placement)` gates the dismissible card and sheet; menu rows only need `path`.
 */
export function useInstallOffer() {
  const current = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  return {
    path: current?.path ?? null,
    canOffer: (placement: OfferPlacement) =>
      current !== null && canOffer(current.state, placement, new Date()),
    markShown: (placement: OfferPlacement) => update((state) => shown(state, placement)),
    dismiss: (placement: OfferPlacement) =>
      update((state) => dismissed(state, placement, new Date())),
    promptInstall,
  };
}
