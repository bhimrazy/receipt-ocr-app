import "server-only";
import { ExternalLink } from "lucide-react";

type Tool = {
  name: string;
  /** Env var names that switch it on; only their presence is read, never their values. */
  keys: string[];
  href: (env: NodeJS.ProcessEnv) => string;
  adds: string;
};

const TOOLS: Tool[] = [
  {
    name: "Axiom",
    keys: ["AXIOM_TOKEN", "AXIOM_DATASET"],
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
    adds: "product funnels and, with browser capture on, web vitals",
  },
];

const configured = (tool: Tool, env: NodeJS.ProcessEnv) =>
  tool.keys.every((key) => Boolean(env[key]));

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
