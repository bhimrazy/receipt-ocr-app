"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@receipt-ocr/ui/lib/utils";

/** On/off control. The thumb sits in a 44px hit area below md (WCAG 2.5.5). */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none after:absolute after:-inset-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-foreground shadow-sm ring-0 transition-transform data-checked:translate-x-4 data-checked:bg-primary-foreground data-unchecked:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
