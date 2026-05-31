"use client";

import { Button, type ButtonProps } from "@receipt-ocr/ui/components/button";
import { openSupportWidget, type SupportTopic } from "@/lib/support-widget";

export function ContactButton({
  topic,
  ...props
}: ButtonProps & { topic?: SupportTopic }) {
  return <Button {...props} onClick={() => openSupportWidget(topic)} />;
}
