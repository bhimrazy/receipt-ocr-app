import { describe, expect, it, vi } from "vitest";

const ipAddress = vi.hoisted(
  () => ({}) as { ipAddressHeaders?: string[]; trustedProxies?: string[] },
);
vi.mock("server-only", () => ({}));
vi.mock("./runtime", () => ({ runtime: {} }));
vi.mock("./log", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("./env", () => ({ authEnv: { betterAuthUrl: "https://app.example", ipAddress } }));

const { causeDetail, clientIp, crossOriginResponse } = await import("./http");

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
  });

  it("rejects another origin and a missing one", () => {
    expect(crossOriginResponse(mutation({ origin: "https://evil.example" }))?.status).toBe(403);
    expect(crossOriginResponse(mutation({ "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(crossOriginResponse(mutation({}))?.status).toBe(403);
  });
});

describe("causeDetail (L2)", () => {
  it("keeps the failed SQL but drops its bound params", () => {
    const cause = new Error(
      'Failed query: update "receipts" set "merchant" = $1 where "id" = $2\nparams: Jane Doe Pharmacy,0f8f',
    );
    const detail = causeDetail({ cause });
    expect(detail).toContain('update "receipts"');
    expect(detail).not.toContain("Jane Doe");
  });
});
