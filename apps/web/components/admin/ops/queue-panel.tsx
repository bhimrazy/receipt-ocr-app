import type { OpsQueue } from "@receipt-ocr/core";
import { Alert, AlertDescription, AlertTitle } from "@receipt-ocr/ui/components/alert";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import { formatAge, formatCount } from "./format";

/** The oldest due job waiting longer than this means nothing is draining the queue. */
export const OLDEST_DUE_ALARM_S = 180;
/** No tick for a kind in this long: nothing runs it. */
const TICK_STALE_S = 300;

const link =
  "rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function controlLabel(scope: string) {
  if (scope === "queue") return "Whole queue";
  if (scope.startsWith("kind:")) return `Kind ${scope.slice(5)}`;
  if (scope.startsWith("provider:")) return `Provider ${scope.slice(9)} cooling down`;
  return scope;
}

/** Alarms worth a banner: a paused queue, a stuck backlog, dead workers. */
export function QueueAlarms({ queue }: { queue: OpsQueue }) {
  const paused = queue.controls.filter((c) => c.paused);
  const alarms: { title: string; body: React.ReactNode }[] = [];
  if (paused.length > 0) {
    alarms.push({
      title: "Jobs are paused",
      body: (
        <>
          {paused.map((c) => controlLabel(c.scope)).join(", ")}. Nothing in it runs until resumed on{" "}
          <Link className={link} href="/admin/jobs">
            Jobs
          </Link>
          .
        </>
      ),
    });
  }
  if ((queue.oldestDueSeconds ?? 0) > OLDEST_DUE_ALARM_S) {
    alarms.push({
      title: `The oldest due job has waited ${formatAge(queue.oldestDueSeconds)}`,
      body: "Nothing seems to be draining the queue. Check the last tick per kind below and the server logs.",
    });
  }
  if (queue.expiredLeases > 0) {
    alarms.push({
      title: `${queue.expiredLeases} running ${queue.expiredLeases === 1 ? "job has" : "jobs have"} an expired lease`,
      body: "A worker or function stopped mid-job. The next tick re-queues them (or marks them dead on their last attempt).",
    });
  }
  if (alarms.length === 0) return null;
  return (
    <div className="mb-6 flex flex-col gap-3">
      {alarms.map((a) => (
        <Alert key={a.title} variant="warning">
          <AlertTitle>{a.title}</AlertTitle>
          <AlertDescription>{a.body}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function Row({
  label,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm text-muted-foreground">
        {label}
        {note ? <span className="block text-xs">{note}</span> : null}
      </dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/** The queue right now, as a table of numbers; the jobs page has the rows behind them. */
export function QueuePanel({ queue }: { queue: OpsQueue }) {
  const now = new Date(queue.now).getTime();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <dl className="divide-y divide-border rounded-lg border border-border bg-card px-4">
        <Row
          label="Queued"
          note={`${formatCount(queue.due)} due now, ${formatCount(queue.retrying)} waiting to retry`}
          value={formatCount(queue.queued)}
        />
        <Row label="Running" value={formatCount(queue.running)} />
        <Row label="Expired leases" value={formatCount(queue.expiredLeases)} />
        <Row label="Oldest due job waiting" value={formatAge(queue.oldestDueSeconds)} />
        <Row
          label="Dead, last 24 hours"
          value={
            <Link className={link} href="/admin/jobs?state=dead">
              {formatCount(queue.dead24h)}
            </Link>
          }
        />
      </dl>
      <div className="flex flex-col gap-4">
        <section
          aria-labelledby="ops-controls"
          className="rounded-lg border border-border bg-card p-4"
        >
          <h3 className="text-sm font-medium" id="ops-controls">
            Pauses and cooldowns
          </h3>
          {queue.controls.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None in force.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {queue.controls.map((c) => (
                <li className="py-2" key={c.scope}>
                  <span className="font-medium">{controlLabel(c.scope)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {c.paused ? "Paused" : `Until ${formatDateTime(c.until)}`}
                    {c.reason ? ` · ${c.reason}` : ""}
                    {c.updatedBy ? ` · by ${c.updatedBy}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section
          aria-labelledby="ops-ticks"
          className="rounded-lg border border-border bg-card p-4"
        >
          <h3 className="text-sm font-medium" id="ops-ticks">
            Last queue run per kind
          </h3>
          {queue.ticks.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No queue run recorded yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {queue.ticks.map((t) => {
                const age = (now - new Date(t.at).getTime()) / 1000;
                return (
                  <li className="flex items-baseline justify-between gap-3 py-2" key={t.kind}>
                    <span className="min-w-0 truncate font-mono text-xs">{t.kind}</span>
                    <span className={age > TICK_STALE_S ? "text-warning" : "text-muted-foreground"}>
                      {formatAge(age)} ago
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {queue.byKind.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Live by kind:{" "}
              {queue.byKind
                .map((k) => `${k.kind} ${k.queued} queued, ${k.running} running`)
                .join(" · ")}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
