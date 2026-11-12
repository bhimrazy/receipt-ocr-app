import type { ErrorEvent } from "@sentry/browser";
import { describe, expect, it } from "vitest";
import { parseSentryDsn, sentryRelease } from "./sentry-config";
import { scrubBreadcrumb, scrubEvent } from "./sentry-event";

const DSN =
  "https://0123456789abcdef0123456789abcdef@o4500000000000000.ingest.us.sentry.io/4500000000000001";

describe("parseSentryDsn", () => {
  it("accepts a DSN and gives its ingest origin for the CSP", () => {
    expect(parseSentryDsn(` ${DSN} `)).toEqual({
      dsn: DSN,
      ingestOrigin: "https://o4500000000000000.ingest.us.sentry.io",
    });
  });

  it("refuses anything else, so a pasted token never reaches the bundle (security plan M12)", () => {
    for (const value of [
      undefined,
      "",
      "sntrys_eyJpYXQiOjE3MDAwMDAwMDB9_secret",
      "http://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/1",
      "https://key:secret@o1.ingest.sentry.io/1",
      "https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/api/1/envelope?x=1",
    ]) {
      expect(parseSentryDsn(value)).toBeNull();
    }
  });

  it("names the release by the short commit SHA, as /api/health does", () => {
    expect(sentryRelease({ VERCEL_GIT_COMMIT_SHA: "9bd27c4aaaaaaaa" })).toBe("9bd27c4");
    expect(sentryRelease({})).toBeUndefined();
  });

  it("prefers the commit the deploy workflow passes over Vercel's", () => {
    expect(
      sentryRelease({ GIT_COMMIT_SHA: "aaaaaaa1111", VERCEL_GIT_COMMIT_SHA: "bbbbbbb2222" }),
    ).toBe("aaaaaaa");
    expect(sentryRelease({ GIT_COMMIT_SHA: "", VERCEL_GIT_COMMIT_SHA: "bbbbbbb2222" })).toBe(
      "bbbbbbb",
    );
  });
});

const leaky = (): ErrorEvent => ({
  type: undefined,
  event_id: "e1",
  release: "9bd27c4",
  environment: "production",
  platform: "node",
  server_name: "ip-10-0-0-1",
  user: { id: "u_1", email: "jane@example.com", ip_address: "203.0.113.9" },
  request: {
    url: "https://app.example/api/auth/reset-password/tok123?callbackURL=/x",
    method: "POST",
    headers: { cookie: "better-auth.session_token=abc", authorization: "Bearer x" },
    cookies: { session: "abc" },
    data: { merchant: "Dr Smith Clinic" },
    query_string: "email=jane@example.com",
  },
  extra: { receipt: { total: 9.5 } },
  tags: { route: "/api/receipts/[id]", note: "free text with jane@example.com", request_id: "r-1" },
  contexts: { runtime: { name: "node", version: "v24" }, trace: { trace_id: "t", span_id: "s" } },
  exception: {
    values: [
      {
        type: "AI_TypeValidationError",
        value: 'Type validation failed: Value: {"merchant":"Dr Smith Clinic"}',
        stacktrace: {
          frames: [
            {
              filename: "/var/task/app.js",
              function: "read",
              lineno: 1,
              vars: { total: 9.5 },
              context_line: "const merchant = 'Dr Smith'",
            },
          ],
        },
      },
      { type: "Error", value: "Failed query: select … params: jane@example.com" },
    ],
  },
  breadcrumbs: [
    { category: "console", message: '{"event":"receipt.upload","user_id":"u_1"}' },
    { category: "ui.click", message: "button[aria-label='Delete Dr Smith receipt']" },
    {
      category: "navigation",
      data: { from: "/accept-invitation/inv1?x=1", to: "/app/receipts/abc" },
    },
    { category: "fetch", data: { url: "/api/receipts/abc?x=1", method: "GET", status_code: 500 } },
  ],
});

describe("scrubEvent", () => {
  it("keeps only allowlisted fields: no user, headers, cookies, bodies, extra or query", () => {
    const out = scrubEvent(leaky());
    const text = JSON.stringify(out);
    for (const secret of [
      "jane",
      "Dr Smith",
      "9.5",
      "203.0.113",
      "session_token",
      "abc?",
      "tok123",
      "callbackURL",
      "ip-10-0-0-1",
      "inv1",
      "Bearer",
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(out.request).toEqual({
      url: "https://app.example/api/auth/reset-password/:token",
      method: "POST",
    });
    expect(out.tags).toEqual({ route: "/api/receipts/[id]", request_id: "r-1" });
    expect(out.contexts).toEqual({ runtime: { name: "node", version: "v24" } });
    expect(out.exception?.values?.[0]).toMatchObject({
      type: "AI_TypeValidationError",
      value: "[redacted]",
    });
    expect(out.exception?.values?.[0]?.stacktrace?.frames?.[0]).toEqual({
      filename: "/var/task/app.js",
      function: "read",
      lineno: 1,
    });
    expect(out.exception?.values?.[1]?.value).toBe("Failed query: select … [redacted]");
  });

  it("keeps source-map debug IDs and drops other debug images", () => {
    const id = "0f3e7a52-1b6c-4d2e-8f90-aabbccddeeff";
    const event = leaky();
    event.debug_meta = {
      images: [
        { type: "sourcemap", code_file: "/var/task/app.js?x=1", debug_id: id },
        { type: "sourcemap", code_file: "/var/task/b.js", debug_id: "not an id" },
        { type: "macho", debug_id: id, image_addr: "0x1" },
      ],
    };
    expect(scrubEvent(event).debug_meta).toEqual({
      images: [{ type: "sourcemap", code_file: "/var/task/app.js", debug_id: id }],
    });
    expect(scrubEvent(leaky()).debug_meta).toBeUndefined();
  });

  it("keeps navigation and fetch breadcrumbs with scrubbed URLs, and drops console and clicks (B5)", () => {
    expect(scrubEvent(leaky()).breadcrumbs).toEqual([
      { category: "navigation", data: { from: "/accept-invitation/:id", to: "/app/receipts/:id" } },
      { category: "fetch", data: { url: "/api/receipts/:id", method: "GET", status_code: 500 } },
    ]);
    expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
  });
});
