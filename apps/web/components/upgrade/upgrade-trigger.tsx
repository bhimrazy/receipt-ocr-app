"use client";

import { buttonVariants } from "@receipt-ocr/ui/components/button";
import type { UpgradeSurface } from "@/lib/upgrade-event";

/** Window event the upgrade modal listens for, so no surface needs props drilled to it. */
export const OPEN_UPGRADE = "upgrade-modal:open";

export type OpenUpgradeDetail = {
  surface: UpgradeSurface;
  /** Gets focus back when the modal (or Paddle's overlay) closes; null sends it to the page. */
  trigger: HTMLElement | null;
};

export function openUpgradeModal(surface: UpgradeSurface, trigger: HTMLElement | null) {
  window.dispatchEvent(
    new CustomEvent<OpenUpgradeDetail>(OPEN_UPGRADE, { detail: { surface, trigger } }),
  );
}

/**
 * A link to Billing that opens the upgrade modal instead. Without JavaScript (or with a
 * modifier key) it is a plain link, and Billing has its own checkout.
 */
export function UpgradeTrigger({
  surface,
  variant,
  size,
  className,
  children,
}: {
  surface: UpgradeSurface;
  className?: string;
  children: React.ReactNode;
} & Pick<NonNullable<Parameters<typeof buttonVariants>[0]>, "variant" | "size">) {
  return (
    <a
      aria-haspopup="dialog"
      className={buttonVariants({ variant, size, className })}
      href="/app/settings/billing"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        openUpgradeModal(surface, event.currentTarget);
      }}
    >
      {children}
    </a>
  );
}
