"use client";

import { Banner } from "@receipt-ocr/ui/components/banner";
import { Button } from "@receipt-ocr/ui/components/button";
import { CircleAlert, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { dismissUpgradeOffer } from "@/lib/upgrade-actions";
import { bannerCopy } from "@/lib/upgrade-copy";
import type { UpgradeOffer } from "@/lib/upgrade-level";
import { UpgradeTrigger } from "./upgrade-trigger";

/**
 * Pages that already say the limit is reached (Home and Upload show it instead of the drop
 * zone), Billing, which sells Pro itself, and receipt pages, where the install card lives.
 */
export function bannerHiddenOn(pathname: string) {
  return (
    pathname === "/app" ||
    pathname.startsWith("/app/upload") ||
    pathname.startsWith("/app/settings/billing") ||
    pathname.startsWith("/app/receipts/")
  );
}

/** For an owner whose uploads are blocked by the plan: what happened, when it reopens, and Pro. */
export function UpgradeBanner({ offer }: { offer: UpgradeOffer }) {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const copy = bannerCopy(offer.usage, offer.pro);
  if (hidden || !copy || bannerHiddenOn(pathname)) return null;

  function hide() {
    setHidden(true);
    document.getElementById("main-content")?.focus();
    void dismissUpgradeOffer("banner");
  }

  return (
    <Banner
      actions={
        <>
          <UpgradeTrigger size="sm" surface="banner">
            Upgrade to Pro
          </UpgradeTrigger>
          <Button
            aria-label={`Hide until ${copy.opens}`}
            onClick={hide}
            size="icon-sm"
            variant="ghost"
          >
            <X aria-hidden="true" />
          </Button>
        </>
      }
      aria-label="Plan limit"
      className="mx-auto mb-6 max-w-5xl"
      icon={CircleAlert}
      tone="warning"
    >
      {copy.body}
    </Banner>
  );
}
