"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { Download, X } from "lucide-react";
import type { InstallPath } from "@/lib/use-install-offer";

/** The dismissible install card, placed in the page flow. Loaded only when it will show. */
export default function InstallCard({
  path,
  onInstall,
  onDismiss,
}: {
  path: InstallPath;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside aria-labelledby="install-card-title" className="mt-6">
      <Card className="flex items-start gap-3 p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
          <Download aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" id="install-card-title">
            Install ReceiptOCR
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {path.kind === "prompt"
              ? "Open it in its own window, straight from your home screen or desktop."
              : "Add it to your Home Screen to scan the next receipt in one tap."}
          </p>
          <Button className="mt-3" onClick={onInstall} size="sm">
            {path.kind === "prompt" ? "Install app" : "Show me how"}
          </Button>
        </div>
        <Button aria-label="Not now" onClick={onDismiss} size="icon-sm" variant="ghost">
          <X aria-hidden="true" />
        </Button>
      </Card>
    </aside>
  );
}
