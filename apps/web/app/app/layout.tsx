import { AppSidebarNav, AppTabBar, MobileTopBar } from "@/components/app-nav";
import { SkipLink } from "@/components/skip-link";
import { Brand } from "@/components/brand";
import { NoWorkspace } from "@/components/no-workspace";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { UsageMeter, type Usage } from "@/components/usage-meter";
import { AccountSheet, UserMenu, type MenuUser } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { logger } from "@/lib/log";
import { getCurrentPlan } from "@/lib/plan-limits";
import { planLabel } from "@/lib/plans";
import { getActiveScope, isAdmin, requireSession } from "@/lib/session";
import { getWorkspaceAllowance, listWorkspaces } from "@/lib/workspaces";
import { Toaster } from "@receipt-ocr/ui/components/toast";
import type { Metadata } from "next";
import Link from "next/link";
import { getUsageSummary } from "@/lib/receipts";

async function loadUsage(): Promise<Usage | null> {
  try {
    return await getUsageSummary();
  } catch (error) {
    // The pages report a broken database themselves; the meter just stays out of the way.
    logger.error({ event: "app.usage_meter_failed", message: String(error) });
    return null;
  }
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
  const [allowance, workspaces, usage, { plan }] = await Promise.all([
    getWorkspaceAllowance(),
    listWorkspaces(),
    loadUsage(),
    getCurrentPlan(),
  ]);
  const label = planLabel(plan);
  const showAdmin = isAdmin(session);
  const user: MenuUser = {
    name: session.user.name ?? null,
    email: session.user.email,
    image: session.user.image ?? null,
  };
  const workspace = { activeId: scope.organizationId, canCreate: allowance.canCreate, workspaces };
  const meter = usage ? <UsageMeter planLabel={label} usage={usage} /> : null;

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
                <>
                  <span className="sr-only">Workspace: </span>
                  {workspaces.find((w) => w.id === scope.organizationId)?.name}
                </>
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
            <main
              id="main-content"
              tabIndex={-1}
              className="min-w-0 flex-1 px-4 pt-5 pb-[calc(2rem+var(--app-bottom-inset,0px))] md:px-10 md:py-10"
            >
              {children}
            </main>
          </div>
        </div>
        <AppTabBar />
      </div>
    </Toaster>
  );
}
