import { AppSidebarNav, AppTabBar, MobileTopBar } from "@/components/app-nav";
import { MOBILE_TABS } from "@/components/mobile-tabs";
import { SkipLink } from "@/components/skip-link";
import { Brand } from "@/components/brand";
import { NoWorkspace } from "@/components/no-workspace";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { UsageMeter, type Usage } from "@/components/usage-meter";
import { AccountSheet, UserMenu, WorkspaceNameButton, type MenuUser } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { SecurityNudge } from "@/components/security/security-nudge";
import { SecurityPrompt } from "@/components/security/security-prompt";
import { StepUpProvider } from "@/components/step-up/step-up";
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

/** Streams in after the shell: the meter's two queries must not hold up the page. Both reads are per-request cached. */
async function Meter() {
  const [usage, { plan }] = await Promise.all([loadUsage(), getCurrentPlan()]);
  return usage ? <UsageMeter planLabel={planLabel(plan)} usage={usage} /> : null;
}

function MeterSkeleton() {
  return <Skeleton aria-hidden="true" className="h-[5.25rem] w-full rounded-lg" />;
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
  // Owners and admins of a shared workspace are nudged towards two-step sign-in.
  const mayNudge =
    !session.user.twoFactorEnabled &&
    !session.session.impersonatedBy &&
    (scope.role === "owner" || scope.role === "admin");
  // The one-time card after the fifth receipt; never next to the nudge.
  const [allowance, workspaces, nudge, prompt] = await Promise.all([
    getWorkspaceAllowance(),
    listWorkspaces(),
    mayNudge ? isSharedWorkspace(scope.organizationId) : false,
    showSecurityPrompt(session),
  ]);
  const showAdmin = isAdmin(session);
  const user: MenuUser = {
    name: session.user.name ?? null,
    email: session.user.email,
    image: session.user.image ?? null,
  };
  const workspace = { activeId: scope.organizationId, canCreate: allowance.canCreate, workspaces };
  const meter = (
    <Suspense fallback={<MeterSkeleton />}>
      <Meter />
    </Suspense>
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
                <UserMenu showAdmin={showAdmin} user={user} />
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
                  settingsLink={MOBILE_TABS === "three"}
                  showAdmin={showAdmin}
                  usage={meter}
                  user={user}
                  workspace={workspace}
                />
              }
            />
            <main
              id="main-content"
              tabIndex={-1}
              className="min-w-0 flex-1 px-4 pt-5 pb-[calc(2rem+var(--app-bottom-inset,0px))] md:px-10 md:py-10"
            >
              {nudge ? <SecurityNudge /> : prompt ? <SecurityPrompt /> : null}
              {children}
            </main>
          </div>
        </div>
        <AppTabBar />
      </div>
      <StepUpProvider />
    </Toaster>
  );
}
