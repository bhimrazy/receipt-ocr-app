"use client";

import { Dialog, DialogContent, DialogTitle } from "@receipt-ocr/ui/components/dialog";
import { cn } from "@receipt-ocr/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/**
 * A modal that covers the whole screen like a native camera or editor: focus trap, Escape and
 * scroll lock come from the dialog; padding keeps controls clear of notches and home bars.
 */
export function FullScreen({
  open,
  onClose,
  title,
  children,
  className,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  initialFocus?: ComponentProps<typeof DialogContent>["initialFocus"];
}) {
  return (
    <Dialog onOpenChange={(next) => !next && onClose()} open={open}>
      <DialogContent
        className={cn(
          "top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 ring-0 sm:max-w-none",
          "pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]",
          "data-open:zoom-in-100 data-closed:zoom-out-100",
          className,
        )}
        initialFocus={initialFocus}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
