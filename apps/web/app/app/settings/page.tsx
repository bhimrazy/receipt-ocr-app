import { AccountSettings } from "@/components/account-settings";
import { UsageMeter, type Usage } from "@/components/usage-meter";
import { authEnv, authEnabled } from "@/lib/env";
import { planPolicy } from "@/lib/plans";
import { getActiveScope, getSession, planFor } from "@/lib/session";
import { count, createDb, eq, member, organization } from "@receipt-ocr/db";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { ChevronRight, Gauge, Users } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { getUsageSummary } from "../_data/receipts-contract";

export const metadata: Metadata = { title: "Settings" };

function planLabel(plan: string) {
  return `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
}

async function loadUsage(): Promise<Usage | null> {
  try {
    const { used, limit, resetsAt } = await getUsageSummary();
    return { used, limit, resetsAt };
  } catch {
    return null;
  }
}

async function loadWorkspace(): Promise<{ name: string; members: number } | null> {
  if (!authEnv.databaseUrl) return null;
  try {
    const scope = await getActiveScope();
    if (!scope) return null;
    const db = createDb(authEnv.databaseUrl);
    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, scope.organizationId))
      .limit(1);
    const [row] = await db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, scope.organizationId));
    return org ? { name: org.name, members: Number(row?.value ?? 0) } : null;
  } catch {
    return null;
  }
}

export default async function SettingsPage() {
  const session = authEnabled ? await getSession() : null;
  const plan = planFor(session);
  const policy = planPolicy(plan);
  const label = planLabel(plan);
  const [usage, workspace] = authEnabled
    ? await Promise.all([loadUsage(), loadWorkspace()])
    : [null, null];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account, your workspace and what your plan allows.
        </p>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge aria-hidden="true" className="size-5 text-primary" />
              Plan and limits
            </CardTitle>
            <CardDescription>
              {label}: {policy.receiptsPerDay} receipts a day, {policy.workspaces}{" "}
              {policy.workspaces === 1 ? "workspace" : "workspaces"}.
            </CardDescription>
          </CardHeader>
          {usage ? (
            <CardContent>
              <UsageMeter planLabel={label} usage={usage} />
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-5">
            <Users aria-hidden="true" className="size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Workspace and members</h2>
              <p className="break-words text-sm text-muted-foreground">
                {workspace
                  ? `${workspace.name} · ${workspace.members} ${workspace.members === 1 ? "member" : "members"}`
                  : "Invite teammates and manage their roles."}
              </p>
            </div>
            <Link
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href="/app/settings/members"
            >
              Manage
              <ChevronRight aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>

        {authEnabled ? (
          <AccountSettings />
        ) : (
          <Card>
            <CardContent className="pt-5 text-sm text-muted-foreground">
              Account settings aren&apos;t available because sign-in isn&apos;t set up on this
              server.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
