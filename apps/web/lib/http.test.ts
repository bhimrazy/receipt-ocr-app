import { describe, expect, it, vi } from "vitest";

const ipAddress = vi.hoisted(
  () => ({}) as { ipAddressHeaders?: string[]; trustedProxies?: string[] },
);
vi.mock("server-only", () => ({}));
vi.mock("./runtime", () => ({ runtime: {} }));
vi.mock("./log", () => ({ logger: { error: vi.fn(), info: vi.fn() } }));
vi.mock("./env", () => ({ authEnv: { betterAuthUrl: "https://app.example", ipAddress } }));

const { clientIp } = await import("./http");

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
