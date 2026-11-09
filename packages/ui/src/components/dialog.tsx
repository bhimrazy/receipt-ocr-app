"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@receipt-ocr/ui/lib/utils";

import { Button } from "@receipt-ocr/ui/components/button";
import { XIcon } from "lucide-react";
import { useKeyboardInset } from "../lib/keyboard-inset";

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-scrim duration-100 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Below md the dialog is a bottom sheet (`phoneSheet`, the default), lifted above the on-screen
 * keyboard so a form's fields and buttons stay in view; from md up it is centred in the visible
 * area. Pass `phoneSheet={false}` when `className` lays the popup out itself (full screen).
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  phoneSheet = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  phoneSheet?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPopup
        className={cn(
          "fixed top-[calc((100%-var(--keyboard-inset,0px))/2)] left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-popover p-5 pb-(--dialog-pb) text-sm shadow-2xl text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none [--dialog-pb:1.25rem] sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          phoneSheet &&
            // The bottom padding clears the home indicator, which the keyboard covers when open.
            "max-md:inset-x-0 max-md:top-auto max-md:bottom-[var(--keyboard-inset,0px)] max-md:mx-auto max-md:max-h-[calc(100dvh-var(--keyboard-inset,0px)-env(safe-area-inset-top)-1rem)] max-md:max-w-lg max-md:translate-x-0 max-md:translate-y-0 max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-b-none max-md:border-b-0 max-md:duration-200 max-md:[--dialog-pb:max(1.25rem,calc(env(safe-area-inset-bottom)-var(--keyboard-inset,0px)))] max-md:data-open:slide-in-from-bottom max-md:data-open:zoom-in-100 max-md:data-closed:slide-out-to-bottom max-md:data-closed:zoom-out-100 max-md:motion-reduce:animate-none",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" className="absolute top-2 right-2" size="icon-sm" />}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPopup>
    </DialogPortal>
  );
}

/** Rendered only while open, so the keyboard is watched only then. */
function DialogPopup({ style, ...props }: DialogPrimitive.Popup.Props) {
  const inset = useKeyboardInset();
  return (
    <DialogPrimitive.Popup
      data-slot="dialog-content"
      style={(state) => ({
        "--keyboard-inset": `${inset}px`,
        ...(typeof style === "function" ? style(state) : style),
      })}
      {...props}
    />
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-5 mb-[calc(var(--dialog-pb,1.25rem)*-1)] flex flex-col-reverse gap-2 rounded-b-xl border-t border-border bg-background/40 p-4 pb-[calc(var(--dialog-pb,1.25rem)-0.25rem)] max-md:rounded-b-none sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-tight font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
