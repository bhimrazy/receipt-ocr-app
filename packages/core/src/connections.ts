import {
  checkProvider,
  OCR_MODELS,
  OCR_PROVIDERS,
  type OcrProvider,
  type ProviderCheckStatus,
} from "@receipt-ocr/ai";
import { Effect } from "effect";
import { recordAudit, type AuditActor } from "./audit";
import { NotConfigured, type DbError } from "./errors";
import { providerKeys } from "./ocr";
import { Settings } from "./settings";
import { Db, Storage } from "./services";
import { hitRateLimit } from "./workspace";
import { annotateEvent } from "./telemetry/current";

/**
 * "Check connections" for admins: is each configured service reachable and
 * accepted right now? Results are statuses and short hints only. Provider and
 * storage error text never leaves this module, because it can echo a key.
 */

export type ConnectionStatus = ProviderCheckStatus | "not-configured" | "failed";

export type ConnectionRow = {
  /** `ai:google`, `storage`. */
  id: string;
  label: string;
  status: ConnectionStatus;
  latencyMs: number | null;
  /** What to do about it; names env vars, never values. */
  hint: string;
};

export const CONNECTION_CHECK_WINDOW_MS = 30_000;
/** Runs the editor triggers after saving the OCR chain: looser, it is one cheap list call per provider. */
export const CHAIN_CHECK_WINDOW_MS = 60_000;
export const CHAIN_CHECK_MAX = 10;
export const TEST_EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const TEST_EMAIL_MAX = 3;
const STORAGE_TIMEOUT_MS = 10_000;

export type Limited = { limited: true; retryAfterSeconds: number };

const aiHint = (provider: OcrProvider, status: ConnectionStatus): string => {
  const env = provider.keyEnv ?? "the API key";
  switch (status) {
    case "ok":
      return "Key accepted and the chosen models are visible. Billing isn't checked.";
    case "invalid-key":
      return `Key rejected: check ${env} in Vercel.`;
    case "no-billing-or-quota":
      return `Billing or quota problem: check the plan and credit for ${provider.label}.`;
    case "rate-limited":
      return `${provider.label} is limiting this key (rate limit). Try again in a minute; if it persists, check its quota.`;
    case "model-not-available":
      return `This key can't see a model in your list. Remove it from the OCR models or use another key (${env}).`;
    case "not-configured":
      return `No key set. Add ${env} to use ${provider.label}.`;
    default:
      return `Couldn't reach ${provider.label}. Check its status page and try again.`;
  }
};

export const storageHint = (status: ConnectionStatus, stage?: string): string => {
  switch (status) {
    case "ok":
      return "Write, read and delete worked.";
    case "not-configured":
      return "Storage isn't configured. Set the S3_* variables.";
    default:
      return `Storage ${stage ?? "request"} failed. Check the S3_* variables and the bucket permissions.`;
  }
};

/** Providers a key-based check applies to, in the order OCR_PROVIDERS lists them. */
const keyed = OCR_PROVIDERS.filter((p) => p.keyEnv !== null);

/**
 * Checks each provider that `models` use (every keyed provider when `models`
 * is empty). A provider with no key reports `not-configured` without a call.
 */
export const checkAiProviders = (
  models: readonly string[],
  options?: { fetch?: typeof fetch },
): Effect.Effect<ConnectionRow[]> =>
  Effect.gen(function* () {
    const keys = yield* providerKeys;
    const wanted = new Set(models.map((id) => OCR_MODELS.find((m) => m.id === id)?.provider));
    const providers = keyed.filter((p) => models.length === 0 || wanted.has(p.id));
    return yield* Effect.forEach(
      providers,
      (provider): Effect.Effect<ConnectionRow> => {
        const apiKey = keys[provider.id as "google" | "anthropic"];
        const row = (status: ConnectionStatus, latencyMs: number | null): ConnectionRow => ({
          id: `ai:${provider.id}`,
          label: provider.label,
          status,
          latencyMs,
          hint: aiHint(provider, status),
        });
        if (!apiKey) return Effect.succeed(row("not-configured", null));
        return Effect.promise(() =>
          checkProvider(provider.id, { apiKey, models, ...options }),
        ).pipe(
          Effect.map((r) => row(r.status, r.latencyMs)),
          // checkProvider never rejects; a defect here must still not leak a message.
          Effect.catchAllDefect(() => Effect.succeed(row("unreachable", null))),
        );
      },
      { concurrency: "unbounded" },
    );
  });

/** Put, get and delete a tiny object under the reserved `_health/` prefix. */
export const checkStorage: Effect.Effect<ConnectionRow, never, Storage> = Effect.gen(function* () {
  const storage = yield* Storage;
  const key = `_health/check-${crypto.randomUUID()}`;
  const body = new TextEncoder().encode(crypto.randomUUID());
  const started = performance.now();
  const row = (status: ConnectionStatus, stage?: string): ConnectionRow => ({
    id: "storage",
    label: "File storage",
    status,
    latencyMs: status === "ok" ? Math.round(performance.now() - started) : null,
    hint: storageHint(status, stage),
  });
  const stage = <A, E>(name: string, step: Effect.Effect<A, E>) =>
    step.pipe(Effect.mapError((error) => ({ name, error })));
  return yield* Effect.gen(function* () {
    yield* stage("write", storage.put(key, body, "text/plain"));
    const back = yield* stage("read", storage.get(key));
    if (back.length !== body.length || back.some((b, i) => b !== body[i])) {
      return yield* Effect.fail({ name: "read", error: undefined });
    }
    yield* stage("delete", storage.remove([key]));
    return row("ok");
  }).pipe(
    Effect.timeoutFail({
      duration: STORAGE_TIMEOUT_MS,
      onTimeout: () => ({ name: "request", error: undefined }),
    }),
    Effect.catchAll((failure) =>
      // Best effort: don't leave the probe object behind.
      Effect.ignore(storage.remove([key])).pipe(
        Effect.as(
          failure.error instanceof NotConfigured
            ? row("not-configured")
            : row("failed", failure.name),
        ),
      ),
    ),
  );
});

/** One run's outcome per service, without anything the providers said. */
const summary = (rows: readonly ConnectionRow[]) =>
  Object.fromEntries(rows.map((r) => [r.id.replace(":", "_"), r.status]));

/**
 * Admin "Check now": AI providers and storage, limited to one run per 30 s per
 * admin. Records an audit row (statuses only) and annotates the wide event.
 */
export const checkConnections = (
  audit: AuditActor,
): Effect.Effect<ConnectionRow[] | Limited, DbError, Db | Settings | Storage> =>
  Effect.gen(function* () {
    const gate = yield* hitRateLimit(
      `admin:connections:${audit.actor.id}`,
      CONNECTION_CHECK_WINDOW_MS,
      1,
    );
    if (!gate.allowed) return { limited: true as const, retryAfterSeconds: gate.retryAfterSeconds };
    const chain = yield* Effect.flatMap(Settings, (s) => s.ocr);
    const models = chain.chain.filter((s) => s.enabled).map((s) => s.model);
    const [ai, storage] = yield* Effect.all([checkAiProviders(models), checkStorage], {
      concurrency: "unbounded",
    });
    const rows = [...ai, storage];
    const failed = rows.filter((r) => r.status !== "ok" && r.status !== "not-configured").length;
    yield* annotateEvent({
      action: "connections.check",
      checks: summary(rows),
      counts: { failed },
    });
    yield* recordAudit({
      ...audit,
      action: "connections.check",
      targetType: "settings",
      targetId: "connections",
      targetLabel: "Connections",
      metadata: { statuses: summary(rows) },
    });
    return rows;
  });

/**
 * After saving the OCR chain: re-check the providers its enabled steps use.
 * Returns only the ones that aren't ok. Limited runs return nothing, because
 * this is a courtesy warning and saving never depends on it.
 */
export const checkChainProviders = (
  adminId: string,
  models: readonly string[],
): Effect.Effect<ConnectionRow[], DbError, Db> =>
  Effect.gen(function* () {
    if (models.length === 0) return [];
    const gate = yield* hitRateLimit(
      `admin:chain-check:${adminId}`,
      CHAIN_CHECK_WINDOW_MS,
      CHAIN_CHECK_MAX,
    );
    if (!gate.allowed) return [];
    const rows = yield* checkAiProviders(models);
    return rows.filter((r) => r.status !== "ok");
  });

export type TestEmailOutcome = "sent" | "not-configured" | "failed";

/** Rate limit and audit row for the admin's own test email; the send happens in the web app's mailer. */
export const gateTestEmail = (adminId: string) =>
  hitRateLimit(`admin:test-email:${adminId}`, TEST_EMAIL_WINDOW_MS, TEST_EMAIL_MAX);

export const recordTestEmail = (audit: AuditActor, outcome: TestEmailOutcome) =>
  recordAudit({
    ...audit,
    action: "connections.test_email",
    targetType: "settings",
    targetId: "connections",
    targetLabel: "Test email",
    metadata: { outcome },
  });
