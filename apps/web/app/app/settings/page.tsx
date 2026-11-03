import { AccountSettings } from "@/components/account-settings";
import { planPolicy } from "@/lib/plans";
import { getSession, planFor } from "@/lib/session";
import { authEnabled } from "@/lib/env";
import { getWorkspaceAllowance } from "@/lib/workspaces";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@receipt-ocr/ui/components/card";
import { Gauge, Users } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = authEnabled ? await getSession() : null;
  const plan = planFor(session);
  const policy = planPolicy(plan);
  const allowance = authEnabled ? await getWorkspaceAllowance() : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account, your workspace, and what your plan allows.
        </p>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-5 text-primary" />
              Plan &amp; limits
            </CardTitle>
            <CardDescription>
              What the <Badge variant="secondary">{plan}</Badge> plan includes today.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <div className="font-mono text-2xl">{policy.receiptsPerDay}</div>
              <div className="mt-1 text-xs text-muted-foreground">receipts per day</div>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <div className="font-mono text-2xl">{policy.receiptsPerMinute}</div>
              <div className="mt-1 text-xs text-muted-foreground">per minute (burst)</div>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-4">
              <div className="font-mono text-2xl">
                {allowance ? `${allowance.owned}/${allowance.limit}` : policy.workspaces}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">workspaces owned</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5 text-primary" />
              Workspace &amp; members
            </CardTitle>
            <CardDescription>
              Invite teammates, assign roles, and manage pending invitations. Everyone in a
              workspace shares its receipts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/app/settings/members">
                <Users className="size-4" />
                Manage members
              </Link>
            </Button>
          </CardContent>
        </Card>

        {authEnabled ? (
          <AccountSettings />
        ) : (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Auth is not configured, so account settings are unavailable. Set{" "}
              <code className="font-mono">DATABASE_URL</code> and{" "}
              <code className="font-mono">BETTER_AUTH_SECRET</code> to enable them.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
