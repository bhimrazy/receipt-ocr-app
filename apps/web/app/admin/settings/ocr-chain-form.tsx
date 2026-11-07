"use client";

import type { OcrModel, OcrProvider } from "@receipt-ocr/ai/models";
import { Badge } from "@receipt-ocr/ui/components/badge";
import { Button } from "@receipt-ocr/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@receipt-ocr/ui/components/select";
import { Switch } from "@receipt-ocr/ui/components/switch";
import { toast } from "@receipt-ocr/ui/components/toast";
import { ArrowDown, ArrowUp, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { ConnectionRow } from "@receipt-ocr/core";
import { checkChainProvidersAction, saveOcrAction } from "../actions";

type Step = { model: string; enabled: boolean; timeoutMs: number };

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The ordered model list. The first model that is on and has a key reads
 * every receipt; the next ones are tried in order when it times out, is
 * rate-limited or returns a server error.
 */
export function OcrChainForm({
  current,
  models,
  providers,
  available,
}: {
  current: Step[];
  models: OcrModel[];
  providers: OcrProvider[];
  /** Provider id → API key present on the server. */
  available: Record<string, boolean>;
}) {
  const id = useId();
  const [chain, setChain] = useState<Step[]>(current);
  const [saved, setSaved] = useState<Step[]>(current);
  const [adding, setAdding] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [warnings, setWarnings] = useState<ConnectionRow[]>([]);
  const dirty = JSON.stringify(chain) !== JSON.stringify(saved);

  const modelOf = (modelId: string) => models.find((m) => m.id === modelId);
  const providerOf = (modelId: string) =>
    providers.find((p) => p.id === modelOf(modelId)?.provider);
  const runnable = (step: Step) =>
    step.enabled && available[modelOf(step.model)?.provider ?? ""] === true;
  const order = chain.filter(runnable).map((step) => step.model);
  const addable = models.filter((m) => !chain.some((s) => s.model === m.id));

  const move = (index: number, by: number) =>
    setChain((c) => {
      const next = [...c];
      const [step] = next.splice(index, 1);
      next.splice(index + by, 0, step!);
      return next;
    });
  const update = (index: number, patch: Partial<Step>) =>
    setChain((c) => c.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  async function save() {
    setPending(true);
    setError(null);
    setWarnings([]);
    const result = await saveOcrAction({ chain });
    if (!result.ok) {
      setPending(false);
      setError(result.error);
      return;
    }
    setSaved(chain);
    toast.add({ title: "OCR models saved.", type: "success" });
    // Advisory only: the save stands even if a provider is briefly down.
    setPending(false);
    setChecking(true);
    setWarnings(await checkChainProvidersAction({ chain }).catch(() => []));
    setChecking(false);
  }

  return (
    <div>
      <ol className="divide-y divide-border rounded-lg border border-border bg-card">
        {chain.map((step, index) => {
          const model = modelOf(step.model);
          const provider = providerOf(step.model);
          const hasKey = available[model?.provider ?? ""] === true;
          const position = order.indexOf(step.model);
          const name = model?.label ?? step.model;
          return (
            <li
              className="grid gap-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              key={step.model}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{name}</span>
                  {position === 0 ? (
                    <Badge>Active</Badge>
                  ) : position > 0 ? (
                    <Badge variant="secondary">Fallback {position}</Badge>
                  ) : (
                    <Badge variant="outline">Not used</Badge>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-xs break-all text-muted-foreground">
                  {step.model}
                </p>
                <p
                  className={`mt-1 flex items-center gap-1.5 text-xs ${hasKey ? "text-muted-foreground" : "text-warning"}`}
                >
                  <KeyRound aria-hidden="true" className="size-3.5" />
                  {provider?.label ?? "Unknown provider"}:{" "}
                  {provider?.keyEnv
                    ? hasKey
                      ? "API key set"
                      : `no API key (${provider.keyEnv} is empty)`
                    : hasKey
                      ? "no key needed"
                      : "not available here"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <label className="mr-2 flex min-h-11 items-center gap-2 text-sm md:min-h-9">
                  <Switch
                    aria-describedby={hasKey ? undefined : `${id}-nokey`}
                    checked={step.enabled}
                    disabled={!hasKey && !step.enabled}
                    onCheckedChange={(checked) => update(index, { enabled: checked })}
                  />
                  <span>{step.enabled ? "On" : "Off"}</span>
                  <span className="sr-only">: {name}</span>
                </label>
                <Button
                  aria-label={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  aria-label={`Move ${name} down`}
                  disabled={index === chain.length - 1}
                  onClick={() => move(index, 1)}
                  size="icon"
                  variant="ghost"
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
                <Button
                  aria-label={`Remove ${name} from the list`}
                  disabled={chain.length === 1}
                  onClick={() => setChain((c) => c.filter((_, i) => i !== index))}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" id={`${id}-nokey`}>
        This provider has no API key on the server, so it can&apos;t be turned on.
      </p>

      {order.length === 0 ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          No model can run. Turn on a model whose provider has an API key, or uploads will fail.
        </p>
      ) : null}

      {addable.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor={`${id}-add`}>
              Add a model
            </label>
            <Select
              items={addable.map((m) => ({ value: m.id, label: m.label }))}
              onValueChange={(next) => setAdding(next ? String(next) : "")}
              value={adding || null}
            >
              <SelectTrigger className="w-64" id={`${id}-add`}>
                <SelectValue placeholder="Choose a model" />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {addable.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!adding}
            onClick={() => {
              const provider = modelOf(adding)?.provider ?? "";
              setChain((c) => [
                ...c,
                {
                  model: adding,
                  enabled: available[provider] === true,
                  timeoutMs: DEFAULT_TIMEOUT_MS,
                },
              ]);
              setAdding("");
            }}
            type="button"
            variant="outline"
          >
            <Plus aria-hidden="true" />
            Add to the end
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {checking ? (
        <p className="mt-3 text-xs text-muted-foreground" role="status">
          Checking the providers&hellip;
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <div
          className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
          role="status"
        >
          <p className="font-medium">Saved, but a connection check failed.</p>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w.id}>
                {w.label}: {w.hint}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!dirty || pending || order.length === 0} onClick={save}>
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          ) : null}
          Save models
        </Button>
        {dirty ? (
          <Button disabled={pending} onClick={() => setChain(saved)} variant="ghost">
            Discard changes
          </Button>
        ) : null}
      </div>
    </div>
  );
}
