"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";
import { isAnalyticsPath, stripUrl } from "@/lib/consent/config";
import {
  grantGtag,
  gtagPageView,
  initGtag,
  setGtagDisabled,
  withdrawGtag,
} from "@/lib/consent/gtag";
import { allowedTools, needsBanner, type ConsentFeatures } from "@/lib/consent/state";
import { currentConsent, useConsent } from "@/lib/consent/store";
import { CookieBanner } from "./cookie-banner";
import { ConsentDialog } from "./consent-dialog";

/**
 * Mounted once in the root layout. Asks for consent only when a tool that needs it (GA) is
 * configured, and runs analytics only on the public allowlist (lib/consent/config.ts).
 */
export function ConsentManager({
  gaMeasurementId,
  vercelAnalytics,
}: {
  gaMeasurementId: string | undefined;
  vercelAnalytics: boolean;
}) {
  const pathname = usePathname();
  const consent = useConsent();
  const features: ConsentFeatures = {
    googleAnalytics: Boolean(gaMeasurementId),
    pageCounts: vercelAnalytics,
  };
  const publicPage = isAnalyticsPath(pathname);
  const allowed = consent.hydrated
    ? allowedTools(consent.record, consent.signals, features)
    : { googleAnalytics: false, pageCounts: false };

  // Set during render, before the router commits the new URL: gtag.js listens to history
  // changes and must already be off when a client navigation leaves the allowlist.
  if (gaMeasurementId && typeof window !== "undefined") {
    setGtagDisabled(gaMeasurementId, !(publicPage && allowed.googleAnalytics));
  }

  return (
    <>
      {consent.hydrated && publicPage && needsBanner(consent.record, consent.signals, features) && (
        <CookieBanner />
      )}
      {consent.hydrated && consent.justSaved && <CookieBanner confirmation={consent.justSaved} />}
      <ConsentDialog features={features} />
      {gaMeasurementId && (
        <GoogleAnalytics
          id={gaMeasurementId}
          on={allowed.googleAnalytics}
          pathname={publicPage ? pathname : null}
        />
      )}
      {publicPage && allowed.pageCounts && <Analytics beforeSend={pageCountsBeforeSend} />}
    </>
  );
}

/**
 * Vercel's script stays on the page after a client navigation, so every event is checked here:
 * dropped outside the allowlist or once the visitor objects, and sent without its query string.
 */
function pageCountsBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = stripUrl(event.url);
  if (!url || !isAnalyticsPath(new URL(url).pathname)) return null;
  const { record, signals } = currentConsent();
  if (!allowedTools(record, signals, { googleAnalytics: false, pageCounts: true }).pageCounts) {
    return null;
  }
  return { ...event, url };
}

function GoogleAnalytics({
  id,
  on,
  pathname,
}: {
  id: string;
  on: boolean;
  /** Null outside the allowlist. */
  pathname: string | null;
}) {
  const [loaded, setLoaded] = useState(false);
  const active = on && pathname !== null;

  useEffect(() => {
    if (active && !loaded) {
      initGtag(id);
      setLoaded(true);
    }
  }, [active, loaded, id]);

  useEffect(() => {
    if (!loaded) return;
    if (on) grantGtag();
    else withdrawGtag(id);
  }, [loaded, on, id]);

  useEffect(() => {
    if (loaded && on && pathname) gtagPageView(pathname);
  }, [loaded, on, pathname]);

  if (!loaded) return null;
  return (
    <Script
      id="gtag-js"
      src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`}
      strategy="afterInteractive"
    />
  );
}
