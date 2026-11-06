import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { verifyTurnstileToken } from "./turnstile";

const options = { secretKey: "secret" };
const reply = (body: unknown, init?: ResponseInit) =>
  vi.fn(async () => new Response(JSON.stringify(body), init));

describe("verifyTurnstileToken", () => {
  it("accepts a token Cloudflare approves and sends secret, token and IP", async () => {
    const fetchImpl = reply({ success: true });
    await expect(
      verifyTurnstileToken("tok", "1.2.3.4", { ...options, fetchImpl }),
    ).resolves.toEqual({ ok: true });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      secret: "secret",
      response: "tok",
      remoteip: "1.2.3.4",
    });
  });

  it("rejects a valid token minted for another hostname", async () => {
    const fetchImpl = reply({ success: true, hostname: "evil.example" });
    const allowedHostnames = ["app.example"];
    await expect(
      verifyTurnstileToken("tok", null, { ...options, allowedHostnames, fetchImpl }),
    ).resolves.toEqual({ ok: false, reason: "rejected", errorCodes: ["hostname_mismatch"] });
    const missing = reply({ success: true });
    await expect(
      verifyTurnstileToken("tok", null, { ...options, allowedHostnames, fetchImpl: missing }),
    ).resolves.toMatchObject({ ok: false, reason: "rejected" });
  });

  it("accepts a token for an allowed hostname", async () => {
    const fetchImpl = reply({ success: true, hostname: "app.example" });
    await expect(
      verifyTurnstileToken("tok", null, {
        ...options,
        allowedHostnames: ["other.example", "app.example"],
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects a token Cloudflare refuses, with its error codes", async () => {
    const fetchImpl = reply({ success: false, "error-codes": ["invalid-input-response"] });
    await expect(verifyTurnstileToken("bad", null, { ...options, fetchImpl })).resolves.toEqual({
      ok: false,
      reason: "rejected",
      errorCodes: ["invalid-input-response"],
    });
  });

  it("fails without calling Cloudflare when there is no token", async () => {
    const fetchImpl = reply({ success: true });
    for (const token of [undefined, null, ""]) {
      await expect(verifyTurnstileToken(token, null, { ...options, fetchImpl })).resolves.toEqual({
        ok: false,
        reason: "missing",
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when siteverify times out", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    await expect(
      verifyTurnstileToken("tok", null, {
        ...options,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 20,
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });

  it("fails closed on a network error, a non-2xx reply and a body that is not JSON", async () => {
    const failures = [
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
      reply({ success: true }, { status: 500 }),
      vi.fn(async () => new Response("<html>", { status: 200 })),
    ];
    for (const fetchImpl of failures) {
      await expect(verifyTurnstileToken("tok", null, { ...options, fetchImpl })).resolves.toEqual({
        ok: false,
        reason: "unavailable",
      });
    }
  });
});
