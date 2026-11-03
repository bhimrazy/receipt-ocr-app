import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { eq, member, organization, user as userTable } from "@receipt-ocr/db";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { ArrowLeft, Building2 } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate, formatDateTime } from "@/lib/format";
import { adminDb } from "../../admin-db";
import { RowActions } from "../row-actions";
import type { AdminUser } from "../users-table";
import { SessionsList, type AdminSession } from "./sessions-list";

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const db = adminDb();

  const [row] = await db.select().from(userTable).where(eq(userTable.id, id)).limit(1);
  if (!row) notFound();

  const memberships = await db
    .select({
      role: member.role,
      joinedAt: member.createdAt,
      orgId: organization.id,
      orgName: organization.name,
      orgSlug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, id));

  const sessionResult = await auth.api.listUserSessions({
    body: { userId: id },
    headers: await headers(),
  });
  const rawSessions = "sessions" in sessionResult ? sessionResult.sessions : [];
  const sessions: AdminSession[] = rawSessions.map((session) => ({
    id: session.id,
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
    createdAt: toIso(session.createdAt) ?? new Date().toISOString(),
    expiresAt: toIso(session.expiresAt) ?? new Date().toISOString(),
    impersonatedBy: (session as { impersonatedBy?: string | null }).impersonatedBy ?? null,
  }));

  const adminUser: AdminUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role ?? "user",
    banned: Boolean(row.banned),
    banReason: row.banReason ?? null,
    banExpires: toIso(row.banExpires),
    emailVerified: Boolean(row.emailVerified),
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
  };

  const initial = (row.name?.trim() || row.email).charAt(0).toUpperCase();

  return (
    <div className="mx-auto max-w-4xl">
      <Link className={buttonVariants({ variant: "ghost", size: "sm", className: "mb-6 -ml-3" })} href="/admin/users">
        <ArrowLeft aria-hidden="true" />
        Back to users
      </Link>

      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-full border border-border bg-primary/15 font-mono text-xl font-semibold text-primary">
            {row.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" className="size-full rounded-full object-cover" src={row.image} />
            ) : (
              initial
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{row.name || row.email}</h1>
            <p className="truncate text-sm text-muted-foreground">{row.email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant={adminUser.role === "admin" ? "default" : "secondary"}>
                {adminUser.role === "admin" ? "Admin" : "User"}
              </Badge>
              {adminUser.banned ? (
                <Badge variant="destructive">Banned</Badge>
              ) : (
                <Badge variant="secondary">
                  {adminUser.emailVerified ? "Verified" : "Unverified"}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <RowActions currentUserId={viewer.user.id} user={adminUser} />
      </div>

      {adminUser.banned && adminUser.banReason ? (
        <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="font-medium">Ban reason:</span> {adminUser.banReason}
          {adminUser.banExpires ? ` · Ends ${formatDateTime(adminUser.banExpires)}` : " · Permanent"}
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="User ID" value={row.id} mono />
            <Row label="Plan" value={planLabel(row.plan ?? "free")} />
            <Row label="Joined" value={formatDate(adminUser.createdAt) ?? "Unknown"} />
            <Row
              label="Email verified"
              value={adminUser.emailVerified ? "Yes" : "No"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 aria-hidden="true" className="size-4 text-primary" />
              Workspaces ({memberships.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not in any workspace.</p>
            ) : (
              memberships.map((membership) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2"
                  key={membership.orgId}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{membership.orgName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {membership.orgSlug}
                    </div>
                  </div>
                  <Badge variant="secondary">{capitalize(membership.role)}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5">
        <SessionsList currentSessionId={viewer.session.id} sessions={sessions} userId={row.id} />
      </div>
    </div>
  );
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function planLabel(plan: string) {
  return `${capitalize(plan)} plan`;
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? "min-w-0 truncate font-mono text-xs" : "text-right"}>{value}</span>
    </div>
  );
}
