"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@receipt-ocr/ui/components/dialog";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@receipt-ocr/ui/components/popover";
import { useSyncExternalStore } from "react";

const DESKTOP = "(min-width: 768px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True from md up. On the server (nothing is open yet) it says desktop. */
function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  );
}

/**
 * A popover beside its trigger from md up, a bottom sheet below. Both trap
 * focus, close on Escape and return focus to the trigger.
 */
export function ResponsivePanel({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const desktop = useIsDesktop();
  if (desktop) {
    return (
      <Popover onOpenChange={onOpenChange} open={open}>
        <PopoverTrigger render={trigger} />
        <PopoverContent>
          <div className="flex flex-col gap-1">
            <PopoverTitle>{title}</PopoverTitle>
            {description ? <PopoverDescription>{description}</PopoverDescription> : null}
          </div>
          {children}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger render={trigger} />
      <DialogContent className="top-auto bottom-0 left-0 max-h-[85dvh] max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none pb-[max(1.25rem,env(safe-area-inset-bottom))] data-closed:slide-out-to-bottom data-closed:zoom-out-100 data-open:slide-in-from-bottom data-open:zoom-in-100 sm:max-w-none">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
