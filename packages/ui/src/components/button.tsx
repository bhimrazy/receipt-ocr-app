import * as React from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@receipt-ocr/ui/lib/utils";

// Below md every size grows to 44px so touch targets meet WCAG 2.5.5.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_0_30px_color-mix(in_oklab,var(--primary)_26%,transparent)] hover:-translate-y-0.5 hover:shadow-[0_0_42px_color-mix(in_oklab,var(--primary)_38%,transparent)] motion-reduce:hover:translate-y-0",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-muted",
        ghost:
          "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground aria-expanded:bg-foreground/[0.06] aria-expanded:text-foreground",
        outline:
          "border-border bg-background/40 text-foreground hover:bg-foreground/[0.06] aria-expanded:bg-foreground/[0.06]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs max-md:h-11 max-md:px-4",
        default: "h-10 px-4 max-md:h-11",
        lg: "h-12 px-6",
        icon: "size-10 max-md:size-11",
        "icon-sm": "size-8 max-md:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /**
     * @deprecated Use `render={<Link href="…" />}` (Base UI), or `buttonVariants()` on a link.
     * Kept so existing Radix-style call sites keep working.
     */
    asChild?: boolean;
  };

function Button({
  className,
  variant = "default",
  size = "default",
  asChild,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));

  // Clones the child (usually a link) rather than using the Button primitive,
  // which would add role="button" to a link. Plain cloneElement stays server-safe.
  if (asChild && React.isValidElement<{ className?: string }>(children)) {
    return React.cloneElement(children, {
      ...(props as object),
      "data-slot": "button",
      className: cn(classes, children.props.className),
    } as { className: string });
  }

  return (
    <ButtonPrimitive data-slot="button" className={classes} {...props}>
      {children}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants, type ButtonProps };
