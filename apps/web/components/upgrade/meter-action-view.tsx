"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { ContactButton } from "@/components/contact-button";
import type { MeterAction } from "@/lib/meter-action";
import type { UpgradeSurface } from "@/lib/upgrade-event";
import { ASK_OWNER } from "@/lib/upgrade-copy";
import { UpgradeTrigger } from "./upgrade-trigger";

const textLink =
  "font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:inline-flex max-md:min-h-11 max-md:items-center";

/** What `meterAction` decided, drawn the same on the usage card and the phone strip. */
export function MeterActionView({
  action,
  surface,
  opensSoon,
}: {
  action: MeterAction;
  surface: UpgradeSurface;
  /** "Pro, with 500 scans a month, opens soon." */
  opensSoon: string;
}) {
  switch (action) {
    case "upgrade-button":
      return (
        <UpgradeTrigger className="w-full" size="sm" surface={surface}>
          Upgrade to Pro
        </UpgradeTrigger>
      );
    case "upgrade-link":
      return (
        <UpgradeTrigger
          className="h-auto justify-start p-0 text-xs max-md:min-h-11"
          surface={surface}
          variant="link"
        >
          Upgrade
          <ChevronRight aria-hidden="true" />
        </UpgradeTrigger>
      );
    case "ask-owner":
      return <p className="text-xs text-muted-foreground">{ASK_OWNER}</p>;
    case "contact":
      return (
        <p className="text-xs text-muted-foreground">
          Need more?{" "}
          <ContactButton
            className="h-auto p-0 align-baseline text-xs max-md:min-h-11"
            topic="use-case"
            variant="link"
          >
            Contact us
          </ContactButton>
        </p>
      );
    case "opens-soon":
      return (
        <p className="text-xs text-muted-foreground">
          {opensSoon}{" "}
          <Link className={textLink} href="/pricing">
            Compare plans
          </Link>
        </p>
      );
  }
}
