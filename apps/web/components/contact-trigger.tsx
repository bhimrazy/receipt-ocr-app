"use client";

import type { ComponentProps } from "react";
import { openSupportWidget, type SupportTopic } from "@/lib/support-widget";

/** Opens the support widget on the given topic. Use ContactButton for the styled version. */
export function ContactTrigger({
  topic,
  type = "button",
  ...props
}: ComponentProps<"button"> & { topic?: SupportTopic }) {
  return <button onClick={() => openSupportWidget(topic)} type={type} {...props} />;
}
