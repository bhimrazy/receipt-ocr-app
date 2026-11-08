"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { OfferPlacement } from "@/lib/pwa";
import { platformOf, report, useInstallOffer, type InstallSurface } from "@/lib/use-install-offer";

// Loads on first open.
const InstallGuide = dynamic(() => import("./install-guide"), { ssr: false });

/**
 * Starts an install from `surface`: Chrome's prompt where there is one, otherwise the iOS
 * guide. Declining Chrome's prompt counts as a dismissal at `placement`. Render `guide` outside
 * any menu, so it outlives the menu closing.
 */
export function useInstallAction(surface: InstallSurface, placement: OfferPlacement | null) {
  const { path, promptInstall } = useInstallOffer();
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideLoaded, setGuideLoaded] = useState(false);

  async function start() {
    if (!path) return;
    if (path.kind === "prompt") {
      await promptInstall(surface, placement);
      return;
    }
    report("opened", surface, platformOf(path));
    setGuideLoaded(true);
    setGuideOpen(true);
  }

  const guide =
    path?.kind === "guide" && guideLoaded ? (
      <InstallGuide onOpenChange={setGuideOpen} open={guideOpen} path={path} />
    ) : null;

  return { path, start, guide };
}
