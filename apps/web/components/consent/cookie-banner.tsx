"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { ACCEPT_ALL, REJECT_ALL, type ConsentChoice } from "@/lib/consent/state";
import { dismissConfirmation, openConsentSettings, saveConsent } from "@/lib/consent/store";

const shell =
  "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-popover/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-popover-foreground shadow-2xl supports-backdrop-filter:backdrop-blur-md sm:px-5";

/**
 * First-visit question, not a wall: the page stays usable behind it. The three choices share one
 * style and size so rejecting is as easy as accepting. After a choice it turns into a short
 * confirmation that takes focus, as GOV.UK's banner does, so focus isn't lost with the buttons.
 */
export function CookieBanner({ confirmation }: { confirmation?: ConsentChoice }) {
  const messageRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (confirmation) messageRef.current?.focus();
  }, [confirmation]);

  if (confirmation) {
    return (
      <section aria-label="Cookie choice saved" className={shell}>
        <div className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            className="text-sm leading-6 outline-none"
            ref={messageRef}
            role="status"
            tabIndex={-1}
          >
            {confirmation.analytics
              ? "You accepted analytics cookies."
              : "You rejected analytics cookies."}{" "}
            You can change this at any time in Cookie settings at the bottom of every page.
          </p>
          <Button className="sm:w-auto" onClick={dismissConfirmation} variant="secondary">
            Hide this message
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="cookie-banner-title" className={shell}>
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold" id="cookie-banner-title">
            Cookies on receiptOCR
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            We use necessary cookies to keep you signed in. With your permission we also use Google
            Analytics cookies to see how people find and use this site. They are off until you
            accept.{" "}
            <Link
              className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="/cookies"
            >
              Cookie policy
            </Link>
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button onClick={() => saveConsent(ACCEPT_ALL, "banner")} variant="secondary">
            Accept all
          </Button>
          <Button onClick={() => saveConsent(REJECT_ALL, "banner")} variant="secondary">
            Reject all
          </Button>
          <Button onClick={openConsentSettings} variant="secondary">
            Customise
          </Button>
        </div>
      </div>
    </section>
  );
}
