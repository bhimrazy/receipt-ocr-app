// Turns a scripts/load.sh run directory into packages/bench/results/load-<date>.json and .md.
//   bun packages/bench/load/report.mjs <run-dir> <output-prefix>
// Inputs per run: <name>.summary.json (k6), <name>.window ("start end k6-exit"), <name>.pgss.json.
// Shared: samples.tsv (docker stats + Postgres connections), app.log (the app's wide events), meta.json.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, prefix] = process.argv.slice(2);
if (!dir || !prefix) {
  console.error("usage: report.mjs <run-dir> <output-prefix>");
  process.exit(2);
}

const read = (name) => readFileSync(join(dir, name), "utf8");
const readJson = (name) => JSON.parse(read(name));
const meta = readJson("meta.json");

const pct = (values, p) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const round = (n, digits = 1) => (n === null || n === undefined ? null : Number(n.toFixed(digits)));
const max = (values) => (values.length ? Math.max(...values) : null);
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

const toMiB = (text) => {
  const m = /^([\d.]+)\s*(B|KiB|MiB|GiB)/.exec(text ?? "");
  if (!m) return null;
  return Number(m[1]) * { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024 }[m[2]];
};

const samples = { app: [], postgres: [], rustfs: [], k6: [], pg: [], load: [] };
for (const line of read("samples.tsv").split("\n")) {
  const [t, a, b] = line.split("\t");
  if (!t || !a) continue;
  if (a === "load") {
    if (Number.isFinite(Number(b))) samples.load.push({ t: Number(t), load1: Number(b) });
    continue;
  }
  if (a === "pg") {
    const [total, active] = (b ?? "").split(" ").map(Number);
    if (Number.isFinite(total)) samples.pg.push({ t: Number(t), total, active });
    continue;
  }
  try {
    const row = JSON.parse(a);
    const service = ["app", "postgres", "rustfs", "k6"].find((s) => row.Name?.includes(`-${s}-`));
    if (service) {
      samples[service].push({
        t: Number(t),
        cpu: parseFloat(row.CPUPerc),
        memMiB: toMiB(row.MemUsage),
        pids: Number(row.PIDs),
      });
    }
  } catch {
    // A truncated line from a killed sampler.
  }
}

const events = [];
for (const line of read("app.log").split("\n")) {
  if (!line.startsWith("{")) continue;
  try {
    const e = JSON.parse(line);
    if (e.event && e.timestamp) events.push({ ...e, at: Date.parse(e.timestamp) });
  } catch {
    // Not a JSON log line.
  }
}

function resources(start, end) {
  const within = (rows) => rows.filter((r) => r.t >= start && r.t <= end);
  const app = within(samples.app);
  const pg = within(samples.postgres);
  const s3 = within(samples.rustfs);
  const gen = within(samples.k6);
  const hostLoad = within(samples.load);
  const conns = within(samples.pg);
  return {
    samples: app.length,
    appCpuAvg: round(avg(app.map((r) => r.cpu))),
    appCpuMax: round(max(app.map((r) => r.cpu))),
    appCpuP90: round(
      pct(
        app.map((r) => r.cpu),
        90,
      ),
    ),
    hostLoad1m: round(avg(hostLoad.map((r) => r.load1))),
    k6CpuAvg: round(avg(gen.map((r) => r.cpu))),
    appMemMaxMiB: round(max(app.map((r) => r.memMiB))),
    pgCpuMax: round(max(pg.map((r) => r.cpu))),
    pgMemMaxMiB: round(max(pg.map((r) => r.memMiB))),
    storageCpuMax: round(max(s3.map((r) => r.cpu))),
    dbConnectionsMax: max(conns.map((r) => r.total)),
    dbActiveMax: max(conns.map((r) => r.active)),
  };
}

// An event belongs to the latest run that started before it; background extractions finish a few
// seconds after their run ends, so allow a grace period.
const starts = [];
function serverEvents(start, end) {
  const inWindow = events.filter((e) => {
    const owner = Math.max(...starts.filter((s) => s * 1000 <= e.at + 1000), -Infinity);
    return owner === start && e.at <= end * 1000 + 10_000;
  });
  const byName = {};
  for (const e of inWindow) (byName[e.event] ??= []).push(e);
  const out = {};
  for (const [name, list] of Object.entries(byName)) {
    const durations = list.map((e) => e.duration_ms).filter(Number.isFinite);
    const statuses = {};
    for (const e of list)
      statuses[e.status_code ?? e.outcome ?? "n/a"] =
        (statuses[e.status_code ?? e.outcome ?? "n/a"] ?? 0) + 1;
    const steps = {};
    for (const e of list) {
      // `timings_ms` is a map of step to ms; logs from before the wide-event schema had a `timings` array.
      const timings = e.timings_ms
        ? Object.entries(e.timings_ms)
        : (e.timings ?? []).map((s) => [s.step, s.ms]);
      for (const [step, ms] of timings) if (Number.isFinite(ms)) (steps[step] ??= []).push(ms);
    }
    out[name] = {
      count: list.length,
      statuses,
      durationMs: durations.length
        ? {
            p50: pct(durations, 50),
            p95: pct(durations, 95),
            p99: pct(durations, 99),
            max: max(durations),
          }
        : null,
      stepsP95Ms: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, pct(v, 95)])),
    };
  }
  return out;
}

const readPgss = (name) => {
  try {
    return readJson(`${name}.pgss.json`).slice(0, 8);
  } catch {
    return [];
  }
};

const trend = (m) =>
  m
    ? {
        avg: round(m.avg),
        p50: round(m.med),
        p95: round(m["p(95)"]),
        p99: round(m["p(99)"]),
        max: round(m.max),
      }
    : null;

function summarise(name) {
  const [start, end, exit] = read(`${name}.window`).trim().split(" ").map(Number);
  let k6;
  try {
    k6 = readJson(`${name}.summary.json`).metrics;
  } catch {
    // k6 died before writing its summary (setup failed, image missing, OOM).
    return {
      name,
      durationS: end - start,
      passed: false,
      failedThresholds: [`k6 wrote no summary (exit ${exit}); see ${name}.k6.log`],
      requests: 0,
      requestsPerSec: 0,
      iterations: 0,
      droppedIterations: 0,
      errorRate: 100,
      page: null,
      api: null,
      upload: null,
      uploadE2e: null,
      uploads5xx: 0,
      uploadsRateLimited: 0,
      uploadsIncomplete: 0,
      vusMax: null,
      routes: {},
      resources: resources(start, end),
      server: {},
      topStatements: [],
      startedAt: start,
    };
  }
  const failedThresholds = [];
  for (const [metric, m] of Object.entries(k6)) {
    for (const [expr, crossed] of Object.entries(m.thresholds ?? {})) {
      if (crossed) failedThresholds.push(`${metric} ${expr}`);
    }
  }
  const routes = {};
  for (const [metric, m] of Object.entries(k6)) {
    const hit = /^route_(.+)_ms$/.exec(metric);
    if (hit) routes[hit[1]] = trend(m);
  }
  return {
    name,
    durationS: end - start,
    passed: exit === 0 && failedThresholds.length === 0,
    failedThresholds,
    requests: k6.http_reqs?.count ?? 0,
    requestsPerSec: round(k6.http_reqs?.rate ?? 0),
    iterations: k6.iterations?.count ?? 0,
    droppedIterations: k6.dropped_iterations?.count ?? 0,
    errorRate: round((k6.http_req_failed?.value ?? 0) * 100, 2),
    page: trend(k6["http_req_duration{kind:page}"]),
    api: trend(k6["http_req_duration{kind:api}"]),
    upload: trend(k6.upload_ms),
    uploadE2e: trend(k6.upload_e2e_ms),
    uploads5xx: k6.upload_5xx?.count ?? 0,
    uploadsRateLimited: k6.upload_rate_limited?.count ?? 0,
    uploadsIncomplete: k6.upload_incomplete?.count ?? 0,
    vusMax: k6.vus_max?.max ?? null,
    routes,
    resources: resources(start, end),
    server: serverEvents(start, end),
    topStatements: readPgss(name),
    startedAt: start,
  };
}

const windows = readdirSync(dir).filter((f) => f.endsWith(".window"));
for (const f of windows) starts.push(Number(read(f).split(" ")[0]));
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".window"))
  .map((f) => f.replace(/\.window$/, ""));
const runs = names.map(summarise).sort((a, b) => a.startedAt - b.startedAt);

// Capacity: the highest step of each ramp where every threshold held.
function capacity(kind) {
  const steps = runs
    .filter((r) => r.name.startsWith(`capacity-${kind}-`))
    .map((r) => ({ rate: Number(r.name.split("-").pop()), run: r }))
    .sort((a, b) => a.rate - b.rate);
  if (steps.length === 0) return null;
  const passing = steps.filter((s) => s.run.passed);
  const best = passing.length ? passing[passing.length - 1] : null;
  const firstFail = steps.find((s) => !best || (s.rate > best.rate && !s.run.passed));
  return {
    maxSustainableRate: best?.rate ?? null,
    firstFailingRate: firstFail?.rate ?? null,
    failedBecause: firstFail?.run.failedThresholds ?? [],
    atMax: best ? best.run.resources : null,
    atFailure: firstFail ? firstFail.run.resources : null,
    bottleneck: firstFail ? bottleneck(firstFail.run.resources) : null,
  };
}
// Which resource ran out at a step. Active DB connections equal to the pool size means every connection was busy.
function bottleneck(res) {
  const hints = [];
  if (res.appCpuAvg >= 80 || res.appCpuP90 >= 95) hints.push("app CPU saturated");
  if (res.dbActiveMax >= meta.poolMax)
    hints.push(
      `active DB connections at or over DATABASE_POOL_MAX (${res.dbActiveMax} active, max ${meta.poolMax})`,
    );
  if (res.appMemMaxMiB >= 0.85 * parseFloat(meta.appMem) * (/g$/i.test(meta.appMem) ? 1024 : 1))
    hints.push("app memory near the limit");
  if (res.pgCpuMax >= 90 * Number(meta.pgCpus)) hints.push("Postgres CPU saturated");
  if (res.k6CpuAvg >= 300) hints.push("k6 generator may be the limit");
  return hints.length ? hints : ["no resource saturated (check the Docker host load)"];
}
const caps = { reads: capacity("reads"), uploads: capacity("uploads") };

const [oom, restarts] = read("app.state").trim().split(" ");
const result = {
  meta,
  appOomKilled: oom === "true",
  appRestarts: Number(restarts),
  runs,
  capacity: caps,
};
writeFileSync(`${prefix}.json`, JSON.stringify(result, null, 2));

const ms = (v) => (v === null || v === undefined ? "n/a" : `${v}`);
const line = (cells) => `| ${cells.join(" | ")} |`;
const md = [];
md.push(`# Load test, ${meta.date}`, "");
md.push(
  `Commit \`${meta.commit}\`. Production image on a small server: app ${meta.appCpus} vCPU / ${meta.appMem}, Postgres ${meta.pgCpus} vCPU / ${meta.pgMem}, ` +
    `pool max ${meta.poolMax}, simulated model latency ${meta.fixtureLatencyMs} ms, ${meta.users} users with ${meta.receiptsPerUser} receipts each. ` +
    `k6 and the stack share one Docker host (${meta.dockerCpus} CPUs, ${(meta.dockerMemBytes / 2 ** 30).toFixed(1)} GiB). ` +
    `App OOM-killed: ${result.appOomKilled ? "yes" : "no"}, restarts: ${result.appRestarts}.`,
  "",
);

md.push("## Runs", "");
md.push(
  line([
    "run",
    "result",
    "req/s",
    "err %",
    "page p95 ms",
    "api p95 ms",
    "upload p95 ms",
    "upload e2e p95 ms",
    "5xx",
    "dropped",
    "app CPU avg/p90 %",
    "k6 CPU avg %",
    "host load 1m",
    "app mem MiB",
    "DB conns max (active)",
  ]),
);
md.push(line(Array(15).fill("---")));
for (const r of runs) {
  md.push(
    line([
      r.name,
      r.passed ? "pass" : "FAIL",
      r.requestsPerSec,
      r.errorRate,
      ms(r.page?.p95),
      ms(r.api?.p95),
      ms(r.upload?.p95),
      ms(r.uploadE2e?.p95),
      r.uploads5xx,
      r.droppedIterations,
      `${ms(r.resources.appCpuAvg)} / ${ms(r.resources.appCpuP90)}`,
      ms(r.resources.k6CpuAvg),
      ms(r.resources.hostLoad1m),
      ms(r.resources.appMemMaxMiB),
      `${ms(r.resources.dbConnectionsMax)} (${ms(r.resources.dbActiveMax)})`,
    ]),
  );
}
md.push("");
for (const r of runs.filter((x) => !x.passed))
  md.push(`- ${r.name} crossed: ${r.failedThresholds.join("; ") || "k6 exited non-zero"}`);
md.push("");

for (const kind of ["reads", "uploads"]) {
  const c = caps[kind];
  if (!c) continue;
  md.push(`## Capacity: ${kind}`, "");
  md.push(
    c.maxSustainableRate === null
      ? `No step held every threshold; the first failed at ${c.firstFailingRate} iterations/s.`
      : `Highest step with every threshold held: **${c.maxSustainableRate} ${kind === "reads" ? "page/API reads" : "uploads"}/s**. ` +
          (c.firstFailingRate
            ? `First failing step: ${c.firstFailingRate}/s (${c.failedBecause.join("; ")}).`
            : "No step failed."),
  );
  if (c.bottleneck) {
    const r = c.atFailure;
    md.push(
      `At the first failing step: app CPU avg ${r.appCpuAvg}% (p90 ${r.appCpuP90}%), app memory ${r.appMemMaxMiB} MiB, Postgres CPU max ${r.pgCpuMax}%, ` +
        `DB connections ${r.dbConnectionsMax} (${r.dbActiveMax} active, pool max ${meta.poolMax}). Reading: ${c.bottleneck.join("; ")}.`,
    );
  }
  md.push("");
}

md.push("## Latency by route (p95 ms)", "");
const routeNames = [...new Set(runs.flatMap((r) => Object.keys(r.routes)))];
md.push(line(["run", ...routeNames]));
md.push(line(Array(routeNames.length + 1).fill("---")));
for (const r of runs) md.push(line([r.name, ...routeNames.map((n) => ms(r.routes[n]?.p95))]));
md.push("");

md.push("## App wide events (server-side duration_ms)", "");
md.push(line(["run", "event", "count", "p50", "p95", "p99", "statuses", "step p95 ms"]));
md.push(line(Array(8).fill("---")));
for (const r of runs) {
  for (const [name, e] of Object.entries(r.server)) {
    if (!e.durationMs) continue;
    md.push(
      line([
        r.name,
        name,
        e.count,
        e.durationMs.p50,
        e.durationMs.p95,
        e.durationMs.p99,
        Object.entries(e.statuses)
          .map(([k, v]) => `${k}:${v}`)
          .join(" "),
        Object.entries(e.stepsP95Ms)
          .map(([k, v]) => `${k}=${v}`)
          .join(" "),
      ]),
    );
  }
}
md.push("");

const busiest = runs
  .filter((r) => r.name.startsWith("load") || r.name.startsWith("capacity"))
  .sort((a, b) => b.requests - a.requests)[0];
if (busiest) {
  md.push(`## Top Postgres statements (${busiest.name})`, "");
  md.push(line(["calls", "total ms", "mean ms", "query"]));
  md.push(line(Array(4).fill("---")));
  for (const s of busiest.topStatements)
    md.push(line([s.calls, s.total_ms, s.mean_ms, `\`${s.query.replace(/\|/g, "\\|")}\``]));
  md.push("");
}
md.push(
  "## Caveats",
  "",
  `k6, the app, Postgres and RustFS share one Docker host (${meta.dockerCpus} CPUs), so other work on it lowers the numbers; read the host load column before trusting a failed run. ` +
    "Postgres is local, so there is no cross-region latency; a hosted database adds its round trip time to every sequential query. " +
    "The fixture model is a timer, not CPU, sockets or tokens, so real extractions use somewhat more.",
  "",
);
writeFileSync(`${prefix}.md`, md.join("\n"));
