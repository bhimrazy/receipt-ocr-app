import { AccountSettings } from "@/components/account-settings";
import { SettingsSection } from "@/components/settings-section";
import { UsageMeter } from "@/components/usage-meter";
import { authEnv } from "@/lib/env";
import { planLabel, planPolicy } from "@/lib/plans";
import { planFor, requireActiveScope, requireSession } from "@/lib/session";
import { count, createDb, eq, member, organization } from "@receipt-ocr/db";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card } from "@receipt-ocr/ui/components/card";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getUsageSummary } from "../_data/receipts-contract";

export const metadata: Metadata = { title: "Settings" };

async function loadWorkspace(organizationId: string) {
  const db = createDb(authEnv.databaseUrl!);
  const [[org], [row]] = await Promise.all([
    db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1),
    db.select({ value: count() }).from(member).where(eq(member.organizationId, organizationId)),
  ]);
  return { name: org?.name ?? "This workspace", members: Number(row?.value ?? 0) };
}

export default async function SettingsPage() {
  const [session, scope] = await Promise.all([requireSession(), requireActiveScope()]);
  const plan = planFor(session);
  const policy = planPolicy(plan);
  const [usage, workspace] = await Promise.all([
    getUsageSummary(),
    loadWorkspace(scope.organizationId),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your plan, your workspace and your account.
        </p>
      </div>

      <SettingsSection
        description="Receipts reset at 00:00 UTC every day. Receipts that couldn't be read don't count."
        id="plan-heading"
        title="Plan and usage"
      >
        <div className="flex flex-col gap-3">
          <UsageMeter className="p-5" planLabel={planLabel(plan)} usage={usage} />
          <dl className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <dt className="text-xs text-muted-foreground">Receipts a day</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{policy.receiptsPerDay}</dd>
            </Card>
            <Card className="p-4">
              <dt className="text-xs text-muted-foreground">Workspaces you can own</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{policy.workspaces}</dd>
            </Card>
          </dl>
        </div>
      </SettingsSection>

      <SettingsSection
        description="Everyone in a workspace shares its receipts."
        id="workspace-heading"
        title="Workspace"
      >
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 font-mono text-sm font-semibold text-primary"
          >
            {(workspace.name.trim() || "?").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{workspace.name}</p>
            <p className="text-xs text-muted-foreground">
              {workspace.members} {workspace.members === 1 ? "member" : "members"} · Your role:{" "}
              {scope.role.charAt(0).toUpperCase()}
              {scope.role.slice(1)}
            </p>
          </div>
          <Link
            className={buttonVariants({ variant: "outline", size: "sm" })}
            href="/app/settings/members"
          >
            Members
            <ChevronRight aria-hidden="true" />
          </Link>
        </Card>
      </SettingsSection>

      <AccountSettings />
    </div>
  );
}
