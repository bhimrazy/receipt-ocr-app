import { MembersManager } from "@/components/members-manager";
import { authEnabled } from "@/lib/env";
import { Card, CardContent } from "@receipt-ocr/ui/components/card";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="flex items-center gap-1 text-xs text-muted-foreground">
            <li>
              <Link
                className="inline-flex items-center rounded-md py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11"
                href="/app/settings"
              >
                Settings
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li aria-current="page" className="text-foreground">
              Members
            </li>
          </ol>
        </nav>
        <h1 className="text-3xl font-semibold tracking-tight">Workspace members</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Invite teammates and choose what they can do. Everyone in a workspace shares its receipts.
        </p>
      </div>

      {authEnabled ? (
        <MembersManager />
      ) : (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            Workspaces aren&apos;t available because sign-in isn&apos;t set up on this server.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
