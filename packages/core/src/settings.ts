import {
  OCR_MODELS,
  OCR_PROVIDERS,
  ocrModel,
  type ModelId,
  type OcrProviderId,
} from "@receipt-ocr/ai";
import { appSettings, eq, type DbClient } from "@receipt-ocr/db";
import { Config, Context, Effect, Layer, Option } from "effect";
import { z } from "zod";
import { insertAudit, transact, type AuditActor } from "./audit";
import { InvalidInput, type Conflict, type DbError, type NotFound } from "./errors";
import { DEFAULT_BATCH_MAX, DEFAULT_PLANS, MAX_BATCH, type PlanTable } from "./plans";
import { Db } from "./services";
import { errorFields } from "./telemetry/redact";

/**
 * Runtime settings an admin can change: plan limits and the OCR model chain.
 * Stored as JSON in `app_settings`, validated on write and on read; a missing
 * or invalid row falls back to the code defaults (never to "unlimited").
 */

const count = (max: number) => z.number().int().min(1).max(max);

const policySchema = (batchMax: z.ZodType<number>) =>
  z
    .object({
      workspaces: count(100),
      receiptsPerDay: count(100_000),
      receiptsPerMinute: count(1_000),
      // Rows saved before this field existed get the default.
      batchMax: batchMax.default(DEFAULT_BATCH_MAX),
    })
    .refine((p) => p.receiptsPerMinute <= p.receiptsPerDay, {
      message: "The per-minute limit can't be higher than the daily limit.",
      path: ["receiptsPerMinute"],
    });

const planPolicySchema = policySchema(count(MAX_BATCH));

/** What an admin may save. */
export const planTableSchema = z.object({ free: planPolicySchema, pro: planPolicySchema });

/**
 * What is read back: a stored `batchMax` over MAX_BATCH (saved before the cap was lowered) is
 * clamped, so that one field doesn't send every customised limit back to the defaults.
 */
const storedPolicySchema = policySchema(
  z
    .number()
    .int()
    .min(1)
    .transform((n) => Math.min(n, MAX_BATCH)),
);
export const storedPlanTableSchema = z.object({
  free: storedPolicySchema,
  pro: storedPolicySchema,
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

export const ocrRoutingSchema = z.object({
  chain: z
    .array(ocrStepSchema)
    .min(1)
    .max(5)
    .refine((chain) => new Set(chain.map((s) => s.model)).size === chain.length, {
      message: "Each model can appear once.",
    })
    .superRefine((chain, ctx) => {
      chain.forEach((step, index) => {
        if (step.effort === undefined) return;
        const model = ocrModel(step.model);
        const values = model?.effort?.values;
        if (values?.includes(step.effort)) return;
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

/** The first allowlisted Gemini model: the fallback when GEMINI_MODEL isn't on the list. */
const DEFAULT_GOOGLE_MODEL = OCR_MODELS.find((m) => m.provider === "google")!.id.slice(
  "google:".length,
);

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

/** First choice until an admin saves a chain; steps whose provider has no key are skipped. */
const DEFAULT_PRIMARY_MODEL: ModelId = "anthropic:claude-sonnet-5-5";

/** The chain used until an admin saves one: Claude Sonnet, then the env's Gemini model. */
const defaultOcrRouting: Effect.Effect<OcrRouting> = Effect.all({
  provider: Config.string("OCR_PROVIDER").pipe(Config.withDefault("google")),
  model: Config.string("GEMINI_MODEL").pipe(Config.withDefault(DEFAULT_GOOGLE_MODEL)),
}).pipe(
  Effect.orElseSucceed(() => ({ provider: "google", model: DEFAULT_GOOGLE_MODEL })),
  Effect.flatMap(({ provider, model }) => {
    if (provider === "fixture") return Effect.succeed("fixture" as const);
    const wanted = `google:${model}`;
    if (ocrModel(wanted)) return Effect.succeed(wanted as ModelId);
    // An unlisted model would leave the settings page with nothing that can run.
    return Effect.logWarning("settings.unlisted_model", { ocr: { model: wanted } }).pipe(
      Effect.as(`google:${DEFAULT_GOOGLE_MODEL}` as ModelId),
    );
  }),
  Effect.map((model) => ({
    chain: (model === "fixture" ? [model] : [DEFAULT_PRIMARY_MODEL, model]).map((id) => ({
      model: id,
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
            ? ((yield* parse(ocrRoutingSchema, ocrRow.value, fallbackOcr, "ocr")) as OcrRouting)
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
              key === "plans" ? storedPlanTableSchema : ocrRoutingSchema;
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
