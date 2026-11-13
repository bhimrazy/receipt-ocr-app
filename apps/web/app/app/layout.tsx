import { AppSidebarNav, AppTabBar, MobileTopBar } from "@/components/app-nav";
import { SectionBoundary } from "@/components/section-error";
import { SkipLink } from "@/components/skip-link";
import { Brand } from "@/components/brand";
import { NoWorkspace } from "@/components/no-workspace";
import { OfflineBar } from "@/components/offline-bar";
import { RefreshOnReturn } from "@/components/refresh-on-return";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { UsageMeter, type Usage } from "@/components/usage-meter";
import { AccountSheet, UserMenu, WorkspaceNameButton, type MenuUser } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { SecurityNudge } from "@/components/security/security-nudge";
import { SecurityPrompt } from "@/components/security/security-prompt";
import { StepUpProvider } from "@/components/step-up/step-up";
import { UpgradeBanner } from "@/components/upgrade/upgrade-banner";
import { UpgradeModal } from "@/components/upgrade/upgrade-modal";
import { UpgradeTrigger } from "@/components/upgrade/upgrade-trigger";
import { ASK_OWNER } from "@/lib/upgrade-copy";
import { getUpgradeOffer } from "@/lib/upgrade-offer";
import type { UpgradeOffer } from "@/lib/upgrade-level";
import { errorFields, logger } from "@/lib/log";
import { getCurrentPlan } from "@/lib/plan-limits";
import { planLabel } from "@/lib/plans";
import { getActiveScope, isAdmin, requireSession } from "@/lib/session";
import { getWorkspaceAllowance, isSharedWorkspace, listWorkspaces } from "@/lib/workspaces";
import { Toaster } from "@receipt-ocr/ui/components/toast";
import type { Metadata } from "next";
import Link from "next/link";
import { getUsageSummary } from "@/lib/receipts";
import { showSecurityPrompt } from "@/lib/security-prompt";
import { runtime } from "@/lib/runtime";
import { hasStrongFactor } from "@receipt-ocr/core";
import { Skeleton } from "@receipt-ocr/ui/components/skeleton";
import { Suspense } from "react";

async function loadUsage(): Promise<Usage | null> {
  try {
    return await getUsageSummary();
  } catch (error) {
    // The pages report a broken database themselves; the meter just stays out of the way.
    logger.error({ event: "app.usage_meter_failed", unit: "log", error: errorFields(error) });
    return null;
  }
}

/**
 * Streams in after the shell. Both reads are per-request cached, and the layout has already
 * made them for the upgrade offer. Owners get the upgrade button at every level; a member gets
 * the "ask the owner" line once the meter is amber.
 */
async function Meter({ offer }: { offer: UpgradeOffer | null }) {
  const [usage, { plan }] = await Promise.all([loadUsage(), getCurrentPlan()]);
  if (!usage) return null;
  const owner = offer?.audience === "owner";
  return (
    <UsageMeter
      action={
        owner ? (
          <UpgradeTrigger
            className="w-full"
            size="sm"
            surface="meter"
            variant={offer.level === "quiet" ? "outline" : "default"}
          >
            Upgrade to Pro
          </UpgradeTrigger>
        ) : null
      }
      ownerNote={offer?.audience === "member" ? ASK_OWNER : undefined}
      planLabel={planLabel(plan)}
      usage={usage}
    />
  );
}

function MeterSkeleton({ withAction }: { withAction: boolean }) {
  return (
    <Skeleton
      aria-hidden="true"
      className={withAction ? "h-[8.25rem] w-full rounded-lg" : "h-[5.25rem] w-full rounded-lg"}
    />
  );
}

// Signed-in pages are private; keep them out of search results even if a link leaks.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every /app page needs a real session; with auth unconfigured this sends everyone to /sign-in.
  const session = await requireSession();
  // Redirecting to /sign-in here would loop: signed-in visitors are sent back to /app.
  // First, alone: it may create the personal workspace, which the reads below count.
  const scope = await getActiveScope();
  if (!scope) return <NoWorkspace email={session.user.email} />;
  // Owners and admins of a shared workspace without a passkey or app code are nudged to add one.
  const mayNudge =
    !session.user.twoFactorEnabled &&
    !session.session.impersonatedBy &&
    (scope.role === "owner" || scope.role === "admin");
  // The one-time card after the fifth receipt; never next to the nudge.
  // The upgrade offer reads the plan, usage, plan limits and checkout settings up front: the
  // modal, banner and menu item render with the shell. The meter and Home reuse those reads.
  const [allowance, workspaces, nudge, prompt, offer, plan] = await Promise.all([
    getWorkspaceAllowance(),
    listWorkspaces(),
    mayNudge
      ? Promise.all([
          isSharedWorkspace(scope.organizationId),
          runtime.runPromise(hasStrongFactor(session.user.id)),
        ]).then(([shared, strong]) => shared && !strong)
      : false,
    showSecurityPrompt(session),
    getUpgradeOffer(),
    // Only tells the modal when a payment has turned Pro on; a failed read just means Free.
    getCurrentPlan().then(
      (current) => current.plan,
      () => "free" as const,
    ),
  ]);
  const ownerOffer = offer?.audience === "owner" ? offer : null;
  const showAdmin = isAdmin(session);
  const user: MenuUser = {
    name: session.user.name ?? null,
    email: session.user.email,
    image: session.user.image ?? null,
  };
  const workspace = {
    activeId: scope.organizationId,
    canCreate: allowance.canCreate,
    planNote: allowance.planNote,
    workspaces,
  };
  const meter = (
    <SectionBoundary label="Usage">
      <Suspense fallback={<MeterSkeleton withAction={ownerOffer !== null} />}>
        <Meter offer={offer} />
      </Suspense>
    </SectionBoundary>
  );

  return (
    <Toaster>
      <SkipLink />
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        {session.session.impersonatedBy ? <ImpersonationBanner email={session.user.email} /> : null}
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-64 shrink-0 border-r border-border bg-sidebar md:block">
            <aside className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto p-4">
              <Link
                className="flex min-h-11 items-center rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href="/app"
              >
                <Brand />
              </Link>
              <WorkspaceSwitcher {...workspace} />
              <AppSidebarNav showAdmin={showAdmin} />
              <div className="mt-auto flex flex-col gap-3">
                {meter}
                <UserMenu showAdmin={showAdmin} upgrade={ownerOffer !== null} user={user} />
              </div>
            </aside>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <MobileTopBar
              context={
                <WorkspaceNameButton>
                  <span className="sr-only">Workspace: </span>
                  {workspaces.find((w) => w.id === scope.organizationId)?.name}
                  <span className="sr-only">. Switch workspace</span>
                </WorkspaceNameButton>
              }
              home="/app"
              leading={<Brand compact />}
              trailing={
                <AccountSheet
                  showAdmin={showAdmin}
                  usage={meter}
                  user={user}
                  workspace={workspace}
                />
              }
            />
            <OfflineBar />
            <main
              id="main-content"
              tabIndex={-1}
              className="min-w-0 flex-1 px-4 pt-5 pb-[calc(2rem+var(--app-bottom-inset,0px))] md:px-10 md:py-10"
            >
              {nudge ? (
                <SecurityNudge />
              ) : prompt ? (
                <SecurityPrompt />
              ) : ownerOffer?.level === "at" && !ownerOffer.dismissed.banner ? (
                <UpgradeBanner offer={ownerOffer} />
              ) : null}
              {children}
            </main>
          </div>
        </div>
        <AppTabBar />
      </div>
      <StepUpProvider />
      <RefreshOnReturn />
      <UpgradeModal offer={ownerOffer} plan={plan} />
    </Toaster>
  );
}
