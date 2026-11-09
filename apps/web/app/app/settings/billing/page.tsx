import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Card } from "@receipt-ocr/ui/components/card";
import type { WorkspaceBilling } from "@receipt-ocr/core";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { PortalButtons } from "@/components/billing/portal-buttons";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { SettingsBreadcrumb } from "@/components/settings-breadcrumb";
import { SettingsSection } from "@/components/settings-section";
import { UsageMeter } from "@/components/usage-meter";
import { canManageBilling, getCheckoutFor, getWorkspaceBilling } from "@/lib/billing";
import { formatDate } from "@/lib/format";
import { logPageRender } from "@/lib/page-event";
import { getAccountPlan, getCurrentPlan, getPlanTable } from "@/lib/plan-limits";
import { allowance, SEPARATE_UPGRADE } from "@/lib/plan-copy";
import { planLabel } from "@/lib/plans";
import { getUsageSummary } from "@/lib/receipts";
import { isAdmin, requireActiveScope, requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Billing" };

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed",
  paused: "Paused",
  canceled: "Canceled",
};

/** What happened to the subscription, in one sentence, for the state it is in. */
function subscriptionNote(subscription: WorkspaceBilling): string | null {
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
  if (subscription.status === "paused") {
    return "This subscription is paused in Paddle; resume it from the portal or start a new one.";
  }
  if (subscription.status === "past_due" && !subscription.revoked) {
    return `Pro ended on ${ended} because the payment didn't go through. Update the payment method to turn it back on.`;
  }
  return `Ended on ${ended}. Upgrade again any time.`;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ interval?: string | string[] }>;
}) {
  logPageRender("/app/settings/billing");
  const [scope, session, params] = await Promise.all([
    requireActiveScope(),
    requireSession(),
    searchParams,
  ]);
  const [{ plan, policy }, account, usage, plans, subscription, checkout] = await Promise.all([
    getCurrentPlan(),
    getAccountPlan(),
    getUsageSummary(),
    getPlanTable(),
    getWorkspaceBilling(scope.organizationId),
    getCheckoutFor(isAdmin(session)),
  ]);
  const owner = canManageBilling(scope.role);
  const entitled = subscription?.entitled === true;
  // A comp: Pro without a subscription of its own (an admin set the owner's plan).
  const comped = plan === "pro" && !entitled;
  const interval = params.interval === "year" ? "year" : "month";
  // Only the buyer sees their card and invoices; any owner once the buyer is gone.
  const buyer = subscription?.buyer ?? null;
  const isBuyer = buyer === null || buyer.id === session.user.id;
  const portalOpen =
    subscription !== null &&
    (entitled || subscription.status === "past_due" || subscription.status === "paused");
  const note = subscription ? subscriptionNote(subscription) : null;

  const managedElsewhere = (
    <Alert>
      Billing for this workspace is managed by {buyer?.email ?? "the person who subscribed"}.
    </Alert>
  );
  const checkoutButton = checkout ? (
    <CheckoutButton
      initialInterval={interval}
      settings={{
        environment: checkout.config.environment,
        clientToken: checkout.config.clientToken,
      }}
      testMode={checkout.testMode}
      workspaceId={scope.organizationId}
    />
  ) : null;

  let actions: React.ReactNode;
  if (!checkout) {
    actions = comped ? null : (
      <p className="text-sm text-muted-foreground">
        Paid plans aren&apos;t open yet. See{" "}
        <Link className="text-foreground underline underline-offset-4" href="/pricing">
          pricing
        </Link>{" "}
        for what Pro will include.
      </p>
    );
  } else if (!owner) {
    actions = (
      <Alert>
        {plan === "pro"
          ? "This workspace is on Pro. Only its owner can see invoices or change the plan."
          : "Only the workspace owner can upgrade this workspace. Ask them, or use your Free scans here."}
      </Alert>
    );
  } else if (session.session.impersonatedBy) {
    actions = <Alert>Billing is hidden while you are signed in as another user.</Alert>;
  } else if (portalOpen) {
    actions = !isBuyer ? (
      managedElsewhere
    ) : (
      <>
        <PortalButtons canceling={subscription?.cancelAtPeriodEnd === true} />
        {subscription?.status === "paused" ? checkoutButton : null}
      </>
    );
  } else if (comped) {
    actions = null;
  } else {
    actions = (
      <>
        {checkoutButton}
        {subscription && isBuyer ? <PortalButtons canceling /> : null}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader className="mb-8">
        <PageHeaderContent>
          <SettingsBreadcrumb current="Billing" />
          <PageHeaderTitle>Billing</PageHeaderTitle>
          <PageHeaderDescription>
            The plan for this workspace. Each workspace has its own plan.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <SettingsSection
        description={
          plan === "pro"
            ? `Pro scans are shared by everyone in this workspace, which can have up to ${policy.membersPerWorkspace} members. Limits reset at 00:00 UTC: daily, and on the 1st of each month.`
            : `Free scans are per person, across every Free workspace you use. This workspace can have up to ${policy.membersPerWorkspace} members. Limits reset at 00:00 UTC: daily, and on the 1st of each month.`
        }
        id="billing-usage-heading"
        title="Plan and usage"
      >
        <UsageMeter className="p-5" planLabel={planLabel(plan)} usage={usage} />
      </SettingsSection>

      <SettingsSection
        description={`Pro gives this workspace ${allowance(plans.pro)} and up to ${plans.pro.membersPerWorkspace} members. Paddle is the merchant of record: it takes the payment, adds tax and sends invoices.`}
        id="billing-subscription-heading"
        title="Subscription"
      >
        <Card className="flex flex-col gap-4 p-5">
          {subscription && !comped ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">
                Pro, {subscription.interval === "year" ? "yearly" : "monthly"}
              </p>
              <Badge
                variant={
                  subscription.status === "past_due"
                    ? "warning"
                    : entitled
                      ? "default"
                      : "secondary"
                }
              >
                {subscription.cancelAtPeriodEnd && entitled
                  ? "Ends at period end"
                  : !entitled && subscription.status !== "paused"
                    ? "Ended"
                    : (STATUS_LABEL[subscription.status] ?? subscription.status)}
              </Badge>
            </div>
          ) : (
            <p className="text-sm font-medium">
              {comped ? "Pro, given by an administrator. No payment is needed." : "No subscription"}
            </p>
          )}

          {note && !comped ? <p className="text-sm text-muted-foreground">{note}</p> : null}
          {plan === "free" && owner && account.plan === "pro" ? (
            <p className="text-sm text-muted-foreground">{SEPARATE_UPGRADE}</p>
          ) : null}

          {actions}
          <p className="text-xs text-muted-foreground">
            <Link className="underline underline-offset-4" href="/pricing">
              Pricing
            </Link>{" "}
            ·{" "}
            <Link className="underline underline-offset-4" href="/refunds">
              Refund policy
            </Link>
          </p>
        </Card>
      </SettingsSection>
    </div>
  );
}
