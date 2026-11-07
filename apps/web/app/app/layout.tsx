import { AppSidebarNav, AppTabBar } from "@/components/app-nav";
import { SkipLink } from "@/components/skip-link";
import { Brand } from "@/components/brand";
import { NoWorkspace } from "@/components/no-workspace";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { UsageMeter, type Usage } from "@/components/usage-meter";
import { UserMenu, type MenuUser } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { errorFields, logger } from "@/lib/log";
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
    logger.error({ event: "app.usage_meter_failed", unit: "log", error: errorFields(error) });
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
  const switcher = (
    <WorkspaceSwitcher
      activeId={scope.organizationId}
      canCreate={allowance.canCreate}
      workspaces={workspaces}
    />
  );

  return (
    <Toaster>
      <SkipLink />
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        {session.session.impersonatedBy ? <ImpersonationBanner email={session.user.email} /> : null}
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-64 shrink-0 border-r border-border bg-sidebar md:block">
            <aside className="sticky top-0 flex h-screen flex-col gap-6 p-4">
              <Link
                className="flex min-h-11 items-center rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href="/app"
              >
                <Brand />
              </Link>
              {switcher}
              <AppSidebarNav showAdmin={showAdmin} />
              <div className="mt-auto flex flex-col gap-3">
                {usage ? <UsageMeter planLabel={label} usage={usage} /> : null}
                <UserMenu showAdmin={showAdmin} user={user} variant="row" />
              </div>
            </aside>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-16 items-center justify-between gap-3 border-b border-border px-4 md:hidden">
              <Link
                className="flex min-h-11 shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href="/app"
              >
                <Brand />
              </Link>
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 max-w-44">{switcher}</div>
                <UserMenu showAdmin={showAdmin} user={user} />
              </div>
            </header>
            <main
              id="main-content"
              tabIndex={-1}
              className="min-w-0 flex-1 px-4 pt-6 pb-28 md:px-10 md:py-10"
            >
              {children}
            </main>
          </div>
        </div>
        <AppTabBar showAdmin={showAdmin} />
      </div>
    </Toaster>
  );
}
