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
import { useIsDesktop } from "@/lib/use-is-desktop";

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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
