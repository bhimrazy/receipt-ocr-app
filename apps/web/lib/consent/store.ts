"use client";

import { useSyncExternalStore } from "react";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS } from "./config";
import {
  makeRecord,
  parseConsent,
  readSignals,
  serializeConsent,
  type ConsentChoice,
  type ConsentRecord,
  type PrivacySignals,
} from "./state";

type Snapshot = {
  /** False on the server and in the first client render, so markup matches before hydration. */
  hydrated: boolean;
  record: ConsentRecord | null;
  signals: PrivacySignals;
  dialogOpen: boolean;
  /** Set right after a choice in the banner, for its confirmation message. */
  justSaved: ConsentChoice | null;
};

const serverSnapshot: Snapshot = {
  hydrated: false,
  record: null,
  signals: { gpc: false, dnt: false },
  dialogOpen: false,
  justSaved: null,
};

let snapshot = serverSnapshot;
const listeners = new Set<() => void>();

function set(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function readCookie(): string | undefined {
  const prefix = `${CONSENT_COOKIE}=`;
  const part = document.cookie.split("; ").find((p) => p.startsWith(prefix));
  if (!part) return undefined;
  try {
    return decodeURIComponent(part.slice(prefix.length));
  } catch {
    return undefined;
  }
}

function subscribe(listener: () => void) {
  if (!snapshot.hydrated) {
    snapshot = {
      ...snapshot,
      hydrated: true,
      record: parseConsent(readCookie(), nowSeconds()),
      signals: readSignals(navigator as Navigator & { globalPrivacyControl?: unknown }),
    };
    queueMicrotask(() => listener());
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConsent(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => serverSnapshot,
  );
}

/** Read outside React, e.g. in an analytics beforeSend hook. */
export function currentConsent(): Snapshot {
  return snapshot;
}

export function saveConsent(choice: ConsentChoice, from: "banner" | "dialog") {
  const record = makeRecord(choice, nowSeconds());
  const value = serializeConsent(record);
  // Written here so the choice applies at once, then again by the server: Safari caps cookies
  // written from script at 7 days, but not ones set by a same-site response.
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  void fetch("/api/consent", { method: "POST", body: value, keepalive: true }).catch(() => {
    // The script-written cookie still holds the choice.
  });
  set({ record, dialogOpen: false, justSaved: from === "banner" ? choice : null });
}

export function openConsentSettings() {
  set({ dialogOpen: true, justSaved: null });
}

export function closeConsentSettings() {
  set({ dialogOpen: false });
}

export function dismissConfirmation() {
  set({ justSaved: null });
}
