import { OCR_PROVIDERS, ocrModel, type ModelId, type OcrProviderId } from "@receipt-ocr/ai";
import { appSettings, eq, type DbClient } from "@receipt-ocr/db";
import { Config, Context, Effect, Layer, Option } from "effect";
import { z } from "zod";
import { insertAudit, transact, type AuditActor } from "./audit";
import { InvalidInput, type Conflict, type DbError, type NotFound } from "./errors";
import {
  DEFAULT_BATCH_MAX,
  DEFAULT_PLANS,
  MAX_BATCH,
  QUOTA_SCOPES,
  type PlanPolicy,
  type PlanTable,
} from "./plans";
import { Db } from "./services";
import { errorFields } from "./telemetry/redact";

/**
 * Runtime settings an admin can change: plan limits and the OCR model chain.
 * Stored as JSON in `app_settings`, validated on write and on read; a missing
 * or invalid row falls back to the code defaults (never to "unlimited").
 */

const count = (max: number) => z.number().int().min(1).max(max);

/**
 * `defaults` fills fields a stored row predates (it was saved before they existed), so an older
 * save keeps its own numbers and gets the code default for the new ones.
 */
const policySchema = (batchMax: z.ZodType<number>, defaults: PlanPolicy) =>
  z
    .object({
      workspaces: count(100),
      scope: z.enum(QUOTA_SCOPES).default(defaults.scope),
      receiptsPerDay: count(100_000),
      receiptsPerMonth: count(1_000_000).nullable().default(defaults.receiptsPerMonth),
      poolPerDay: count(10_000_000).nullable().default(defaults.poolPerDay),
      receiptsPerMinute: count(1_000),
      batchMax: batchMax.default(DEFAULT_BATCH_MAX),
    })
    .refine((p) => p.receiptsPerMinute <= p.receiptsPerDay, {
      message: "The per-minute limit can't be higher than the daily limit.",
      path: ["receiptsPerMinute"],
    })
    .refine((p) => p.receiptsPerMonth === null || p.receiptsPerDay <= p.receiptsPerMonth, {
      message: "The daily limit can't be higher than the monthly limit.",
      path: ["receiptsPerDay"],
    });

/** What an admin may save. */
export const planTableSchema = z.object({
  free: policySchema(count(MAX_BATCH), DEFAULT_PLANS.free),
  pro: policySchema(count(MAX_BATCH), DEFAULT_PLANS.pro),
});

/**
 * What is read back: a stored `batchMax` over MAX_BATCH (saved before the cap was lowered) is
 * clamped, so that one field doesn't send every customised limit back to the defaults.
 */
const storedBatchMax = z
  .number()
  .int()
  .min(1)
  .transform((n) => Math.min(n, MAX_BATCH));
export const storedPlanTableSchema = z.object({
  free: policySchema(storedBatchMax, DEFAULT_PLANS.free),
  pro: policySchema(storedBatchMax, DEFAULT_PLANS.pro),
});

/** Per-step budget; the whole chain also shares one deadline (see `Ocr`). */
export const DEFAULT_STEP_TIMEOUT_MS = 30_000;

const ocrStepSchema = z.object({
  model: z.string().refine((id) => ocrModel(id) !== undefined, "That model isn't on the list."),
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(5_000).max(50_000).default(DEFAULT_STEP_TIMEOUT_MS),
  /** Reasoning effort; unset runs the model's default. Checked against the model in the chain. */
  effort: z.string().optional(),
});

const chainOf = <S extends z.ZodType<{ model: string }>>(step: S) =>
  z
    .array(step)
    .min(1)
    .max(5)
    .refine((chain) => new Set(chain.map((s) => s.model)).size === chain.length, {
      message: "Each model can appear once.",
    });

const supportsEffort = (model: string, effort: string) =>
  ocrModel(model)?.effort?.values.includes(effort) === true;

/** What an admin may save: an effort the model doesn't list is refused. */
export const ocrRoutingSchema = z.object({
  chain: chainOf(ocrStepSchema).superRefine((chain, ctx) => {
    chain.forEach((step, index) => {
      if (step.effort === undefined || supportsEffort(step.model, step.effort)) return;
      const model = ocrModel(step.model);
      const values = model?.effort?.values;
      ctx.addIssue({
        code: "custom",
        path: [index, "effort"],
        message: values
          ? `${model!.label} doesn't support effort "${step.effort}". Choose one of: ${values.join(", ")}.`
          : `${model?.label ?? step.model} has no effort setting.`,
      });
    });
  }),
});

/**
 * What is read back: a stored effort the model no longer lists (the allowlist changed since the
 * save) is dropped from that step, so one stale value doesn't send the whole chain back to the
 * defaults. The step then runs the model's default.
 */
export const storedOcrRoutingSchema = z.object({
  chain: chainOf(
    ocrStepSchema.transform(({ effort, ...step }) =>
      effort !== undefined && supportsEffort(step.model, effort) ? { ...step, effort } : step,
    ),
  ),
});

export type OcrStep = { model: ModelId; enabled: boolean; timeoutMs: number; effort?: string };
/** Ordered: the first enabled step whose provider has a key is the active model; the rest are fallbacks. */
export type OcrRouting = { chain: OcrStep[] };

export type SettingKey = "plans" | "ocr";

export type SettingsSnapshot = {
  plans: PlanTable;
  ocr: OcrRouting;
  /** When each key was last saved, and by whom; absent while it still uses the defaults. */
  saved: Partial<Record<SettingKey, { updatedAt: Date; updatedBy: string | null }>>;
};

const nonEmpty = (name: string) =>
  Config.option(Config.string(name)).pipe(
    Config.map((value) => Option.isSome(value) && value.value.trim() !== ""),
  );

/** Which providers can run: a key is present in env (the value is never read out). */
export const providerAvailability: Effect.Effect<Record<OcrProviderId, boolean>> = Effect.all(
  Object.fromEntries(
    OCR_PROVIDERS.map((p) => [
      p.id,
      p.keyEnv
        ? nonEmpty(p.keyEnv)
        : // The keyless offline fixture runs only where OCR_PROVIDER=fixture opts in.
          Config.string("OCR_PROVIDER").pipe(
            Config.map((value) => value === "fixture"),
            Config.withDefault(false),
          ),
    ]),
  ) as Record<OcrProviderId, Config.Config<boolean>>,
).pipe(
  Effect.orElseSucceed(
    () =>
      Object.fromEntries(OCR_PROVIDERS.map((p) => [p.id, false])) as Record<OcrProviderId, boolean>,
  ),
);

/**
 * The chain used until an admin saves one. Steps whose provider has no key are skipped (see
 * `activeChain`). No step sets an effort: Haiku runs at low (`CLAUDE_EFFORT`), Flash-Lite at the
 * provider's default (minimal), Groq has none.
 */
export const DEFAULT_OCR_MODELS: readonly ModelId[] = [
  "anthropic:claude-haiku-5-5",
  "google:gemini-3.5-flash-lite",
  "groq:qwen/qwen3.8-27b",
];

/** `OCR_PROVIDER=fixture` swaps the chain for the offline fixture; nothing else configures it. */
const defaultOcrRouting: Effect.Effect<OcrRouting> = Config.string("OCR_PROVIDER").pipe(
  Config.withDefault("google"),
  Effect.orElseSucceed(() => "google"),
  Effect.map((provider) => ({
    chain: (provider === "fixture" ? (["fixture"] as const) : DEFAULT_OCR_MODELS).map((model) => ({
      model,
      enabled: true,
      timeoutMs: DEFAULT_STEP_TIMEOUT_MS,
    })),
  })),
);

const parse = <T>(schema: z.ZodType<T>, value: unknown, fallback: T, key: string) => {
  const result = schema.safeParse(value);
  if (result.success) return Effect.succeed(result.data);
  return Effect.logWarning("settings.invalid_row", { kind: key }).pipe(Effect.as(fallback));
};

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Those values aren't valid.";

export class Settings extends Context.Tag("@receipt-ocr/core/Settings")<
  Settings,
  {
    /** Cached for 30 s per process; the process that saves sees its change at once. */
    readonly get: Effect.Effect<SettingsSnapshot>;
    readonly plans: Effect.Effect<PlanTable>;
    readonly ocr: Effect.Effect<OcrRouting>;
    /**
     * Validates and stores a value with its audit row in one transaction, then
     * drops the cache. Returns the stored value it replaced.
     */
    readonly save: <K extends SettingKey>(
      key: K,
      value: unknown,
      audit: AuditActor,
    ) => Effect.Effect<
      { previous: SettingsSnapshot[K]; next: SettingsSnapshot[K] },
      InvalidInput | Conflict | NotFound | DbError
    >;
  }
>() {
  static readonly Live = Layer.effect(
    Settings,
    Effect.gen(function* () {
      const db = yield* Db;
      const { use } = db;

      const load = Effect.gen(function* () {
        const fallbackOcr = yield* defaultOcrRouting;
        const rows = yield* use((db: DbClient) => db.select().from(appSettings));
        const row = (key: SettingKey) => rows.find((r) => r.key === key);
        const plansRow = row("plans");
        const ocrRow = row("ocr");
        const saved: SettingsSnapshot["saved"] = {};
        for (const r of [plansRow, ocrRow]) {
          if (r) saved[r.key as SettingKey] = { updatedAt: r.updatedAt, updatedBy: r.updatedBy };
        }
        return {
          plans: plansRow
            ? yield* parse(storedPlanTableSchema, plansRow.value, DEFAULT_PLANS, "plans")
            : DEFAULT_PLANS,
          ocr: ocrRow
            ? ((yield* parse(
                storedOcrRoutingSchema,
                ocrRow.value,
                fallbackOcr,
                "ocr",
              )) as OcrRouting)
            : fallbackOcr,
          saved,
        } satisfies SettingsSnapshot;
      }).pipe(
        // A database blip must not lift the limits: serve the defaults, briefly.
        Effect.catchAll((error) =>
          Effect.logError("settings.load_failed", { error: errorFields(error) }).pipe(
            Effect.zipRight(defaultOcrRouting),
            Effect.map((ocr) => ({ plans: DEFAULT_PLANS, ocr, saved: {} })),
          ),
        ),
      );

      const [cached, invalidate] = yield* Effect.cachedInvalidateWithTTL(load, "30 seconds");

      const validate = (key: SettingKey, value: unknown) =>
        Effect.gen(function* () {
          if (key === "plans") {
            const result = planTableSchema.safeParse(value);
            if (!result.success)
              return yield* new InvalidInput({ message: firstIssue(result.error) });
            return result.data;
          }
          const result = ocrRoutingSchema.safeParse(value);
          if (!result.success)
            return yield* new InvalidInput({ message: firstIssue(result.error) });
          const available = yield* providerAvailability;
          const enabled = result.data.chain.filter((step) => step.enabled);
          if (enabled.length === 0) {
            return yield* new InvalidInput({ message: "Turn on at least one model." });
          }
          const missing = enabled.find((step) => !available[ocrModel(step.model)!.provider]);
          if (missing) {
            return yield* new InvalidInput({
              message: `${ocrModel(missing.model)!.label} has no API key on the server, so it can't be turned on.`,
            });
          }
          return result.data;
        });

      return {
        get: cached,
        plans: Effect.map(cached, (s) => s.plans),
        ocr: Effect.map(cached, (s) => s.ocr),
        save: (key, value, audit) =>
          Effect.gen(function* () {
            const next = yield* validate(key, value);
            const fallback = key === "plans" ? DEFAULT_PLANS : yield* defaultOcrRouting;
            const schema: z.ZodType<unknown> =
              key === "plans" ? storedPlanTableSchema : storedOcrRoutingSchema;
            const previous = yield* transact(async (tx) => {
              // Read under a row lock, not from the cache, so `previous` is what this save replaces.
              const [row] = await tx
                .select({ value: appSettings.value })
                .from(appSettings)
                .where(eq(appSettings.key, key))
                .for("update");
              const parsed = row ? schema.safeParse(row.value) : null;
              const previous = parsed?.success ? parsed.data : fallback;
              const now = new Date();
              await tx
                .insert(appSettings)
                .values({ key, value: next, updatedBy: audit.actor.id, updatedAt: now })
                .onConflictDoUpdate({
                  target: appSettings.key,
                  set: { value: next, updatedBy: audit.actor.id, updatedAt: now },
                });
              await insertAudit(tx, {
                ...audit,
                action: `settings.${key}`,
                targetType: "settings",
                targetId: key,
                targetLabel: key === "plans" ? "Plan limits" : "OCR models",
                metadata: { from: previous, to: next },
              });
              return previous;
            }).pipe(Effect.provideService(Db, db));
            yield* invalidate;
            return { previous, next } as never;
          }),
      };
    }),
  );
}
