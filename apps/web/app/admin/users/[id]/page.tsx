import { listAudit, policyFor, userDetail } from "@receipt-ocr/core";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@receipt-ocr/ui/components/card";
import { Effect } from "effect";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditList } from "@/components/admin/audit-list";
import { Meter } from "@/components/admin/meter";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Initial, UserBadges } from "@/components/admin/user-badges";
import { auth } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { getPlanTable } from "@/lib/plan-limits";
import { planLabel } from "@/lib/plans";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { SessionsList, type AdminSession } from "./sessions-list";
import { AccountControls, DangerZone, type ActionUser } from "./user-actions";

export const metadata: Metadata = { title: "User" };

const iso = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const cap = (value: string) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

const STATUS: Record<string, string> = {
  completed: "Read",
  failed: "Failed",
  processing: "Reading",
  uploaded: "Uploaded",
};

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await requireAdmin();
  const { id } = await params;
  const [plans, data] = await Promise.all([
    getPlanTable(),
    runtime.runPromise(
      Effect.all([
        userDetail(id),
        listAudit({ targetType: "user", targetId: id }, { page: 1, pageSize: 20 }),
      ]),
    ),
  ]);
  const [user, audit] = data;
  if (!user) notFound();

  const sessionResult = await auth.api.listUserSessions({
    body: { userId: id },
    headers: await headers(),
  });
  const sessions: AdminSession[] = ("sessions" in sessionResult ? sessionResult.sessions : []).map(
    (s) => ({
      id: s.id,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
      createdAt: iso(s.createdAt),
      expiresAt: iso(s.expiresAt),
      impersonatedBy: (s as { impersonatedBy?: string | null }).impersonatedBy ?? null,
    }),
  );

  const isSelf = viewer.user.id === user.id;
  const limit = policyFor(plans, user.plan).receiptsPerDay;
  const actionUser: ActionUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    plan: user.plan,
    banned: user.banned,
    banExpires: user.banExpires ? user.banExpires.toISOString() : null,
    emailVerified: user.emailVerified,
    soloWorkspaces: user.memberships.filter((m) => m.members === 1).length,
  };
  const banEntry = audit.rows.find((entry) => entry.action === "user.ban");

  return (
    <>
      <AdminPageHeader
        back={{ href: "/admin/users", label: "Users" }}
        title={
          <span className="flex items-center gap-3">
            <Initial email={user.email} name={user.name} />
            <span className="min-w-0 truncate">{user.name || user.email}</span>
          </span>
        }
      >
        <p className="mt-1.5 text-sm break-all text-muted-foreground">
          {user.email} · Joined {formatDate(user.createdAt)}
          {isSelf ? " · This is you" : ""}
        </p>
        <div className="mt-3">
          <UserBadges {...user} showPlan />
        </div>
      </AdminPageHeader>

      {user.banned ? (
        <div
          className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"
          role="status"
        >
          <p className="font-medium text-destructive">
            Banned{" "}
            {user.banExpires
              ? `until ${formatDateTime(user.banExpires)}`
              : "until the ban is lifted"}
          </p>
          <p className="mt-1 text-foreground">
            Reason: {user.banReason || "No reason was recorded."}
          </p>
          {banEntry ? (
            <p className="mt-1 text-xs text-muted-foreground">
              By {banEntry.actorEmail} on {formatDateTime(banEntry.createdAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Today, {planLabel(user.plan)} (resets at 00:00 UTC)
              </p>
              <Meter
                className="mt-2"
                label="Receipts used today"
                limit={limit}
                used={user.usedToday}
              />
              <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
                {[
                  ["Last 7 days", user.receipts.week],
                  ["All time", user.receipts.total],
                  ["Failed", user.receipts.failed],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Workspaces{" "}
                <span className="font-mono text-muted-foreground">{user.memberships.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {user.memberships.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not a member of any workspace.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {user.memberships.map((m) => (
                    <li
                      className="flex items-center justify-between gap-3 py-2.5"
                      key={m.organizationId}
                    >
                      <Link
                        className="min-w-0 rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                        href={`/admin/workspaces/${m.organizationId}`}
                      >
                        <span className="block truncate text-sm font-medium">{m.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {m.members === 1 ? "Only member" : `${m.members} members`} · Joined{" "}
                          {formatDate(m.joinedAt)}
                        </span>
                      </Link>
                      <Badge variant={m.role === "owner" ? "default" : "secondary"}>
                        {cap(m.role)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent receipts</CardTitle>
            </CardHeader>
            <CardContent>
              {user.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">No receipts uploaded yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {user.recent.map((r) => (
                    <li className="flex items-center justify-between gap-3 py-2.5" key={r.id}>
                      <div className="min-w-0">
                        <p className="truncate text-sm">
                          {r.status === "completed"
                            ? r.merchant || "Merchant not found"
                            : r.status === "failed"
                              ? "Could not be read"
                              : "Still reading"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.workspace} · {formatDateTime(r.createdAt)}
                        </p>
                      </div>
                      {r.status === "completed" && r.total ? (
                        <span className="shrink-0 font-mono text-sm tabular-nums">
                          {formatMoney(r.total, r.currency ?? "USD")}
                        </span>
                      ) : (
                        <Badge variant={r.status === "failed" ? "destructive" : "secondary"}>
                          {STATUS[r.status]}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <SessionsList currentSessionId={viewer.session.id} sessions={sessions} userId={user.id} />

          <section aria-labelledby="user-activity">
            <h2 className="mb-3 text-base font-semibold" id="user-activity">
              Admin activity on this account
            </h2>
            <AuditList
              empty="No admin has changed this account yet."
              entries={audit.rows}
              showTarget={false}
            />
          </section>
        </div>

        <div className="order-first flex flex-col gap-6 lg:order-none lg:sticky lg:top-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent>
              <AccountControls isSelf={isSelf} plans={plans} user={actionUser} />
            </CardContent>
          </Card>
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle>Access</CardTitle>
            </CardHeader>
            <CardContent>
              <DangerZone isSelf={isSelf} user={actionUser} />
            </CardContent>
          </Card>
          <p className="font-mono text-xs break-all text-muted-foreground">User ID {user.id}</p>
        </div>
      </div>
    </>
  );
}
