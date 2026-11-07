import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import type { ComponentProps } from "react";
import { ContactTrigger } from "@/components/contact-trigger";
import type { SupportTopic } from "@/lib/support-widget";

type Variants = NonNullable<Parameters<typeof buttonVariants>[0]>;

/** Styled like `Button`; the classes resolve on the server and only the click handler ships. */
export function ContactButton({
  variant,
  size,
  className,
  ...props
}: ComponentProps<"button"> & Variants & { topic?: SupportTopic }) {
  return <ContactTrigger className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
