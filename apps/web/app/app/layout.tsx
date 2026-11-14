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
import { SupportWidget } from "@/components/support-widget";
import { UpgradeBanner } from "@/components/upgrade/upgrade-banner";
import { UpgradeModal } from "@/components/upgrade/upgrade-modal";
import { MeterActionView } from "@/components/upgrade/meter-action-view";
import { meterAction } from "@/lib/meter-action";
import { proOpensSoon } from "@/lib/upgrade-copy";
import { getUpgradeOffer } from "@/lib/upgrade-offer";
import type { UpgradeOffer } from "@/lib/upgrade-level";
import { errorFields, logger } from "@/lib/log";
import { getCurrentPlan, getPlanTable } from "@/lib/plan-limits";
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
 * Streams in after the shell. The reads are per-request cached, and the layout has already
 * made them for the upgrade offer. What it offers under the note is `meterAction`'s.
 */
async function Meter({ offer, owner }: { offer: UpgradeOffer | null; owner: boolean }) {
  const [usage, { plan }, plans] = await Promise.all([
    loadUsage(),
    getCurrentPlan(),
    getPlanTable(),
  ]);
  if (!usage) return null;
  const action = meterAction({ usage, plan, owner, audience: offer?.audience ?? null });
  return (
    <UsageMeter
      action={
        action ? (
          <MeterActionView action={action} opensSoon={proOpensSoon(plans.pro)} surface="meter" />
        ) : null
      }
      plan={plan}
      usage={usage}
    />
  );
}

// Heights follow the card: base 5.25rem, plus the button (3rem) or a one-line action (1.75rem,
// 3.5rem on phones where the link keeps a 44 px target).
const METER_SKELETON_HEIGHT = {
  none: "h-[5.25rem]",
  button: "h-[8.25rem]",
  line: "h-[7rem] max-md:h-[8.75rem]",
} as const;

function MeterSkeleton({ kind }: { kind: keyof typeof METER_SKELETON_HEIGHT }) {
  return (
    <Skeleton aria-hidden="true" className={`${METER_SKELETON_HEIGHT[kind]} w-full rounded-lg`} />
  );
}

function skeletonKind(action: ReturnType<typeof meterAction>): keyof typeof METER_SKELETON_HEIGHT {
  if (action === null) return "none";
  return action === "upgrade-button" ? "button" : "line";
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
  // modal and banner render with the shell. The meter and Home reuse those reads.
  const [allowance, workspaces, nudge, prompt, offer, plan, usage] = await Promise.all([
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
    loadUsage(),
  ]);
  // At the limit the limit is the message: the passkey prompts wait until uploads reopen.
  const blocked = usage?.blocked != null;
  const ownerOffer = offer?.audience === "owner" ? offer : null;
  const owner = scope.role === "owner";
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
    comparePlans: allowance.comparePlans,
    workspaces,
  };
  const meter = (
    <SectionBoundary label="Usage">
      <Suspense
        fallback={
          <MeterSkeleton
            kind={
              usage === null
                ? "none"
                : skeletonKind(
                    meterAction({ usage, plan, owner, audience: offer?.audience ?? null }),
                  )
            }
          />
        }
      >
        <Meter offer={offer} owner={owner} />
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
                <UserMenu showAdmin={showAdmin} showHelp user={user} />
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
                  showHelp
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
              {nudge && !blocked ? (
                <SecurityNudge />
              ) : prompt && !blocked ? (
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
      {/* Opened by Help and feedback and Report a problem; no floating launcher in the app. */}
      <SupportWidget launcher={false} />
      <UpgradeModal offer={ownerOffer} plan={plan} />
    </Toaster>
  );
}
