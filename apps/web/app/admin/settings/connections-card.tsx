"use client";

import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { useState } from "react";
import { checkConnectionsAction, sendTestEmailAction } from "../actions";
import { CONNECTION_STATUS_LABELS, statusTone, testEmailMessage } from "./connection-status";
import type { ConnectionRow } from "@receipt-ocr/core";

/**
 * On-demand check of each configured service. Shows statuses and short hints
 * only; the server never sends provider error text.
 */
export function ConnectionsCard() {
  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  const [emailNote, setEmailNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    const result = await checkConnectionsAction();
    setChecking(false);
    if (result.ok) setRows(result.rows);
    else setError(result.error);
  }

  async function sendTest() {
    setEmailPending(true);
    setEmailNote(null);
    const result = await sendTestEmailAction();
    setEmailPending(false);
    setEmailNote(result.ok ? testEmailMessage(result.outcome) : { ok: false, text: result.error });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={checking} onClick={check}>
          {checking ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <RefreshCw aria-hidden="true" />
          )}
          Check now
        </Button>
        <Button disabled={emailPending} onClick={sendTest} variant="outline">
          {emailPending ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : (
            <Mail aria-hidden="true" />
          )}
          Send test email
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        The test email goes only to your own address. Checks cost no AI tokens.
      </p>

      <div aria-live="polite">
        {error ? (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {emailNote ? (
          <p className={`mt-3 text-sm ${emailNote.ok ? "text-muted-foreground" : "text-warning"}`}>
            {emailNote.text}
          </p>
        ) : null}
      </div>

      {rows ? (
        <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((row) => (
            <li
              className="grid gap-1 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-4"
              key={row.id}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.hint}</p>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <Badge variant={statusTone(row.status)}>
                  {CONNECTION_STATUS_LABELS[row.status]}
                </Badge>
                {row.latencyMs !== null ? (
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {row.latencyMs} ms
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
