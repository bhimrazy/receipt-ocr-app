"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { openConsentSettings } from "@/lib/consent/store";

/** Reopens the cookie settings dialog. A button, not a link: it changes no URL. */
export function CookieSettingsButton({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "secondary" | "link";
}) {
  return (
    <Button className={className} onClick={openConsentSettings} type="button" variant={variant}>
      Cookie settings
    </Button>
  );
}
