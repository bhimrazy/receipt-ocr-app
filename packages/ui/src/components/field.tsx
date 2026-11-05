import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { Label } from "@receipt-ocr/ui/components/label";

/** Stacks related fields with even spacing. */
function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("group/field-group flex w-full flex-col gap-4", className)}
      {...props}
    />
  );
}

const fieldVariants = cva("group/field flex w-full gap-1.5 data-[invalid=true]:text-destructive", {
  variants: {
    orientation: {
      vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
      horizontal: "flex-row items-center *:data-[slot=field-label]:flex-auto",
    },
  },
  defaultVariants: {
    orientation: "vertical",
  },
});

/**
 * One label + control + hint/error. Set `data-invalid` here and `aria-invalid` on the control
 * when it has an error; point the control's `aria-describedby` at the description/error ids.
 */
function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn("w-fit group-data-[disabled=true]/field:opacity-50", className)}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-xs font-normal text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className,
      )}
      {...props}
    />
  );
}

/** Renders nothing without children, so it can sit in the tree unconditionally. */
function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  if (!children) return null;
  return (
    <p
      role="alert"
      data-slot="field-error"
      className={cn("text-sm font-normal text-destructive", className)}
      {...props}
    >
      {children}
    </p>
  );
}

export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel };
