import { GroupsManager } from "@/components/groups/groups-manager";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { getWorkspaceGroups } from "@/lib/groups";
import { logPageRender } from "@/lib/page-event";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { cn } from "@receipt-ocr/ui/lib/utils";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Groups" };

export default async function GroupsPage() {
  logPageRender("/app/receipts/groups");
  const groups = await getWorkspaceGroups();
  return (
    <div className="mx-auto max-w-3xl">
      {/* Phones get Back in the app bar; the sidebar doesn't name Groups. */}
      <Link
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "mb-2 -ml-2 focus-visible:ring-2 focus-visible:ring-ring max-md:hidden",
        )}
        href="/app/receipts"
      >
        <ChevronLeft aria-hidden="true" />
        Receipts
      </Link>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Groups</PageHeaderTitle>
          <PageHeaderDescription>
            Collect receipts for a trip, a client or a year. A receipt can be in several groups, and
            deleting a group keeps its receipts.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <GroupsManager groups={groups} />
    </div>
  );
}
