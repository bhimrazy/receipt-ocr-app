import { redirect } from "next/navigation";

// The section was renamed; keep old bookmarks working.
export default function OrganizationsRedirect() {
  redirect("/admin/workspaces");
}
