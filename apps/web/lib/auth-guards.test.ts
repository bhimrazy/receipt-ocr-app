import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hits = new Map<string, number>();
const buyers = new Set<string>();
vi.mock("./runtime", () => ({
  runtime: { runPromise: async (result: unknown) => result },
}));
vi.mock("@receipt-ocr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@receipt-ocr/core")>()),
  userPaysForWorkspace: (organizationId: string, userId: string) =>
    buyers.has(`${organizationId}:${userId}`),
  // In-memory stand-in for the rate_limit table.
  hitRateLimit: (key: string, _windowMs: number, max: number) => {
    const count = (hits.get(key) ?? 0) + 1;
    hits.set(key, count);
    return { allowed: count <= max, retryAfterSeconds: 60 };
  },
}));

const {
  INVITES_PER_HOUR,
  assertBuyerStays,
  assertWorkspaceRole,
  limitInvitations,
  validateWorkspaceName,
} = await import("./auth-guards");

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return "ok";
  } catch (error) {
    return error instanceof APIError ? error.status : String(error);
  }
};

beforeEach(() => {
  hits.clear();
  buyers.clear();
});

describe("validateWorkspaceName (P1-1)", () => {
  it("rejects markup and over-long names with 400 on create and update", async () => {
    for (const name of ["Acme</strong><h1>locked</h1>", "x".repeat(81), "x".repeat(20_000)]) {
      expect(await status(validateWorkspaceName({ name }, { required: true }))).toBe("BAD_REQUEST");
      expect(await status(validateWorkspaceName({ name }, { required: false }))).toBe(
        "BAD_REQUEST",
      );
    }
  });

  it("stores the trimmed name", async () => {
    expect(
      await validateWorkspaceName({ name: "  Acme  ", slug: "acme" }, { required: true }),
    ).toEqual({ data: { name: "Acme", slug: "acme" } });
  });

  it("lets an update that doesn't touch the name through, but not a create without one", async () => {
    expect(
      await validateWorkspaceName({ logo: "x" } as { name?: string }, { required: false }),
    ).toBe(undefined);
    expect(await status(validateWorkspaceName({}, { required: true }))).toBe("BAD_REQUEST");
  });
});

describe("limitInvitations (P1-1)", () => {
  it("caps invitations per inviter and answers 429", async () => {
    for (let i = 0; i < INVITES_PER_HOUR; i++)
      expect(await status(limitInvitations("u1"))).toBe("ok");
    expect(await status(limitInvitations("u1"))).toBe("TOO_MANY_REQUESTS");
    // Another inviter has their own budget.
    expect(await status(limitInvitations("u2"))).toBe("ok");
  });
});

describe("assertWorkspaceRole (GHSA-c85h)", () => {
  it("accepts exactly member, admin or owner", () => {
    for (const role of ["member", "admin", "owner"])
      expect(() => assertWorkspaceRole(role)).not.toThrow();
  });

  it("rejects padded or combined roles that Better Auth would parse as owner", () => {
    for (const role of [
      "admin, owner",
      "member,owner",
      " owner",
      "OWNER",
      "",
      undefined,
      ["owner"],
    ]) {
      expect(() => assertWorkspaceRole(role)).toThrow(APIError);
    }
  });
});

describe("assertBuyerStays (M-A)", () => {
  const messageOf = async (action: "remove" | "demote" | "leave") => {
    try {
      await assertBuyerStays("o1", "u1", "Pat", action);
      return "ok";
    } catch (error) {
      return error instanceof APIError ? error.body?.message : String(error);
    }
  };

  it("lets anyone but the buyer of a charging subscription through", async () => {
    expect(await messageOf("remove")).toBe("ok");
    buyers.add("o1:someone-else");
    expect(await messageOf("demote")).toBe("ok");
  });

  it("refuses the buyer, saying what to do", async () => {
    buyers.add("o1:u1");
    const tail = "Cancel the subscription in Billing, or let it end, before";
    expect(await messageOf("remove")).toBe(
      `Pat pays for Pro on this workspace. ${tail} removing them.`,
    );
    expect(await messageOf("demote")).toBe(
      `Pat pays for Pro on this workspace. ${tail} changing the role of them.`,
    );
    expect(await messageOf("leave")).toBe(`You pay for Pro on this workspace. ${tail} leaving.`);
  });
});
