import { AppSidebarNav, AppTabBar } from "@/components/app-nav";
import { Brand } from "@/components/brand";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { UsageMeter, type Usage } from "@/components/usage-meter";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { authEnabled } from "@/lib/env";
import { getSession, isAdmin, planFor } from "@/lib/session";
import { getWorkspaceAllowance } from "@/lib/workspaces";
import { Toaster } from "@receipt-ocr/ui/components/toast";
import Link from "next/link";
import { getUsageSummary } from "./_data/receipts-contract";

async function loadUsage(): Promise<Usage | null> {
  try {
    const { used, limit, resetsAt } = await getUsageSummary();
    return { used, limit, resetsAt };
  } catch {
    // No session or no database: hide the meter rather than show a fake number.
    return null;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = authEnabled ? await getSession() : null;
  const [allowance, usage] = authEnabled ? await Promise.all([getWorkspaceAllowance(), loadUsage()]) : [null, null];
  const plan = planFor(session);
  const planLabel = `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
  const showAdmin = isAdmin(session);

  const userControl = authEnabled ? (
    <UserMenu />
  ) : (
    <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground">
      Preview mode
    </span>
  );
  const workspaceControl = authEnabled ? <WorkspaceSwitcher canCreate={allowance?.canCreate ?? false} /> : null;

  return (
    <Toaster>
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-[#0f0f11] p-5 md:flex md:flex-col">
          <Link className="mb-6 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/app">
            <Brand />
          </Link>
          {workspaceControl ? <div className="mb-6">{workspaceControl}</div> : null}
          <AppSidebarNav showAdmin={showAdmin} />
          {usage ? <UsageMeter className="mt-auto" planLabel={planLabel} usage={usage} /> : null}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          {authEnabled ? <ImpersonationBanner /> : null}
          <header className="flex h-16 items-center justify-between gap-3 border-b border-border px-4 md:hidden">
            <Link className="flex min-h-11 shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring" href="/app">
              <Brand />
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              {workspaceControl ? <div className="min-w-0 max-w-40">{workspaceControl}</div> : null}
              {userControl}
            </div>
          </header>
          <header className="hidden h-16 items-center justify-end border-b border-border px-8 md:flex">
            {userControl}
          </header>
          <main className="min-w-0 flex-1 p-4 pb-24 md:p-10">{children}</main>
        </div>
        <AppTabBar showAdmin={showAdmin} />
      </div>
    </Toaster>
  );
}
