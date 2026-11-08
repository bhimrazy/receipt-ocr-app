import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@receipt-ocr/ui/components/alert";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Card } from "@receipt-ocr/ui/components/card";
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
import { canManageBilling, getCheckoutConfig, getWorkspaceBilling } from "@/lib/billing";
import { formatDate } from "@/lib/format";
import { logPageRender } from "@/lib/page-event";
import { getCurrentPlan, getPlanTable } from "@/lib/plan-limits";
import { allowance } from "@/lib/plan-copy";
import { planLabel } from "@/lib/plans";
import { getUsageSummary } from "@/lib/receipts";
import { requireActiveScope, requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Billing" };

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed",
  paused: "Paused",
  canceled: "Canceled",
};

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
  const [{ plan }, usage, plans, subscription, checkout] = await Promise.all([
    getCurrentPlan(),
    getUsageSummary(),
    getPlanTable(),
    getWorkspaceBilling(scope.organizationId),
    getCheckoutConfig(),
  ]);
  const owner = canManageBilling(scope.role);
  const entitled = subscription?.entitled === true;
  const interval = params.interval === "month" ? "month" : "year";
  const until = formatDate(subscription?.currentPeriodEnd ?? null);

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
            ? "Pro scans are shared by everyone in this workspace. Limits reset at 00:00 UTC: daily, and on the 1st of each month."
            : "Free scans are per person, across every Free workspace you use. Limits reset at 00:00 UTC: daily, and on the 1st of each month."
        }
        id="billing-usage-heading"
        title="Plan and usage"
      >
        <UsageMeter className="p-5" planLabel={planLabel(plan)} usage={usage} />
      </SettingsSection>

      <SettingsSection
        description={`Pro gives this workspace ${allowance(plans.pro)}. Paddle is the merchant of record: it takes the payment, adds tax and sends invoices.`}
        id="billing-subscription-heading"
        title="Subscription"
      >
        <Card className="flex flex-col gap-4 p-5">
          {subscription ? (
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
                  : (STATUS_LABEL[subscription.status] ?? subscription.status)}
              </Badge>
            </div>
          ) : (
            <p className="text-sm font-medium">
              {plan === "pro" ? "Pro, given by an administrator" : "No subscription"}
            </p>
          )}

          {subscription && entitled && until ? (
            <p className="text-sm text-muted-foreground">
              {subscription.cancelAtPeriodEnd
                ? `Pro stays on until ${until}, then this workspace moves to Free. Nothing more is charged.`
                : subscription.status === "past_due"
                  ? `The last payment didn't go through. Paddle will try again; update the payment method to keep Pro after ${formatDate(subscription.graceEndsAt) ?? "the grace period"}.`
                  : `Renews on ${until}.`}
            </p>
          ) : null}

          {!checkout ? (
            <p className="text-sm text-muted-foreground">
              Paid plans aren&apos;t open yet. See{" "}
              <Link className="text-foreground underline underline-offset-4" href="/pricing">
                pricing
              </Link>{" "}
              for what Pro will include.
            </p>
          ) : !owner ? (
            <Alert>
              Only the workspace owner can change its plan or see its invoices. Ask them to upgrade
              this workspace.
            </Alert>
          ) : session.session.impersonatedBy ? (
            <Alert>Billing is hidden while you are signed in as another user.</Alert>
          ) : entitled || subscription?.status === "past_due" ? (
            <PortalButtons canceling={subscription?.cancelAtPeriodEnd === true} />
          ) : plan === "pro" ? null : (
            <>
              <CheckoutButton
                email={session.user.email}
                initialInterval={interval}
                settings={{
                  environment: checkout.environment,
                  clientToken: checkout.clientToken,
                  prices: checkout.prices,
                }}
                userId={session.user.id}
                workspaceId={scope.organizationId}
              />
              {subscription ? <PortalButtons canceling /> : null}
            </>
          )}
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
