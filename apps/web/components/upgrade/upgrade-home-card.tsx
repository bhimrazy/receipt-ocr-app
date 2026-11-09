"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { CircleAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { dismissUpgradeOffer } from "@/lib/upgrade-actions";
import { homeCardCopy } from "@/lib/upgrade-copy";
import type { UpgradeOffer } from "@/lib/upgrade-level";
import { UpgradeTrigger } from "./upgrade-trigger";

/** Home's upgrade card for an owner, `quiet` from WARM_RATIO or `near`. "Not now" snoozes it. */
export function UpgradeHomeCard({
  offer,
  level,
}: {
  offer: UpgradeOffer;
  level: "quiet" | "near";
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  const copy = homeCardCopy(level, offer.usage, offer.pro);
  const near = level === "near";

  function notNow() {
    setHidden(true);
    document.getElementById("main-content")?.focus();
    void dismissUpgradeOffer("home");
  }

  return (
    <Card className={cn("p-5", near && "border-primary/30 max-lg:-order-1")}>
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-primary/25 bg-primary/10 text-primary">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Badge className="font-mono tabular-nums" variant={near ? "warning" : "secondary"}>
            {near ? <CircleAlert aria-hidden="true" /> : null}
            {copy.badge}
          </Badge>
          <h2 className="mt-2 text-sm font-medium">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <UpgradeTrigger surface="home" variant={near ? "default" : "outline"}>
          {copy.action}
        </UpgradeTrigger>
        <Button onClick={notNow} variant="ghost">
          Not now
        </Button>
      </div>
    </Card>
  );
}
