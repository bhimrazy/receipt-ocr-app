import "server-only";
import { ExternalLink } from "lucide-react";
import { logStorageName } from "@/lib/processors";

type Tool = {
  name: string;
  /** Env var names that switch it on; only their presence is read, never their values. */
  keys: string[];
  href: (env: NodeJS.ProcessEnv) => string;
  adds: string;
  /** Beyond the keys being set; read without showing any value. */
  matches?: (env: NodeJS.ProcessEnv) => boolean;
};

const TOOLS: Tool[] = [
  {
    name: "Axiom",
    // OTLP export; this card counts it as Axiom only when the endpoint is Axiom's.
    keys: ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS"],
    matches: (env) => logStorageName(env.OTEL_EXPORTER_OTLP_ENDPOINT) === "Axiom",
    href: () => "https://app.axiom.co/",
    adds: "request latency and status per route, from the wide events the app already logs",
  },
  {
    name: "Sentry",
    keys: ["SENTRY_DSN"],
    href: () => "https://sentry.io/issues/",
    adds: "5xx errors with stack traces, grouped and alerted",
  },
  {
    name: "PostHog",
    keys: ["POSTHOG_KEY"],
    // Region only; the host itself isn't shown.
    href: (env) =>
      env.POSTHOG_HOST?.includes("eu.") ? "https://eu.posthog.com/" : "https://us.posthog.com/",
    adds: "product funnels from server-side events (sign-ups, uploads, scans, exports, plan limits)",
  },
];

const configured = (tool: Tool, env: NodeJS.ProcessEnv) =>
  tool.keys.every((key) => Boolean(env[key])) && (tool.matches?.(env) ?? true);

/** "Open in …" for each telemetry tool that is configured; a line on what the others would add. */
export function TelemetryLinks({ env = process.env }: { env?: NodeJS.ProcessEnv }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {TOOLS.map((tool) => (
        <li className="rounded-lg border border-border bg-card p-4 text-sm" key={tool.name}>
          {configured(tool, env) ? (
            <a
              className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
              href={tool.href(env)}
              rel="noreferrer"
              target="_blank"
            >
              Open in {tool.name}
              <ExternalLink aria-hidden="true" className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <>
              <p className="font-medium">{tool.name} is not set up</p>
              <p className="mt-1 text-muted-foreground">
                It would add {tool.adds}. Set{" "}
                {tool.keys.map((key, i) => (
                  <span key={key}>
                    {i > 0 ? " and " : ""}
                    <code className="font-mono text-xs text-foreground">{key}</code>
                  </span>
                ))}{" "}
                to switch it on.
              </p>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
