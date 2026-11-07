import { ocrModel, type OcrProviderId } from "./models";

/**
 * A free key check per provider: list the models the key can see. No tokens
 * are spent. Results are statuses only. Provider error bodies are read for
 * keywords and then dropped, because they can echo the key.
 */
export const PROVIDER_CHECK_STATUSES = [
  "ok",
  "invalid-key",
  "no-billing-or-quota",
  "rate-limited",
  "unreachable",
  "model-not-available",
] as const;
export type ProviderCheckStatus = (typeof PROVIDER_CHECK_STATUSES)[number];

export type ProviderCheckResult = {
  status: ProviderCheckStatus;
  /** Round trip of the list call(s); null when nothing answered. */
  latencyMs: number | null;
};

export type ProviderCheckInput = {
  apiKey: string;
  /** Full model ids (`google:gemini-3.8-flash`) that must appear in the provider's list. */
  models: readonly string[];
  timeoutMs?: number;
  fetch?: typeof fetch;
};

export const CHECK_TIMEOUT_MS = 5_000;
const MAX_PAGES = 5;

type Page = { ids: string[]; next: string | null };
type Lister = (
  fetcher: typeof fetch,
  apiKey: string,
  cursor: string | null,
  signal: AbortSignal,
) => Promise<{ response: Response; page: () => Promise<Page> }>;

const get = (url: string, headers: Record<string, string>, fetcher: typeof fetch, s: AbortSignal) =>
  fetcher(url, { method: "GET", headers, signal: s, cache: "no-store" });

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/models";
const GROQ_URL = "https://api.groq.com/openai/v1/models";

type Adapter = {
  list: Lister;
  /** Maps a non-2xx response to a status, from its code and (never returned) body text. */
  classify: (status: number, body: string) => ProviderCheckStatus;
  /** Whether a listed id satisfies a wanted bare model id. */
  matches: (listed: string, wanted: string) => boolean;
};

const adapters: Record<Exclude<OcrProviderId, "fixture">, Adapter> = {
  google: {
    list: async (fetcher, apiKey, cursor, signal) => {
      const url = new URL(GEMINI_URL);
      url.searchParams.set("pageSize", "1000");
      if (cursor) url.searchParams.set("pageToken", cursor);
      // The key goes in a header so it never lands in a URL, a log or an error.
      const response = await get(url.toString(), { "x-goog-api-key": apiKey }, fetcher, signal);
      return {
        response,
        page: async () => {
          const json = (await response.json()) as {
            models?: { name?: string }[];
            nextPageToken?: string;
          };
          return {
            ids: (json.models ?? []).flatMap((m) =>
              m.name ? [m.name.replace(/^models\//, "")] : [],
            ),
            next: json.nextPageToken || null,
          };
        },
      };
    },
    classify: (status, body) => {
      // Google answers a bad key with 400 and reason API_KEY_INVALID.
      if (status === 401 || status === 403 || /API_KEY_INVALID/.test(body)) return "invalid-key";
      if (status === 402) return "no-billing-or-quota";
      if (status === 429) {
        // Per-minute and per-day 429s share the "exceeded your current quota" text. The quota
        // id in the details tells them apart: a daily cap, or a limit of 0 (no access on this
        // tier), is a quota problem; anything else is treated as a rate limit.
        return /PerDay|"limit"\s*:\s*"?0"?\b/.test(body) ? "no-billing-or-quota" : "rate-limited";
      }
      return "unreachable";
    },
    matches: (listed, wanted) => listed === wanted,
  },
  anthropic: {
    list: async (fetcher, apiKey, cursor, signal) => {
      const url = new URL(ANTHROPIC_URL);
      url.searchParams.set("limit", "1000");
      if (cursor) url.searchParams.set("after_id", cursor);
      const response = await get(
        url.toString(),
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        fetcher,
        signal,
      );
      return {
        response,
        page: async () => {
          const json = (await response.json()) as {
            data?: { id?: string }[];
            has_more?: boolean;
            last_id?: string;
          };
          return {
            ids: (json.data ?? []).flatMap((m) => (m.id ? [m.id] : [])),
            next: json.has_more && json.last_id ? json.last_id : null,
          };
        },
      };
    },
    classify: (status, body) => {
      if (status === 401 || status === 403) return "invalid-key";
      if (status === 402 || /credit balance|billing/i.test(body)) return "no-billing-or-quota";
      if (status === 429) return "rate-limited";
      return "unreachable";
    },
    // Lists may carry dated snapshots (`claude-x-20260101`) of the bare id we allowlist.
    matches: (listed, wanted) => listed === wanted || listed.startsWith(`${wanted}-`),
  },
  groq: {
    // OpenAI-compatible list: one page, `data[].id`.
    list: async (fetcher, apiKey, _cursor, signal) => {
      const response = await get(GROQ_URL, { authorization: `Bearer ${apiKey}` }, fetcher, signal);
      return {
        response,
        page: async () => {
          const json = (await response.json()) as { data?: { id?: string }[] };
          return { ids: (json.data ?? []).flatMap((m) => (m.id ? [m.id] : [])), next: null };
        },
      };
    },
    classify: (status, body) => {
      if (status === 401 || status === 403) return "invalid-key";
      if (status === 402) return "no-billing-or-quota";
      if (status === 429) {
        // Groq's daily caps name themselves ("per day (TPD)", "(RPD)"); a minute cap clears itself.
        return /\(T?RPD\)|\(TPD\)|per day/i.test(body) ? "no-billing-or-quota" : "rate-limited";
      }
      return "unreachable";
    },
    matches: (listed, wanted) => listed === wanted,
  },
};

/** Statuses only: never throws, never returns provider text. */
export async function checkProvider(
  providerId: OcrProviderId,
  input: ProviderCheckInput,
): Promise<ProviderCheckResult> {
  if (providerId === "fixture") return { status: "ok", latencyMs: 0 };
  const adapter = adapters[providerId];
  const fetcher = input.fetch ?? fetch;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const signal = AbortSignal.timeout(input.timeoutMs ?? CHECK_TIMEOUT_MS);
  try {
    const listed: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const { response, page } = await adapter.list(fetcher, input.apiKey, cursor, signal);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return { status: adapter.classify(response.status, body), latencyMs: elapsed() };
      }
      const { ids, next } = await page();
      listed.push(...ids);
      cursor = next;
      if (!cursor) break;
    }
    const wanted = input.models.flatMap((id) => {
      const model = ocrModel(id);
      return model?.provider === providerId ? [id.slice(providerId.length + 1)] : [];
    });
    const missing = wanted.some((w) => !listed.some((l) => adapter.matches(l, w)));
    return { status: missing ? "model-not-available" : "ok", latencyMs: elapsed() };
  } catch {
    // Timeout, DNS, TLS or a malformed body: the message could quote the request.
    return { status: "unreachable", latencyMs: null };
  }
}
