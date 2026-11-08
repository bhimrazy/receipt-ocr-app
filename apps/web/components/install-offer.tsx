"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { DrawerAction } from "@receipt-ocr/ui/components/drawer";
import { DropdownMenuItem } from "@receipt-ocr/ui/components/dropdown-menu";
import { Download } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { SettingsSection } from "@/components/settings-section";
import { useInstallAction } from "@/components/use-install-action";
import { platformOf, report, useInstallOffer } from "@/lib/use-install-offer";

// Loads only when it shows: most visits never see it.
const InstallCard = dynamic(() => import("./install-card"), { ssr: false });

/**
 * The install offer in the page flow, for after a receipt was read. Hidden while installed,
 * without an install path, or snoozed (30 days after the first "Not now", for good after the
 * second, and 7 days after any dismissal anywhere).
 */
export function InstallOfferCard() {
  const { path, canOffer, dismiss } = useInstallOffer();
  const action = useInstallAction("card", "app");
  const offered = path && canOffer("app") ? path : null;
  const visible = offered !== null;

  useEffect(() => {
    if (offered) report("shown", "card", platformOf(offered));
    // Once per page view, not again when the path object is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <>
      {offered ? (
        <InstallCard
          onDismiss={() => {
            report("dismissed", "card", platformOf(offered));
            dismiss("app");
          }}
          onInstall={action.start}
          path={offered}
        />
      ) : null}
      {action.guide}
    </>
  );
}

/** "Install app" in the desktop account menu. */
export function InstallAppMenuItem({ onSelect }: { onSelect: () => void }) {
  return (
    <DropdownMenuItem onClick={onSelect}>
      <Download aria-hidden="true" />
      Install app
    </DropdownMenuItem>
  );
}

/** "Install app" in the phone account sheet. */
export function InstallAppSheetAction({ onSelect }: { onSelect: () => void }) {
  return (
    <DrawerAction onClick={onSelect}>
      <Download aria-hidden="true" />
      Install app
    </DrawerAction>
  );
}

/** The App section in Settings, shown only while not installed and an install path exists. */
export function InstallAppSettings() {
  const { path, start, guide } = useInstallAction("settings", null);
  if (!path) return null;
  return (
    <SettingsSection
      description="Opens in its own window from your home screen or dock. It's a web app, not a store download."
      id="app-heading"
      title="App"
    >
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
        >
          <Download className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Install ReceiptOCR</p>
          <p className="text-xs text-muted-foreground">
            {path.kind === "prompt"
              ? "Your browser asks once to confirm."
              : "Safari adds it to your Home Screen in a few taps."}
          </p>
        </div>
        <Button onClick={start} size="sm" variant="outline">
          Install app
        </Button>
      </Card>
      {guide}
    </SettingsSection>
  );
}
