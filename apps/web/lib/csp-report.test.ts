import { describe, expect, it } from "vitest";
import { blockedHost, createWindowLimiter, parseCspReports, readCappedText } from "./csp-report";

describe("parseCspReports", () => {
  it("reads a report-uri body and keeps only the directive and blocked host", () => {
    const violations = parseCspReports({
      "csp-report": {
        "document-uri": "https://app.example/reset-password/SECRET?callbackURL=x",
        "violated-directive": "script-src-elem 'self'",
        "effective-directive": "script-src-elem",
        "blocked-uri": "https://evil.example:8443/x.js?token=SECRET",
      },
    });
    expect(violations).toEqual([{ directive: "script-src-elem", blocked: "evil.example:8443" }]);
    expect(JSON.stringify(violations)).not.toContain("SECRET");
  });

  it("reads report-to batches and drops other report types", () => {
    const violations = parseCspReports([
      {
        type: "csp-violation",
        url: "https://app.example/app/receipts/123?x=1",
        body: { effectiveDirective: "img-src", blockedURL: "https://cdn.example/a.png?sig=abc" },
      },
      { type: "deprecation", body: { id: "x" } },
      { type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "inline" } },
    ]);
    expect(violations).toEqual([
      { directive: "img-src", blocked: "cdn.example" },
      { directive: "script-src", blocked: "inline" },
    ]);
  });

  it("ignores junk and caps how many reports one request can log", () => {
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports({ hello: 1 })).toEqual([]);
    const many = Array.from({ length: 500 }, () => ({
      type: "csp-violation",
      body: { effectiveDirective: "img-src", blockedURL: "data" },
    }));
    expect(parseCspReports(many)).toHaveLength(20);
    expect(
      parseCspReports({ "csp-report": { "effective-directive": "<script>", "blocked-uri": 5 } }),
    ).toEqual([{ directive: "unknown", blocked: "unknown" }]);
  });
});

describe("blockedHost", () => {
  it.each([
    ["https://a.example/p?q=1", "a.example"],
    ["data:image/png;base64,AAAA", "data"],
    ["blob:https://app.example/uuid", "blob"],
    ["eval", "eval"],
    ["", "unknown"],
    ["not a url with spaces", "unknown"],
  ])("%s -> %s", (input, expected) => {
    expect(blockedHost(input)).toBe(expected);
  });
});

describe("readCappedText", () => {
  const post = (body: string, headers?: Record<string, string>) =>
    new Request("https://app.example/api/csp-report", { method: "POST", body, headers });

  it("returns the body under the cap", async () => {
    expect(await readCappedText(post("hello"), 16)).toBe("hello");
  });

  it("refuses on a declared Content-Length over the cap", async () => {
    expect(await readCappedText(post("x", { "content-length": "999" }), 16)).toBeNull();
  });

  it("refuses a streamed body that grows past the cap", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(10));
        controller.enqueue(new Uint8Array(10));
        controller.close();
      },
    });
    // @ts-expect-error Node's fetch needs `duplex` for a streamed body.
    const req = new Request("https://app.example/x", { method: "POST", body, duplex: "half" });
    expect(await readCappedText(req, 16)).toBeNull();
  });
});

describe("createWindowLimiter", () => {
  it("allows max hits per window per key, then resets", () => {
    const hit = createWindowLimiter(1000, 2);
    expect([hit("a", 0), hit("a", 1), hit("a", 2), hit("b", 2)]).toEqual([true, true, false, true]);
    expect(hit("a", 1000)).toBe(true);
  });

  it("stays bounded in memory", () => {
    const hit = createWindowLimiter(1000, 1, 3);
    for (const key of ["a", "b", "c", "d"]) hit(key, 0);
    // The map was cleared when full, so "a" starts a fresh window.
    expect(hit("a", 1)).toBe(true);
  });
});
