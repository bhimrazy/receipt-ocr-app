import type { AdminAuditEntry } from "@receipt-ocr/db";
import { ocrModel } from "@receipt-ocr/ai/models";
import Link from "next/link";
import { formatDateTime } from "@/lib/format";

const LABELS: Record<string, string> = {
  "user.role": "Changed role",
  "user.plan": "Changed plan",
  "user.ban": "Banned user",
  "user.unban": "Lifted ban",
  "user.sessions_revoke": "Signed user out everywhere",
  "user.session_revoke": "Ended one session",
  "user.verification_resend": "Resent verification email",
  "user.delete": "Deleted user",
  "user.impersonate_start": "Started signing in as user",
  "user.impersonate_stop": "Stopped signing in as user",
  "workspace.member_role": "Changed member role",
  "workspace.member_remove": "Removed member",
  "workspace.invitation_cancel": "Cancelled invitation",
  "workspace.delete": "Deleted workspace",
  "settings.plans": "Changed plan limits",
  "settings.ocr": "Changed OCR models",
};

/** `<action>_failed` rows record a Better Auth call that failed after its audit row was written. */
function label(action: string): string {
  const base = action.endsWith("_failed") ? action.slice(0, -"_failed".length) : action;
  const text = LABELS[base] ?? base;
  return base === action ? text : `${text} (failed)`;
}

const cap = (value: unknown) =>
  typeof value === "string" ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : String(value);

type Policy = Record<string, number>;
const FIELDS: [string, string][] = [
  ["receiptsPerDay", "a day"],
  ["receiptsPerMinute", "a minute"],
  ["batchMax", "a batch"],
  ["workspaces", "workspaces"],
];

function planChanges(from: Record<string, Policy>, to: Record<string, Policy>): string {
  const parts: string[] = [];
  for (const plan of Object.keys(to)) {
    for (const [field, unit] of FIELDS) {
      const before = from?.[plan]?.[field];
      const after = to[plan]?.[field];
      if (before !== after) parts.push(`${cap(plan)}: ${before ?? "–"} → ${after} ${unit}`);
    }
  }
  return parts.join(" · ") || "No change";
}

type Chain = { chain: { model: string; enabled: boolean }[] };
const chainText = (value: Chain | undefined) =>
  value?.chain
    ?.filter((step) => step.enabled)
    .map((step) => ocrModel(step.model)?.label ?? step.model)
    .join(" → ") || "none";

/** One plain line describing what changed, from the entry's metadata. */
function details(entry: AdminAuditEntry): string | null {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case "user.role":
    case "user.plan":
      return `${cap(meta.from)} → ${cap(meta.to)}`;
    case "user.ban":
      return meta.days ? `For ${meta.days} ${meta.days === 1 ? "day" : "days"}` : "Permanent";
    case "workspace.member_role":
      return `${meta.member}: ${cap(meta.from)} → ${cap(meta.to)}`;
    case "workspace.member_remove":
      return `${meta.member} (${cap(meta.role)})`;
    case "workspace.invitation_cancel":
      return String(meta.email ?? "");
    case "workspace.delete":
    case "user.delete": {
      const files = Number(meta.files ?? 0);
      return `${files} stored ${files === 1 ? "file" : "files"} deleted`;
    }
    case "settings.plans":
      return planChanges(meta.from as Record<string, Policy>, meta.to as Record<string, Policy>);
    case "settings.ocr":
      return `${chainText(meta.from as Chain)} became ${chainText(meta.to as Chain)}`;
    default:
      return typeof meta.error === "string" ? `Error: ${meta.error}` : null;
  }
}

function targetHref(entry: AdminAuditEntry): string | null {
  if (!entry.targetId || entry.action.endsWith(".delete")) return null;
  if (entry.targetType === "user") return `/admin/users/${entry.targetId}`;
  if (entry.targetType === "workspace") return `/admin/workspaces/${entry.targetId}`;
  if (entry.targetType === "settings") return "/admin/settings";
  return null;
}

/** Newest first. `showTarget` is off on a user's or workspace's own page. */
export function AuditList({
  entries,
  showTarget = true,
  empty = "No admin actions yet.",
}: {
  entries: AdminAuditEntry[];
  showTarget?: boolean;
  empty?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }
  return (
    <ol className="divide-y divide-border rounded-lg border border-border bg-card">
      {entries.map((entry) => {
        const href = targetHref(entry);
        const line = details(entry);
        return (
          <li
            className="grid gap-1 px-4 py-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"
            key={entry.id}
          >
            <time
              className="font-mono text-xs text-muted-foreground tabular-nums sm:pt-0.5"
              dateTime={entry.createdAt.toISOString()}
            >
              {formatDateTime(entry.createdAt)}
            </time>
            <div className="min-w-0 text-sm">
              <p className="break-words">
                <span className="font-medium">{label(entry.action)}</span>
                {/* Settings actions already name their target. */}
                {showTarget && entry.targetLabel && entry.targetType !== "settings" ? (
                  <>
                    {" "}
                    {href ? (
                      <Link
                        className="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        href={href}
                      >
                        {entry.targetLabel}
                      </Link>
                    ) : (
                      <span className="text-foreground">{entry.targetLabel}</span>
                    )}
                  </>
                ) : null}
              </p>
              {line ? <p className="mt-0.5 break-words text-muted-foreground">{line}</p> : null}
              {entry.reason ? (
                <p className="mt-1.5 border-l-2 border-border pl-2.5 break-words text-muted-foreground">
                  Reason: <span className="text-foreground">{entry.reason}</span>
                </p>
              ) : null}
              <p className="mt-1 text-xs break-all text-muted-foreground">By {entry.actorEmail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
