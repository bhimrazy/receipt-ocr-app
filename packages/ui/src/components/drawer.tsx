"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "@receipt-ocr/ui/lib/utils";

/**
 * Bottom sheet on Base UI's Drawer: same surface, border and backdrop as Dialog, swipe down,
 * Escape or a tap outside to close. For phone menus and action lists; use Dialog for forms.
 */
function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose({ ...props }: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Backdrop
        data-slot="drawer-overlay"
        className="fixed inset-0 z-50 min-h-dvh bg-scrim opacity-[calc(1-var(--drawer-swipe-progress))] transition-opacity duration-300 ease-out supports-backdrop-filter:backdrop-blur-sm data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 motion-reduce:transition-none"
      />
      <DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "flex max-h-[85dvh] w-full max-w-lg flex-col overflow-y-auto overscroll-contain rounded-t-2xl border border-b-0 border-border bg-popover pb-[max(1rem,env(safe-area-inset-bottom))] text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/10 outline-none [transform:translateY(var(--drawer-swipe-movement-y))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-ending-style:[transform:translateY(100%)] data-starting-style:[transform:translateY(100%)] data-swiping:select-none motion-reduce:transition-none",
            className,
          )}
          {...props}
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-2.5 mb-1 h-1 w-10 shrink-0 rounded-full bg-foreground/20"
          />
          <DrawerPrimitive.Content className="flex flex-col">{children}</DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn("flex flex-col gap-1 px-5 pt-2 pb-3", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-base leading-tight font-semibold", className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/** A group of rows, separated from the next group by a rule. */
function DrawerGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-group"
      className={cn("flex flex-col border-t border-border px-2 py-2", className)}
      {...props}
    />
  );
}

function DrawerLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="drawer-label"
      className={cn("px-3 pt-1 pb-1.5 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

const actionClass =
  "flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors outline-none select-none hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5 [&_svg]:text-muted-foreground aria-[current=page]:[&_svg]:text-primary";

/**
 * A 48px row in a sheet. A button by default; pass `render={<Link href="…" />}` for navigation.
 * `destructive` colours it for delete-style actions.
 */
function DrawerAction({
  className,
  destructive,
  render,
  ...props
}: React.ComponentProps<"button"> & {
  destructive?: boolean;
  render?: React.ReactElement<{ className?: string }>;
}) {
  const classes = cn(
    actionClass,
    destructive && "text-destructive [&_svg]:text-destructive",
    className,
  );
  if (render) {
    return React.cloneElement(render, {
      ...(props as object),
      className: cn(classes, render.props.className),
      "data-slot": "drawer-action",
    } as React.HTMLAttributes<HTMLElement>);
  }
  return <button data-slot="drawer-action" type="button" className={classes} {...props} />;
}

export {
  Drawer,
  DrawerAction,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerGroup,
  DrawerHeader,
  DrawerLabel,
  DrawerTitle,
  DrawerTrigger,
};
