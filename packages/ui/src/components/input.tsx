import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@receipt-ocr/ui/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-lg border border-input bg-background/60 px-3 py-2 text-base text-foreground transition outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/40 max-md:h-11 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
