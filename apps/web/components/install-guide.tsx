"use client";

import { Button } from "@receipt-ocr/ui/components/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@receipt-ocr/ui/components/drawer";
import { Check, Compass, Copy, Share, SquarePlus, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { InstallPath } from "@/lib/use-install-offer";

type GuidePath = Extract<InstallPath, { kind: "guide" }>;
type Step = { icon: LucideIcon; text: React.ReactNode; note?: string };

const b = (text: string) => <strong className="font-medium text-foreground">{text}</strong>;

/**
 * Add to Home Screen steps for Safari. We can't tell which toolbar layout is in use (iOS 26's
 * Compact layout hides Share behind •••), so the first iPhone step names both.
 */
export function guideSteps(path: GuidePath): Step[] {
  if (path.browser !== "safari") return [];
  if (path.ipad) {
    return [
      { icon: Share, text: <>Tap {b("Share")} in the toolbar.</> },
      {
        icon: SquarePlus,
        text: (
          <>
            Tap {b("Add to Home Screen")}, then {b("Add")}.
          </>
        ),
      },
    ];
  }
  return [
    {
      icon: Share,
      text: (
        <>
          Tap {b("Share")}. If you don&apos;t see it, tap {b("•••")} next to the address bar, then{" "}
          {b("Share")}.
        </>
      ),
    },
    { icon: SquarePlus, text: <>Tap {b("Add to Home Screen")}.</> },
    // iOS 26 shows this switch, on by default; off, it saves a plain bookmark.
    { icon: Check, text: <>Tap {b("Add")}.</>, note: "If you see Open as Web App, leave it on." },
  ];
}

export function GuideSteps({ path }: { path: GuidePath }) {
  const steps = guideSteps(path);
  if (steps.length === 0) {
    return (
      <p className="flex items-start gap-3 px-5 text-sm text-muted-foreground">
        <Compass aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        Open this page in Safari to add it to your Home Screen.
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-4 px-5">
      {steps.map((step, index) => (
        <li className="flex items-start gap-3" key={index}>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
            <step.icon aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 pt-1.5 text-sm text-muted-foreground">
            <p>
              {index + 1}. {step.text}
            </p>
            {step.note ? <p className="mt-1 text-xs">{step.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      className="mx-5 mt-4"
      onClick={() =>
        navigator.clipboard
          .writeText(location.href)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }
      variant="outline"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Link copied" : "Copy link"}
    </Button>
  );
}

/** A bottom sheet with the steps to add ReceiptOCR to the Home Screen on iPhone or iPad. */
export default function InstallGuide({
  path,
  open,
  onOpenChange,
}: {
  path: GuidePath;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const safari = path.browser === "safari";
  return (
    <Drawer onOpenChange={onOpenChange} open={open}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Add ReceiptOCR to your Home Screen</DrawerTitle>
          <DrawerDescription>
            It&apos;s a web app, so there&apos;s nothing to download from the App Store.
            {safari ? " Safari adds it in a few taps:" : null}
          </DrawerDescription>
        </DrawerHeader>
        <GuideSteps path={path} />
        {safari ? null : <CopyLink />}
        <p className="mt-5 px-5 text-xs text-muted-foreground">
          ReceiptOCR is a progressive web app (PWA): it runs in your browser and updates itself.
        </p>
        <Button className="mx-5 mt-4" onClick={() => onOpenChange(false)} variant="secondary">
          Done
        </Button>
      </DrawerContent>
    </Drawer>
  );
}
