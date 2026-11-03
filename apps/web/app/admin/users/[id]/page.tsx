import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { eq, member, organization, user as userTable } from "@receipt-ocr/db";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { ArrowLeft, Building2 } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adminDb } from "../../admin-db";
import { RowActions } from "../row-actions";
import type { AdminUser } from "../users-table";
import { SessionsList, type AdminSession } from "./sessions-list";

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
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
    token: session.token,
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
      <Button asChild className="mb-6" size="sm" variant="ghost">
        <Link href="/admin/users">
          <ArrowLeft className="size-4" />
          Back to users
        </Link>
      </Button>

      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-full border border-border bg-primary/15 font-mono text-xl font-semibold text-primary">
            {row.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" className="size-full rounded-full object-cover" src={row.image} />
            ) : (
              initial
            )}
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{row.name || "—"}</h1>
            <p className="text-sm text-muted-foreground">{row.email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant={adminUser.role === "admin" ? "default" : "secondary"}>
                {adminUser.role}
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
        <RowActions user={adminUser} />
      </div>

      {adminUser.banned && adminUser.banReason ? (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <span className="font-medium">Ban reason:</span> {adminUser.banReason}
          {adminUser.banExpires
            ? ` · expires ${new Date(adminUser.banExpires).toLocaleString()}`
            : " · permanent"}
        </div>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="User ID" value={row.id} mono />
            <Row label="Plan" value={row.plan ?? "free"} />
            <Row label="Joined" value={new Date(adminUser.createdAt).toLocaleString()} />
            <Row label="Email verified" value={adminUser.emailVerified ? "Yes" : "No"} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              Organizations ({memberships.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">No memberships.</p>
            ) : (
              memberships.map((membership) => (
                <div
                  className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2"
                  key={membership.orgId}
                >
                  <div>
                    <div className="text-sm font-medium">{membership.orgName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {membership.orgSlug}
                    </div>
                  </div>
                  <Badge variant="secondary">{membership.role}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-5">
        <SessionsList sessions={sessions} userId={row.id} />
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "truncate font-mono text-xs" : "text-right"}>{value}</span>
    </div>
  );
}
