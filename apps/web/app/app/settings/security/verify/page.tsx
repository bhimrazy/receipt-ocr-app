import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from "@/components/page-header";
import { SettingsBreadcrumb } from "@/components/settings-breadcrumb";
import { logPageRender } from "@/lib/page-event";
import { ADMIN_ENROL_PATH, adminSessionAccess, requireAdminRole } from "@/lib/session";
import { AdminVerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Confirm it's you" };

/** Where an admin proves their second factor once per session before /admin opens. */
export default async function AdminVerifyPage() {
  logPageRender("/app/settings/security/verify");
  const session = await requireAdminRole();
  const access = await adminSessionAccess(session);
  if (access === "ok") redirect("/admin");
  if (access === "enrol") redirect(ADMIN_ENROL_PATH);

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader className="mb-6">
        <PageHeaderContent>
          <SettingsBreadcrumb current="Confirm it's you" />
          <PageHeaderTitle>Confirm it&apos;s you to open Admin</PageHeaderTitle>
          <PageHeaderDescription>
            Admin needs your second factor once per session. Signing in with Google, GitHub or a
            trusted device skips that step, so we ask here.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <AdminVerifyForm />
    </div>
  );
}
