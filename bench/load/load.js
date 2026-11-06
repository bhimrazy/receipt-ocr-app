// Receipt OCR load scenarios. Run through scripts/load.sh; see the Load test section of bench/README.md.
//
// SCENARIO: smoke | reads | uploads | load | spike | soak
//   RATE_READS / RATE_UPLOADS   iterations per second at steady state
//   DURATION                    steady-state length (default 60s; soak default 30m)
//   SPIKE_MULT                  spike peak as a multiple of the steady rate (default 5)
//   UPLOAD_MODE                 queued (default, what the browser sends) | instant
//   LATENCY_MS                  the app's FIXTURE_LATENCY_MS, to size the end-to-end upload threshold
import http from "k6/http";
import exec from "k6/execution";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import {
  BASE_URL,
  emailOf,
  ipOf,
  PASSWORD,
  postJson,
  receiptId,
  RECEIPTS_PER_USER,
  SESSION_COOKIE,
  USERS,
} from "./lib.js";

const SCENARIO = __ENV.SCENARIO || "load";
const RATE_READS = Number(__ENV.RATE_READS || 20);
const RATE_UPLOADS = Number(__ENV.RATE_UPLOADS || 2);
const DURATION = __ENV.DURATION || (SCENARIO === "soak" ? "30m" : "60s");
const SPIKE_MULT = Number(__ENV.SPIKE_MULT || 5);
const UPLOAD_MODE = __ENV.UPLOAD_MODE === "instant" ? "instant" : "queued";
const LATENCY_MS = Number(__ENV.LATENCY_MS || 3000);
// Sign-in is limited to 5 a minute per IP, so each run signs in from addresses of its own.
const RUN = Number(__ENV.RUN || 0);
const signInIp = (i) => `172.${16 + (RUN % 16)}.${Math.floor(i / 250)}.${i % 250}`;

const jpeg = open("../fixtures/load-receipt.jpg", "b");
const pdf = open("../fixtures/load-receipt.pdf", "b");

const randomReceipt = (user) => receiptId(user, Math.floor(Math.random() * RECEIPTS_PER_USER));

// One Trend per route so the report can show where the time goes.
const ROUTES = {
  landing: { path: () => "/", kind: "page" },
  home: { path: () => "/app", kind: "page" },
  history: { path: () => "/app/history", kind: "page" },
  history_filtered: {
    path: () => "/app/history?q=coffee&category=Meals&status=completed",
    kind: "page",
  },
  history_page2: { path: () => "/app/history?page=2", kind: "page" },
  detail: { path: (u) => `/app/receipts/${randomReceipt(u)}`, kind: "page" },
  export_csv: { path: () => "/api/receipts/export?category=Meals", kind: "api" },
  poll: { path: (u) => `/api/receipts/${randomReceipt(u)}`, kind: "api" },
};
// Roughly a browsing session: details and lists dominate, exports are rare.
const MIX = [
  ["landing", 8],
  ["home", 17],
  ["history", 15],
  ["history_filtered", 10],
  ["history_page2", 5],
  ["detail", 30],
  ["export_csv", 5],
  ["poll", 10],
];
const routeMs = Object.fromEntries(
  Object.keys(ROUTES).map((r) => [r, new Trend(`route_${r}_ms`, true)]),
);

const uploadMs = new Trend("upload_ms", true); // POST until the server answers
const uploadE2eMs = new Trend("upload_e2e_ms", true); // POST until the receipt is completed
const upload5xx = new Counter("upload_5xx");
const uploadLimited = new Counter("upload_rate_limited");
const uploadIncomplete = new Counter("upload_incomplete");

const ramp = (rate, hold) => [
  { target: rate, duration: "15s" },
  { target: rate, duration: hold },
];

const spike = (rate) => [
  { target: rate, duration: "20s" },
  { target: rate * SPIKE_MULT, duration: "10s" },
  { target: rate * SPIKE_MULT, duration: "30s" },
  { target: rate, duration: "10s" },
  { target: rate, duration: "60s" },
];

// An upload holds its VU for the model latency plus polling, so size the pool from the peak rate;
// VUs initialised mid-run would show up as dropped iterations that blame the server for k6's startup.
const arrivals = (fn, stages, holdSeconds) => ({
  executor: "ramping-arrival-rate",
  exec: fn,
  startRate: 1,
  timeUnit: "1s",
  preAllocatedVUs: Math.max(
    50,
    Math.ceil(Math.max(...stages.map((s) => s.target)) * holdSeconds * 1.3),
  ),
  maxVUs: 1000,
  stages,
});
const READ_HOLD = 1;
const UPLOAD_HOLD = LATENCY_MS / 1000 + 3;

const scenarios = {
  smoke: {
    smoke: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 1,
      exec: "smoke",
      maxDuration: "2m",
    },
  },
  reads: { reads: arrivals("reads", ramp(RATE_READS, DURATION), READ_HOLD) },
  uploads: { uploads: arrivals("uploads", ramp(RATE_UPLOADS, DURATION), UPLOAD_HOLD) },
  load: {
    reads: arrivals("reads", ramp(RATE_READS, DURATION), READ_HOLD),
    uploads: arrivals("uploads", ramp(RATE_UPLOADS, DURATION), UPLOAD_HOLD),
  },
  spike: {
    reads: arrivals("reads", spike(RATE_READS), READ_HOLD),
    uploads: arrivals("uploads", spike(RATE_UPLOADS), UPLOAD_HOLD),
  },
  soak: {
    reads: arrivals("reads", ramp(RATE_READS, DURATION), READ_HOLD),
    uploads: arrivals("uploads", ramp(RATE_UPLOADS, DURATION), UPLOAD_HOLD),
  },
}[SCENARIO];
if (!scenarios) throw new Error(`unknown SCENARIO ${SCENARIO}`);

// SLOs. The numbers come from measured runs on 1 vCPU / 1 GB; see bench/README.md.
const slo = {
  http_req_failed: ["rate<0.01"],
  checks: ["rate>0.99"],
  "http_req_duration{kind:page}": ["p(95)<500"],
  "http_req_duration{kind:api}": ["p(95)<300"],
  // Instant mode holds the request through the model call.
  upload_ms: [`p(95)<${UPLOAD_MODE === "instant" ? LATENCY_MS + 1000 : 1000}`],
  upload_e2e_ms: [`p(95)<${LATENCY_MS + 3000}`],
  upload_5xx: ["count==0"],
  upload_incomplete: ["count==0"],
  dropped_iterations: ["count==0"],
};
if (SCENARIO === "spike") {
  // A spike may queue work for a few seconds. It must not error or lose uploads, and pages stay usable.
  delete slo.upload_ms;
  delete slo.dropped_iterations;
  slo["http_req_duration{kind:page}"] = ["p(95)<1500"];
  slo["http_req_duration{kind:api}"] = ["p(95)<1500"];
  slo.upload_e2e_ms = [`p(95)<${LATENCY_MS + 6000}`];
}

export const options = {
  scenarios,
  thresholds: slo,
  setupTimeout: "5m",
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

// Sign every seeded user in once and hold the session, as a logged-in browser would.
export function setup() {
  const sessions = [];
  for (let start = 0; start < USERS; start += 5) {
    const batch = [];
    for (let i = start; i < Math.min(start + 5, USERS); i++) {
      batch.push([
        "POST",
        `${BASE_URL}/api/auth/sign-in/email`,
        JSON.stringify({ email: emailOf(i), password: PASSWORD }),
        {
          headers: {
            "Content-Type": "application/json",
            Origin: BASE_URL,
            "X-Forwarded-For": signInIp(i),
          },
          jar: new http.CookieJar(),
        },
      ]);
    }
    http.batch(batch).forEach((res, k) => {
      const cookie = res.cookies[SESSION_COOKIE];
      if (res.status !== 200 || !cookie) {
        throw new Error(
          `sign-in failed for user ${start + k}: ${res.status} ${res.body}. Run the seed step first.`,
        );
      }
      sessions[start + k] = `${SESSION_COOKIE}=${cookie[0].value}`;
    });
  }
  return { sessions };
}

const headersFor = (sessions, user) => ({
  Cookie: sessions[user],
  "X-Forwarded-For": ipOf(user),
  Origin: BASE_URL,
});

function pickRoute() {
  let n = Math.random() * MIX.reduce((sum, [, w]) => sum + w, 0);
  for (const [name, weight] of MIX) {
    if ((n -= weight) < 0) return name;
  }
  return MIX[0][0];
}

function visit(sessions, user, name) {
  const route = ROUTES[name];
  const res = http.get(`${BASE_URL}${route.path(user)}`, {
    headers: headersFor(sessions, user),
    jar: new http.CookieJar(),
    tags: { kind: route.kind, route: name },
  });
  routeMs[name].add(res.timings.duration);
  check(res, { "read 200": (r) => r.status === 200 });
}

export function reads(data) {
  visit(data.sessions, exec.scenario.iterationInTest % USERS, pickRoute());
}

export function uploads(data) {
  const user = exec.scenario.iterationInTest % USERS;
  const headers = headersFor(data.sessions, user);
  const [name, bytes, type] =
    Math.random() < 0.7
      ? ["receipt.jpg", jpeg, "image/jpeg"]
      : ["receipt.pdf", pdf, "application/pdf"];
  const started = Date.now();
  const res = http.post(
    `${BASE_URL}/api/receipts`,
    { mode: UPLOAD_MODE, file: http.file(bytes, name, type) },
    {
      headers,
      jar: new http.CookieJar(),
      tags: { kind: "upload", route: "upload" },
      responseCallback: http.expectedStatuses(200, 202, 429),
    },
  );
  uploadMs.add(res.timings.duration);
  if (res.status === 429) uploadLimited.add(1);
  if (res.status >= 500) upload5xx.add(1);
  if (!check(res, { "upload accepted": (r) => r.status === 200 || r.status === 202 })) return;

  if (UPLOAD_MODE === "instant") return uploadE2eMs.add(Date.now() - started);
  // The browser polls the receipt until it settles; so do we.
  const id = res.json("receiptId");
  for (let attempt = 0; attempt < 40; attempt++) {
    sleep(1);
    const poll = http.get(`${BASE_URL}/api/receipts/${id}`, {
      headers,
      jar: new http.CookieJar(),
      tags: { kind: "api", route: "poll" },
    });
    routeMs.poll.add(poll.timings.duration);
    if (
      poll.status === 200 &&
      ["completed", "failed", "needs-review"].includes(poll.json("status"))
    ) {
      return uploadE2eMs.add(Date.now() - started);
    }
  }
  uploadIncomplete.add(1);
}

export function smoke(data) {
  for (const name of Object.keys(ROUTES)) visit(data.sessions, 0, name);
  uploads(data);
}
