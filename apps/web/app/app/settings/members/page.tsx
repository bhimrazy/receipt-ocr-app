import { MembersManager } from "@/components/members-manager";
import { authEnabled } from "@/lib/env";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { Users } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Link className="hover:text-foreground" href="/app/settings">
            Settings
          </Link>
          <span>/</span>
          <span className="text-foreground">Members</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Workspace members</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Invite teammates, manage roles, and control who can access the active workspace.
        </p>
      </div>

      {authEnabled ? (
        <MembersManager />
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Users className="size-5 text-muted-foreground" />
            <span>
              Auth is not configured, so workspaces are unavailable. Add{" "}
              <code className="font-mono">DATABASE_URL</code> and{" "}
              <code className="font-mono">BETTER_AUTH_SECRET</code> to enable members and
              invitations.
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
