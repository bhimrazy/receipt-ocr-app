"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@receipt-ocr/ui/components/dialog";
import { Switch } from "@receipt-ocr/ui/components/switch";
import Link from "next/link";
import { useId, useState } from "react";
import {
  ACCEPT_ALL,
  REJECT_ALL,
  allowedTools,
  type ConsentChoice,
  type ConsentFeatures,
} from "@/lib/consent/state";
import {
  closeConsentSettings,
  consentReturnFocus,
  saveConsent,
  useConsent,
} from "@/lib/consent/store";

/** Opened by "Customise" in the banner and by every "Cookie settings" link. */
export function ConsentDialog({ features }: { features: ConsentFeatures }) {
  const { dialogOpen } = useConsent();
  return (
    <Dialog onOpenChange={(open) => !open && closeConsentSettings()} open={dialogOpen}>
      <DialogContent
        finalFocus={() => consentReturnFocus() ?? true}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        {/* Remounted on each open so the switches start from the saved choice. */}
        {dialogOpen && <ConsentForm features={features} />}
      </DialogContent>
    </Dialog>
  );
}

function ConsentForm({ features }: { features: ConsentFeatures }) {
  const { record, signals } = useConsent();
  const allowed = allowedTools(record, signals, features);
  const [choice, setChoice] = useState<ConsentChoice>({
    analytics: allowed.googleAnalytics,
    marketing: false,
    pageCounts: allowed.pageCounts,
  });
  const optional = features.googleAnalytics || features.pageCounts;
  const gaBlockedBy = signals.gpc ? "Global Privacy Control" : signals.dnt ? "Do Not Track" : null;
  const countsBlocked = signals.gpc || signals.dnt;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cookie settings</DialogTitle>
        <DialogDescription>
          {optional
            ? "Choose which optional tools may run. Necessary cookies are always on. Your choice is saved on this device for 6 months."
            : "receiptOCR uses only necessary cookies on this site. There is nothing optional to turn on or off."}
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        <Category
          description="Keep you signed in, protect sign-in from forged requests, remember this choice, make the signed-in app show your data correctly and, where it is on, run Cloudflare's bot check on forms. The site can't work without them."
          title="Necessary"
        >
          <Badge variant="secondary">Always on</Badge>
        </Category>

        {features.googleAnalytics && (
          <Category
            description={
              gaBlockedBy
                ? `Your browser sends ${gaBlockedBy}, so Google Analytics stays off. We honour that signal.`
                : "Google Analytics sets cookies (_ga) to count visits and see which public pages people use. Google receives your IP address and browser details. Off until you turn it on."
            }
            title="Analytics cookies (Google Analytics)"
          >
            {(labelId, descriptionId) => (
              <Switch
                aria-describedby={descriptionId}
                aria-labelledby={labelId}
                checked={choice.analytics && !gaBlockedBy}
                disabled={Boolean(gaBlockedBy)}
                onCheckedChange={(analytics) => setChoice((c) => ({ ...c, analytics }))}
              />
            )}
          </Category>
        )}

        {features.pageCounts && (
          <Category
            description={
              gaBlockedBy
                ? `Your browser sends ${gaBlockedBy}, so page counts are off. We honour that signal.`
                : features.googleAnalytics
                  ? "Vercel Web Analytics counts visits to public pages without cookies or any id stored on your device. Visits are told apart by a hash of the request that is discarded after 24 hours. Off until you turn it on."
                  : "Vercel Web Analytics counts visits to public pages without cookies or any id stored on your device. Visits are told apart by a hash of the request that is discarded after 24 hours. On unless you turn it off."
            }
            title="Cookie-free page counts"
          >
            {(labelId, descriptionId) => (
              <Switch
                aria-describedby={descriptionId}
                aria-labelledby={labelId}
                checked={choice.pageCounts && !countsBlocked}
                disabled={countsBlocked}
                onCheckedChange={(pageCounts) => setChoice((c) => ({ ...c, pageCounts }))}
              />
            )}
          </Category>
        )}
        {/* A Marketing category goes here once a marketing tool exists; none does today. */}
      </div>

      {signals.gpc && (
        <p className="text-xs leading-5 text-muted-foreground">
          Global Privacy Control detected: we don&apos;t sell or share your data, and Google
          Analytics and page counts stay off.
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        <Link
          className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/cookies"
          onClick={closeConsentSettings}
        >
          Read the cookie policy
        </Link>{" "}
        for every cookie and how long it lasts.
      </p>

      <DialogFooter>
        {optional ? (
          <>
            <Button onClick={() => saveConsent(REJECT_ALL, "dialog")} variant="secondary">
              Reject all
            </Button>
            <Button onClick={() => saveConsent(ACCEPT_ALL, "dialog")} variant="secondary">
              Accept all
            </Button>
            <Button onClick={() => saveConsent(choice, "dialog")} variant="secondary">
              Save choices
            </Button>
          </>
        ) : (
          <Button onClick={closeConsentSettings} variant="secondary">
            Close
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function Category({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode | ((labelId: string, descriptionId: string) => React.ReactNode);
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-medium" id={labelId}>
          {title}
        </h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground" id={descriptionId}>
          {description}
        </p>
      </div>
      <div className="flex min-h-11 shrink-0 items-center md:min-h-0 md:pt-0.5">
        {typeof children === "function" ? children(labelId, descriptionId) : children}
      </div>
    </div>
  );
}
