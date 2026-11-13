import { adminOverview, loadDailyOcrCap } from "@receipt-ocr/core";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Effect } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { DailyChart } from "@/components/admin/daily-chart";
import { Meter } from "@/components/admin/meter";
import { AdminPageHeader, AdminSection } from "@/components/admin/page-header";
import { Stat } from "@/components/admin/stat";
import { formatDate, formatTime } from "@/lib/format";
import { getPlanTable } from "@/lib/plan-limits";
import { planLabel } from "@/lib/plans";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { logPageRender } from "@/lib/page-event";

export const metadata: Metadata = { title: "Overview" };

const linkClass =
  "rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring";

export default async function AdminOverviewPage() {
  logPageRender("/admin");
  await requireAdmin();
  const now = new Date();
  const plans = await getPlanTable();
  const [data, cap] = await runtime.runPromise(
    Effect.all([
      adminOverview(plans, now),
      loadDailyOcrCap.pipe(Effect.orElseSucceed(() => undefined)),
    ]),
  );
  const failedShare = data.receipts.week > 0 ? data.receipts.failedWeek / data.receipts.week : 0;

  return (
    <>
      <AdminPageHeader
        description={`Accounts and receipt reading across the service. Days are UTC; figures as of ${formatTime(now)}.`}
        title="Overview"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          href="/admin/users"
          label="Users"
          note={`${data.users.newThisWeek} new in the last 7 days`}
          value={data.users.total}
        />
        <Stat
          href="/admin/workspaces"
          label="Workspaces"
          note={`${data.workspaces.shared} with more than one member`}
          value={data.workspaces.total}
        />
        <Stat
          label="Receipts today"
          note={
            data.receipts.failedToday > 0
              ? `${data.receipts.failedToday} could not be read`
              : "None failed"
          }
          tone={data.receipts.failedToday > 0 ? "warning" : "default"}
          value={data.receipts.today}
        />
        <Stat
          label="Receipts, last 7 days"
          note={`${data.receipts.failedWeek} failed (${Math.round(failedShare * 100)}%)`}
          tone={failedShare >= 0.1 ? "warning" : "default"}
          value={data.receipts.week}
        />
        <Stat
          className="col-span-2 lg:col-span-1"
          href="/admin/support"
          label="Support, waiting"
          note={
            data.support.new > 0
              ? `${data.support.new} new, ${data.support.open} open`
              : data.support.open > 0
                ? `${data.support.open} open, none new`
                : "Nothing waiting"
          }
          tone={data.support.new > 0 ? "warning" : "default"}
          value={data.support.new + data.support.open}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <DailyChart days={data.daily} />

        <section
          aria-labelledby="cap-title"
          className="flex flex-col rounded-lg border border-border bg-card p-4"
        >
          <h2 className="text-sm font-medium" id="cap-title">
            Service-wide daily cap
          </h2>
          {cap === undefined ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No cap is set. Set{" "}
              <code className="font-mono text-xs text-foreground">OCR_DAILY_CAP</code> in the server
              environment to limit provider calls per UTC day.
            </p>
          ) : (
            <>
              <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">
                {data.readsToday.toLocaleString("en-US")}
                <span className="text-base font-normal text-muted-foreground">
                  {" "}
                  / {cap.toLocaleString("en-US")}
                </span>
              </p>
              <Meter
                className="mt-3"
                label="Provider calls today against the daily cap"
                limit={cap}
                showNumbers={false}
                used={data.readsToday}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                {data.readsToday >= cap
                  ? "Reached. Uploads are refused for everyone until 00:00 UTC."
                  : `${(cap - data.readsToday).toLocaleString("en-US")} left today. Counts every upload and retry since 00:00 UTC.`}
              </p>
            </>
          )}
          <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm text-muted-foreground">
            <Link
              className={`${linkClass} inline-flex min-h-11 items-center md:min-h-0`}
              href="/admin/users?status=banned"
            >
              {data.users.banned} banned
            </Link>
            <Link
              className={`${linkClass} inline-flex min-h-11 items-center md:min-h-0`}
              href="/admin/users?status=unverified"
            >
              {data.users.unverified} email not verified
            </Link>
          </div>
        </section>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <AdminSection
          action={
            <Link
              className={`${linkClass} inline-flex min-h-11 items-center text-sm text-muted-foreground md:min-h-0`}
              href="/admin/users?sort=usage"
            >
              All users by usage
            </Link>
          }
          description="Users at 80% or more of their plan's daily limit."
          id="near-limit"
          title="Near the daily limit"
        >
          {data.nearLimit.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              Nobody is close to their limit today.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {data.nearLimit.map((u) => (
                <li
                  className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center"
                  key={u.id}
                >
                  <Link className={`${linkClass} min-w-0`} href={`/admin/users/${u.id}`}>
                    <span className="block truncate text-sm font-medium">{u.name || u.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.email} · {planLabel(u.plan)}
                    </span>
                  </Link>
                  <Meter
                    label={`Receipts used today by ${u.email}`}
                    limit={u.limit}
                    used={u.used}
                  />
                </li>
              ))}
            </ul>
          )}
        </AdminSection>

        <AdminSection
          action={
            <Link
              className={`${linkClass} inline-flex min-h-11 items-center text-sm text-muted-foreground md:min-h-0`}
              href="/admin/users"
            >
              All users
            </Link>
          }
          description="Newest accounts first."
          id="recent-signups"
          title="Recent sign-ups"
        >
          {data.recentSignups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No accounts yet.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {data.recentSignups.map((u) => (
                <li className="flex items-center justify-between gap-3 px-4 py-3" key={u.id}>
                  <Link className={`${linkClass} min-w-0`} href={`/admin/users/${u.id}`}>
                    <span className="block truncate text-sm font-medium">{u.name || u.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                  </Link>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {formatDate(u.createdAt)}
                    </span>
                    {u.emailVerified ? null : <Badge variant="warning">Email not verified</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      </div>
    </>
  );
}
