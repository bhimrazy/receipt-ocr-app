import { describe, expect, it, vi } from "vitest";

const ipAddress = vi.hoisted(
  () => ({}) as { ipAddressHeaders?: string[]; trustedProxies?: string[] },
);
vi.mock("server-only", () => ({}));
vi.mock("./runtime", () => ({ runtime: {} }));
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

const { clientIp, crossOriginResponse, discardBody, failureResponse, skipEvent, withRequestEvent } =
  await import("./http");
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

  it("keeps every plan-quota 429: it is the upgrade signal, not a flood", async () => {
    expect(
      await optionsOf({ event: "receipt.upload", route: "/api/receipts" }, (event) => {
        event.outcome = "QuotaExceeded";
        return new Response(null, { status: 429 });
      }),
    ).toEqual({ routine: false });
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
