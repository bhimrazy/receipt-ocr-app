import { expect, test } from "@playwright/test";

test("health endpoints answer signed out, with no detail beyond statuses", async ({ request }) => {
  const live = await request.get("/api/health");
  expect(live.status()).toBe(200);
  expect(Object.keys(await live.json()).sort()).toEqual(["commit", "ok"]);

  const ready = await request.get("/api/health/ready");
  expect(ready.status()).toBe(200);
  expect(await ready.json()).toMatchObject({
    ok: true,
    checks: { database: "ok", storage: "ok" },
  });
});

test("the CSP reports to /api/csp-report, which accepts both report formats", async ({
  request,
}) => {
  const page = await request.get("/");
  const csp = page.headers()["content-security-policy-report-only"];
  expect(csp).toContain("report-uri /api/csp-report");
  expect(csp).toContain("report-to csp");
  expect(page.headers()["reporting-endpoints"]).toBe('csp="/api/csp-report"');

  const legacy = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify({
      "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://x.example/a" },
    }),
  });
  expect(legacy.status()).toBe(204);
  const modern = await request.post("/api/csp-report", {
    headers: { "content-type": "application/reports+json" },
    data: JSON.stringify([
      { type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "inline" } },
    ]),
  });
  expect(modern.status()).toBe(204);
  const huge = await request.post("/api/csp-report", { data: "x".repeat(20_000) });
  expect(huge.status()).toBe(413);
});

test("security.txt is served and not expired", async ({ request }) => {
  const res = await request.get("/.well-known/security.txt");
  expect(res.status()).toBe(200);
  const text = await res.text();
  expect(text).toMatch(/^Contact: https:\/\//m);
  const expires = /^Expires: (.+)$/m.exec(text)?.[1];
  expect(new Date(expires!).getTime()).toBeGreaterThan(Date.now());
});
