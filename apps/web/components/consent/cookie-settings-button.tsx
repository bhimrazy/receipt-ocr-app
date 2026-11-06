"use client";

import { openConsentSettings } from "@/lib/consent/store";

/** Reopens the cookie settings dialog. A button, not a link: it changes no URL. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button className={className} onClick={openConsentSettings} type="button">
      Cookie settings
    </button>
  );
}
