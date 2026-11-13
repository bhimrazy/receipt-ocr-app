import type { Metadata } from "next";
import { loadPaddleConfig } from "@receipt-ocr/core";
import { Effect, Option } from "effect";
import { PlanAndBilling } from "@/components/billing/plan-and-billing";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { SettingsBreadcrumb } from "@/components/settings-breadcrumb";
import { canManageBilling, getCheckoutFor, getWorkspaceBilling } from "@/lib/billing";
import { logPageRender } from "@/lib/page-event";
import { getAccountPlan, getCurrentPlan, getPlanTable } from "@/lib/plan-limits";
import { getUsageSummary } from "@/lib/receipts";
import { isAdmin, requireActiveScope, requireSession } from "@/lib/session";
import { listWorkspaces } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Plan and billing" };

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
  const [{ plan, policy }, account, usage, plans, subscription, checkout, paddle, workspaces] =
    await Promise.all([
      getCurrentPlan(),
      getAccountPlan(),
      getUsageSummary(),
      getPlanTable(),
      getWorkspaceBilling(scope.organizationId),
      getCheckoutFor(isAdmin(session)),
      // Env only: the portal needs the server's Paddle settings, not an open checkout.
      Effect.runPromise(loadPaddleConfig),
      listWorkspaces(),
    ]);
  const buyer = subscription?.buyer ?? null;
  const workspaceName =
    workspaces.find((w) => w.id === scope.organizationId)?.name ?? "this workspace";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader className="mb-8">
        <PageHeaderContent>
          <SettingsBreadcrumb current="Plan and billing" />
          <PageHeaderTitle>Plan and billing</PageHeaderTitle>
          <PageHeaderDescription>
            Each workspace has its own plan. This is {workspaceName}.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <PlanAndBilling
        checkout={
          checkout
            ? {
                settings: {
                  environment: checkout.config.environment,
                  clientToken: checkout.config.clientToken,
                },
                testMode: checkout.testMode,
              }
            : null
        }
        impersonating={Boolean(session.session.impersonatedBy)}
        interval={params.interval === "year" ? "year" : "month"}
        // Only the buyer sees their card and invoices; nobody once the buyer's account is gone.
        isBuyer={buyer !== null && buyer.id === session.user.id}
        owner={canManageBilling(scope.role)}
        ownsPro={account.plan === "pro"}
        plan={plan}
        plans={plans}
        policy={policy}
        portalAvailable={Option.isSome(paddle)}
        subscription={subscription}
        usage={usage}
        workspaceId={scope.organizationId}
      />
    </div>
  );
}
