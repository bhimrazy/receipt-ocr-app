"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import type { ComponentProps } from "react";
import { openSupportWidget, type SupportTopic } from "@/lib/support-widget";

/**
 * A button that opens the support form (`SupportWidget`, which must be on the page) on `topic`.
 * `aria-haspopup` tells screen readers it opens a dialog rather than navigating.
 */
export function ContactButton({
  topic,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "type"> & { topic?: SupportTopic }) {
  return (
    <Button
      aria-haspopup="dialog"
      onClick={() => openSupportWidget(topic)}
      type="button"
      {...props}
    />
  );
}
