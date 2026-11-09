"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button, buttonVariants } from "@receipt-ocr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@receipt-ocr/ui/components/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@receipt-ocr/ui/components/drawer";
import { toast } from "@receipt-ocr/ui/components/toast";
import { ArrowRight, CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { CHECKOUT_BLOCKED, SLOW_WEBHOOK } from "@/components/billing/checkout-button";
import { IntervalToggle, type BillingInterval } from "@/components/billing/interval-toggle";
import { useProCheckout } from "@/components/billing/use-pro-checkout";
import type { PlanId } from "@/lib/plans";
import { PRO_PRICE, PRO_PRICE_LABEL, REFUND_DAYS } from "@/lib/pricing";
import { recordUpgradeOpened } from "@/lib/upgrade-actions";
import { comparisonRows, usedLine } from "@/lib/upgrade-copy";
import type { UpgradeSurface } from "@/lib/upgrade-event";
import type { UpgradeOffer } from "@/lib/upgrade-level";
import { useIsDesktop } from "@/lib/use-is-desktop";
import { OPEN_UPGRADE, type OpenUpgradeDetail } from "./upgrade-trigger";

const YEAR_MONTHLY = `$${(PRO_PRICE.year / 12).toFixed(2)}`;

/** Where focus goes when the modal or Paddle's overlay closes: the trigger, else the page. */
const focusTarget = (trigger: HTMLElement | null) =>
  trigger?.isConnected ? trigger : document.getElementById("main-content");

/**
 * The one upgrade modal, mounted once in the app layout: a dialog from md up, a bottom sheet
 * below. Opens on `upgrade-modal:open` from any surface, or on `?upgrade=1` (stripped once
 * read, so Back leaves the page). Its primary button closes the modal, then opens Paddle's
 * overlay, which can't sit on top of a focus-trapping dialog. Renders nothing without an
 * owner's offer, but stays mounted after payment to report when Pro is on.
 */
export function UpgradeModal({ offer, plan }: { offer: UpgradeOffer | null; plan: PlanId }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [surface, setSurface] = useState<UpgradeSurface>("link");
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [desktop, setDesktop] = useState(true);
  const [loadScript, setLoadScript] = useState(false);
  const liveDesktop = useIsDesktop();
  const trigger = useRef<HTMLElement | null>(null);
  const pending = useRef<string | null>(null);
  const toastId = useRef<string | null>(null);
  // Kept after the offer goes away (Pro arrived) for the closing toast and Paddle's settings.
  const [last, setLast] = useState(offer);
  if (offer && offer !== last) setLast(offer);
  const owned = offer?.audience === "owner" ? offer : null;

  const checkout = useProCheckout({
    settings: last?.checkout?.settings ?? null,
    load: loadScript,
    done: plan === "pro",
    onClosed: () => focusTarget(trigger.current)?.focus(),
  });

  const latest = useRef({ owned, liveDesktop, reset: checkout.reset });
  useEffect(() => {
    latest.current = { owned, liveDesktop, reset: checkout.reset };
  });

  useEffect(() => {
    function show(
      nextSurface: UpgradeSurface,
      from: HTMLElement | null,
      nextInterval?: BillingInterval,
    ) {
      if (!latest.current.owned) return;
      trigger.current = from;
      latest.current.reset();
      setSurface(nextSurface);
      if (nextInterval) setInterval(nextInterval);
      // Read once per opening, so it never switches between dialog and sheet mid-way.
      setDesktop(latest.current.liveDesktop);
      setLoadScript(true);
      setOpen(true);
      void recordUpgradeOpened(nextSurface);
    }
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenUpgradeDetail>).detail;
      show(detail.surface, detail.trigger);
    };
    window.addEventListener(OPEN_UPGRADE, onOpen);

    // The deep link: /app/...?upgrade=1[&via=email][&interval=year], read once and removed.
    const url = new URL(window.location.href);
    if (url.searchParams.get("upgrade") === "1") {
      const via = url.searchParams.get("via");
      const yearly = url.searchParams.get("interval") === "year";
      for (const key of ["upgrade", "via", "interval"]) url.searchParams.delete(key);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      show(via === "email" ? "email" : "link", null, yearly ? "year" : undefined);
    }
    return () => window.removeEventListener(OPEN_UPGRADE, onOpen);
  }, []);

  // After payment the modal is closed; the outcome is a toast.
  const state = checkout.state;
  const name = last?.workspaceName ?? "this workspace";
  useEffect(() => {
    if (state === "paid" && !toastId.current) {
      toastId.current = toast.add({
        title: "Payment received. Turning on Pro for this workspace…",
        type: "loading",
        timeout: 0,
      });
      return;
    }
    const id = toastId.current;
    if (!id) return;
    if (state === "done") {
      toast.update(id, { title: `Pro is on for ${name}.`, type: "success", timeout: 6000 });
      toastId.current = null;
    } else if (state === "slow") {
      toast.update(id, {
        title: SLOW_WEBHOOK,
        type: "info",
        timeout: 0,
        actionProps: {
          children: "Open Billing",
          onClick: () => router.push("/app/settings/billing"),
        },
      });
      toastId.current = null;
    }
  }, [state, name, router]);

  // Paddle reported a problem while its overlay was open (ours is closed by then).
  useEffect(() => {
    if (state === "error" && !open && checkout.error)
      toast.add({ title: checkout.error, type: "error" });
  }, [state, open, checkout.error]);

  async function startCheckout() {
    const transactionId = await checkout.create(interval, surface);
    if (!transactionId) return;
    pending.current = transactionId;
    setOpen(false);
  }

  /** Paddle's overlay opens only once our close transition has finished, so they never overlap. */
  function onOpenChangeComplete(isOpen: boolean) {
    if (isOpen || !pending.current) return;
    const transactionId = pending.current;
    pending.current = null;
    checkout.open(transactionId);
  }

  const finalFocus = () => (pending.current ? false : focusTarget(trigger.current));
  const script = checkout.scriptProps ? <Script {...checkout.scriptProps} /> : null;
  if (!owned) return script;

  const body = (
    <ModalBody
      busy={checkout.busy}
      error={checkout.state === "error" ? checkout.error : null}
      interval={interval}
      offer={owned}
      onClose={() => setOpen(false)}
      onContinue={startCheckout}
      onInterval={setInterval}
      starting={checkout.state === "starting"}
      Title={desktop ? DialogTitle : DrawerTitle}
      Description={desktop ? DialogDescription : DrawerDescription}
      unavailable={checkout.state === "unavailable"}
    />
  );

  return (
    <>
      {script}
      {desktop ? (
        <Dialog onOpenChange={setOpen} onOpenChangeComplete={onOpenChangeComplete} open={open}>
          <DialogContent
            className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
            finalFocus={finalFocus}
          >
            {body}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer onOpenChange={setOpen} onOpenChangeComplete={onOpenChangeComplete} open={open}>
          <DrawerContent finalFocus={finalFocus}>
            <div className="px-5 pt-2">{body}</div>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}

type TitleComponent = React.ComponentType<{ className?: string; children: React.ReactNode }>;

function ModalBody({
  offer,
  interval,
  onInterval,
  onContinue,
  onClose,
  busy,
  starting,
  unavailable,
  error,
  Title,
  Description,
}: {
  offer: UpgradeOffer;
  interval: BillingInterval;
  onInterval: (interval: BillingInterval) => void;
  onContinue: () => void;
  onClose: () => void;
  busy: boolean;
  starting: boolean;
  unavailable: boolean;
  error: string | null;
  Title: TitleComponent;
  Description: TitleComponent;
}) {
  const { level, usage, workspaceName } = offer;
  const yearly = interval === "year";
  const price = yearly ? `${PRO_PRICE_LABEL.year} a year` : `${PRO_PRICE_LABEL.month} a month`;
  const rows = comparisonRows({ free: offer.free, pro: offer.pro });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="flex flex-wrap items-center gap-2 pr-8">
          <Badge variant={level === "quiet" ? "secondary" : "warning"}>
            {level === "quiet" ? null : <CircleAlert aria-hidden="true" />}
            {level === "at" ? "Limit reached" : "Free plan"}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {usedLine(usage)}
          </span>
        </p>
        <Title className="mt-3 text-lg">Pro for {workspaceName}</Title>
        <Description className="mt-1">
          Each workspace has its own plan; this upgrades {workspaceName} only.
        </Description>
      </div>

      <IntervalToggle
        className="w-full sm:w-auto sm:self-start [&>label]:flex-1 sm:[&>label]:flex-none"
        name="upgrade-interval"
        onChange={onInterval}
        value={interval}
      />

      <div>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-3xl font-bold tracking-tight tabular-nums">
            {yearly ? PRO_PRICE_LABEL.year : PRO_PRICE_LABEL.month}
          </span>
          <span className="text-sm text-muted-foreground">
            {yearly ? `a year per workspace (${YEAR_MONTHLY} a month)` : "a month per workspace"}
          </span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Plus sales tax or VAT where it applies.
        </p>
      </div>

      <table className="w-full text-sm">
        <caption className="sr-only">Free and Pro compared</caption>
        <thead>
          <tr className="border-b border-border">
            <td />
            <th className="pb-2 text-right text-xs font-medium text-muted-foreground" scope="col">
              Free
            </th>
            <th className="pb-2 pl-3 text-right" scope="col">
              <Badge>Pro</Badge>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.label}>
              <th className="py-2 pr-3 text-left font-normal text-muted-foreground" scope="row">
                {row.label}
              </th>
              <td className="py-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                {row.free}
              </td>
              <td className="py-2 pl-3 text-right font-mono text-xs text-foreground tabular-nums">
                {row.pro}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {offer.checkout?.testMode ? (
        <Badge className="self-start" variant="warning">
          Test mode: no real charge
        </Badge>
      ) : null}

      {unavailable ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-destructive" role="alert">
            {CHECKOUT_BLOCKED}
          </p>
          <Link
            className={buttonVariants({ className: "w-full sm:self-start sm:w-auto" })}
            href="/app/settings/billing"
          >
            Open checkout on the billing page
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="max-md:h-11 sm:flex-1" disabled={busy} onClick={onContinue}>
            {busy ? (
              <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            ) : null}
            Continue to checkout, {price}
          </Button>
          <Button className="max-md:h-11" onClick={onClose} variant="ghost">
            Not now
          </Button>
        </div>
      )}
      {error ? (
        <p className="-mt-2 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {starting ? (
        <span className="sr-only" role="status">
          Starting the checkout…
        </span>
      ) : null}

      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>
          Paddle takes the payment and sends the invoice. Cancel any time; full refund within{" "}
          {REFUND_DAYS} days.
        </p>
        <Link
          className="inline-flex items-center gap-1 self-start rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
          href="/pricing"
        >
          Compare all plans
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>
    </div>
  );
}
