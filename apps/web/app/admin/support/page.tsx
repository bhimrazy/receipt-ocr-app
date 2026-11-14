import {
  listSupportMessages,
  SUPPORT_RETENTION_MONTHS,
  type AdminSupportRow,
  type SupportStatusFilter,
} from "@receipt-ocr/core";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { buttonVariants } from "@receipt-ocr/ui/components/button";
import { Reply } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ListToolbar } from "@/components/admin/list-toolbar";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Pager } from "@/components/admin/pager";
import { formatDateTime } from "@/lib/format";
import { logPageRender } from "@/lib/page-event";
import { runtime } from "@/lib/runtime";
import { requireAdmin } from "@/lib/session";
import { SITE_NAME } from "@/lib/site";
import { one, PAGE_SIZE, pageOf, pick, type SearchParams } from "../params";
import { StatusButtons } from "./status-buttons";

export const metadata: Metadata = { title: "Support" };

const STATUS_LABELS = { new: "New", open: "Open", closed: "Closed" } as const;
const STATUS_VARIANTS = { new: "warning", open: "default", closed: "secondary" } as const;
const KIND_LABELS = {
  question: "Question",
  problem: "Problem",
  feedback: "Feedback",
  sales: "Sales",
} as const;
const SOURCE_LABELS = {
  help: "In-app help",
  receipt: "Report a problem",
  public: "Public site",
} as const;

const link =
  "rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

const replyHref = (row: AdminSupportRow) =>
  `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(`Re: your message to ${SITE_NAME}`)}`;

const REOPEN_HINTS = {
  new: `Marking it open restarts the ${SUPPORT_RETENTION_MONTHS}-month retention clock.`,
  open: null,
  closed: `Reopening restarts the ${SUPPORT_RETENTION_MONTHS}-month retention clock.`,
} as const;

function Message({ row }: { row: AdminSupportRow }) {
  const reopenHint = REOPEN_HINTS[row.status];
  const headingId = `message-${row.id}`;
  return (
    <li>
      <article aria-labelledby={headingId} className="px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-sm font-medium break-words" id={headingId}>
              {row.name}
            </h2>
            <a
              className={`${link} text-sm break-all`}
              href={`mailto:${encodeURIComponent(row.email)}`}
            >
              {row.email}
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{KIND_LABELS[row.kind]}</Badge>
            <Badge variant={STATUS_VARIANTS[row.status]}>{STATUS_LABELS[row.status]}</Badge>
          </div>
        </div>

        <p className="mt-1 text-xs text-muted-foreground">
          <time className="font-mono tabular-nums" dateTime={row.createdAt.toISOString()}>
            {formatDateTime(row.createdAt)}
          </time>
          {" · "}
          {SOURCE_LABELS[row.source]}
          {" · "}
          <span className="font-mono">{row.id.slice(0, 8)}</span>
          {row.closedAt ? ` · closed ${formatDateTime(row.closedAt)}` : null}
        </p>

        <p className="mt-3 text-sm break-words whitespace-pre-wrap">{row.message}</p>

        {row.userId || row.organizationId || row.receiptId ? (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {row.userId ? (
              <li>
                <Link
                  className={`${link} inline-flex min-h-11 items-center md:min-h-0`}
                  href={`/admin/users/${row.userId}`}
                >
                  Account
                </Link>
              </li>
            ) : null}
            {row.organizationId ? (
              <li className="min-w-0">
                <Link
                  className={`${link} inline-flex min-h-11 max-w-full items-center md:min-h-0`}
                  href={`/admin/workspaces/${row.organizationId}`}
                >
                  <span className="truncate">
                    Workspace: {row.workspaceName ?? row.organizationId}
                  </span>
                </Link>
              </li>
            ) : null}
            {row.receiptId ? (
              <li>
                <Link
                  className={`${link} inline-flex min-h-11 items-center md:min-h-0`}
                  href={`/admin/jobs?q=${row.receiptId}`}
                >
                  Receipt{" "}
                  <span className="ml-1 font-mono text-xs">{row.receiptId.slice(0, 8)}</span>
                  <span className="sr-only">, its jobs</span>
                </Link>
              </li>
            ) : null}
          </ul>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <a className={buttonVariants({ variant: "outline", size: "sm" })} href={replyHref(row)}>
            <Reply aria-hidden="true" />
            Reply by email
          </a>
          <StatusButtons
            messageId={row.id}
            openHintId={reopenHint ? `${row.id}-retention` : undefined}
            sender={row.name}
            status={row.status}
          />
        </div>
        {reopenHint ? (
          <p className="mt-2 text-xs text-muted-foreground" id={`${row.id}-retention`}>
            {reopenHint}
          </p>
        ) : null}
      </article>
    </li>
  );
}

const FILTERS = ["new", "open", "closed", "all"] as const;

export default async function AdminSupportPage({ searchParams }: { searchParams: SearchParams }) {
  logPageRender("/admin/support");
  await requireAdmin();
  const params = await searchParams;
  const q = one(params.q);
  const chosen = pick(params.status, FILTERS);
  const status: SupportStatusFilter | undefined =
    chosen === "all" ? undefined : (chosen ?? "active");
  const page = pageOf(params.page);
  const { rows, total } = await runtime.runPromise(
    listSupportMessages({ status, q }, { page, pageSize: PAGE_SIZE }),
  );

  return (
    <>
      <AdminPageHeader
        description={`Messages sent through the support button, newest first. Messages are deleted ${SUPPORT_RETENTION_MONTHS} months after they are closed; one that isn't closed counts from when it was sent or its status last changed.`}
        title="Support"
      />
      <ListToolbar
        searchLabel="Search support messages by sender name or email"
        searchPlaceholder="Name or email"
        selects={[
          {
            name: "status",
            label: "Status",
            options: [
              { value: "active", label: "New and open" },
              { value: "new", label: "New" },
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
              { value: "all", label: "All messages" },
            ],
          },
        ]}
      />
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {q || chosen
            ? "No messages match these filters."
            : "No messages are waiting for a reply."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((row) => (
            <Message key={row.id} row={row} />
          ))}
        </ul>
      )}
      <Pager
        noun="messages"
        page={page}
        pageSize={PAGE_SIZE}
        params={{ q, status: chosen }}
        total={total}
      />
    </>
  );
}
