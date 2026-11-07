import { jobDetail, listAudit } from "@receipt-ocr/core";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Effect } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuditList } from "@/components/admin/audit-list";
import {
  formatCount,
  formatMs,
  formatUsd,
  kindLabel,
  modelLabel,
} from "@/components/admin/ops/format";
import { AdminPageHeader, AdminSection } from "@/components/admin/page-header";
import { formatDateTime } from "@/lib/format";
import { logPageRender } from "@/lib/page-event";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { JobActions } from "../job-buttons";
import { STATE_LABELS, stateVariant } from "../states";

export const metadata: Metadata = { title: "Job" };

const link =
  "rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

const OUTCOMES: Record<string, string> = {
  succeeded: "Succeeded",
  retry: "Failed, retried",
  deferred: "Waited for a cooldown",
  dead: "Failed for good",
  "lease-expired": "Worker lost",
  "admin-rerun": "Re-run by an admin",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}

/** One job: ids, state, attempt log and the round's model calls. Never receipt contents or images. */
export default async function AdminJobPage({ params }: { params: Promise<{ id: string }> }) {
  logPageRender("/admin/jobs/[id]");
  await requireAdmin();
  const { id } = await params;
  const [job, audit] = await runtime.runPromise(
    Effect.all([
      jobDetail(id),
      listAudit({ targetType: "job", targetId: id }, { page: 1, pageSize: 20 }),
    ]),
  );
  if (!job) notFound();
  const superseded = job.receipt && job.round !== null && job.receipt.attempts !== job.round;

  return (
    <>
      <AdminPageHeader
        actions={<JobActions jobId={job.id} state={job.state} />}
        back={{ href: "/admin/jobs", label: "Jobs" }}
        description={<span className="font-mono text-xs break-all">{job.id}</span>}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {job.kind}
            <Badge variant={stateVariant(job.state)}>{STATE_LABELS[job.state] ?? job.state}</Badge>
          </span>
        }
      />

      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-4">
        <Field label="Attempts">
          <span className="font-mono tabular-nums">
            {job.attempts} of {job.maxAttempts}
          </span>
        </Field>
        <Field label="Last error">
          {job.lastErrorKind ? kindLabel(job.lastErrorKind) : "None"}
        </Field>
        <Field label="Runs at">{formatDateTime(job.runAt)}</Field>
        <Field label="Lease">
          {job.lockedUntil
            ? `${job.lockedBy ?? "?"} until ${formatDateTime(job.lockedUntil)}`
            : "Not held"}
        </Field>
        <Field label="Created">{formatDateTime(job.createdAt)}</Field>
        <Field label="Started">{formatDateTime(job.startedAt) ?? "Not yet"}</Field>
        <Field label="Finished">{formatDateTime(job.finishedAt) ?? "Not yet"}</Field>
        <Field label="Priority">{job.priority}</Field>
        <Field label="Owner">
          {job.userId && job.userEmail ? (
            <Link className={link} href={`/admin/users/${job.userId}`}>
              {job.userEmail}
            </Link>
          ) : (
            "Deleted user"
          )}
        </Field>
        <Field label="Workspace">
          {job.organizationId && job.workspaceName ? (
            <Link className={link} href={`/admin/workspaces/${job.organizationId}`}>
              {job.workspaceName}
            </Link>
          ) : (
            "Deleted workspace"
          )}
        </Field>
        <Field label="Receipt">
          {job.receiptId ? (
            <>
              <span className="font-mono text-xs break-all">{job.receiptId}</span>
              <span className="block text-xs text-muted-foreground">
                {job.receipt
                  ? `Now ${job.receipt.status}, on try ${job.receipt.attempts}${job.round ? `; this job is try ${job.round}` : ""}`
                  : "Deleted"}
              </span>
            </>
          ) : (
            "None"
          )}
        </Field>
      </dl>
      {superseded ? (
        <p className="mt-3 text-sm text-muted-foreground">
          The user retried this receipt since, so the newer try owns it and this job can&apos;t be
          re-run.
        </p>
      ) : null}

      <AdminSection
        className="mt-8"
        description="The last five attempts, oldest first."
        id="job-attempts"
        title="Attempt log"
      >
        {job.attemptLog.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No attempt has finished yet.
          </p>
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border bg-card">
            {job.attemptLog.map((entry, i) => (
              <li
                className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[4rem_12rem_minmax(0,1fr)] sm:gap-4"
                key={`${entry.n}-${i}`}
              >
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  #{entry.n}
                </span>
                <time
                  className="font-mono text-xs text-muted-foreground tabular-nums"
                  dateTime={entry.at}
                >
                  {formatDateTime(entry.at)}
                </time>
                <span>
                  {OUTCOMES[entry.outcome] ?? entry.outcome}
                  {entry.kind ? ` · ${kindLabel(entry.kind)}` : ""}
                  {entry.ms != null ? ` · ${formatMs(entry.ms)}` : ""}
                  {entry.worker ? (
                    <span className="block font-mono text-xs break-all text-muted-foreground">
                      {entry.worker}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </AdminSection>

      <AdminSection
        className="mt-8"
        description="Every model call this job's round made, from the usage ledger."
        id="job-calls"
        title="Model calls"
      >
        {job.calls.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No model calls recorded for this round.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Model calls for this round</caption>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium" scope="col">
                    Attempt
                  </th>
                  <th className="px-4 py-2 text-left font-medium" scope="col">
                    Model
                  </th>
                  <th className="px-4 py-2 text-left font-medium" scope="col">
                    Result
                  </th>
                  <th className="px-4 py-2 text-right font-medium" scope="col">
                    Latency
                  </th>
                  <th className="px-4 py-2 text-right font-medium" scope="col">
                    Tokens in / out
                  </th>
                  <th className="px-4 py-2 text-right font-medium" scope="col">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {job.calls.map((c) => (
                  <tr
                    className="border-b border-border/60 last:border-0"
                    key={`${c.jobAttempt}-${c.step}`}
                  >
                    <th
                      className="px-4 py-2 text-left font-mono text-xs font-normal tabular-nums"
                      scope="row"
                    >
                      {c.jobAttempt}
                      {c.step > 0 ? ` (fallback ${c.step})` : ""}
                    </th>
                    <td className="px-4 py-2 text-xs">
                      {c.model ? modelLabel(c.model) : "No model called"}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {c.status === "ok" ? "Read" : kindLabel(c.status)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                      {formatMs(c.latencyMs)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                      {c.inputTokens == null ? "–" : formatCount(c.inputTokens)} /{" "}
                      {c.outputTokens == null ? "–" : formatCount(c.outputTokens)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                      {c.costMicroUsd == null ? "Unpriced" : formatUsd(c.costMicroUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      <AdminSection className="mt-8" id="job-audit" title="Admin actions on this job">
        <AuditList
          empty="No admin has acted on this job."
          entries={audit.rows}
          showTarget={false}
        />
      </AdminSection>
    </>
  );
}
