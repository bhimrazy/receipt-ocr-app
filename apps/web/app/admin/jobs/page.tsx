import {
  JOB_STATES,
  jobErrorKinds,
  jobKinds,
  listJobs,
  queueSnapshot,
  type AdminJobRow,
} from "@receipt-ocr/core";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Effect } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { kindLabel } from "@/components/admin/ops/format";
import { QueueAlarms } from "@/components/admin/ops/queue-panel";
import { AdminPageHeader, AdminSection } from "@/components/admin/page-header";
import { Pager } from "@/components/admin/pager";
import { formatDateTime } from "@/lib/format";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { one, PAGE_SIZE, pageOf, pick, type SearchParams } from "../params";
import { ControlButton } from "./job-buttons";
import { STATE_LABELS, stateVariant } from "./states";

export const metadata: Metadata = { title: "Jobs" };

const ERROR_KIND = /^[a-z0-9.-]{1,40}$/;
const link =
  "rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function JobsTable({ rows, filtered }: { rows: AdminJobRow[]; filtered: boolean }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {filtered ? "No jobs match these filters." : "No jobs yet. Each upload and retry adds one."}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[44rem] text-sm">
        <caption className="sr-only">Jobs, newest first</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="px-4 py-2 text-left font-medium" scope="col">
              Job
            </th>
            <th className="px-4 py-2 text-left font-medium" scope="col">
              State
            </th>
            <th className="px-4 py-2 text-right font-medium" scope="col">
              Attempts
            </th>
            <th className="px-4 py-2 text-left font-medium" scope="col">
              Last error
            </th>
            <th className="px-4 py-2 text-left font-medium" scope="col">
              Owner
            </th>
            <th className="px-4 py-2 text-left font-medium" scope="col">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => (
            <tr className="border-b border-border/60 last:border-0" key={job.id}>
              <th className="px-4 py-2 text-left font-normal" scope="row">
                <Link className={`${link} font-mono text-xs`} href={`/admin/jobs/${job.id}`}>
                  {job.id.slice(0, 8)}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {job.kind}
                  {job.round ? ` · try ${job.round}` : ""}
                </span>
              </th>
              <td className="px-4 py-2">
                <Badge variant={stateVariant(job.state)}>
                  {STATE_LABELS[job.state] ?? job.state}
                </Badge>
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">
                {job.attempts}/{job.maxAttempts}
              </td>
              <td className="px-4 py-2 text-xs">
                {job.lastErrorKind ? (
                  kindLabel(job.lastErrorKind)
                ) : (
                  <span className="text-muted-foreground">–</span>
                )}
              </td>
              <td className="max-w-56 px-4 py-2 text-xs">
                {job.userId && job.userEmail ? (
                  <Link className={`${link} block truncate`} href={`/admin/users/${job.userId}`}>
                    {job.userEmail}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Deleted user</span>
                )}
                {job.organizationId && job.workspaceName ? (
                  <Link
                    className={`${link} block truncate`}
                    href={`/admin/workspaces/${job.organizationId}`}
                  >
                    {job.workspaceName}
                  </Link>
                ) : null}
              </td>
              <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                {formatDateTime(job.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminJobsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const params = await searchParams;
  const kinds = jobKinds();
  const errorKind = one(params.error);
  const filters = {
    q: one(params.q),
    state: pick(params.state, JOB_STATES),
    kind: pick(params.kind, kinds),
    errorKind: errorKind && ERROR_KIND.test(errorKind) ? errorKind : undefined,
  };
  const page = pageOf(params.page);
  const [result, errorKinds, queue] = await runtime.runPromise(
    Effect.all([listJobs(filters, { page, pageSize: PAGE_SIZE }), jobErrorKinds, queueSnapshot], {
      concurrency: 2,
    }),
  );
  const pausedQueue = queue.controls.some((c) => c.scope === "queue" && c.paused);
  const pausedKinds = new Set(queue.controls.filter((c) => c.paused).map((c) => c.scope));
  const cooldowns = queue.controls.filter((c) => c.scope.startsWith("provider:"));

  return (
    <>
      <AdminPageHeader
        back={{ href: "/admin/operations", label: "Operations" }}
        description="Every upload and retry runs as a job. Filter by state, kind, last error, or a user or workspace. Only ids and metadata show here, never receipt contents."
        title="Jobs"
      />

      <QueueAlarms queue={queue} />

      <AdminSection
        className="mb-8"
        description="A pause stops new claims; running jobs finish. Every change is audited."
        id="jobs-controls"
        title="Queue controls"
      >
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm">
              <span className="font-medium">Whole queue</span>
              <span className="block text-xs text-muted-foreground">
                {pausedQueue ? "Paused" : "Running"}
              </span>
            </span>
            <ControlButton label="Whole queue" paused={pausedQueue} scope="queue" />
          </li>
          {kinds.map((kind) => {
            const paused = pausedKinds.has(`kind:${kind}`);
            return (
              <li
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                key={kind}
              >
                <span className="text-sm">
                  <span className="font-mono text-xs font-medium">{kind}</span>
                  <span className="block text-xs text-muted-foreground">
                    {paused ? "Paused" : "Running"}
                  </span>
                </span>
                <ControlButton label={kind} paused={paused} scope={`kind:${kind}`} />
              </li>
            );
          })}
          {cooldowns.map((c) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              key={c.scope}
            >
              <span className="text-sm">
                <span className="font-medium">
                  {c.scope.slice("provider:".length)} is cooling down
                </span>
                <span className="block text-xs text-muted-foreground">
                  Until {formatDateTime(c.until)}
                </span>
              </span>
              <ControlButton cooldown label={c.scope} paused={false} scope={c.scope} />
            </li>
          ))}
        </ul>
      </AdminSection>

      <ListToolbar
        searchLabel="Search jobs by id, user email or workspace"
        searchPlaceholder="Id, email or workspace"
        selects={[
          {
            name: "state",
            label: "State",
            options: [
              { value: "any", label: "Any state" },
              ...JOB_STATES.map((s) => ({ value: s, label: STATE_LABELS[s] ?? s })),
            ],
          },
          {
            name: "kind",
            label: "Kind",
            options: [
              { value: "any", label: "Any kind" },
              ...kinds.map((k) => ({ value: k, label: k })),
            ],
          },
          {
            name: "error",
            label: "Last error",
            options: [
              { value: "any", label: "Any error" },
              ...errorKinds.map((k) => ({ value: k, label: kindLabel(k) })),
            ],
          },
        ]}
      />
      <JobsTable filtered={Object.values(filters).some(Boolean)} rows={result.rows} />
      <Pager
        noun={result.capped ? "jobs (counted up to 10,000)" : "jobs"}
        page={page}
        pageSize={PAGE_SIZE}
        params={{
          q: filters.q,
          state: filters.state,
          kind: filters.kind,
          error: filters.errorKind,
        }}
        total={result.total}
      />
    </>
  );
}
