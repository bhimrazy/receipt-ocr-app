"use client";

import {
  FREE_FAILED_ROUNDS,
  type PlanId,
  type PlanPolicy,
  type PlanTable,
} from "@receipt-ocr/core/plans";
import { Button } from "@receipt-ocr/ui/components/button";
import { Input } from "@receipt-ocr/ui/components/input";
import { toast } from "@receipt-ocr/ui/components/toast";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { savePlansAction } from "../actions";

const FIELDS: { key: keyof PlanPolicy; label: string; hint: string }[] = [
  {
    key: "receiptsPerDay",
    label: "Receipts a day",
    hint: `Counted per user from 00:00 UTC. The first ${FREE_FAILED_ROUNDS} failed reads a day don't count.`,
  },
  {
    key: "receiptsPerMinute",
    label: "Receipts a minute",
    hint: "Burst limit per user, over a rolling minute.",
  },
  {
    key: "batchMax",
    label: "Receipts in one batch",
    hint: "Photos and files a user can add before uploading, from 1 to 50. The limits above still apply to each upload.",
  },
  {
    key: "workspaces",
    label: "Workspaces they can own",
    hint: "Workspaces they join as a member don't count.",
  },
];
const PLANS: { id: PlanId; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "pro", label: "Pro" },
];

type Draft = Record<PlanId, Record<keyof PlanPolicy, string>>;

const toDraft = (table: PlanTable): Draft =>
  Object.fromEntries(
    PLANS.map(({ id }) => [
      id,
      Object.fromEntries(FIELDS.map(({ key }) => [key, String(table[id][key])])),
    ]),
  ) as Draft;

const toTable = (draft: Draft) =>
  Object.fromEntries(
    PLANS.map(({ id }) => [
      id,
      Object.fromEntries(FIELDS.map(({ key }) => [key, Number(draft[id][key])])),
    ]),
  );

/** One number per plan and limit; saved together so a half-applied change can't happen. */
export function PlanLimitsForm({ current, defaults }: { current: PlanTable; defaults: PlanTable }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(current));
  const [saved, setSaved] = useState<Draft>(() => toDraft(current));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const isDefault = JSON.stringify(draft) === JSON.stringify(toDraft(defaults));
  const lowered = PLANS.some(
    ({ id }) => Number(draft[id].receiptsPerDay) < Number(saved[id].receiptsPerDay),
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await savePlansAction(toTable(draft));
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(draft);
    toast.add({ title: "Plan limits saved.", type: "success" });
  }

  return (
    <form noValidate onSubmit={submit}>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="hidden grid-cols-[minmax(0,1fr)_8rem_8rem] gap-4 border-b border-border px-4 py-2.5 text-xs font-medium text-muted-foreground sm:grid">
          <span>Limit</span>
          {PLANS.map((plan) => (
            <span className="text-right" key={plan.id}>
              {plan.label}
            </span>
          ))}
        </div>
        <div className="divide-y divide-border">
          {FIELDS.map((field) => (
            <div
              aria-labelledby={`${field.key}-label`}
              className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_8rem_8rem] sm:items-center sm:gap-4"
              key={field.key}
              role="group"
            >
              <div>
                <p className="text-sm font-medium" id={`${field.key}-label`}>
                  {field.label}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{field.hint}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:contents">
                {PLANS.map((plan) => {
                  const id = `${plan.id}-${field.key}`;
                  return (
                    <div className="flex flex-col gap-1" key={plan.id}>
                      <label className="text-xs text-muted-foreground sm:sr-only" htmlFor={id}>
                        {plan.label} plan
                      </label>
                      <Input
                        className="text-right font-mono tabular-nums"
                        id={id}
                        inputMode="numeric"
                        onChange={(event) =>
                          setDraft((d) => ({
                            ...d,
                            [plan.id]: {
                              ...d[plan.id],
                              [field.key]: event.target.value.replace(/\D/g, ""),
                            },
                          }))
                        }
                        required
                        value={draft[plan.id][field.key]}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {lowered ? (
        <p className="mt-3 text-sm text-warning" role="status">
          Lowering a daily limit stops anyone who already used more today from uploading until 00:00
          UTC.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={!dirty || pending} type="submit">
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : null}
          Save limits
        </Button>
        {dirty ? (
          <Button disabled={pending} onClick={() => setDraft(saved)} type="button" variant="ghost">
            Discard changes
          </Button>
        ) : null}
        {!isDefault ? (
          <Button
            disabled={pending}
            onClick={() => setDraft(toDraft(defaults))}
            type="button"
            variant="ghost"
          >
            Use the defaults
          </Button>
        ) : null}
      </div>
    </form>
  );
}
