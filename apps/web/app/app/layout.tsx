import { Brand } from "@/components/brand";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { UserMenu } from "@/components/user-menu";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { authEnabled } from "@/lib/env";
import { getWorkspaceAllowance } from "@/lib/workspaces";
import { Button } from "@receipt-ocr/ui/components/button";
import { History, Settings, Upload } from "lucide-react";
import Link from "next/link";

const nav = [
  { href: "/app/upload", label: "Upload", icon: Upload },
  { href: "/app/history", label: "History", icon: History },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const allowance = authEnabled ? await getWorkspaceAllowance() : null;
  const userControl = authEnabled ? (
    <UserMenu />
  ) : (
    <span className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground">
      auth preview
    </span>
  );

  const workspaceControl = authEnabled ? (
    <WorkspaceSwitcher canCreate={allowance?.canCreate ?? false} />
  ) : null;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-[#0f0f11] p-5 md:flex md:flex-col">
        <div className="mb-6">
          <Brand />
        </div>
        {workspaceControl ? <div className="mb-6">{workspaceControl}</div> : null}
        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Button asChild className="justify-start" key={item.href} variant="ghost">
                <Link href={item.href}>
                  <Icon className="size-4" />
                  {item.label}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="mt-auto rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Free tier</p>
          <div className="mt-2 flex items-end justify-between">
            <span className="font-mono text-2xl font-semibold">23</span>
            <span className="text-xs text-muted-foreground">/50 this month</span>
          </div>
          <div className="mt-3 h-1 rounded-full bg-border">
            <div className="h-full w-[46%] rounded-full bg-primary" />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {authEnabled ? <ImpersonationBanner /> : null}
        <header className="flex h-16 items-center justify-between gap-3 border-b border-border px-5 md:hidden">
          <Brand />
          <div className="flex items-center gap-2">
            {workspaceControl ? <div className="w-36">{workspaceControl}</div> : null}
            {userControl}
          </div>
        </header>
        <header className="hidden h-16 items-center justify-end border-b border-border px-8 md:flex">
          {userControl}
        </header>
        <main className="flex-1 overflow-auto p-5 md:p-10">{children}</main>
      </div>
    </div>
  );
}
