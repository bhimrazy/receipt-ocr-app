"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { CircleAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { dismissUpgradeOffer } from "@/lib/upgrade-actions";
import { homeCardCopy } from "@/lib/upgrade-copy";
import type { UpgradeOffer } from "@/lib/upgrade-level";
import { UpgradeTrigger } from "./upgrade-trigger";

/** Home's upgrade card for an owner from NEAR_RATIO used. "Not now" snoozes it until the reset. */
export function UpgradeHomeCard({ offer }: { offer: UpgradeOffer }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const copy = homeCardCopy(offer.usage, offer.pro);

  function notNow() {
    setHidden(true);
    document.getElementById("main-content")?.focus();
    void dismissUpgradeOffer("home");
  }

  return (
    <Card className="border-primary/30 p-5 max-lg:-order-1">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Badge className="font-mono tabular-nums" variant="warning">
            <CircleAlert aria-hidden="true" />
            {copy.badge}
          </Badge>
          <h2 className="mt-2 text-sm font-medium">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <UpgradeTrigger surface="home">{copy.action}</UpgradeTrigger>
        <Button onClick={notNow} variant="ghost">
          Not now
        </Button>
      </div>
    </Card>
  );
}
