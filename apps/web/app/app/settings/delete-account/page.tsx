import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { DeleteAccountConfirm } from "@/components/delete-account-confirm";
import { logPageRender } from "@/lib/page-event";
import { requireSession } from "@/lib/session";
import { isDeleteToken } from "@/lib/account-deletion";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Delete account" };

/** Where the emailed deletion link lands. Nothing is deleted until the user confirms here. */
export default async function DeleteAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  logPageRender("/app/settings/delete-account");
  const [session, { token }] = await Promise.all([requireSession(), searchParams]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader className="mb-8">
        <PageHeaderContent>
          <PageHeaderTitle>Delete your account</PageHeaderTitle>
          <PageHeaderDescription>
            You&apos;re signed in as{" "}
            <span className="break-all text-foreground">{session.user.email}</span>.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <DeleteAccountConfirm token={isDeleteToken(token) ? token : null} />
    </div>
  );
}
