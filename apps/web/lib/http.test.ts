import { describe, expect, it, vi } from "vitest";

const ipAddress = vi.hoisted(
  () => ({}) as { ipAddressHeaders?: string[]; trustedProxies?: string[] },
);
const runtime = vi.hoisted(() => ({ runPromise: vi.fn() }));
vi.mock("./runtime", () => ({ runtime }));
vi.mock("./log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./log")>()),
  logger: { error: vi.fn(), info: vi.fn(), emit: vi.fn() },
}));
vi.mock("./env", () => ({
  authEnv: {
    betterAuthUrl: "https://app.example",
    // A preview trusts its branch alias and its deployment host.
    trustedOrigins: ["https://app.example", "https://app-git-pr.vercel.app"],
    ipAddress,
  },
}));

const {
  annotateCaller,
  clientIp,
  crossOriginResponse,
  discardBody,
  failureResponse,
  skipEvent,
  withRequestEvent,
} = await import("./http");
const { logger } = await import("./log");

const request = (headers: Record<string, string>) =>
  new Request("https://app.example/api/contact", { method: "POST", headers });

describe("clientIp (P2-6)", () => {
  it("takes the right-most untrusted hop when proxies append to X-Forwarded-For", () => {
    ipAddress.ipAddressHeaders = ["x-forwarded-for"];
    ipAddress.trustedProxies = ["10.0.0.0/24"];
    expect(clientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.7" }))).toBe(
      "203.0.113.9",
    );
  });

  it("never trusts the client-controlled first entry of a multi-hop header", () => {
    ipAddress.ipAddressHeaders = ["x-forwarded-for"];
    ipAddress.trustedProxies = undefined;
    expect(clientIp(request({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).not.toBe("6.6.6.6");
  });

  it("reads only the configured header", () => {
    ipAddress.ipAddressHeaders = ["x-real-ip"];
    ipAddress.trustedProxies = undefined;
    expect(clientIp(request({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "6.6.6.6" }))).toBe(
      "203.0.113.9",
    );
  });
});

describe("crossOriginResponse (L4)", () => {
  const mutation = (headers: Record<string, string>) =>
    new Request("https://app.example/api/receipts/x", { method: "DELETE", headers });

  it("allows the app's own origin", () => {
    expect(crossOriginResponse(mutation({ origin: "https://app.example" }))).toBeNull();
    expect(crossOriginResponse(mutation({ origin: "https://app-git-pr.vercel.app" }))).toBeNull();
  });

  it("rejects another origin and a missing one", () => {
    expect(crossOriginResponse(mutation({ origin: "https://evil.example" }))?.status).toBe(403);
    expect(crossOriginResponse(mutation({ "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(crossOriginResponse(mutation({}))?.status).toBe(403);
  });
});

describe("failureResponse (L2)", () => {
  it("records the error's tag, cause class and SQLSTATE, never the message or params", async () => {
    const { Cause } = await import("effect");
    const { DbError } = await import("@receipt-ocr/core");
    const cause = Object.assign(
      new Error(
        'Failed query: update "receipts" set "merchant" = $1\nparams: Jane Doe Pharmacy,0f8f',
      ),
      { code: "23505" },
    );
    const event = { event: "receipt.update" } as Parameters<typeof failureResponse>[1] & object;
    const res = failureResponse(
      Cause.fail(new DbError({ message: "Update failed", cause })),
      event,
    );
    expect(res.status).toBe(500);
    expect(event.error).toEqual({ type: "DbError", class: "Error", code: "23505" });
    expect(JSON.stringify(event)).not.toContain("Jane Doe");
  });
});

describe("failureResponse error reporting", () => {
  it("reports provider and infra 5xx, never a photo the model couldn't read", async () => {
    const { Cause } = await import("effect");
    const { OcrError } = await import("@receipt-ocr/core");
    const { setErrorReporter } = await import("./telemetry/errors");
    const reported: string[] = [];
    setErrorReporter((report) => void reported.push(String(report.fields.kind)));
    try {
      for (const kind of ["invalid-output", "bad-image", "refused", "unsupported-file"] as const) {
        const res = failureResponse(Cause.fail(new OcrError({ message: "x", kind, attempts: [] })));
        expect(res.status).toBe(502);
      }
      expect(reported).toEqual([]);
      for (const kind of ["timeout", "provider-error"] as const) {
        failureResponse(Cause.fail(new OcrError({ message: "x", kind, attempts: [] })));
      }
      expect(reported).toEqual(["timeout", "provider-error"]);
    } finally {
      setErrorReporter(undefined);
    }
  });
});

describe("failureResponse for NotConfigured", () => {
  it("tells the user nothing about the server's configuration", async () => {
    const { Cause } = await import("effect");
    const { NotConfigured } = await import("@receipt-ocr/core");
    const res = failureResponse(
      Cause.fail(new NotConfigured({ message: "No OCR model is turned on with an API key" })),
    );
    expect(res.status).toBe(503);
    const body = JSON.stringify(await res.json());
    expect(body).toBe('{"error":"This feature isn\'t available right now."}');
  });
});

describe("withRequestEvent", () => {
  it("writes one event with route, method, status, duration and outcome", async () => {
    vi.mocked(logger.emit).mockClear();
    const handler = withRequestEvent(
      { event: "receipt.poll", route: "/api/receipts/[id]", routine: true },
      (_request, _context, event) => {
        event.receipt_id = "r-1";
        return new Response(null, { status: 404 });
      },
    );
    const response = await handler(new Request("https://app.example/api/receipts/r-1?x=1"));
    expect(logger.emit).toHaveBeenCalledTimes(1);
    const [event, options] = vi.mocked(logger.emit).mock.calls[0]!;
    expect(response.headers.get("x-request-id")).toBe(event.request_id);
    expect(event).toMatchObject({
      event: "receipt.poll",
      unit: "request",
      route: "/api/receipts/[id]",
      method: "GET",
      status_code: 404,
      outcome: "rejected",
      receipt_id: "r-1",
    });
    expect(typeof event.duration_ms).toBe("number");
    expect(options).toEqual({ routine: true });
  });

  it("records a thrown error as a 500 and rethrows it", async () => {
    vi.mocked(logger.emit).mockClear();
    const handler = withRequestEvent({ event: "x.y", route: "/api/x" }, () => {
      throw new TypeError("secret receipt text");
    });
    await expect(handler(new Request("https://app.example/api/x"))).rejects.toThrow();
    const [event] = vi.mocked(logger.emit).mock.calls[0]!;
    expect(event).toMatchObject({
      status_code: 500,
      outcome: "error",
      error: { class: "TypeError" },
    });
  });

  const optionsOf = async (
    spec: Parameters<typeof withRequestEvent>[0],
    respond: (event: Parameters<Parameters<typeof withRequestEvent>[1]>[2]) => Response,
  ) => {
    vi.mocked(logger.emit).mockClear();
    await withRequestEvent(spec, (_r, _c, event) => respond(event))(
      new Request("https://app.example/api/x"),
    );
    return vi.mocked(logger.emit).mock.calls[0]?.[1];
  };

  it("decides routine per request, makes every 429 routine, and never a unit with notices", async () => {
    const spec = { event: "x", route: "/api/x" };
    expect(await optionsOf({ ...spec, routine: () => false }, () => new Response())).toEqual({
      routine: false,
    });
    expect(await optionsOf({ ...spec, routine: () => true }, () => new Response())).toEqual({
      routine: true,
    });
    expect(await optionsOf(spec, () => new Response(null, { status: 429 }))).toEqual({
      routine: true,
    });
    expect(
      await optionsOf(
        { ...spec, keepRateLimited: true },
        () => new Response(null, { status: 429 }),
      ),
    ).toEqual({ routine: false });
    expect(
      await optionsOf({ ...spec, routine: true }, (event) => {
        event.notices = ["receipt.calls_not_recorded"];
        return new Response();
      }),
    ).toEqual({ routine: false });
  });

  it("keeps a user's first few plan-quota 429s a minute and samples the rest", async () => {
    const quota429 = (userId?: string) =>
      optionsOf({ event: "receipt.upload", route: "/api/receipts" }, (event) => {
        event.user_id = userId;
        event.outcome = "QuotaExceeded";
        return new Response(null, { status: 429 });
      });
    let count = 0;
    runtime.runPromise.mockImplementation(async () => ({ allowed: ++count <= 3 }));
    for (let i = 0; i < 3; i++) expect(await quota429("u_1")).toEqual({ routine: false });
    expect(await quota429("u_1")).toEqual({ routine: true });
    const [repeat] = vi.mocked(logger.emit).mock.calls[0]!;
    expect(repeat.flags).toEqual({ quota_repeat: true });
    expect(runtime.runPromise).toHaveBeenCalledTimes(4);

    // A counter that fails, and a rejection without a user, are treated as repeats.
    runtime.runPromise.mockRejectedValue(new Error("db down"));
    expect(await quota429("u_1")).toEqual({ routine: true });
    runtime.runPromise.mockClear();
    expect(await quota429()).toEqual({ routine: true });
    expect(runtime.runPromise).not.toHaveBeenCalled();
  });

  it("writes nothing for an event the handler skipped", async () => {
    vi.mocked(logger.emit).mockClear();
    await withRequestEvent({ event: "x", route: "/api/x" }, (_r, _c, event) => {
      skipEvent(event);
      return new Response(null, { status: 429 });
    })(new Request("https://app.example/api/x"));
    expect(logger.emit).not.toHaveBeenCalled();
  });
});

describe("annotateCaller", () => {
  it("marks impersonated requests from the scope alone, or from the session", () => {
    const scope = { userId: "u_1", organizationId: "org_1", impersonatedBy: "admin_1" };
    const fromScope: Parameters<typeof annotateCaller>[0] = { event: "x" };
    annotateCaller(fromScope, { scope });
    expect(fromScope).toMatchObject({
      user_id: "u_1",
      organization_id: "org_1",
      impersonated_by: "admin_1",
    });

    const fromSession: Parameters<typeof annotateCaller>[0] = { event: "x" };
    annotateCaller(fromSession, {
      session: { user: { id: "u_1" }, session: { impersonatedBy: "admin_2" } },
    });
    expect(fromSession.impersonated_by).toBe("admin_2");

    const own: Parameters<typeof annotateCaller>[0] = { event: "x" };
    annotateCaller(own, { scope: { userId: "u_1", organizationId: "org_1" } });
    expect(own).not.toHaveProperty("impersonated_by");
  });
});

describe("discardBody (audit L1)", () => {
  it("cancels an unread body and passes the response through", async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => void (cancelled = true) });
    // @ts-expect-error Node's fetch needs `duplex` for a streamed body.
    const req = new Request("https://app.example/x", { method: "POST", body, duplex: "half" });
    const res = new Response(null, { status: 401 });
    expect(discardBody(req, res)).toBe(res);
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });
});
