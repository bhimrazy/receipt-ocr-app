"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useInstallAction } from "@/components/use-install-action";
import { useBottomHeld } from "@/lib/bottom-slot";
import { useConsent } from "@/lib/consent/store";
import { useInstallOffer } from "@/lib/use-install-offer";

const LandingInstallSheet = dynamic(() => import("./landing-install-sheet"), { ssr: false });

const ENGAGED_AFTER_MS = 45_000;
const AFTER_CONSENT_MS = 10_000;

/** Scrolled to How it works, or 45 seconds on the page. */
function useEngaged() {
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (engaged) return;
    const timer = window.setTimeout(() => setEngaged(true), ENGAGED_AFTER_MS);
    const how = document.getElementById("how");
    const observer =
      how && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setEngaged(true);
          })
        : null;
    if (how) observer?.observe(how);
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [engaged]);
  return engaged;
}

/** False until 10 seconds after the visitor's cookie choice, if they made one just now. */
function useConsentSettled() {
  const consent = useConsent();
  const savedAt = consent.record ? consent.record.savedAt * 1000 : null;
  const [settledAt, setSettledAt] = useState<number | null>(null);
  useEffect(() => {
    if (savedAt === null) return;
    const wait = Math.max(0, savedAt + AFTER_CONSENT_MS - Date.now());
    const timer = window.setTimeout(() => setSettledAt(savedAt), wait);
    return () => window.clearTimeout(timer);
  }, [savedAt]);
  return consent.hydrated && (savedAt === null || settledAt === savedAt);
}

function isAndroidPhone() {
  return /Android/.test(navigator.userAgent) && window.matchMedia("(max-width: 767.98px)").matches;
}

/**
 * The home page's timed install sheet: Android phones with Chrome's prompt only, after the
 * visitor engaged, never with the cookie banner or support panel up, and within its snooze
 * (7 days after Not now, 3 shows ever, none within 7 days of any dismissal). Once shown it stays
 * until answered, even if the show used up the last of the cap.
 */
export function LandingInstallOffer() {
  const { path, canOffer, markShown, dismiss } = useInstallOffer();
  const { start } = useInstallAction("landing_sheet", "landing");
  const engaged = useEngaged();
  const settled = useConsentSettled();
  const bannerUp = useBottomHeld("cookie-banner");
  const supportOpen = useBottomHeld("support");
  const [phase, setPhase] = useState<"waiting" | "open" | "done">("waiting");

  const ready =
    phase === "waiting" &&
    path?.kind === "prompt" &&
    engaged &&
    settled &&
    !bannerUp &&
    !supportOpen &&
    canOffer("landing") &&
    isAndroidPhone();

  // Latched during render, so counting the show (which can use up the cap) doesn't hide it.
  if (ready) setPhase("open");
  useEffect(() => {
    if (phase === "open") markShown("landing");
    // Once per show; markShown's identity changes with the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // A late cookie banner or the support panel takes the slot back; the prompt may be gone too.
  const visible = phase === "open" && !bannerUp && !supportOpen && path?.kind === "prompt";
  if (!visible) return null;
  return (
    <LandingInstallSheet
      onDismiss={() => {
        dismiss("landing");
        setPhase("done");
      }}
      onInstall={async () => {
        setPhase("done");
        await start();
      }}
    />
  );
}

/**
 * The site's permanent "Get the app": Chrome's prompt, or the guide in iOS Safari. Other
 * browsers get nothing rather than a help page. Render `guide` outside any menu.
 */
export function useSiteInstall() {
  const { path, start, guide } = useInstallAction("site_entry", null);
  const available = path !== null && (path.kind === "prompt" || path.browser === "safari");
  return { available, start, guide };
}

/** "Get the app" in the site footer. */
export function GetTheAppEntry({ className }: { className: string }) {
  const { available, start, guide } = useSiteInstall();
  if (!available) return null;
  return (
    <li>
      <button className={className} onClick={() => void start()} type="button">
        Get the app
      </button>
      {guide}
    </li>
  );
}
