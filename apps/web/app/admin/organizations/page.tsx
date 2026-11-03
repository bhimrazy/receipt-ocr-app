import { requireAdmin } from "@/lib/session";
import { count, desc, eq, member, organization, user as userTable } from "@receipt-ocr/db";
import { adminDb } from "../admin-db";
import { OrganizationsList, type AdminOrganization } from "./organizations-list";

function toIso(value: unknown): string {
  if (!value) return new Date().toISOString();
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export default async function AdminOrganizationsPage() {
  await requireAdmin();
  const db = adminDb();

  // Orgs with a member count.
  const orgs = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      memberCount: count(member.id),
    })
    .from(organization)
    .leftJoin(member, eq(member.organizationId, organization.id))
    .groupBy(organization.id)
    .orderBy(desc(organization.createdAt));

  // All memberships with user info, grouped by org for the expandable member list.
  const memberships = await db
    .select({
      orgId: member.organizationId,
      role: member.role,
      userId: userTable.id,
      name: userTable.name,
      email: userTable.email,
    })
    .from(member)
    .innerJoin(userTable, eq(member.userId, userTable.id));

  const byOrg = new Map<string, AdminOrganization["members"]>();
  for (const membership of memberships) {
    const list = byOrg.get(membership.orgId) ?? [];
    list.push({
      userId: membership.userId,
      name: membership.name,
      email: membership.email,
      role: membership.role,
    });
    byOrg.set(membership.orgId, list);
  }

  const organizations: AdminOrganization[] = orgs.map((org) => {
    const members = byOrg.get(org.id) ?? [];
    const owner = members.find((entry) => entry.role === "owner") ?? null;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: toIso(org.createdAt),
      memberCount: org.memberCount,
      owner: owner ? { name: owner.name, email: owner.email } : null,
      members,
    };
  });

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Workspaces</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {organizations.length} {organizations.length === 1 ? "workspace" : "workspaces"}. Expand one to see its
          members.
        </p>
      </div>
      <OrganizationsList organizations={organizations} />
    </div>
  );
}
