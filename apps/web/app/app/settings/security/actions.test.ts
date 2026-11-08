import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  send: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: mocks.cookieSet }),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { sendVerificationEmail: mocks.send } } }));
vi.mock("@/lib/env", () => ({ isProduction: false }));
vi.mock("@/lib/log", () => ({ errorFields: () => ({}), logger: { error: vi.fn() } }));
vi.mock("@/lib/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/set-password", () => ({ setFirstPassword: vi.fn() }));
vi.mock("@/lib/runtime", () => ({ runtime: {} }));
vi.mock("@receipt-ocr/core", () => ({ clearRateLimit: vi.fn(), hitRateLimit: vi.fn() }));

import { verificationSend } from "@/lib/email-limits";
import { dismissSecurityPromptAction, sendVerificationAction } from "./actions";

const session = (over: { impersonatedBy?: string | null; emailVerified?: boolean } = {}) => ({
  user: { id: "u1", email: "a@example.com", emailVerified: over.emailVerified ?? false },
  session: { impersonatedBy: over.impersonatedBy ?? null },
});

beforeEach(() => vi.clearAllMocks());

describe("sendVerificationAction", () => {
  it("sends the link and reports ok", async () => {
    mocks.getSession.mockResolvedValue(session());
    mocks.send.mockResolvedValue({ status: true });
    expect(await sendVerificationAction()).toEqual({ ok: true });
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("refuses an impersonation session without sending", async () => {
    mocks.getSession.mockResolvedValue(session({ impersonatedBy: "admin1" }));
    expect(await sendVerificationAction()).toMatchObject({ ok: false });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sends nothing when the address was confirmed since the page loaded", async () => {
    mocks.getSession.mockResolvedValue(session({ emailVerified: true }));
    expect(await sendVerificationAction()).toEqual({ ok: true, alreadyVerified: true });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("says so when the per-address cap skipped the send", async () => {
    mocks.getSession.mockResolvedValue(session());
    mocks.send.mockImplementation(async () => {
      const report = verificationSend.getStore();
      if (report) report.suppressed = true;
      return { status: true };
    });
    expect(await sendVerificationAction()).toEqual({
      ok: false,
      error: "We sent a link recently. Try again later.",
    });
  });
});

describe("dismissSecurityPromptAction", () => {
  it("sets the cookie for a normal session", async () => {
    mocks.getSession.mockResolvedValue(session());
    await dismissSecurityPromptAction();
    expect(mocks.cookieSet).toHaveBeenCalledOnce();
  });

  it("does nothing while impersonating", async () => {
    mocks.getSession.mockResolvedValue(session({ impersonatedBy: "admin1" }));
    await dismissSecurityPromptAction();
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });
});
