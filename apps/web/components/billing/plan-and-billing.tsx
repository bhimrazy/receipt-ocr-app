import { BUYER_GONE, type WorkspaceBilling } from "@receipt-ocr/core";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Card } from "@receipt-ocr/ui/components/card";
import { Check } from "lucide-react";
import Link from "next/link";
import { CheckoutButton } from "@/components/billing/checkout-button";
import type { CheckoutSettings } from "@/components/billing/paddle-js";
import { PortalButtons } from "@/components/billing/portal-buttons";
import { ContactButton } from "@/components/contact-button";
import { SettingsSection } from "@/components/settings-section";
import { PlanBadge, UsageMeter, type Usage } from "@/components/usage-meter";
import { formatDate } from "@/lib/format";
import { freeFeatures, membersLine, scansLine, SEPARATE_UPGRADE } from "@/lib/plan-copy";
import type { PlanId, PlanPolicy, PlanTable } from "@/lib/plans";
import { PRO_PRICE_LABEL } from "@/lib/pricing";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed",
  paused: "Paused",
  canceled: "Canceled",
};

/**
 * Who can act on a subscription that blocks a new checkout, for a viewer without its portal
 * buttons on this page: the buyer through Paddle's emails while billing is unavailable, another
 * owner through the buyer, and support once the buyer is gone.
 */
function whoCanAct(subscription: WorkspaceBilling, isBuyer: boolean): string {
  if (isBuyer) return "Reply to any email from Paddle about it, or use the support button.";
  return subscription.buyer
    ? `Ask ${subscription.buyer.email}, who subscribed, to cancel it, or use the support button.`
    : "Use the support button to cancel or resume it.";
}

/**
 * What happened to the subscription, for the state it is in. `canManage`: the viewer has its
 * portal buttons on this page (the buyer, with billing on).
 */
function subscriptionNote(
  subscription: WorkspaceBilling,
  canManage: boolean,
  isBuyer: boolean,
): string | null {
  const until = formatDate(subscription.currentPeriodEnd);
  const ended = formatDate(subscription.endedAt) ?? "its last day";
  if (subscription.entitled) {
    if (subscription.cancelAtPeriodEnd && until) {
      return `Pro stays on until ${until}, then this workspace moves to Free. Nothing more is charged.`;
    }
    if (subscription.status === "past_due") {
      const graceEnds = formatDate(subscription.graceEndsAt);
      return graceEnds
        ? `The last payment didn't go through. Paddle will keep trying the card until ${graceEnds}, and Pro stays on until then. Update the payment method so it doesn't end.`
        : "The last payment didn't go through. Paddle will keep trying the card, and Pro stays on for now. Update the payment method so it doesn't end.";
    }
    return until ? `Renews on ${until}.` : null;
  }
  if (subscription.revoked && subscription.status !== "canceled") {
    return `Pro ended on ${ended} after a refund or chargeback, and this subscription is being canceled in Paddle. A new one can start once that is done.`;
  }
  if (subscription.status === "paused") {
    const next = canManage
      ? "Cancel it below, or use the support button to resume it."
      : whoCanAct(subscription, isBuyer);
    return `This subscription is paused in Paddle, so Pro is off and nothing is charged. A new subscription can't start while it exists. ${next}`;
  }
  if (subscription.status === "past_due" && !subscription.revoked) {
    return `Pro ended on ${ended} because the payment didn't go through. Update the payment method to turn it back on.`;
  }
  return `Ended on ${ended}.`;
}

export type PlanAndBillingProps = {
  plan: PlanId;
  /** The viewer's limits on this workspace's plan. */
  policy: PlanPolicy;
  plans: PlanTable;
  usage: Usage;
  /** May buy and manage this workspace's plan (`canManageBilling`). */
  owner: boolean;
  impersonating: boolean;
  /** The viewer owns another workspace that is on Pro. */
  ownsPro: boolean;
  subscription: WorkspaceBilling | null;
  /** Signed in as the person who subscribed. */
  isBuyer: boolean;
  /** The checkout this viewer may use, or null while it is closed to them. */
  checkout: { settings: CheckoutSettings; testMode: boolean } | null;
  /** Paddle's server settings are present, so the customer portal can open. */
  portalAvailable: boolean;
  workspaceId: string;
  interval: "month" | "year";
};

const linkClass =
  "underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:inline-flex max-md:min-h-11 max-md:items-center";

/**
 * The one billing page. A subscription decides what an owner sees before the checkout state
 * does, so a payer always has status, renewal and the portal (or the way to reach Paddle).
 * Anyone else in a Pro workspace sees the plan and usage and who manages it, nothing more.
 */
export function PlanAndBilling(props: PlanAndBillingProps) {
  const { plan, policy, usage, owner, subscription } = props;
  const entitled = subscription?.entitled === true;
  // A comp: Pro without a subscription of its own (an admin set the owner's plan).
  const comped = plan === "pro" && !entitled;
  const memberOfPro = plan === "pro" && !owner;

  return (
    <>
      <SettingsSection
        description={
          plan === "pro"
            ? "Pro scans are shared by everyone in this workspace."
            : "Free scans are counted per person, across every Free workspace you use."
        }
        id="billing-usage-heading"
        title="Usage"
      >
        <div className="flex flex-col gap-3">
          <UsageMeter className="p-5" detail plan={plan} usage={usage} />
          <p className="font-mono text-xs text-muted-foreground tabular-nums">
            {policy.receiptsPerDay} a day · up to {policy.membersPerWorkspace} members
          </p>
          {memberOfPro ? (
            <Alert>Managed by the workspace owner. Ask them to change the plan.</Alert>
          ) : null}
        </div>
      </SettingsSection>

      {memberOfPro ? null : comped ? (
        <SettingsSection
          description="Set by an administrator for the workspace owner."
          id="billing-plan-heading"
          title="Plan"
        >
          <Card className="flex items-center gap-2 p-5">
            <PlanBadge plan="pro" />
            <p className="text-sm">Given by an administrator. No payment is needed.</p>
          </Card>
        </SettingsSection>
      ) : (
        <>
          {subscription && owner ? <Subscription {...props} subscription={subscription} /> : null}
          {plan === "free" ? <Plans {...props} /> : null}
        </>
      )}
    </>
  );
}

function Subscription(props: PlanAndBillingProps & { subscription: WorkspaceBilling }) {
  const { subscription, isBuyer, impersonating, portalAvailable } = props;
  const entitled = subscription.entitled;
  const portalOpen =
    entitled || subscription.status === "past_due" || subscription.status === "paused";
  const note = subscriptionNote(subscription, canManageHere(props), isBuyer);

  let actions: React.ReactNode = null;
  if (impersonating) {
    actions = <Alert>Billing is hidden while you are signed in as another user.</Alert>;
  } else if (!isBuyer) {
    actions = (
      <Alert>
        {subscription.buyer
          ? `Billing for this workspace is managed by ${subscription.buyer.email}.`
          : BUYER_GONE}
      </Alert>
    );
  } else if (!portalAvailable) {
    actions = portalOpen ? (
      <div className="flex flex-col gap-2">
        <p className="text-sm">Billing is unavailable right now. Your plan is not affected.</p>
        <p className="text-sm text-muted-foreground">
          To cancel, change the card or get an invoice now, reply to any email from Paddle about
          this subscription, or{" "}
          <ContactButton
            className="h-auto p-0 align-baseline max-md:h-auto max-md:px-0"
            topic="use-case"
            variant="link"
          >
            contact us
          </ContactButton>
          .
        </p>
      </div>
    ) : null;
  } else if (portalOpen) {
    actions = <PortalButtons canceling={subscription.cancelAtPeriodEnd} />;
  } else {
    actions = <PortalButtons canceling />;
  }

  return (
    <SettingsSection
      description="Paddle is the merchant of record: it takes the payment, adds tax and sends invoices."
      id="billing-subscription-heading"
      title="Subscription"
    >
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <PlanBadge plan="pro" />
          <p className="text-sm font-medium">
            {subscription.interval === "year" ? "Yearly" : "Monthly"}
          </p>
          <Badge
            variant={
              subscription.status === "past_due" ? "warning" : entitled ? "default" : "secondary"
            }
          >
            {subscription.cancelAtPeriodEnd && entitled
              ? "Ends at period end"
              : !entitled && subscription.status !== "paused"
                ? "Ended"
                : (STATUS_LABEL[subscription.status] ?? subscription.status)}
          </Badge>
        </div>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
        {actions}
        <FooterLinks />
      </Card>
    </SettingsSection>
  );
}

/** The viewer has the portal buttons for the subscription on this page. */
const canManageHere = (props: PlanAndBillingProps) =>
  props.isBuyer && props.portalAvailable && !props.impersonating && !props.subscription?.revoked;

function Plans(props: PlanAndBillingProps) {
  const { plans, owner, impersonating, checkout, ownsPro, subscription } = props;
  const { free } = plans;

  let proAction: React.ReactNode;
  if (!owner) {
    proAction = (
      <p className="text-sm text-muted-foreground">
        Only the workspace owner can upgrade this workspace.
      </p>
    );
  } else if (impersonating) {
    proAction = (
      <p className="text-sm text-muted-foreground">
        Billing is hidden while you are signed in as another user.
      </p>
    );
  } else if (subscription?.checkoutBlocked) {
    // A second subscription would charge alongside the one that still can.
    proAction = (
      <p className="text-sm text-muted-foreground">
        {subscription.revoked
          ? "This workspace's subscription is being canceled in Paddle. A new one can start once that is done."
          : canManageHere(props)
            ? "This workspace still has a subscription in Paddle. Manage it under Subscription above instead of starting another."
            : `This workspace still has a subscription in Paddle, so a new one can't start. ${whoCanAct(subscription, props.isBuyer)}`}
      </p>
    );
  } else if (checkout) {
    proAction = (
      <CheckoutButton
        initialInterval={props.interval}
        settings={checkout.settings}
        testMode={checkout.testMode}
        workspaceId={props.workspaceId}
      />
    );
  } else {
    proAction = null;
  }

  return (
    <SettingsSection
      description="What this workspace gets on each plan."
      id="billing-plans-heading"
      title="Plans"
    >
      <div className="flex flex-col gap-3">
        {ownsPro && owner ? (
          <p className="text-sm text-muted-foreground">{SEPARATE_UPGRADE}</p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Free</h3>
              <Badge variant="secondary">Your plan</Badge>
            </div>
            <p className="font-mono text-2xl font-bold">$0</p>
            <FeatureList features={freeFeatures(free).slice(0, 2)} />
          </Card>
          <Card className="flex flex-col gap-3 border-primary/30 p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Pro</h3>
              {checkout ? null : <Badge>Opens soon</Badge>}
            </div>
            <p className="font-mono text-2xl font-bold">
              {PRO_PRICE_LABEL.month}{" "}
              <span className="font-sans text-sm font-normal text-muted-foreground">a month</span>
            </p>
            <FeatureList features={[scansLine(plans.pro), membersLine(plans.pro)]} />
            {proAction ? <div className="mt-auto pt-2">{proAction}</div> : null}
          </Card>
        </div>
        {subscription ? null : <FooterLinks />}
      </div>
    </SettingsSection>
  );
}

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {features.map((feature) => (
        <li className="flex items-start gap-2" key={feature}>
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

function FooterLinks() {
  return (
    <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      <Link className={linkClass} href="/pricing">
        Compare plans
      </Link>
      <span aria-hidden="true">·</span>
      <Link className={linkClass} href="/refunds">
        Refund policy
      </Link>
    </p>
  );
}
